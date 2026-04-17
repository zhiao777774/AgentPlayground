import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import unzipper from 'unzipper';
import archiver from 'archiver';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { AgentMeta } from '../models/ResourceMeta.js';

// Configuration constants for file traversing
const IGNORED_DIRS = new Set([
    'node_modules',
    'venv',
    'env',
    '.venv',
    '.env',
    'dist',
    'build',
    '__pycache__',
    '.git',
    '.idea',
    '.vscode',
]);
const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1 MB limit
const MAX_DEPTH = 10; // Maximum directory depth to traverse

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const agentsDir = path.resolve(__dirname, '../../agents');

// Helper to ensure agents directory exists
async function ensureAgentsDir() {
    if (!existsSync(agentsDir)) {
        await fs.mkdir(agentsDir, { recursive: true });
    }
}

// Multer setup for zip uploads (memory storage before extraction)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        if (
            file.mimetype === 'application/zip' ||
            file.mimetype === 'application/x-zip-compressed' ||
            file.originalname.endsWith('.zip')
        ) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are supported for agent upload.'));
        }
    },
});

/**
 * Synchronizes the AgentMeta database with the physical agents/ directory.
 * This handles 'Auto-Registration' for folders created by AI skills in real-time.
 */
export async function syncAgentMetaFromDisk(currentUserId: string, currentUsername: string) {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

        const folderName = entry.name;
        // Normalize the username to match the folder naming convention (lowercase, no underscores)
        const folderPrefix = currentUsername.toLowerCase().replace(/_/g, '-');
        
        // Only auto-register or correct folders that belong to the CURRENT user
        if (folderName.startsWith(`${folderPrefix}--`)) {
            const agentName = folderName.replace(`${folderPrefix}--`, '');
            const existing = await AgentMeta.findOne({ id: folderName });

            if (!existing) {
                console.log(`[Auto-Register] Registering new folder: ${folderName}`);
                const hasAgentsMd = existsSync(path.join(agentsDir, folderName, 'AGENTS.md'));
                await AgentMeta.create({
                    id: folderName,
                    name: agentName,
                    ownerId: currentUserId,
                    ownerName: currentUsername, // Use username as name if display name not in sync context
                    type: hasAgentsMd ? 'KM Agent' : 'General Agent'
                });
            } else if (existing.ownerId !== currentUserId) {
                // CORRECTION: If the agent exists but was claimed by wrong ID (e.g. legacy 'admin')
                // we correct it to the actual logged-in user's ID.
                console.log(`[Sync] Correcting owner for ${folderName}: ${existing.ownerId} -> ${currentUserId}`);
                existing.ownerId = currentUserId;
                await existing.save();
            }
        }
    }
}

// GET /api/agents - List all agents
router.get('/', async (req, res) => {
    try {
        const userId = req.user!.id;
        const username = req.user!.username;

        // Perform migration and auto-registration before listing
        await syncAgentMetaFromDisk(userId, username);

        const authMetas = await AgentMeta.find({ $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }] });
        const validAgentsMap = new Map(authMetas.map(m => [m.id, m]));

        const entries = await fs.readdir(agentsDir, { withFileTypes: true });

        const agents = [];
        for (const entry of entries) {
            if (entry.isDirectory() && validAgentsMap.has(entry.name)) {
                const agentPath = path.join(agentsDir, entry.name);
                const stat = await fs.stat(agentPath);
                
                const meta = validAgentsMap.get(entry.name)!;

                agents.push({
                    id: entry.name,
                    name: meta.name,
                    type: meta.type,
                    ownerId: meta.ownerId,
                    ownerName: meta.ownerName,
                    sharedWith: meta.sharedWith,
                    isShared: meta.ownerId !== userId,
                    createdAt: stat.birthtime.toISOString(),
                    updatedAt: stat.mtime.toISOString(),
                });
            }
        }
        res.json(agents);
    } catch (error: any) {
        console.error('Failed to list agents:', error);
        res.status(500).json({ error: 'Failed to list agents' });
    }
});

// POST /api/agents/upload - Upload a new agent via zip
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const zipBuffer = req.file.buffer;

        // Step 1: Analyze zip to find root folder name
        const directory = await unzipper.Open.buffer(zipBuffer);
        if (directory.files.length === 0) {
            return res.status(400).json({ error: 'Zip file is empty' });
        }

        // Find the first top-level folder (or derive from files)
        const rootEntries = new Set<string>();
        for (const file of directory.files) {
            const parts = file.path.split('/');
            if (parts.length > 0 && parts[0]) {
                // Ignore macOS invisible folders
                if (parts[0] !== '__MACOSX') {
                    rootEntries.add(parts[0]);
                }
            }
        }

        if (rootEntries.size !== 1) {
            return res.status(400).json({
                error: 'Zip file must contain exactly one top-level folder representing the agent',
            });
        }

        const agentName = Array.from(rootEntries)[0];
        const agentId = randomUUID();
        const finalAgentPath = path.join(agentsDir, agentId);

        // Step 2: Extract zip safely to a temp dir then rename to UUID
        await ensureAgentsDir();
        const tempExtracDir = path.join(agentsDir, `.tmp_${agentId}`);
        await fs.mkdir(tempExtracDir, { recursive: true });

        try {
            const readStream = Readable.from(zipBuffer);
            await readStream.pipe(unzipper.Extract({ path: tempExtracDir })).promise();

            const sourceFolder = path.join(tempExtracDir, agentName);
            await fs.rename(sourceFolder, finalAgentPath);
        } finally {
            // Clean up zip artifacts
            if (existsSync(tempExtracDir)) {
                await fs.rm(tempExtracDir, { recursive: true, force: true });
            }
        }

        // Auto-detect agent type based on folder contents
        const hasAgentsMd = existsSync(path.join(finalAgentPath, 'AGENTS.md'));
        const detectedType = hasAgentsMd ? 'KM Agent' : 'General Agent';

        await AgentMeta.create({
            id: agentId,
            name: agentName,
            ownerId: req.user!.id,
            ownerName: req.user!.displayName,
            type: detectedType
        });

        res.status(201).json({
            message: 'Agent uploaded successfully',
            agent: { id: agentId, name: agentName, type: detectedType },
        });
    } catch (error: any) {
        console.error('Failed to upload agent:', error);
        res.status(500).json({
            error: error.message || 'Failed to extract agent zip file',
        });
    }
});

// GET /api/agents/:id - Get a specific agent's details (files structure and content)
router.get('/:id', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;

    const authMeta = await AgentMeta.findOne({
        id: agentId,
        $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
    });

    if (!authMeta) {
        return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const agentPath = path.join(agentsDir, agentId);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found locally' });
    }

    try {
        const result: any = { id: agentId, files: {}, isShared: authMeta.ownerId !== userId };

        // Helper to recursively read all valid markdown files
        async function readFiles(
            currentPath: string,
            relativePrefix: string = '',
            depth: number = 0,
        ) {
            // Prevent infinite recursion or excessively deep traversing and notify user
            if (depth > MAX_DEPTH) {
                const warningPath = path.join(
                    relativePrefix,
                    '[Directory too deep].txt',
                );
                result.files[warningPath] = {
                    content: `[Directory depth exceeds ${MAX_DEPTH} levels. Further contents are hidden.]`,
                    readOnly: true,
                };
                return;
            }

            const entries = await fs.readdir(currentPath, {
                withFileTypes: true,
            });

            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue; // Skip hidden

                if (entry.isDirectory() && IGNORED_DIRS.has(entry.name))
                    continue;

                const fullPath = path.join(currentPath, entry.name);
                const relPath = path.join(relativePrefix, entry.name);

                if (entry.isDirectory()) {
                    await readFiles(fullPath, relPath, depth + 1);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    const imageExts = [
                        '.png',
                        '.jpg',
                        '.jpeg',
                        '.gif',
                        '.webp',
                        '.svg',
                        '.bmp',
                        '.ico',
                    ];
                    const isReadOnly = relPath.includes('/');

                    try {
                        const stats = await fs.stat(fullPath);
                        if (stats.size > MAX_FILE_SIZE) {
                            result.files[relPath] = {
                                content: `[File exceeds 1MB preview limit]`,
                                readOnly: true,
                            };
                            continue;
                        }
                    } catch (e) {
                        continue; // Skip if we can't stat
                    }

                    if (imageExts.includes(ext)) {
                        // Encode images as base64 data URIs
                        const buf = await fs.readFile(fullPath);
                        const mime =
                            ext === '.svg'
                                ? 'image/svg+xml'
                                : ext === '.jpg' || ext === '.jpeg'
                                  ? 'image/jpeg'
                                  : ext === '.png'
                                    ? 'image/png'
                                    : ext === '.gif'
                                      ? 'image/gif'
                                      : ext === '.webp'
                                        ? 'image/webp'
                                        : ext === '.bmp'
                                          ? 'image/bmp'
                                          : ext === '.ico'
                                            ? 'image/x-icon'
                                            : 'application/octet-stream';
                        result.files[relPath] = {
                            content: `data:${mime};base64,${buf.toString('base64')}`,
                            readOnly: true,
                            isImage: true,
                        };
                    } else {
                        // Try reading as text; skip if binary / unreadable
                        try {
                            const content = await fs.readFile(fullPath, 'utf8');
                            result.files[relPath] = {
                                content,
                                readOnly: isReadOnly,
                            };
                        } catch {
                            // Skip files that can't be read as text
                        }
                    }
                }
            }
        }

        await readFiles(agentPath);
        res.json(result);
    } catch (error: any) {
        console.error(`Failed to read agent ${agentId}:`, error);
        res.status(500).json({ error: 'Failed to read agent details' });
    }
});

router.put('/:id', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;

    // Check if user is owner or shared user
    const authMeta = await AgentMeta.findOne({
        id: agentId,
        $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
    });

    if (!authMeta) {
        return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const { filePath, content } = req.body;

    if (!filePath || content === undefined) {
        return res
            .status(400)
            .json({ error: 'filePath and content are required' });
    }

    // Prevent directory traversal attacks and modification of memory/ and skills/
    if (
        filePath.includes('..') ||
        filePath.startsWith('memory/') ||
        filePath.startsWith('skills/')
    ) {
        return res
            .status(403)
            .json({ error: 'Cannot modify restricted files' });
    }

    const agentPath = path.join(agentsDir, agentId);
    const fullFilePath = path.join(agentPath, filePath);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found locally' });
    }

    try {
        // Ensure parent directories exist (e.g. if creating a new file)
        await fs.mkdir(path.dirname(fullFilePath), { recursive: true });
        await fs.writeFile(fullFilePath, content, 'utf8');
        res.json({ ok: true });
    } catch (error: any) {
        console.error(
            `Failed to update file ${filePath} for agent ${agentId}:`,
            error,
        );
        res.status(500).json({ error: 'Failed to update agent file' });
    }
});

// GET /api/agents/:id/export - Export an agent as a zip file
router.get('/:id/export', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;

    const authMeta = await AgentMeta.findOne({
        id: agentId,
        $or: [{ ownerId: userId }, { 'sharedWith.userId': userId }]
    });

    if (!authMeta) {
        return res.status(404).json({ error: 'Agent not found or unauthorized' });
    }

    const agentPath = path.join(agentsDir, agentId);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found locally' });
    }

    try {
        // Set headers to trigger a file download in the browser
        res.attachment(`${agentId}.zip`);

        const archive = archiver('zip', {
            zlib: { level: 9 }, // Sets the compression level.
        });

        // Listen for all archive's data and pipe it to the response object
        archive.pipe(res);

        // Good practice to catch warnings (ie stat failures and other non-blocking errors)
        archive.on('warning', function (err) {
            if (err.code === 'ENOENT') {
                console.warn(err);
            } else {
                throw err;
            }
        });

        // Good practice to catch these errors explicitly
        archive.on('error', function (err) {
            throw err;
        });

        // Append files from a sub-directory, putting its contents at the root of archive
        // We put them inside a folder named after the agent, so when unzipped, it creates that folder.
        archive.directory(agentPath, agentId);

        // Finalize the archive (i.e. we are done appending files)
        archive.finalize();
    } catch (error: any) {
        console.error(`Failed to export agent ${agentId}:`, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to export agent' });
        }
    }
});

// DELETE /api/agents/:id - Delete an agent completely
router.delete('/:id', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;

    const authMeta = await AgentMeta.findOne({ id: agentId, ownerId: userId });
    if (!authMeta) {
        return res.status(404).json({ error: 'Agent not found or unauthorized to delete' });
    }

    await AgentMeta.deleteOne({ id: agentId });

    const agentPath = path.join(agentsDir, agentId);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found locally' });
    }

    try {
        await fs.rm(agentPath, { recursive: true, force: true });
        res.json({ ok: true });
    } catch (error: any) {
        console.error(`Failed to delete agent ${agentId}:`, error);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

// POST /api/agents/:id/share - Share an agent with another user
router.post('/:id/share', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;
    const { targetUserId, targetUserName } = req.body;

    if (!targetUserId || !targetUserName) {
        return res.status(400).json({ error: 'targetUserId and targetUserName are required' });
    }

    try {
        const agent = await AgentMeta.findOne({ id: agentId, ownerId: userId });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or unauthorized' });
        }

        // Check if already shared
        if (!agent.sharedWith.some(u => u.userId === targetUserId)) {
            agent.sharedWith.push({ userId: targetUserId, name: targetUserName });
            await agent.save();
        }

        res.json(agent.sharedWith);
    } catch (error) {
        console.error('Failed to share agent:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/agents/:id/unshare - Unshare an agent
router.post('/:id/unshare', async (req, res) => {
    const agentId = req.params.id;
    const userId = req.user!.id;
    const { targetUserId } = req.body;

    if (!targetUserId) {
        return res.status(400).json({ error: 'targetUserId is required' });
    }

    try {
        const agent = await AgentMeta.findOne({ id: agentId, ownerId: userId });
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found or unauthorized' });
        }

        agent.sharedWith = agent.sharedWith.filter(u => u.userId !== targetUserId);
        await agent.save();

        res.json(agent.sharedWith);
    } catch (error) {
        console.error('Failed to unshare agent:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
