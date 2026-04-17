import mongoose from 'mongoose';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { SessionMeta, AgentMeta, DocumentMeta } from '../models/ResourceMeta.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agent-playground';
const ADMIN_DEV_ID = 'admin-dev-id'; // Default migration owner

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log(`[MongoDB] Connected safely to ${MONGODB_URI}`);
        await runBackwardsCompatibilityMigration();
    } catch (error) {
        console.error('[MongoDB] Connection error:', error);
        process.exit(1);
    }
};

/**
 * Sweeps the file system on first boot and claims any orphaned resources to the admin dev user.
 * This guarantees backwards compatibility with single-tenant data structure.
 */
async function runBackwardsCompatibilityMigration() {
    console.log('[MongoDB] Running backwards compatibility migration check...');

    // 1. Migrate Sessions — use SessionManager.list() to get canonical UUID IDs
    const sessionsDir = path.resolve(process.cwd(), 'memory/sessions');
    if (existsSync(sessionsDir)) {
        const { SessionManager } = await import('@mariozechner/pi-coding-agent');
        const sessions = await SessionManager.list(process.cwd(), sessionsDir);
        for (const session of sessions) {
            const sessionId = session.id; // Canonical UUID from SessionManager
            const exists = await SessionMeta.exists({ id: sessionId });
            if (!exists) {
                // Extract real session name from the last session_info entry in the .jsonl file
                let sessionName = '';
                try {
                    const content = readFileSync(session.path, 'utf8');
                    const lines = content.trim().split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        try {
                            const entry = JSON.parse(lines[i]);
                            if (entry.type === 'session_info' && entry.name) {
                                sessionName = entry.name;
                                break;
                            }
                        } catch { /* skip malformed lines */ }
                    }
                } catch (err) {
                    console.warn(`[Migration] Could not parse session file ${session.path}:`, err);
                }

                await SessionMeta.create({
                    id: sessionId,
                    ownerId: ADMIN_DEV_ID,
                    name: sessionName
                });
                console.log(`[Migration] Claimed session ${sessionId} (name: "${sessionName}") to ${ADMIN_DEV_ID}`);
            }
        }
    }

    // 2. Migrate Agents
    const agentsDir = path.resolve(process.cwd(), 'agents');
    if (existsSync(agentsDir)) {
        const agentFolders = await fs.readdir(agentsDir, { withFileTypes: true });
        for (const entry of agentFolders) {
            if (entry.isDirectory()) {
                const agentId = entry.name;
                const exists = await AgentMeta.exists({ id: agentId });
                if (!exists) {
                    const agentPath = path.join(agentsDir, agentId);
                    const hasAgentsMd = existsSync(path.join(agentPath, 'AGENTS.md'));
                    const detectedType = hasAgentsMd ? 'KM Agent' : 'General Agent';
                    await AgentMeta.create({
                        id: agentId,
                        name: agentId,
                        ownerId: ADMIN_DEV_ID,
                        type: detectedType
                    });
                    console.log(`[Migration] Claimed agent ${agentId} to ${ADMIN_DEV_ID}`);
                }
            }
        }
    }

    // 3. Migrate Documents (from JSON DB)
    const docsMetaPath = path.resolve(process.cwd(), 'memory/documents/documents_meta.json');
    if (existsSync(docsMetaPath)) {
        try {
            const raw = readFileSync(docsMetaPath, 'utf8');
            const data = JSON.parse(raw);
            for (const docId of Object.keys(data)) {
                const docData = data[docId];
                const exists = await DocumentMeta.exists({ id: docData.id });
                if (!exists) {
                    await DocumentMeta.create({
                        id: docData.id,
                        ownerId: ADMIN_DEV_ID,
                        name: docData.name,
                        path: docData.path,
                        status: docData.status,
                        createdAt: new Date(docData.createdAt || Date.now())
                    });
                    console.log(`[Migration] Claimed document ${docData.id} to ${ADMIN_DEV_ID}`);
                }
            }
            // Once safely imported, rename the old file to avoid double importing or confusion later
            await fs.rename(docsMetaPath, `${docsMetaPath}.migrated.bak`);
        } catch (err) {
            console.error('[Migration] Failed to migrate documents_meta.json', err);
        }
    }
}
