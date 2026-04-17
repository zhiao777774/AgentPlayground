import mongoose from 'mongoose';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
    SessionMeta,
    AgentMeta,
    DocumentMeta,
} from '../models/ResourceMeta.js';

const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/agent-playground';
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
        const { SessionManager } =
            await import('@mariozechner/pi-coding-agent');
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
                        } catch {
                            /* skip malformed lines */
                        }
                    }
                } catch (err) {
                    console.warn(
                        `[Migration] Could not parse session file ${session.path}:`,
                        err,
                    );
                }

                await SessionMeta.create({
                    id: sessionId,
                    ownerId: ADMIN_DEV_ID,
                    ownerName: 'Administrator (Dev)',
                    name: sessionName,
                });
                console.log(
                    `[Migration] Claimed session ${sessionId} (name: "${sessionName}") to ${ADMIN_DEV_ID}`,
                );
            }
        }
    }

    // 2. Migrate Agents
    const agentsDir = path.resolve(process.cwd(), 'agents');
    if (existsSync(agentsDir)) {
        const agentFolders = await fs.readdir(agentsDir, {
            withFileTypes: true,
        });
        for (const entry of agentFolders) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

            let folderName = entry.name;
            const oldPath = path.join(agentsDir, folderName);

            // 2.1 Handle legacy folders without '--' prefix
            if (!folderName.includes('--')) {
                const newFolderName = `admin--${folderName}`;
                const newPath = path.join(agentsDir, newFolderName);

                console.log(
                    `[Migration] Renaming legacy agent folder: ${folderName} -> ${newFolderName}`,
                );
                try {
                    if (!existsSync(newPath)) {
                        await fs.rename(oldPath, newPath);
                        folderName = newFolderName; // Continue with the new name
                    } else {
                        // Collision? Use the new one and let the old one be dealt with manually if needed
                        console.warn(
                            `[Migration] Collision detected for ${newFolderName}, skipping rename.`,
                        );
                    }
                } catch (err) {
                    console.error(
                        `[Migration] Failed to rename ${oldPath}:`,
                        err,
                    );
                }
            }

            // 2.2 Register in DB if missing or incorrectly owned
            const exists = await AgentMeta.findOne({ id: folderName });
            if (!exists) {
                const parts = folderName.split('--');
                const agentName =
                    parts.length > 1 ? parts.slice(1).join('--') : folderName;
                const ownerUsername = parts.length > 1 ? parts[0] : 'admin';

                // For initial migration, we assume anything missing belongs to admin-dev-id
                // OR we could look up the user by username if we wanted to be more precise.
                const targetOwnerId =
                    ownerUsername === 'admin' ? ADMIN_DEV_ID : ownerUsername;

                const agentPath = path.join(agentsDir, folderName);
                const hasAgentsMd = existsSync(
                    path.join(agentPath, 'AGENTS.md'),
                );
                const detectedType = hasAgentsMd ? 'KM Agent' : 'General Agent';

                await AgentMeta.create({
                    id: folderName,
                    name: agentName,
                    ownerId: targetOwnerId,
                    ownerName:
                        targetOwnerId === ADMIN_DEV_ID
                            ? 'Administrator (Dev)'
                            : targetOwnerId, // Fallback to username for auto-reg
                    type: detectedType,
                });
                console.log(
                    `[Migration] Registered agent ${folderName} to owner ${targetOwnerId}`,
                );
            }
        }
    }

    // 3. Migrate Documents (from JSON DB)
    const docsMetaPath = path.resolve(
        process.cwd(),
        'memory/documents/documents_meta.json',
    );
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
                        ownerName: 'Administrator (Dev)',
                        name: docData.name,
                        path: docData.path,
                        status: docData.status,
                        createdAt: new Date(docData.createdAt || Date.now()),
                    });
                    console.log(
                        `[Migration] Claimed document ${docData.id} to ${ADMIN_DEV_ID}`,
                    );
                }
            }
            // Once safely imported, rename the old file to avoid double importing or confusion later
            await fs.rename(docsMetaPath, `${docsMetaPath}.migrated.bak`);
        } catch (err) {
            console.error(
                '[Migration] Failed to migrate documents_meta.json',
                err,
            );
        }
    }

    // 4. Backfill ownerName for any records missing it (New Step)
    console.log('[Migration] Backfilling ownerName for existing records...');
    const USER_MAP: Record<string, string> = {
        'admin-dev-id': 'Administrator (Dev)',
        'test-user-id': 'Test User',
    };

    const collections = [
        { model: SessionMeta, name: 'Sessions' },
        { model: AgentMeta, name: 'Agents' },
        { model: DocumentMeta, name: 'Documents' },
    ];

    for (const { model, name } of collections) {
        const records = await (model as any).find({
            $or: [{ ownerName: { $exists: false } }, { ownerName: '' }],
        });
        for (const record of records) {
            // Use the map for known dev accounts, fall back to ownerId (username) for others
            record.ownerName = USER_MAP[record.ownerId] || record.ownerId || 'Unknown User';
            await record.save();
        }
        if (records.length > 0)
            console.log(
                `[Migration] Updated ${records.length} records in ${name} with ownerName.`,
            );
    }
}
