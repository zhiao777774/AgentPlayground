import { Router } from 'express';
import {
    createAgentSession,
    SessionManager,
    DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { modelRegistry, authStorage } from '../server.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { memory_get } from '../tools/memory_get.js';
import { agent_list } from '../tools/agent_list.js';
import { list_knowledge_base_documents } from '../tools/list_knowledge_base_documents.js';
import { search_knowledge_base } from '../tools/search_knowledge_base.js';

// --- Custom Fallback for Unhandled Context Window Errors ---
// The underlying pi-ai SDK detects context length errors via predefined regex patterns.
// If you are using custom models (e.g. Minimax, custom local models) whose error messages
// change or aren't supported natively, add their error regex patterns here.
const CUSTOM_OVERFLOW_PATTERNS: RegExp[] = [
    // MiniMax (e.g. "400 You passed X input tokens... However, the model's context length is only...")
    /You passed.*However, the model's context length is only/i,
];

// Helper to check if an error message matches any custom overflow patterns
function checkCustomContextOverflow(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    return CUSTOM_OVERFLOW_PATTERNS.some((pattern) =>
        pattern.test(errorMessage),
    );
}

// --- OpenClaw-style Memory Bootstrapping Helpers ---
const BOOTSTRAP_MAX_CHARS = 20000;

function truncateMemory(content: string, filename: string): string {
    if (content.length <= BOOTSTRAP_MAX_CHARS) return content;
    const topLength = Math.floor(BOOTSTRAP_MAX_CHARS * 0.7);
    const bottomLength = Math.floor(BOOTSTRAP_MAX_CHARS * 0.2);
    const topPart = content.substring(0, topLength);
    const bottomPart = content.substring(content.length - bottomLength);
    return `${topPart}\n\n... [${content.length - topLength - bottomLength} characters truncated from ${filename} for context limits] ...\n\n${bottomPart}`;
}

function getDailyLog(date: Date, memoryDir: string): string | null {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const filepath = path.join(memoryDir, `${yyyy}-${mm}-${dd}.md`);
    return fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const sessionsDir = path.resolve(__dirname, '../../memory/sessions');

// Active session store: maps sessionId → AgentSession for mid-generation steering
const activeSessions = new Map<string, any>();

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

        if (sessionId) {
            sessionRecord = allSessions.find(
                (s) => s.id === sessionId || s.id.endsWith(`_${sessionId}`),
            );
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
            const agentsDir = path.resolve(__dirname, '../../agents');
            try {
                if (!fs.existsSync(agentsDir)) {
                    handleAsStaticSystemResponse = 'No agents directory found.';
                } else {
                    const entries = await fs.promises.readdir(agentsDir, {
                        withFileTypes: true,
                    });
                    const agents = [];
                    for (const entry of entries) {
                        if (
                            entry.isDirectory() &&
                            !entry.name.startsWith('.')
                        ) {
                            const stat = await fs.promises.stat(
                                path.join(agentsDir, entry.name),
                            );
                            agents.push(
                                `- **${entry.name}** (Created: ${stat.birthtime.toISOString().split('T')[0]})`,
                            );
                        }
                    }
                    if (agents.length === 0) {
                        handleAsStaticSystemResponse =
                            'No custom agents found.';
                    } else {
                        handleAsStaticSystemResponse = `Found ${agents.length} agent(s):\n${agents.join('\n')}`;
                    }
                }
            } catch (error: any) {
                handleAsStaticSystemResponse = `Failed to read agents directory: ${error.message}`;
            }
        }

        // Match `/agent <id>` or `/agent <id> <optional message>`
        const agentMatch = actualMessage.match(
            /^\/agent\s+([a-zA-Z0-9_-]+)(?:\s+(.*))?$/i,
        );
        if (agentMatch && !handleAsStaticSystemResponse) {
            const requestedAgentId = agentMatch[1];
            targetAgentId =
                requestedAgentId === 'default' ? null : requestedAgentId;

            // Validate the agent exists (skip for 'default')
            if (targetAgentId) {
                const agentsDir = path.resolve(__dirname, '../../agents');
                const agentPath = path.join(agentsDir, targetAgentId);
                if (
                    !fs.existsSync(agentPath) ||
                    !fs.statSync(agentPath).isDirectory()
                ) {
                    handleAsStaticSystemResponse = `Agent \"${targetAgentId}\" not found. Use \`/agents\` or \`/agent list\` to see available agents.`;
                    // Don't proceed with routing — just show the error
                    targetAgentId = undefined as any;
                }
            }

            if (handleAsStaticSystemResponse === null) {
                if (agentMatch[2] && agentMatch[2].trim().length > 0) {
                    // If there is a message after the id, it's a one-off override
                    actualMessage = agentMatch[2].trim();
                    isOneOff = true;
                } else {
                    sessionManager.appendCustomEntry('agent_routing', {
                        agentId: targetAgentId,
                    });
                    handleAsStaticSystemResponse = `Successfully switched agent mode to: ${targetAgentId || 'default'}. Future messages in this session will be routed to this agent.`;
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

        // 5. Configure Resource Loader to support global skills while switching Agent Directory
        const baseAgentDir = path.resolve(__dirname, '../../');
        const activeAgentDir = targetAgentId
            ? path.resolve(baseAgentDir, 'agents', targetAgentId)
            : baseAgentDir;

        const resourceLoader = new DefaultResourceLoader({
            cwd: process.cwd(),
            agentDir: activeAgentDir,
            additionalSkillPaths: [
                path.join(baseAgentDir, 'skills'),
                // Force load local skills for the active agent since there's no .pi config doing it automatically
                ...(targetAgentId ? [path.join(activeAgentDir, 'skills')] : []),
            ],
        });
        await resourceLoader.reload();

        // Dynamically create the context-switching tool to capture sessionManager via closure
        const switch_agent_routing = {
            name: 'switch_agent_routing',
            label: 'Switch Agent Context',
            description:
                'Switches the active default agent routing context for this chat session to a newly created agent. Call this ONLY after successfully creating a new agent in agents/.',
            parameters: {
                type: 'object',
                properties: {
                    agentId: {
                        type: 'string',
                        description:
                            'The unique directory name of the new agent.',
                    },
                },
                required: ['agentId'],
            },
            execute: async (_toolCallId: any, params: any) => {
                sessionManager.appendCustomEntry('agent_routing', {
                    agentId: params.agentId,
                });
                res.write(
                    `data: ${JSON.stringify({
                        type: 'active_agent',
                        id: params.agentId,
                    })}\n\n`,
                );
                return {
                    content: [
                        {
                            type: 'text',
                            text: `[SYSTEM] Successfully switched persistent routing context to agent: ${params.agentId}.`,
                        },
                    ],
                    details: {},
                };
            },
        };

        // 6. Create Agent Session with SSE Progressive Disclosure
        const { session } = await createAgentSession({
            cwd: process.cwd(),
            agentDir: activeAgentDir,
            authStorage,
            modelRegistry,
            sessionManager,
            resourceLoader,
            model,
            customTools: [
                memory_get,
                agent_list,
                list_knowledge_base_documents,
                search_knowledge_base,
                switch_agent_routing as any,
            ],
        });

        // 6.5 Bootstrap AGENTS.md and MEMORY.md into System Prompt
        // This ensures that every request sent to this specific agent has its
        // persistent rules and memories injected into the context window.
        if (targetAgentId) {
            const agentsMdPath = path.join(activeAgentDir, 'AGENTS.md');
            const memoryMdPath = path.join(activeAgentDir, 'MEMORY.md');
            const memoryDir = path.join(activeAgentDir, 'memory');
            let bootstrapContext = '';

            if (fs.existsSync(agentsMdPath)) {
                bootstrapContext += `\n\n# Project Rules (AGENTS.md)\n${truncateMemory(fs.readFileSync(agentsMdPath, 'utf8'), 'AGENTS.md')}`;
            }
            if (fs.existsSync(memoryMdPath)) {
                bootstrapContext += `\n\n# Long-term Memory (MEMORY.md)\n${truncateMemory(fs.readFileSync(memoryMdPath, 'utf8'), 'MEMORY.md')}`;
            }

            // Load Today's and Yesterday's logs
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const yesterdayLog = getDailyLog(yesterday, memoryDir);
            if (yesterdayLog) {
                bootstrapContext += `\n\n# Yesterday's Log\n${truncateMemory(yesterdayLog, 'yesterday log')}`;
            }

            const todayLog = getDailyLog(today, memoryDir);
            if (todayLog) {
                bootstrapContext += `\n\n# Today's Log\n${truncateMemory(todayLog, 'today log')}`;
            }

            if (bootstrapContext) {
                // Add explicit instructions for memory management
                bootstrapContext += `\n\n## Memory Operation Manual\nIf the user says "remember this", you must write it to the corresponding memory file (like \`memory/YYYY-MM-DD.md\` or \`MEMORY.md\`) rather than just keeping it in your immediate context.`;

                const baseSystemPrompt = session.systemPrompt;
                session.agent.setSystemPrompt(
                    baseSystemPrompt + bootstrapContext,
                );
            }
        }

        // Register this session so steer endpoint can reach it
        const activeId =
            sessionManager.getSessionId() ?? sessionId ?? Date.now().toString();
        activeSessions.set(activeId, session);
        // Let the client know the resolved session ID for steer calls
        res.write(
            `data: ${JSON.stringify({ type: 'session_id', id: activeId })}\n\n`,
        );

        // 7. Event-driven completion tracking
        // sendUserMessage() resolves BEFORE async auto-compaction/retry runs
        // (pi-agent-core's emit() is fire-and-forget for async handlers).
        // We keep the SSE stream open until the session is truly idle.

        let resolveCompletion: () => void;
        const completionPromise = new Promise<void>((resolve) => {
            resolveCompletion = resolve;
        });

        let isFlushingMemory = false;

        const tryResolveIfIdle = () => {
            // Give the async event handler time to start compaction/retry
            setTimeout(() => {
                if (
                    !session.isStreaming &&
                    !session.isCompacting &&
                    !session.isRetrying &&
                    !isFlushingMemory
                ) {
                    resolveCompletion();
                }
            }, 250);
        };

        // Listen to agent events to stream via SSE
        session.subscribe((event: any) => {
            if (isFlushingMemory) {
                if (event.type === 'agent_end') {
                    tryResolveIfIdle();
                } else if (event.type === 'tool_execution_start') {
                    res.write(
                        `data: ${JSON.stringify({ type: 'status', status: 'memorizing' })}\n\n`,
                    );
                }
                return;
            }

            if (event.type === 'tool_execution_start') {
                res.write(
                    `data: ${JSON.stringify({ type: 'tool_call', tool: event.toolName, input: event.args })}\n\n`,
                );
            } else if (event.type === 'tool_execution_end') {
                // Extract text output from tool result content
                let toolOutput = '';
                if (Array.isArray(event.result?.content)) {
                    toolOutput = event.result.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text || '')
                        .join('');
                }
                const citations = event.result?.details?.citations;
                res.write(
                    `data: ${JSON.stringify({
                        type: 'tool_result',
                        tool: event.toolName,
                        status: event.isError ? 'error' : 'success',
                        output: toolOutput,
                        citations: citations,
                    })}\n\n`,
                );
            } else if (event.type === 'message_update') {
                const amEvent = event.assistantMessageEvent;
                if (amEvent.type === 'text_delta' && amEvent.delta) {
                    res.write(
                        `data: ${JSON.stringify({ type: 'message', text: amEvent.delta })}\n\n`,
                    );
                } else if (amEvent.type === 'thinking_delta' && amEvent.delta) {
                    res.write(
                        `data: ${JSON.stringify({ type: 'thinking', text: amEvent.delta })}\n\n`,
                    );
                }
            } else if (event.type === 'auto_compaction_start') {
                console.log(
                    `[AUTO-COMPACT] Compaction started (reason: ${event.reason})`,
                );
                res.write(
                    `data: ${JSON.stringify({ type: 'status', status: 'compacting', reason: event.reason })}\n\n`,
                );
            } else if (event.type === 'auto_compaction_end') {
                console.log(
                    `[AUTO-COMPACT] Compaction ended (willRetry: ${event.willRetry}, aborted: ${event.aborted})`,
                );
                res.write(
                    `data: ${JSON.stringify({ type: 'status', status: 'generating' })}\n\n`,
                );
                // If compaction ended without retry planned, check if we're done
                if (!event.willRetry) {
                    tryResolveIfIdle();
                }
            } else if (event.type === 'auto_retry_start') {
                console.log(
                    `[AUTO-RETRY] Retry started (attempt: ${event.attempt}/${event.maxAttempts})`,
                );
                res.write(
                    `data: ${JSON.stringify({ type: 'status', status: 'retrying', attempt: event.attempt, maxAttempts: event.maxAttempts })}\n\n`,
                );
            } else if (event.type === 'auto_retry_end') {
                console.log(
                    `[AUTO-RETRY] Retry ended (success: ${event.success})`,
                );
                res.write(
                    `data: ${JSON.stringify({ type: 'status', status: 'generating' })}\n\n`,
                );
                // After retry ends, the agent will run again via agent.continue()
                // so we don't resolve here — wait for the next agent_end
            } else if (event.type === 'agent_end') {
                const messages = event.messages; // Using event.messages directly
                const lastMsg = messages[messages.length - 1];
                let isCustomContextOverflow = false;

                if (
                    lastMsg?.role === 'assistant' &&
                    lastMsg.stopReason === 'error'
                ) {
                    isCustomContextOverflow = checkCustomContextOverflow(
                        lastMsg.errorMessage,
                    );
                }

                if (isCustomContextOverflow) {
                    // Popping the error message from the context window is already handled
                    // natively inside `_runAutoCompaction` if we pass 'overflow'.
                    console.log(
                        '[AUTO-COMPACT] Detected unhandled context limit error from custom model. Manually triggering native compaction.',
                    );

                    // We directly tap into the internal _runAutoCompaction method.
                    // This elegantly preserves all native event emission (auto_compaction_start/end),
                    // tracks internal loading states, and delegates the retry execution.
                    (session as any)
                        ._runAutoCompaction('overflow', true)
                        .catch((e: any) => {
                            console.error(
                                '[AUTO-COMPACT] Native fallback compaction failed',
                                e,
                            );
                            res.write(
                                `data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`,
                            );
                            resolveCompletion();
                        });
                } else {
                    // agent_end fires when the agent loop finishes, but async compaction
                    // may start immediately after. Check after a delay.
                    tryResolveIfIdle();
                }
            }
        });

        // Abort agent if client disconnects early
        req.on('close', () => {
            activeSessions.delete(activeId);
            if (session.isStreaming || session.isCompacting) {
                console.log('Client disconnected, aborting agent session...');
                session.abort().catch(console.error);
            }
            // Also resolve completion to prevent hanging
            resolveCompletion();
        });

        // --- 7.5 Pre-compaction Memory Flush ---
        if (targetAgentId) {
            const usage = session.getContextUsage();
            if (usage) {
                const modelContextWindow = model?.contextWindow || 128000;
                const reserveTokensFloor = 20000;
                const softThresholdTokens = 4000;
                const flushTrigger =
                    modelContextWindow -
                    reserveTokensFloor -
                    softThresholdTokens;

                // Use the official pi-coding-agent ContextUsage interface
                const totalTokens = usage.tokens || 0;

                if (totalTokens > flushTrigger) {
                    const lastFlushTokens =
                        sessionManager
                            .getEntries()
                            .find(
                                (e: any) =>
                                    e.message?.content?.type ===
                                    'memory_flush_checkpoint',
                            )?.message?.content?.tokensUsed || 0;

                    // Only flush if we haven't flushed recently in this compaction cycle.
                    if (
                        totalTokens > lastFlushTokens + 10000 ||
                        lastFlushTokens === 0 ||
                        totalTokens < lastFlushTokens
                    ) {
                        console.log(
                            `[MEMORY FLUSH] Triggering pre-compaction flush at ${totalTokens} tokens (Threshold: ${flushTrigger}).`,
                        );
                        res.write(
                            `data: ${JSON.stringify({ type: 'status', status: 'memorizing', reason: 'Pre-compaction memory flush' })}\n\n`,
                        );

                        isFlushingMemory = true;

                        const silentMessage = `[SYSTEM] Session nearing auto-compaction. You are about to lose detailed history. Please use your write tools to store any lasting architectural decisions, bug fixes, or user preferences to memory/YYYY-MM-DD.md (or MEMORY.md). If there is absolutely nothing worth remembering this cycle, reply exactly with NO_REPLY.`;

                        session.agent.state.messages.push({
                            role: 'user',
                            content: [{ type: 'text', text: silentMessage }],
                            timestamp: Date.now(),
                        } as any);

                        const startIndex =
                            session.agent.state.messages.length - 1;

                        try {
                            await session.agent.continue();
                        } catch (e) {
                            console.error(
                                '[MEMORY FLUSH] Error during silent flush:',
                                e,
                            );
                        }

                        sessionManager.appendCustomEntry(
                            'memory_flush_checkpoint',
                            {
                                type: 'memory_flush_checkpoint',
                                tokensUsed: totalTokens,
                            },
                        );

                        // Erase the silent dialogue from the agent's memory
                        session.agent.replaceMessages(
                            session.agent.state.messages.slice(0, startIndex),
                        );

                        isFlushingMemory = false;
                        console.log(
                            `[MEMORY FLUSH] Flush completed. Resuming actual request.`,
                        );
                        res.write(
                            `data: ${JSON.stringify({ type: 'status', status: 'generating' })}\n\n`,
                        );
                    }
                }
            }
        }

        // 8. Send the user message to the agent
        await session.sendUserMessage(actualMessage);

        // Wait for the session to be truly idle (including compaction + retry cycles)
        await completionPromise;

        // Clean up active session
        activeSessions.delete(activeId);

        // Append context usage telemetry
        const contextUsage = session.getContextUsage();
        if (contextUsage) {
            res.write(
                `data: ${JSON.stringify({ type: 'context_usage', usage: contextUsage })}\n\n`,
            );
        }

        // End the SSE stream
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
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
