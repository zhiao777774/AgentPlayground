import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

export const switchAgentRoutingSchema = Type.Object({
    agentId: Type.String({
        description:
            'The unique directory name of the agent to switch context to.',
    }),
});

export const switch_agent_routing: ToolDefinition<any, any> = {
    name: 'switch_agent_routing',
    label: 'Switch Agent Routing Context',
    description:
        'Switches the active default agent routing context for this chat session to a newly created agent. Call this tool ONLY after you have successfully created a new agent folder using another tool or skill. This seamlessly redirects the user to their new agent for future inputs.',
    parameters: switchAgentRoutingSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: any) => {
        try {
            if (ctx.sessionManager) {
                // Since this is natively hooked into the SDK context, try to persist the tracking tag directly into the active session history!
                ctx.sessionManager.appendCustomEntry('agent_routing', {
                    agentId: params.agentId,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: `[SYSTEM] Successfully switched the persistent chat context to agent: ${params.agentId}. The user will now interact directly with this new agent in subsequent turns.`,
                        },
                    ],
                    details: {},
                };
            } else {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Failed to switch context. The SessionManager instance was not exposed to the execution context.`,
                        },
                    ],
                    details: {},
                };
            }
        } catch (error: any) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to switch routing context: ${error.message}`,
                    },
                ],
                details: {},
            };
        }
    },
};
