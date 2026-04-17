import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { AgentMeta } from '../models/ResourceMeta.js';

export const agentListSchema = Type.Object({});

export const agent_list: ToolDefinition<any, any> = {
    name: 'agent_list',
    label: 'List Available Agents',
    description:
        'Returns a list of all available customized agents in the system that you have access to. Use this when the user asks what other agents or personas are available.',
    parameters: agentListSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
        try {
            const userId = ctx?.userId;
            if (!userId) {
                throw new Error('User ID not found in tool context');
            }

            // Query database for agents owned by or shared with the user
            const dbAgents = await AgentMeta.find({
                $or: [
                    { ownerId: userId },
                    { 'sharedWith.userId': userId }
                ]
            }).sort({ createdAt: -1 });

            if (dbAgents.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'No custom agents found or available for your account.',
                        },
                    ],
                    details: {},
                };
            }

            const agentLines = dbAgents.map(
                (a) =>
                    `- **${a.name}** (ID: \`${a.id}\`, Type: ${a.type || 'Unknown'}, Owner: ${a.ownerId === userId ? 'You' : 'Shared with you'})`,
            );

            return {
                content: [
                    {
                        type: 'text',
                        text: `Available Agent(s):\n${agentLines.join('\n')}`,
                    },
                ],
                details: {},
            };
        } catch (error: any) {
            console.error('Failed to list agents tool error:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to retrieve agent list: ${error.message}`,
                    },
                ],
                details: {},
            };
        }
    },
};
