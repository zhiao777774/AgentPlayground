import { Router } from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import path from 'path';
import { fileURLToPath } from 'url';
import { modelRegistry } from '../server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const sessionsDir = path.resolve(__dirname, '../../memory/sessions');

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

        res.status(201).json({
            sessionId: fullId,
            message: 'Session created',
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
    }
});

import fs from 'fs';

// Retrieve an existing session
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sessions = await SessionManager.list(process.cwd(), sessionsDir);

        // Find session — flexible matching: UUID or full timestamped ID
        const session = sessions.find(
            (s) =>
                s.id === id ||
                s.id.endsWith(`_${id}`) ||
                id.endsWith(`_${s.id}`),
        );

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const filePath = session.path;
        const messages: any[] = [];
        let activeAgentId: string | null = null;
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
            const allEntries: any[] = [];
            const entryById = new Map<string, any>();

            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.id) {
                        allEntries.push(entry);
                        entryById.set(entry.id, entry);
                    }
                } catch (e) {
                    console.warn('Failed to parse session entry line', e);
                }
            }

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
                if (
                    entry.type === 'message' &&
                    entry.message?.role === 'toolResult'
                ) {
                    toolResultIds.add(entry.id);
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
                            !toolResultIds.has(parent.id)) ||
                        parent.type === 'custom_message'
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
                    if (toolResultIds.has(entry.id)) continue;

                    const msg = entry.message;
                    let textContent = '';
                    let reasoningContent = '';
                    const toolCalls: any[] = [];

                    if (Array.isArray(msg.content)) {
                        textContent = msg.content
                            .filter((c: any) => c.type === 'text')
                            .map((c: any) => c.text || '')
                            .join('');
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
            let modelId = 'default';
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
                    if (usage) {
                        const tokens =
                            (usage.input || 0) +
                            (usage.output || 0) +
                            (usage.cacheRead || 0) +
                            (usage.cacheWrite || 0);
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
            agentRoutingEntries,
            contextUsage,
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

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const sessionRecord = sessions.find(
            (s) => s.id === id || s.id.endsWith(`_${id}`),
        );

        if (!sessionRecord) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Directly append a session_info entry to the JSONL file.
        // SessionManager.appendSessionInfo() only writes in-memory and never
        // flushes to disk on its own, so we write the line manually.
        const infoEntry = {
            type: 'session_info',
            id: Math.random().toString(36).slice(2, 10),
            parentId: null,
            timestamp: new Date().toISOString(),
            name,
        };
        fs.appendFileSync(sessionRecord.path, JSON.stringify(infoEntry) + '\n');

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
        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        const sessionRecord = sessions.find(
            (s) => s.id === id || s.id.endsWith(`_${id}`),
        );

        if (!sessionRecord) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (fs.existsSync(sessionRecord.path)) {
            fs.unlinkSync(sessionRecord.path);
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
        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        res.json(sessions);
    } catch (error) {
        console.error('Error listing sessions:', error);
        res.status(500).json({ error: 'Failed to list sessions' });
    }
});

export default router;
