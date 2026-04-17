export interface User {
    id: string;
    username: string;
    displayName: string;
    email: string;
}

export interface Model {
    id: string;
    name: string;
    provider: string;
}

export interface Session {
    id: string;
    created: string;
    modified: string;
    name?: string;
    firstMessage?: string;
    messages?: Message[];
    activeAgentId?: string | null;
    lastModelId?: string;
    agentRoutingEntries?: Array<{
        id: string;
        parentId: string | null;
        agentId: string | null;
    }>;
    contextUsage?: { tokens: number; contextWindow: number; percent: number };
    ownerId?: string;
    sharedWith?: Array<{ userId: string, name: string }>;
    isShared?: boolean;
}

export interface SearchUser {
    id: string;
    username: string;
    displayName: string;
    department: string;
}

export interface Message {
    id: string;
    parentId?: string | null;
    role: 'user' | 'assistant' | 'system';
    isCompaction?: boolean;
    content: string;
    reasoning?: string;
    toolCalls?: ToolCall[];
    activeAgentId?: string | null;
    citations?: Record<string, any>;
    errorMessage?: string;
    stopReason?: string;
}

export interface ToolCall {
    name: string;
    input: Record<string, unknown>;
    status: 'pending' | 'success' | 'error';
    output?: string;
}

export interface Agent {
    id: string;
    name: string;
    type: string;
    createdAt: string;
    updatedAt: string;
}

export interface AgentDetail {
    id: string;
    files: Record<
        string,
        {
            content: string;
            readOnly: boolean;
            isImage?: boolean;
        }
    >;
}

export interface DocumentMeta {
    id: string;
    name: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: string;
    path: string;
    error?: string;
    chunkCount?: number | null;
}

export interface DocumentChunk {
    id: string;
    text: string;
}

export interface DocumentChunksResponse {
    chunks: DocumentChunk[];
    total: number;
}
