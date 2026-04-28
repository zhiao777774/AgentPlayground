import { Router } from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { modelRegistry } from '../server.js';
import {
    requireExternalAuth,
    requireExternalScope,
} from '../middleware/externalAuth.js';
import type { ExternalPrincipal } from '../middleware/externalAuth.js';
import {
    ExternalChatSession,
    ExternalSystemBinding,
} from '../models/ExternalIntegration.js';
import { AgentMeta } from '../models/ResourceMeta.js';
import { runAgentSessionStream } from '../services/chatRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const sessionsDir = path.resolve(__dirname, '../../memory/sessions');

function getObjectMetadata(
    metadata: unknown,
): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return undefined;
    }
    return metadata as Record<string, unknown>;
}

function getLatestAgentRouting(sessionManager: any): string | null {
    const entries = sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as any;
        if (entry.type === 'custom' && entry.customType === 'agent_routing') {
            return entry.data?.agentId || null;
        }
    }
    return null;
}

function appendExternalContext(
    sessionManager: any,
    principal: ExternalPrincipal,
    externalUserId: string,
    agentId: string,
    metadata: unknown,
    reason: 'new_session' | 'binding_agent_changed',
) {
    sessionManager.appendCustomEntry('external_context', {
        systemId: principal?.systemId,
        systemName: principal?.systemName,
        externalUserId,
        agentId,
        reason,
        timestamp: Date.now(),
        metadata: getObjectMetadata(metadata),
    });
}

router.delete(
    '/chat/sessions/:session_id',
    requireExternalAuth,
    requireExternalScope('chat:stream'),
    async (req, res) => {
        const principal = req.externalPrincipal!;
        const { session_id } = req.params;
        const externalUserId =
            typeof req.body?.external_user_id === 'string'
                ? req.body.external_user_id
                : typeof req.query.external_user_id === 'string'
                  ? req.query.external_user_id
                  : '';

        if (!session_id || !externalUserId.trim()) {
            return res.status(400).json({
                error: 'session_id and external_user_id are required',
            });
        }

        try {
            const externalSession = await ExternalChatSession.findOne({
                sessionId: session_id,
                systemId: principal.systemId,
                externalUserId: externalUserId.trim(),
            });

            if (!externalSession) {
                return res.status(404).json({
                    error: 'External session not found',
                });
            }

            const sessions = await SessionManager.list(
                process.cwd(),
                sessionsDir,
            );
            const sessionRecord = sessions.find(
                (session) => session.id === externalSession.sessionId,
            );

            await ExternalChatSession.deleteOne({
                sessionId: externalSession.sessionId,
            });

            let deletedSessionFile = false;
            if (sessionRecord && fs.existsSync(sessionRecord.path)) {
                fs.unlinkSync(sessionRecord.path);
                deletedSessionFile = true;
            }

            const sessionTmpDir = path.join(
                process.cwd(),
                'memory',
                'tmp',
                externalSession.sessionId,
            );
            if (fs.existsSync(sessionTmpDir)) {
                fs.rmSync(sessionTmpDir, { recursive: true, force: true });
            }

            return res.json({
                message: 'External session deleted successfully',
                session_id: externalSession.sessionId,
                deletedSessionFile,
            });
        } catch (error) {
            console.error('External session delete error:', error);
            return res.status(500).json({
                error: 'Failed to delete external session',
            });
        }
    },
);

router.post(
    '/chat/stream',
    requireExternalAuth,
    requireExternalScope('chat:stream'),
    async (req, res) => {
        const principal = req.externalPrincipal!;
        const { external_user_id, session_id, message, metadata } = req.body;

        if (
            typeof external_user_id !== 'string' ||
            !external_user_id.trim() ||
            typeof message !== 'string' ||
            !message.trim()
        ) {
            return res.status(400).json({
                error: 'external_user_id and message are required',
            });
        }

        let streamStarted = false;

        try {
            const binding = await ExternalSystemBinding.findOne({
                systemId: principal.systemId,
                status: 'active',
            });

            if (!binding) {
                return res.status(403).json({
                    error: 'No active agent binding found for this external system',
                });
            }

            const defaultBoundAgent = await AgentMeta.findOne({
                id: binding.agentId,
            });
            if (!defaultBoundAgent) {
                return res.status(500).json({
                    error: 'Bound agent not found',
                });
            }

            const availableModels = modelRegistry.getAvailable();
            let model = availableModels.find(
                (candidate: any) =>
                    candidate.id === binding.modelId &&
                    candidate.provider === binding.modelProvider,
            );
            if (!model) {
                return res.status(500).json({
                    error: `Bound model not available: ${binding.modelProvider}/${binding.modelId}`,
                });
            }

            let sessionManager: any;
            const targetAgentId = binding.agentId;
            const runtimeAgent = defaultBoundAgent;

            if (session_id) {
                const externalSession = await ExternalChatSession.findOne({
                    sessionId: session_id,
                    systemId: principal.systemId,
                    externalUserId: external_user_id,
                });

                if (!externalSession) {
                    return res.status(404).json({
                        error: 'External session not found',
                    });
                }

                const allSessions = await SessionManager.list(
                    process.cwd(),
                    sessionsDir,
                );
                const sessionRecord = allSessions.find(
                    (session) => session.id === externalSession.sessionId,
                );

                if (!sessionRecord) {
                    return res.status(410).json({
                        error: 'Session file not found',
                    });
                }

                sessionManager = SessionManager.open(
                    sessionRecord.path,
                    sessionsDir,
                );

                const latestRoutedAgentId =
                    getLatestAgentRouting(sessionManager);
                if (latestRoutedAgentId !== targetAgentId) {
                    sessionManager.appendCustomEntry('agent_routing', {
                        agentId: targetAgentId,
                    });
                    appendExternalContext(
                        sessionManager,
                        principal,
                        external_user_id,
                        targetAgentId,
                        metadata,
                        'binding_agent_changed',
                    );
                }

                const currentContext = sessionManager.buildSessionContext();
                const currentModel = currentContext.model;
                if (
                    currentContext.messages.length > 0 &&
                    (!currentModel ||
                        currentModel.modelId !== model.id ||
                        currentModel.provider !== model.provider)
                ) {
                    sessionManager.appendModelChange(model.provider, model.id);
                }

                externalSession.agentId = targetAgentId;
                externalSession.lastActivityAt = new Date();
                const objectMetadata = getObjectMetadata(metadata);
                if (objectMetadata) {
                    externalSession.metadata = objectMetadata;
                }
                await externalSession.save();
            } else {
                sessionManager = SessionManager.create(process.cwd(), sessionsDir);
                sessionManager.newSession();
                const fullId = sessionManager.getSessionId();
                sessionManager.appendCustomEntry('session_init', {
                    timestamp: Date.now(),
                });
                sessionManager.appendCustomEntry('agent_routing', {
                    agentId: targetAgentId,
                });
                appendExternalContext(
                    sessionManager,
                    principal,
                    external_user_id,
                    targetAgentId,
                    metadata,
                    'new_session',
                );

                const sessionFile = sessionManager.getSessionFile();
                if (sessionFile && !fs.existsSync(sessionFile)) {
                    const allEntries = [
                        sessionManager.getHeader(),
                        ...sessionManager.getEntries(),
                    ];
                    const content =
                        allEntries
                            .map((entry: any) => JSON.stringify(entry))
                            .join('\n') + '\n';
                    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
                    fs.writeFileSync(sessionFile, content);
                }

                await ExternalChatSession.create({
                    sessionId: fullId,
                    systemId: principal.systemId,
                    externalUserId: external_user_id,
                    agentId: targetAgentId,
                    metadata: getObjectMetadata(metadata),
                    lastActivityAt: new Date(),
                });
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            streamStarted = true;

            await runAgentSessionStream({
                req,
                res,
                sessionManager,
                model,
                targetAgentId,
                message: message.trim(),
                sessionIdHint: session_id,
                userContext: {
                    id: principal.systemId,
                    username: principal.systemId,
                    displayName: principal.systemName,
                    email: 'N/A',
                    department: 'External System',
                },
                toolUserId: runtimeAgent.ownerId,
                toolUsername: runtimeAgent.ownerName || principal.systemId,
                allowAgentList: false,
                allowSwitchAgentTool: false,
                registerActiveSession: false,
                promptProfile: 'external',
                externalUserId: external_user_id,
            });
        } catch (error: any) {
            console.error('External chat endpoint error:', error);
            if (!streamStarted && !res.headersSent) {
                return res.status(500).json({
                    error: error.message || 'Failed to generate response',
                });
            }
            res.write(
                `data: ${JSON.stringify({ type: 'error', message: error.message || 'Failed to generate response' })}\n\n`,
            );
            res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
            res.end();
        }
    },
);

export default router;
