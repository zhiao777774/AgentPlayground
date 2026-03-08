import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import * as path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

export const agentListSchema = Type.Object({});

export const agent_list: ToolDefinition<any, any> = {
    name: 'agent_list',
    label: 'List Available Agents',
    description:
        'Returns a list of all available customized agents in the system and their basic metadata (e.g. type, creation date). Use this when the user asks what other agents or personas are available.',
    parameters: agentListSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        // Find the absolute root backend directory dynamically instead of simple ctx.cwd
        // since ctx.cwd might be the specific agent's folder if running under a slash command.

        let rootDir = ctx.cwd;
        // If the current working directory looks like it's inside an agent folder
        if (rootDir.includes('/agents/')) {
            rootDir = path.resolve(rootDir, '../../');
        }

        const agentsDir = path.resolve(rootDir, 'agents');

        if (!existsSync(agentsDir)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'No agents directory found or no agents available.',
                    },
                ],
                details: {},
            };
        }

        try {
            const entries = await fs.readdir(agentsDir, {
                withFileTypes: true,
            });
            const agents = [];

            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const agentPath = path.join(agentsDir, entry.name);
                    const stat = await fs.stat(agentPath);

                    let type = 'Unknown';
                    const agentsMdPath = path.join(agentPath, 'AGENTS.md');
                    if (existsSync(agentsMdPath)) {
                        type = 'KM Agent'; // Defaulting to KM Agent as per current context
                    }

                    agents.push(
                        `- **${entry.name}** (Type: ${type}, Created: ${stat.birthtime.toISOString().split('T')[0]})`,
                    );
                }
            }

            if (agents.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'No custom agents found.',
                        },
                    ],
                    details: {},
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Found ${agents.length} agent(s):\n${agents.join('\n')}`,
                    },
                ],
                details: {},
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to read agents directory: ${error.message}`,
                    },
                ],
                details: {},
            };
        }
    },
};
