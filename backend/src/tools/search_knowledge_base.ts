import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import axios from 'axios';
import { DocumentMeta } from '../models/ResourceMeta.js';

export const searchKnowledgeBaseSchema = Type.Object({
    query: Type.String({
        description:
            'The semantic question or topic to search for within the documents.',
    }),
    document_ids: Type.Optional(
        Type.Array(Type.String(), {
            description:
                'Optional list of specific document IDs to restrict the search to. If omitted, searches all documents.',
        }),
    ),
    limit: Type.Optional(
        Type.Number({
            description: 'Maximum number of chunks to return. Defaults to 10.',
            default: 10,
        }),
    ),
});

export const search_knowledge_base: ToolDefinition<any, any> = {
    name: 'search_knowledge_base',
    label: 'Search Knowledge Base',
    description:
        'Performs a semantic (RAG) search within the knowledge base documents to find content related to the query. This is specifically for searching inside PDF and TXT contents indexed by the system. Use this to answer questions about uploaded documents. If you need to know which documents exist, use list_knowledge_base_documents first.',
    parameters: searchKnowledgeBaseSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
        const query = params.query;
        let requestedDocumentIds = params.document_ids;
        const limit = params.limit || 10;

        try {
            const userId = _ctx?.userId;
            if (!userId) {
                throw new Error('User ID not found in tool context');
            }

            // 1. Fetch ALL documents accessible to this user
            const authorizedDocs = await DocumentMeta.find({
                $or: [
                    { ownerId: userId },
                    { 'sharedWith.userId': userId }
                ]
            }).lean();

            const authorizedIds = authorizedDocs.map(d => d.id);
            const docMap = authorizedDocs.reduce((acc: any, doc: any) => {
                acc[doc.id] = doc;
                return acc;
            }, {});

            if (authorizedIds.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'You do not have access to any documents in the Knowledge Base.',
                        },
                    ],
                    details: {},
                };
            }

            // 2. Security Filter: Intersect requested IDs with authorized IDs
            let targetDocumentIds: string[];
            if (requestedDocumentIds && requestedDocumentIds.length > 0) {
                targetDocumentIds = requestedDocumentIds.filter(id => authorizedIds.includes(id));
                if (targetDocumentIds.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: 'None of the requested documents were found or you do not have permission to access them.',
                            },
                        ],
                        details: {},
                    };
                }
            } else {
                // Default to all authorized documents
                targetDocumentIds = authorizedIds;
            }

            // 3. Call Python RAG Service
            const PYTHON_SERVICE_URL =
                process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

            const payload: any = {
                query: query,
                limit: limit,
                document_ids: targetDocumentIds
            };

            const response = await axios.post(
                `${PYTHON_SERVICE_URL}/api/rag/search`,
                payload,
            );
            const results = response.data.results;

            if (!results || results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'No relevant information found in your accessible documents for this query.',
                        },
                    ],
                    details: {},
                };
            }

            // 4. Format results with resolved names from DB
            let formattedResults = `Found ${results.length} relevant chunks from your accessible knowledge base:\n\n`;
            formattedResults += `IMPORTANT INSTRUCTION: When you use information from these search results in your answer, you MUST cite them using a markdown link with the specific Citation Link provided. Example: "This is a fact [1](cite:123456)."\n\n`;

            const citations: Record<string, any> = {};

            results.forEach((hit: any, index: number) => {
                const docName = docMap[hit.document_id]?.name || hit.document_id;
                const citeId = hit.id.toString();

                citations[citeId] = {
                    id: citeId,
                    document_name: docName,
                    document_id: hit.document_id,
                    score: hit.score,
                    text: hit.text,
                };

                formattedResults += `--- Chunk from Document: ${docName} ---\n`;
                formattedResults += `Citation Link: cite:${citeId}\n`;
                formattedResults += `Relevance Score: ${hit.score.toFixed(4)}\n`;
                formattedResults += `Text:\n${hit.text}\n\n`;
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: formattedResults,
                    },
                ],
                details: { citations },
            };
        } catch (error: any) {
            console.error('Failed to search knowledge base:', error);
            const errorMessage = error.response?.data?.detail || error.message;
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error searching the knowledge base: ${errorMessage}`,
                    },
                ],
                details: {},
            };
        }
    },
};
