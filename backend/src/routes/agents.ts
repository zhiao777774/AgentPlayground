import { Router } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// GET /api/agents - List all agents
router.get('/', async (req, res) => {
    try {
        await ensureAgentsDir();
        const entries = await fs.readdir(agentsDir, { withFileTypes: true });

        const agents = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const agentPath = path.join(agentsDir, entry.name);
                const stat = await fs.stat(agentPath);

                // Read AGENTS.md to extract some metadata if needed (e.g. type/goal)
                let type = 'Unknown';
                const agentsMdPath = path.join(agentPath, 'AGENTS.md');
                if (existsSync(agentsMdPath)) {
                    // Could optionally parse AGENTS.md here, for now just marking it exists
                    type = 'KM Agent'; // Defaulting to KM Agent as per current scope, can be refined based on file content
                }

                agents.push({
                    id: entry.name,
                    name: entry.name,
                    type: type,
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

// GET /api/agents/:id - Get a specific agent's details (files structure and content)
router.get('/:id', async (req, res) => {
    const agentId = req.params.id;
    const agentPath = path.join(agentsDir, agentId);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    try {
        const result: any = { id: agentId, files: {} };

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

// PUT /api/agents/:id - Update an agent's specific file
router.put('/:id', async (req, res) => {
    const agentId = req.params.id;
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
        return res.status(404).json({ error: 'Agent not found' });
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

// DELETE /api/agents/:id - Delete an agent completely
router.delete('/:id', async (req, res) => {
    const agentId = req.params.id;
    const agentPath = path.join(agentsDir, agentId);

    if (!existsSync(agentPath)) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    try {
        await fs.rm(agentPath, { recursive: true, force: true });
        res.json({ ok: true });
    } catch (error: any) {
        console.error(`Failed to delete agent ${agentId}:`, error);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

export default router;
