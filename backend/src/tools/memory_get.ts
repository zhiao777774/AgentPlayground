import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as path from 'path';
import * as fs from 'fs/promises';

export const memoryGetSchema = Type.Object({
    fileBasename: Type.String({
        description:
            "The name of the memory file (e.g., 'MEMORY' or 'memory/2023-10-27')",
    }),
    startLine: Type.Optional(
        Type.Number({
            description:
                'The starting line number to read from (1-indexed). Optional.',
        }),
    ),
    endLine: Type.Optional(
        Type.Number({
            description:
                'The ending line number to read until (1-indexed). Optional.',
        }),
    ),
});

export const memory_get: ToolDefinition<any, any> = {
    name: 'memory_get',
    label: 'memory_get',
    description:
        'Read targeted info from a specific memory Markdown file. Helpful for reading your MEMORY.md configuration and specific session memories (e.g. daily memory/YYYY-MM-DD.md). If `startLine` and `endLine` are omitted, the whole file is returned. Do not specify extension, pass relative name inside your agent directory.',
    parameters: memoryGetSchema,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        try {
            const { cwd } = ctx;
            const { fileBasename, startLine, endLine } = params;
            const safeBasename = fileBasename.replace(/\.md$/, ''); // Ensure no duplicate .md
            const filePath = path.join(cwd, `${safeBasename}.md`);

            // Prevent directory traversal
            if (!filePath.startsWith(path.resolve(cwd))) {
                throw new Error(
                    'Access denied: Cannot read files outside the agent memory directory.',
                );
            }

            const content = await fs.readFile(filePath, 'utf-8');

            let resultContent = content;
            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n');
                const start =
                    startLine !== undefined ? Math.max(1, startLine) - 1 : 0;
                const end =
                    endLine !== undefined
                        ? Math.min(lines.length, endLine)
                        : lines.length;

                if (start >= lines.length) {
                    resultContent = `File has only ${lines.length} lines.`;
                } else {
                    resultContent = lines.slice(start, end).join('\n');
                }
            }

            return {
                content: [{ type: 'text', text: resultContent }],
                details: {},
            };
        } catch (err: any) {
            let errorMessage = `Error reading memory file: ${err.message}`;
            if (err.code === 'ENOENT') {
                errorMessage = `File not found: ${params.fileBasename}.md. It may not exist yet or was deleted.`;
            }
            return {
                content: [{ type: 'text', text: errorMessage }],
                details: {},
            };
        }
    },
};
