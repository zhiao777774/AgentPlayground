import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { DocumentMeta } from '../models/ResourceMeta.js';

export const listKnowledgeBaseDocumentsSchema = Type.Object({});

export const list_knowledge_base_documents: ToolDefinition<any, any> = {
    name: 'list_knowledge_base_documents',
    label: 'List Knowledge Base Documents',
    description:
        'Returns a list of all documents currently indexed and available in the RAG Knowledge Base. IMPORTANT: This is the ONLY way to see documents available for semantic search; do not use standard shell commands (ls, find) to check the knowledge base. You should call this first to get the correct document IDs before performing a search.',
    parameters: listKnowledgeBaseDocumentsSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        try {
            const userId = _ctx?.userId;
            if (!userId) {
                throw new Error('User ID not found in tool context');
            }

            // Directly query the database for documents owned by or shared with the user
            const docs = await DocumentMeta.find({
                $or: [
                    { ownerId: userId },
                    { 'sharedWith.userId': userId }
                ]
            }).lean();

            const formattedDocs = docs.map((doc: any) => ({
                id: doc.id,
                name: doc.name,
                status: doc.status,
                createdAt: doc.createdAt,
            }));

            if (formattedDocs.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'No documents are currently available in the Knowledge Base for your account.',
                        },
                    ],
                    details: {},
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Available Knowledge Base Documents:\n\n${JSON.stringify(formattedDocs, null, 2)}`,
                    },
                ],
                details: {},
            };
        } catch (error) {
            console.error('Failed to list knowledge base documents:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: Failed to retrieve document list. ${error instanceof Error ? error.message : 'Unknown error'}.`,
                    },
                ],
                details: {},
            };
        }
    },
};
