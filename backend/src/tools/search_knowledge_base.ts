import { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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
        const documentIds = params.document_ids;
        const limit = params.limit || 10;

        try {
            const PYTHON_SERVICE_URL =
                process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

            const payload: any = {
                query: query,
                limit: limit,
            };

            if (documentIds && documentIds.length > 0) {
                payload.document_ids = documentIds;
            }

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
                            text: 'No relevant information found in the knowledge base for this query.',
                        },
                    ],
                    details: {},
                };
            }

            // Load document metadata to resolve names
            let docMeta: any = {};
            try {
                const dbPath = path.join(
                    process.cwd(),
                    'memory',
                    'documents',
                    'documents_meta.json',
                );
                if (fs.existsSync(dbPath)) {
                    docMeta = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
                }
            } catch (e) {
                console.error(
                    'Failed to load document metadata for search:',
                    e,
                );
            }

            // Format results cleanly for the LLM
            let formattedResults = `Found ${results.length} relevant chunks:\n\n`;
            formattedResults += `IMPORTANT INSTRUCTION: When you use information from these search results in your answer, you MUST cite them using a markdown link with the specific Citation Link provided. Example: "This is a fact [1](cite:123456)."\n\n`;

            const citations: Record<string, any> = {};

            results.forEach((hit: any, index: number) => {
                const docName =
                    docMeta[hit.document_id]?.name || hit.document_id;
                const citeId = hit.id.toString();

                // Store full data for frontend rendering
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
