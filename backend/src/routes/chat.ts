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
const BOOTSTRAP_MAX_CHARS = parseInt(
    process.env.BOOTSTRAP_MAX_CHARS || '20000',
    10,
);
const BOOTSTRAP_TOTAL_MAX_CHARS = parseInt(
    process.env.BOOTSTRAP_TOTAL_MAX_CHARS || '150000',
    10,
);

function truncateMemory(
    content: string,
    filename: string,
    maxChars: number = BOOTSTRAP_MAX_CHARS,
): string {
    if (content.length <= maxChars) return content;
    const topLength = Math.floor(maxChars * 0.7);
    const bottomLength = Math.floor(maxChars * 0.2);
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
                !currentModel ||
                currentModel.modelId !== model.id ||
                currentModel.provider !== model.provider
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

        // 6.5 Bootstrap OpenClaw Spec Context Files into System Prompt
        // This ensures that every request sent to this specific agent has its
        // persistent rules, persona, and memories injected into the context window.
        const activeId = sessionManager.getSessionId() ?? sessionId ?? Date.now().toString();
        
        // Ensure tmp sandbox exists for this session
        const sessionTmpDir = path.join(process.cwd(), 'memory', 'tmp', activeId);
        if (!fs.existsSync(sessionTmpDir)) {
            fs.mkdirSync(sessionTmpDir, { recursive: true });
        }
        
        let bootstrapContext = '';

        if (targetAgentId) {
            // Appended under the SDK's existing `# Project Context` section.
            // AGENTS.md is intentionally excluded — pi-agent SDK (v0.55+) already
            // injects it untruncated via its native `contextFiles` mechanism.
            let totalBootstrapChars = bootstrapContext.length;

            // Standard OpenClaw Bootstrap Files
            const bootstrapFiles = [
                // 'AGENTS.md', — handled by pi-agent SDK contextFiles
                'SOUL.md',
                'TOOLS.md',
                'IDENTITY.md',
                'USER.md',
                'HEARTBEAT.md',
                'BOOTSTRAP.md',
                'MEMORY.md', // Represents the long-term memory slot
            ];

            for (let filename of bootstrapFiles) {
                let filePath = path.join(activeAgentDir, filename);

                // OpenClaw lowercase fallback for memory
                if (filename === 'MEMORY.md' && !fs.existsSync(filePath)) {
                    const fallbackPath = path.join(activeAgentDir, 'memory.md');
                    if (fs.existsSync(fallbackPath)) {
                        filename = 'memory.md';
                        filePath = fallbackPath;
                    }
                }

                let contentToAdd = '';

                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    if (content.trim()) {
                        contentToAdd = truncateMemory(content, filename);
                    }
                } else {
                    // OpenClaw missing file marker
                    contentToAdd = `_(Not provided)_`;
                }

                if (contentToAdd) {
                    const sectionPath = path.join(activeAgentDir, filename);
                    const sectionHeader = `\n\n---\n\n## ${sectionPath}\n\n`;
                    let formattedSection = sectionHeader + contentToAdd;

                    // Enforce global bootstrap character limit
                    if (
                        totalBootstrapChars + formattedSection.length >
                        BOOTSTRAP_TOTAL_MAX_CHARS
                    ) {
                        const remainingChars = Math.max(
                            0,
                            BOOTSTRAP_TOTAL_MAX_CHARS -
                                totalBootstrapChars -
                                sectionHeader.length,
                        );
                        if (remainingChars > 500) {
                            formattedSection =
                                sectionHeader +
                                truncateMemory(
                                    contentToAdd,
                                    filename,
                                    remainingChars,
                                );
                            bootstrapContext += formattedSection;
                            totalBootstrapChars += formattedSection.length;
                        } else {
                            bootstrapContext += `${sectionHeader}_(Truncated due to total bootstrap limit)_`;
                        }
                        break; // Stop processing further files if we've hit the global cap
                    } else {
                        bootstrapContext += formattedSection;
                        totalBootstrapChars += formattedSection.length;
                    }
                }
            }

            // Load Today's and Yesterday's logs seamlessly into the remaining limit
            const memoryDir = path.join(activeAgentDir, 'memory');
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            const logsToLoad = [
                { date: yesterday, label: "Yesterday's Log" },
                { date: today, label: "Today's Log" },
            ];

            for (const log of logsToLoad) {
                const logContent = getDailyLog(log.date, memoryDir);
                if (logContent) {
                    const sectionHeader = `\n## ${log.label}\n`;
                    const contentToAdd = truncateMemory(logContent, log.label);
                    let formattedSection = sectionHeader + contentToAdd;

                    if (
                        totalBootstrapChars + formattedSection.length >
                        BOOTSTRAP_TOTAL_MAX_CHARS
                    ) {
                        const remainingChars = Math.max(
                            0,
                            BOOTSTRAP_TOTAL_MAX_CHARS -
                                totalBootstrapChars -
                                sectionHeader.length,
                        );
                        if (remainingChars > 500) {
                            formattedSection =
                                sectionHeader +
                                truncateMemory(
                                    logContent,
                                    log.label,
                                    remainingChars,
                                );
                            bootstrapContext += formattedSection;
                            totalBootstrapChars += formattedSection.length;
                        } else {
                            bootstrapContext += `${sectionHeader}_(Truncated)_`;
                        }
                        break;
                    } else {
                        bootstrapContext += formattedSection;
                        totalBootstrapChars += formattedSection.length;
                    }
                }
            }

            // Add explicit instructions for memory management and behavioral guidelines
            bootstrapContext += `\n\n## Proactive Memory Management\n`;
            bootstrapContext += `Chat history is ephemeral and will be periodically truncated. You must PROACTIVELY preserve important context without waiting for the user to explicitly say "remember this":\n`;
            bootstrapContext += `- Write enduring constraints, domain knowledge, or repeated formatting rules to \`MEMORY.md\`.\n`;
            bootstrapContext += `- Write temporary scratchpad data, intermediate task states, or volatile day-to-day context to \`memory/YYYY-MM-DD.md\`.\n`;
            bootstrapContext += `If a piece of information is critical for future conversational turns, NEVER just say "Got it." Immediately use your file writing tools to store it in the appropriate memory file.\n`;
            bootstrapContext += `**Watch for Implicit Memory Triggers:** Users rarely say "save this". You must instantly recognize implicit constraints such as "always do X", "from now on", "I prefer", "the standard format is", or corrections like "actually, we don't do it that way". Any of these should trigger an automatic memory update.`;
        } else {
            // No active agent context (Root/Global Mode)
            bootstrapContext += `\n\n## Root Mode Operations\n`;
            bootstrapContext += `You are operating in Root Mode (no specialized agent is currently active). Your primary role is global workspace modification and Agent orchestration.\n`;
            bootstrapContext += `- **Isolated Sandbox**: Your ephemeral workspace is located at \`memory/tmp/${activeId}/\`. You may freely use this directory for any scratchpad reasoning, data processing scripts, testing, or file artifacts without cluttering the global workspace.\n`;
            bootstrapContext += `- **Agent Creation**: If the user asks to create, scaffold, or bootstrap a new specialized agent or workflow, YOU MUST use the \`km-agent-creator\` skill instead of building it from scratch.`;
        }

        // Apply Universal Guidelines regardless of active agent status
        bootstrapContext += `\n\n## Universal Behavioral Guidelines`;
        bootstrapContext += `\n1. **BLUF (Bottom Line Up Front)**: Deliver the final result, answer, or requested action FIRST. Explanations or rationale should only follow if necessary and must be strictly concise.`;

        if (targetAgentId) {
            bootstrapContext += `\n2. **Local Skills & Tools Execution**: Actively leverage your available skills. If you need to develop a NEW skill or tool, YOU MUST place it inside your local directory (e.g., \`agents/${targetAgentId}/skills\` or \`agents/${targetAgentId}/tools\`). Utilize the \`skill-creator\` skill to correctly scaffold any new skills.`;
            bootstrapContext += `\n3. **Complex Task Planning**: For extremely difficult or multi-step requests, actively leverage the \`planning-with-files\` skill to orchestrate your work. Save your planning artifacts firmly within \`agents/${targetAgentId}/plans/\`.`;
        } else {
            bootstrapContext += `\n2. **Scoped Skills & Tools Execution**: Actively leverage your available skills. If you need to develop a NEW skill or tool, to avoid polluting the global framework, YOU MUST place it inside \`memory/tmp/${activeId}/skills\` or \`memory/tmp/${activeId}/tools\`. Utilize the \`skill-creator\` skill to correctly scaffold it.`;
            bootstrapContext += `\n3. **Complex Task Planning**: For extremely difficult or multi-step requests, actively leverage the \`planning-with-files\` skill to orchestrate your work. Save your planning artifacts in the volatile session directory: \`memory/tmp/${activeId}/plans/\`.`;
        }

        bootstrapContext += `\n4. **Python Execution Environment**: Before executing any Python code or installing packages, ALWAYS prioritize doing so within an isolated virtual environment (\`venv\`) to avoid polluting the system namespace.`;

        const baseSystemPrompt = session.systemPrompt;
        session.agent.setSystemPrompt(baseSystemPrompt + bootstrapContext);

        // Register this session so steer endpoint can reach it
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
        let isManualProcessing = false;

        const tryResolveIfIdle = () => {
            // Give the async event handler time to start compaction/retry
            setTimeout(() => {
                if (
                    !session.isStreaming &&
                    !session.isCompacting &&
                    !session.isRetrying &&
                    !isFlushingMemory &&
                    !isManualProcessing
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
                    console.log(
                        '[AUTO-COMPACT] Detected unhandled context limit error from custom model. Manually triggering custom compaction.',
                    );
                    isManualProcessing = true;
                    res.write(
                        `data: ${JSON.stringify({ type: 'status', status: 'compacting', reason: 'context limit approached (Custom Fallback)' })}\n\n`,
                    );

                    (async () => {
                        try {
                            session.agent.replaceMessages(
                                messages.slice(0, -1),
                            );
                            await session.compact();
                            res.write(
                                `data: ${JSON.stringify({ type: 'status', status: 'retrying', attempt: 1, maxAttempts: 1 })}\n\n`,
                            );
                            res.write(
                                `data: ${JSON.stringify({ type: 'status', status: 'generating' })}\n\n`,
                            );
                            await session.agent.continue();
                        } catch (e: any) {
                            console.error(
                                '[AUTO-COMPACT] Custom logic failed',
                                e,
                            );
                            res.write(
                                `data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`,
                            );
                        } finally {
                            setTimeout(() => {
                                isManualProcessing = false;
                                tryResolveIfIdle();
                            }, 500);
                        }
                    })();
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
                const modelMaxTokens = model?.maxTokens || 4096;

                // Ensure we have enough room left to generate one full MaxTokens response plus tool usage overhead
                const reserveTokensFloor = modelMaxTokens + 2000;
                const softThresholdTokens = 4000;
                const flushTrigger = Math.max(
                    0,
                    modelContextWindow -
                        reserveTokensFloor -
                        softThresholdTokens,
                );

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
