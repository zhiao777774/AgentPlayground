import { Router } from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { modelRegistry } from '../server.js';
import { SessionMeta } from '../models/ResourceMeta.js';
import { ExternalChatSession } from '../models/ExternalIntegration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const sessionsDir = path.resolve(__dirname, '../../memory/sessions');

function getExternalSessionFields(externalSession: any) {
    if (!externalSession) return {};
    return {
        isExternal: true,
        readOnly: true,
        externalAgentId: externalSession.agentId,
        externalSystemId: externalSession.systemId,
        externalUserId: externalSession.externalUserId,
    };
}

// Create a new session
router.post('/', async (req, res) => {
    try {
        const sessionManager = SessionManager.create(
            process.cwd(),
            sessionsDir,
        );
        sessionManager.newSession();
        sessionManager.appendSessionInfo('');

        // Manually flush to disk — SessionManager defers writes until an
        // assistant message is appended, which never happens for session creation.
        const sessionFile = sessionManager.getSessionFile();
        if (sessionFile && !fs.existsSync(sessionFile)) {
            const header = sessionManager.getHeader();
            const entries = sessionManager.getEntries();
            const content =
                [header, ...entries]
                    .map((e: any) => JSON.stringify(e))
                    .join('\n') + '\n';
            fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
            fs.writeFileSync(sessionFile, content);
        }

        const fullId = sessionManager.getSessionId();
        console.log(
            `[DEBUG POST /sessions] Created session. ID=${fullId}, file=${sessionFile}`,
        );

        await SessionMeta.create({
            id: fullId,
            ownerId: req.user!.id,
            ownerName: req.user!.displayName,
            name: 'New Session'
        });

        res.status(201).json({
            sessionId: fullId,
            message: 'Session created',
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

// Retrieve an existing session
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const authMeta = await SessionMeta.findOne({
            id,
            $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
        });
        if (!authMeta) {
            return res.status(404).json({ error: 'Session not found or unauthorized' });
        }

        const externalSession = await ExternalChatSession.findOne({
            sessionId: id,
        });

        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const session = sessions.find((s) => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const filePath = session.path;
        const messages: any[] = [];
        let activeAgentId: string | null = null;
        let modelId: string = 'default';
        const agentRoutingEntries: Array<{
            id: string;
            parentId: string | null;
            agentId: string | null;
        }> = [];
        let contextUsage: any = null;

        if (fs.existsSync(filePath)) {
            const lines = fs
                .readFileSync(filePath, 'utf-8')
                .split('\n')
                .filter(Boolean);

            // Parse ALL entries first to build a complete parent lookup map
            const entryById = new Map<string, any>();

            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.id) {
                        entryById.set(entry.id, entry);
                    }
                } catch (e) {
                    console.warn('Failed to parse session entry line', e);
                }
            }
            
            // Deduplicate entries while preserving initial chronological order
            const allEntries: any[] = Array.from(entryById.values());

            // Extract the latest agent_routing entry to restore state
            for (let i = allEntries.length - 1; i >= 0; i--) {
                const entry = allEntries[i];
                if (
                    entry.type === 'custom' &&
                    entry.customType === 'agent_routing'
                ) {
                    activeAgentId = entry.data?.agentId || null;
                    break;
                }
            }

            // Collect ids of toolResult messages so we skip them as standalone entries
            // (they are embedded into assistant messages' toolCalls array instead)
            const toolResultIds = new Set<string>();
            for (const entry of allEntries) {
                if (entry.type === 'message' && entry.message?.role === 'toolResult') {
                    toolResultIds.add(entry.id);
                }
            }

            // Collect ids of internal background operations (like memory flush) to hide
            // We use structural backtracking: traverse backwards from 'memory_flush_checkpoint'
            // and hide all messages until we exit the background task bounds.
            const hiddenMessageIds = new Set<string>();
            const flushCheckpoints = allEntries.filter(
                (e) => e.type === 'custom' && e.customType === 'memory_flush_checkpoint'
            );

            for (const cp of flushCheckpoints) {
                let currentId = cp.parentId;
                while (currentId) {
                    const currentEntry = entryById.get(currentId);
                    if (!currentEntry) break;

                    // The boundary of the background task is marked by 'thinking_level_change'
                    // or if we encounter a visible user interaction threshold.
                    if (currentEntry.type === 'thinking_level_change') {
                        break;
                    }
                    if (currentEntry.type === 'message' && currentEntry.message?.role === 'user') {
                        break;
                    }
                    if (currentEntry.type === 'custom_message') {
                        break;
                    }

                    // Hide ALL messages (whether assistant text or internal tool usage) generated during the flush
                    if (currentEntry.type === 'message') {
                        hiddenMessageIds.add(currentEntry.id);
                    }

                    currentId = currentEntry.parentId;
                }
            }

            // Helper: find the nearest displayable message-type ancestor for a given parentId.
            // Traverses up through intermediate entries (model_change, thinking_level_change, etc.)
            // AND through hidden toolResult entries, stopping at the first visible message.
            // This ensures sibling messages share the correct resolved parentId even after branching.
            const findNearestMessageParent = (
                parentId: string | null,
            ): string | null => {
                let currentId = parentId;
                const visited = new Set<string>();
                while (currentId && !visited.has(currentId)) {
                    visited.add(currentId);
                    const parent = entryById.get(currentId);
                    if (!parent) return null;
                    // Stop at visible message entries (not hidden toolResult entries)
                    if (
                        (parent.type === 'message' &&
                            !toolResultIds.has(parent.id) &&
                            !hiddenMessageIds.has(parent.id)) ||
                        parent.type === 'custom_message' ||
                        parent.type === 'compaction'
                    )
                        return parent.id;
                    currentId = parent.parentId;
                }
                return null;
            };

            // Build a children-by-parent map for toolResult lookup
            const childrenByParent = new Map<string, any[]>();
            for (const entry of allEntries) {
                if (entry.type === 'message' && entry.parentId) {
                    if (!childrenByParent.has(entry.parentId)) {
                        childrenByParent.set(entry.parentId, []);
                    }
                    childrenByParent.get(entry.parentId)!.push(entry);
                }
            }

            // Pre-compute the activeAgentId for each entry in the tree
            const agentIdByEntry = new Map<string, string | null>();
            for (const entry of allEntries) {
                let currentAgentId: string | null = null;
                // Inherit from parent first
                if (entry.parentId && agentIdByEntry.has(entry.parentId)) {
                    currentAgentId = agentIdByEntry.get(entry.parentId)!;
                }
                // Override if this is an explicit routing event
                if (
                    entry.type === 'custom' &&
                    entry.customType === 'agent_routing'
                ) {
                    currentAgentId = entry.data?.agentId || null;
                }
                agentIdByEntry.set(entry.id, currentAgentId);
            }

            // Now extract message entries with resolved parentIds
            for (const entry of allEntries) {
                if (entry.type === 'message' && entry.message) {
                    // Skip toolResult messages — they are embedded in assistant messages' toolCalls
                    // Also skip hidden background messages like NO_REPLY
                    if (toolResultIds.has(entry.id) || hiddenMessageIds.has(entry.id)) continue;

                    const msg = entry.message;
                    let textContent = '';
                    let reasoningContent = '';
                    const toolCalls: any[] = [];

                    if (Array.isArray(msg.content)) {
                        textContent = msg.content
                            .filter((c: any) => c.type === 'text')
                            .map((c: any) => c.text || '')
                            .join('');
                        textContent += msg.errorMessage || '';
                        reasoningContent = msg.content
                            .filter((c: any) => c.type === 'thinking')
                            .map((c: any) => c.thinking || '')
                            .join('');

                        // Reconstruct toolCalls from toolCall blocks in assistant content
                        const toolCallBlocks = msg.content.filter(
                            (c: any) => c.type === 'toolCall',
                        );
                        if (toolCallBlocks.length > 0) {
                            const children =
                                childrenByParent.get(entry.id) || [];
                            const toolResults = children.filter(
                                (c: any) => c.message?.role === 'toolResult',
                            );
                            for (const tc of toolCallBlocks) {
                                const result = toolResults.find(
                                    (r: any) => r.message?.toolCallId === tc.id,
                                );

                                // Forward citation details to the frontend
                                if (result?.message?.details?.citations) {
                                    if (!msg.citations) msg.citations = {};
                                    Object.assign(
                                        msg.citations,
                                        result.message.details.citations,
                                    );
                                }
                                toolCalls.push({
                                    name: tc.name,
                                    input: tc.arguments,
                                    status: result
                                        ? result.message.isError
                                            ? 'error'
                                            : 'success'
                                        : 'success',
                                    output: result
                                        ? Array.isArray(result.message.content)
                                            ? result.message.content
                                                  .filter(
                                                      (c: any) =>
                                                          c.type === 'text',
                                                  )
                                                  .map((c: any) => c.text || '')
                                                  .join('')
                                            : typeof result.message.content ===
                                                'string'
                                              ? result.message.content
                                              : ''
                                        : '',
                                });
                            }
                        }
                    }

                    messages.push({
                        id: entry.id,
                        parentId: findNearestMessageParent(entry.parentId),
                        createdAt: entry.timestamp,
                        role: msg.role,
                        content: textContent,
                        toolCalls: toolCalls,
                        reasoning: reasoningContent,
                        activeAgentId: agentIdByEntry.get(entry.id) || null,
                        citations: msg.citations || undefined,
                        errorMessage: msg.errorMessage || undefined,
                        stopReason: msg.stopReason || undefined,
                    });
                } else if (entry.type === 'custom_message') {
                    // Map custom_message as a standard visible message node in the frontend
                    const role =
                        entry.customType === 'static_cmd_user'
                            ? 'user'
                            : 'assistant';
                    let textContent = '';
                    if (Array.isArray(entry.content)) {
                        textContent = entry.content
                            .map((c: any) => c.text || '')
                            .join('');
                    } else if (typeof entry.content === 'string') {
                        textContent = entry.content;
                    }

                    messages.push({
                        id: entry.id,
                        parentId: findNearestMessageParent(entry.parentId),
                        createdAt: entry.timestamp,
                        role: role,
                        content: textContent,
                        toolCalls: [],
                        activeAgentId: agentIdByEntry.get(entry.id) || null,
                    });
                } else if (
                    entry.type === 'custom' &&
                    entry.customType === 'agent_routing'
                ) {
                    activeAgentId = entry.data?.agentId || null;
                    agentRoutingEntries.push({
                        id: entry.id,
                        parentId: findNearestMessageParent(entry.parentId),
                        agentId: entry.data?.agentId || null,
                    });
                } else if (entry.type === 'compaction') {
                    // Turn compaction events into visible system messages
                    // so users know the context window was summarized.
                    messages.push({
                        id: entry.id,
                        parentId: findNearestMessageParent(entry.parentId),
                        createdAt: entry.timestamp,
                        role: 'system',
                        isCompaction: true,
                        content: `**[System Note: Context Limit Reached]**\n\nThe previous conversation history has been automatically compressed to save tokens. The agent now remembers the following summary:\n\n> ${entry.summary}`,
                        toolCalls: [],
                        activeAgentId: agentIdByEntry.get(entry.id) || null,
                    });
                }
            }

            // Post-process: Propagate citations forward through consecutive assistant messages.
            // When pi-agent streams, it creates a toolCall message -> toolResult -> final text message.
            // Citations are initially pinned to the toolCall message. We shift them down to the
            // final text message so the Markdown citations can resolve correctly and the References
            // block only renders once at the very end of the turn.
            for (const msg of messages) {
                if (msg.role === 'assistant') {
                    const parent = messages.find((m) => m.id === msg.parentId);
                    if (parent && parent.role === 'assistant') {
                        if (parent.citations) {
                            msg.citations = {
                                ...parent.citations,
                                ...(msg.citations || {}),
                            };
                            delete parent.citations;
                        }
                    }
                }
            }

            // Extract context usage metrics from the session history
            for (let i = allEntries.length - 1; i >= 0; i--) {
                const entry = allEntries[i];
                if (entry.type === 'model_change') {
                    modelId = (entry as any).modelId || 'default';
                    break;
                }
            }
            const availableModels = modelRegistry.getAvailable();
            const model =
                availableModels.find((m: any) => m.id === modelId) ||
                availableModels[0];
            const contextWindow = model?.contextWindow || 128000;

            for (let i = allEntries.length - 1; i >= 0; i--) {
                const entry = allEntries[i];
                if (
                    entry.type === 'message' &&
                    entry.message?.role === 'assistant'
                ) {
                    const usage = (entry.message as any)?.usage;
                    const stopReason = (entry.message as any)?.stopReason;

                    if (usage) {
                        const tokens =
                            (usage.input || 0) +
                            (usage.output || 0) +
                            (usage.cacheRead || 0) +
                            (usage.cacheWrite || 0);

                        // If hitting an error or no tokens, continue searching backward to find the last valid measurement
                        if (tokens === 0 || stopReason === 'error') {
                            continue;
                        }

                        contextUsage = {
                            tokens,
                            contextWindow,
                            percent: (tokens / contextWindow) * 100,
                        };
                        break;
                    }
                }
            }
        }

        res.json({
            ...session,
            messages,
            activeAgentId,
            lastModelId: modelId !== 'default' ? modelId : undefined,
            agentRoutingEntries,
            contextUsage,
            ownerId: authMeta.ownerId,
            ownerName: authMeta.ownerName,
            sharedWith: authMeta.sharedWith,
            isShared: authMeta.ownerId !== userId,
            ...getExternalSessionFields(externalSession),
        });
    } catch (error) {
        console.error('Error retrieving session:', error);
        res.status(500).json({ error: 'Failed to retrieve session' });
    }
});

// Update session name
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const userId = req.user!.id;

        const authMeta = await SessionMeta.findOne({ id, ownerId: userId });
        if (!authMeta) {
            return res.status(403).json({ error: 'Only the session owner can rename it' });
        }

        if (await ExternalChatSession.exists({ sessionId: id })) {
            return res.status(403).json({
                error: 'External sessions are read-only in the internal UI',
            });
        }

        if (typeof name !== 'string') {
            return res.status(400).json({ error: 'Name is required' });
        }

        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const sessionRecord = sessions.find((s) => s.id === id);

        if (!sessionRecord) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Directly append a session_info entry to the JSONL file.
        const infoEntry = {
            type: 'session_info',
            id: Math.random().toString(36).slice(2, 10),
            parentId: null,
            timestamp: new Date().toISOString(),
            name,
        };
        fs.appendFileSync(sessionRecord.path, JSON.stringify(infoEntry) + '\n');

        await SessionMeta.updateOne({ id }, { name });

        res.json({ message: 'Session updated successfully' });
    } catch (error) {
        console.error('Error updating session:', error);
        res.status(500).json({ error: 'Failed to update session' });
    }
});

// Delete a session
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const authMeta = await SessionMeta.findOne({ id, ownerId: userId });
        if (!authMeta) {
            return res.status(403).json({ error: 'Only the session owner can delete it' });
        }

        if (await ExternalChatSession.exists({ sessionId: id })) {
            return res.status(403).json({
                error: 'External sessions are read-only in the internal UI',
            });
        }

        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const sessionRecord = sessions.find((s) => s.id === id);

        // Remove from database even if local file is missing
        await SessionMeta.deleteOne({ id });

        if (!sessionRecord) {
            return res.status(404).json({ error: 'Session not found locally' });
        }

        if (fs.existsSync(sessionRecord.path)) {
            fs.unlinkSync(sessionRecord.path);
        }

        // Clean up tmp sandbox
        const sessionTmpDir = path.join(process.cwd(), 'memory', 'tmp', id);
        if (fs.existsSync(sessionTmpDir)) {
            fs.rmSync(sessionTmpDir, { recursive: true, force: true });
        }

        res.json({ message: 'Session deleted successfully' });
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// List all sessions
router.get('/', async (req, res) => {
    try {
        const userId = req.user!.id;
        const authMetas: any[] = await SessionMeta.find({
            $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
        });
        
        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const externalSessions: any[] = await ExternalChatSession.find({
            sessionId: { $in: authMetas.map((meta) => meta.id) },
        });
        
        const metaMap = new Map(authMetas.map(m => [m.id, m]));
        const externalMap = new Map(
            externalSessions.map((session) => [session.sessionId, session]),
        );
        const filteredSessions = sessions
            .filter(s => metaMap.has(s.id))
            .map(s => {
                const meta = metaMap.get(s.id);
                const externalSession = externalMap.get(s.id);
                return {
                    ...s,
                    ownerId: meta?.ownerId || 'unknown',
                    ownerName: meta?.ownerName || 'Unknown',
                    sharedWith: meta?.sharedWith || [],
                    isShared: meta ? meta.ownerId !== userId : false,
                    ...getExternalSessionFields(externalSession),
                };
            });

        res.json(filteredSessions);
    } catch (error) {
        console.error('Error listing sessions:', error);
        res.status(500).json({ error: 'Failed to list sessions' });
    }
});

// Share a session
router.post('/:id/share', async (req, res) => {
    try {
        const { id } = req.params;
        const { targetUserId, targetUserName } = req.body;
        const userId = req.user!.id;

        if (!targetUserId || !targetUserName) return res.status(400).json({ error: 'targetUserId and targetUserName are required' });

        const session = await SessionMeta.findOne({ id, ownerId: userId });
        if (!session) return res.status(404).json({ error: 'Session not found or not owned by you' });

        if (await ExternalChatSession.exists({ sessionId: id })) {
            return res.status(403).json({
                error: 'External sessions are read-only in the internal UI',
            });
        }

        if (!session.sharedWith.some((p: any) => p.userId === targetUserId)) {
            session.sharedWith.push({ userId: targetUserId, name: targetUserName });
            await session.save();
        }

        res.json({ message: 'Session shared successfully', sharedWith: session.sharedWith });
    } catch (error) {
        console.error('Error sharing session:', error);
        res.status(500).json({ error: 'Failed to share session' });
    }
});

// Unshare a session
router.delete('/:id/share/:targetUserId', async (req, res) => {
    try {
        const { id, targetUserId } = req.params;
        const userId = req.user!.id;

        const session = await SessionMeta.findOne({ id, ownerId: userId });
        if (!session) return res.status(404).json({ error: 'Session not found or not owned by you' });

        if (await ExternalChatSession.exists({ sessionId: id })) {
            return res.status(403).json({
                error: 'External sessions are read-only in the internal UI',
            });
        }

        session.sharedWith = session.sharedWith.filter((p: any) => p.userId !== targetUserId);
        await session.save();

        res.json({ message: 'Session unshared successfully', sharedWith: session.sharedWith });
    } catch (error) {
        console.error('Error unsharing session:', error);
        res.status(500).json({ error: 'Failed to unshare session' });
    }
});

export default router;
