import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import axios from 'axios';
import * as path from 'path';

export const listKnowledgeBaseDocumentsSchema = Type.Object({});

export const list_knowledge_base_documents: ToolDefinition<any, any> = {
    name: 'list_knowledge_base_documents',
    label: 'List Knowledge Base Documents',
    description:
        'Returns a list of all documents currently indexed and available in the RAG Knowledge Base. IMPORTANT: This is the ONLY way to see documents available for semantic search; do not use standard shell commands (ls, find) to check the knowledge base. You should call this first to get the correct document IDs before performing a search.',
    parameters: listKnowledgeBaseDocumentsSchema,
    execute: async (_toolCallId, _params, _signal, _onUpdate, _ctx) => {
        try {
            // Document metadata is stored by the backend Express server
            const API_BASE =
                process.env.VITE_API_BASE || 'http://localhost:3001/api';
            const response = await axios.get(`${API_BASE}/documents`);

            const docs = response.data.map((doc: any) => ({
                id: doc.id,
                name: doc.name,
                status: doc.status,
                createdAt: doc.createdAt,
            }));

            if (docs.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'No documents are currently available in the Knowledge Base.',
                        },
                    ],
                    details: {},
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Available Knowledge Base Documents:\n\n${JSON.stringify(docs, null, 2)}`,
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
                        text: `Error: Failed to retrieve document list. The Knowledge Base service might be offline.`,
                    },
                ],
                details: {},
            };
        }
    },
};
