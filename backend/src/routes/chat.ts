import { Router } from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { modelRegistry } from '../server.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AgentMeta, SessionMeta } from '../models/ResourceMeta.js';
import {
    activeSessions,
    runAgentSessionStream,
} from '../services/chatRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const sessionsDir = path.resolve(__dirname, '../../memory/sessions');

// ─── Main Chat Endpoint ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    const { sessionId, modelId, message, branchFromId } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Set up Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        // 1. Resolve Session
        let sessionRecord;
        const allSessions = await SessionManager.list(
            process.cwd(),
            sessionsDir,
        );

        const userId = req.user!.id;
        if (sessionId) {
            // 1. Verify access via SessionMeta first (Strict Multi-user Security)
            const authMeta = await SessionMeta.findOne({
                id: sessionId,
                $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }],
            });

            if (authMeta) {
                sessionRecord = allSessions.find((s) => s.id === authMeta.id);
            } else {
                // Secondary check for partial ID matching (legacy support but with security)
                const partialAuthMeta = await SessionMeta.findOne({
                    id: { $regex: new RegExp(`_${sessionId}$`) },
                    $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }],
                });

                if (partialAuthMeta) {
                    sessionRecord = allSessions.find(
                        (s) => s.id === partialAuthMeta.id,
                    );
                } else {
                    console.warn(
                        `Unauthorized or non-existent session access attempt: ${sessionId} by user ${userId}`,
                    );
                    // Leave sessionRecord as null, will fallback to creating a new registered session
                }
            }
        }

        // Create new session if not found or no ID provided
        let sessionManager: any;
        let isNewSession = false;

        if (sessionRecord) {
            sessionManager = SessionManager.open(
                sessionRecord.path,
                sessionsDir,
            );
        } else {
            sessionManager = SessionManager.create(process.cwd(), sessionsDir);
            isNewSession = true;

            // Auto-register new session in Meta DB
            const fullId = sessionManager.getSessionId();
            await SessionMeta.create({
                id: fullId,
                ownerId: userId,
                ownerName: req.user!.displayName,
                name: 'New Session',
            });
            console.log(
                `[Security] Registered new session ${fullId} for user ${userId}`,
            );
            sessionManager.newSession();
            // Force file creation immediately by appending an initialization marker
            sessionManager.appendCustomEntry('session_init', {
                timestamp: Date.now(),
            });
            isNewSession = true;
            console.log(
                `[DEBUG chat.ts] Created NEW session. getSessionId() = ${sessionManager.getSessionId()}`,
            );
        }

        if (branchFromId !== undefined && sessionRecord) {
            if (branchFromId === null) {
                sessionManager.resetLeaf();
            } else {
                sessionManager.branch(branchFromId);

                // Auto-forward the leaf pointer past strictly linear system nodes.
                // This prevents "invisible" backend events (like compaction or memory flush)
                // from accidentally forcing the next user message into a sibling branch instead of a linear continuation.
                let currentLeaf = sessionManager.getLeafEntry();
                while (currentLeaf) {
                    const children = sessionManager.getChildren(currentLeaf.id);
                    if (children.length === 1) {
                        const onlyChild = children[0];
                        if (
                            onlyChild.type === 'compaction' ||
                            onlyChild.type === 'model_change' ||
                            onlyChild.type === 'thinking_level_change' ||
                            (onlyChild.type === 'custom' &&
                                onlyChild.customType ===
                                    'memory_flush_checkpoint')
                        ) {
                            sessionManager.branch(onlyChild.id);
                            currentLeaf = onlyChild;
                            continue;
                        }
                    }
                    break;
                }
            }
        }

        // 2. Resolve Model
        // Since we explicitly allow overriding built-in models with custom ones,
        // we should get the available models (which resolves to the registered ones).
        const allModels = modelRegistry.getAvailable();
        let model = allModels.find((m: any) => m.id === modelId);
        console.log(`[DEBUG chat.ts] Requested modelId: ${modelId}`);
        console.log(`[DEBUG chat.ts] Found model? ${!!model}`);
        if (!model && allModels.length > 0) {
            console.log(
                `[DEBUG chat.ts] Available models: ${allModels.map((m: any) => m.id).join(', ')}`,
            );
            model = allModels[0]; // fallback
        } else if (!model) {
            throw new Error('No models available');
        }

        // Add model_change event directly if it's explicitly differing from current session model state
        if (model && sessionRecord) {
            const currentContext = sessionManager.buildSessionContext();
            const currentModel = currentContext.model;
            // The frontend dropdown only provides modelId; if it differs from the context, we must log a model_change
            if (
                currentContext.messages.length > 0 &&
                (!currentModel ||
                    currentModel.modelId !== model.id ||
                    currentModel.provider !== model.provider)
            ) {
                console.log(
                    `[DEBUG chat.ts] Explicitly appending model_change from ${currentModel?.modelId || 'none'} to ${model.id}`,
                );
                sessionManager.appendModelChange(model.provider, model.id);
            }
        }

        // 3. Extract persistent agent routing from history
        let targetAgentId = null;
        let isOneOff = false;
        if (sessionRecord) {
            const entries = sessionManager.getEntries();
            // Find the most recent agent_routing entry
            for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i] as any;
                if (
                    entry.type === 'custom' &&
                    entry.customType === 'agent_routing'
                ) {
                    targetAgentId = entry.data?.agentId || null;
                    break;
                }
            }
        }

        // 4. Handle Slash Commands for routing
        let actualMessage = message.trim();
        let handleAsStaticSystemResponse: string | null = null;

        // Match `/agent list` or `/agents` first, so `list` is not treated as an ID
        if (
            actualMessage.trim() === '/agent list' ||
            actualMessage.trim() === '/agents'
        ) {
            try {
                const userId = req.user!.id;
                const dbAgents = await AgentMeta.find({
                    $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }],
                });

                if (dbAgents.length === 0) {
                    handleAsStaticSystemResponse = 'No custom agents found.';
                } else {
                    const agentLines = dbAgents.map(
                        (a) =>
                            `- **${a.name}** (ID: \`${a.id}\`, Type: ${a.type || 'Unknown'})`,
                    );
                    handleAsStaticSystemResponse = `Found ${dbAgents.length} agent(s):\n${agentLines.join('\n')}\n\nUse \`/agent <ID>\` to switch.`;
                }
            } catch (error: any) {
                handleAsStaticSystemResponse = `Failed to list agents: ${error.message}`;
            }
        }

        // Match `/agent <name>` or `/agent <name> <optional message>`
        const agentMatch = actualMessage.match(
            /^\/agent\s+([a-zA-Z0-9_-]+)(?:\s+(.*))?$/i,
        );
        if (agentMatch && !handleAsStaticSystemResponse) {
            const rawRequestedAgentName = agentMatch[1];
            // Normalize the ID: lowercase and snake_to_kebab
            const normalizedAgentId =
                rawRequestedAgentName === 'default'
                    ? null
                    : rawRequestedAgentName.toLowerCase().replace(/_/g, '-');

            targetAgentId = normalizedAgentId;

            // Validate the agent exists specifically for this user using strict ID matching
            if (targetAgentId) {
                const userId = req.user!.id;
                const dbAgent = await AgentMeta.findOne({
                    $and: [
                        { id: normalizedAgentId },
                        {
                            $or: [
                                { ownerId: userId },
                                { 'sharedWith.userId': userId },
                            ],
                        },
                    ],
                });

                if (!dbAgent) {
                    // Fuzzy search for suggestions: only hint if it's a substring of some valid agents
                    const suggestions = await AgentMeta.find({
                        $and: [
                            {
                                $or: [
                                    {
                                        name: {
                                            $regex: rawRequestedAgentName,
                                            $options: 'i',
                                        },
                                    },
                                    {
                                        id: {
                                            $regex: rawRequestedAgentName,
                                            $options: 'i',
                                        },
                                    },
                                ],
                            },
                            {
                                $or: [
                                    { ownerId: userId },
                                    { 'sharedWith.userId': userId },
                                ],
                            },
                        ],
                    }).limit(5);

                    if (suggestions.length > 0) {
                        const options = suggestions
                            .map((s) => `- \`/agent ${s.id}\``)
                            .join('\n');
                        handleAsStaticSystemResponse = `Agent ID \"${rawRequestedAgentName}\" not found. \n\nDid you mean:\n${options}`;
                    } else {
                        handleAsStaticSystemResponse = `Agent ID \"${rawRequestedAgentName}\" not found or access denied. Type \`/agent list\` to see available agents.`;
                    }
                    targetAgentId = undefined as any;
                } else {
                    // Success, use the canonical ID for internal routing
                    targetAgentId = dbAgent.id;
                }
            }

            if (handleAsStaticSystemResponse === null) {
                if (agentMatch[2] && agentMatch[2].trim().length > 0) {
                    actualMessage = agentMatch[2].trim();
                    isOneOff = true;
                } else {
                    sessionManager.appendCustomEntry('agent_routing', {
                        agentId: targetAgentId,
                    });
                    handleAsStaticSystemResponse = `Successfully switched agent mode to: ${normalizedAgentId === null ? 'default' : normalizedAgentId}. Future messages in this session will be routed to this agent.`;
                    res.write(
                        `data: ${JSON.stringify({ type: 'active_agent', id: targetAgentId || null })}\n\n`,
                    );
                }
            }
        }

        if (handleAsStaticSystemResponse) {
            // For new sessions, we must manually flush to disk because SessionManager
            // defers file creation until an assistant message is present.
            // Static slash commands never produce an assistant message, so we force it.
            const sessionFile = sessionManager.getSessionFile();
            if (sessionFile && !fs.existsSync(sessionFile)) {
                const allEntries = [
                    sessionManager.getHeader(),
                    ...sessionManager.getEntries(),
                ];
                const content =
                    allEntries.map((e: any) => JSON.stringify(e)).join('\n') +
                    '\n';
                fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
                fs.writeFileSync(sessionFile, content);
            }

            const activeId =
                sessionManager.getSessionId() ??
                sessionId ??
                Date.now().toString();
            console.log(
                `[DEBUG chat.ts static] activeId = ${activeId}, sessionFile = ${sessionFile}`,
            );

            // Add user command as a custom message visible in UI
            sessionManager.appendCustomMessageEntry(
                'static_cmd_user',
                [{ type: 'text', text: message.trim() }],
                true,
            );

            // Add system response as a custom message visible in UI
            sessionManager.appendCustomMessageEntry(
                'static_cmd_assistant',
                [{ type: 'text', text: handleAsStaticSystemResponse }],
                true,
            );

            // Manually persist the new entries since SessionManager won't flush them
            if (sessionFile) {
                const entries = sessionManager.getEntries();
                // Write only the entries that aren't already in the file
                const content =
                    [sessionManager.getHeader(), ...entries]
                        .map((e: any) => JSON.stringify(e))
                        .join('\n') + '\n';
                fs.writeFileSync(sessionFile, content);
            }

            res.write(
                `data: ${JSON.stringify({ type: 'session_id', id: activeId })}\n\n`,
            );
            res.write(
                `data: ${JSON.stringify({ type: 'message', text: handleAsStaticSystemResponse })}\n\n`,
            );
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
            return;
        }

        await runAgentSessionStream({
            req,
            res,
            sessionManager,
            model,
            targetAgentId,
            message: actualMessage,
            sessionIdHint: sessionId,
            userContext: {
                id: req.user!.id,
                username: req.user!.username,
                displayName: req.user!.displayName,
                email: req.user!.email,
                department: req.user!.department,
            },
            toolUserId: req.user!.id,
            toolUsername: req.user!.username,
            allowAgentList: true,
            allowSwitchAgentTool: true,
            registerActiveSession: true,
            promptProfile: 'internal',
        });
    } catch (error: any) {
        console.error('Chat endpoint error:', error);
        res.write(
            `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
    }
});

// ─── Steer Endpoint ─────────────────────────────────────────────────────────
// Injects a steering message into an actively running agent session.
// steer() interrupts after the current tool execution and redirects the agent.
router.post('/steer', async (req, res) => {
    const { sessionId, text, mode = 'steer' } = req.body;

    if (!sessionId || !text) {
        return res
            .status(400)
            .json({ error: 'sessionId and text are required' });
    }

    const session = activeSessions.get(sessionId);
    if (!session) {
        return res.status(404).json({
            error: 'No active session found. Agent may have finished.',
        });
    }

    try {
        if (mode === 'followUp') {
            await session.followUp(text);
        } else {
            await session.steer(text);
        }
        res.json({ ok: true });
    } catch (error: any) {
        console.error('Steer error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
