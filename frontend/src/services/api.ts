import type {
    Model,
    Session,
    Agent,
    AgentDetail,
    DocumentMeta,
    DocumentChunksResponse,
} from '../types/index';

export const API_BASE =
    import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

export const api = {
    models: {
        list: async (): Promise<Model[]> => {
            const res = await fetch(`${API_BASE}/models`);
            if (!res.ok) throw new Error('Failed to fetch models');
            return res.json();
        },
    },
    sessions: {
        list: async (): Promise<Session[]> => {
            const res = await fetch(`${API_BASE}/sessions`);
            if (!res.ok) throw new Error('Failed to fetch sessions');
            return res.json();
        },
        create: async (): Promise<{ sessionId: string }> => {
            const res = await fetch(`${API_BASE}/sessions`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to create session');
            return res.json();
        },
        get: async (id: string): Promise<Session> => {
            const res = await fetch(`${API_BASE}/sessions/${id}`);
            if (!res.ok) throw new Error('Failed to fetch session');
            return res.json();
        },
        update: async (id: string, data: { name: string }): Promise<void> => {
            const res = await fetch(`${API_BASE}/sessions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error('Failed to update session');
        },
        delete: async (id: string): Promise<void> => {
            const res = await fetch(`${API_BASE}/sessions/${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete session');
        },
    },
    agents: {
        list: async (): Promise<Agent[]> => {
            const res = await fetch(`${API_BASE}/agents`);
            if (!res.ok) throw new Error('Failed to fetch agents');
            return res.json();
        },
        get: async (id: string): Promise<AgentDetail> => {
            const res = await fetch(`${API_BASE}/agents/${id}`);
            if (!res.ok) throw new Error('Failed to fetch agent details');
            return res.json();
        },
        updateFile: async (
            id: string,
            filePath: string,
            content: string,
        ): Promise<void> => {
            const res = await fetch(`${API_BASE}/agents/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath, content }),
            });
            if (!res.ok) throw new Error('Failed to update agent file');
        },
        delete: async (id: string): Promise<void> => {
            const res = await fetch(`${API_BASE}/agents/${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete agent');
        },
        upload: async (file: File): Promise<Agent> => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${API_BASE}/agents/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) {
                let errorMsg = 'Failed to upload agent';
                try {
                    const data = await res.json();
                    if (data.error) errorMsg = data.error;
                } catch {
                    if (res.status === 413) {
                        errorMsg =
                            'File is too large (exceeds maximum allowed size)';
                    }
                }
                throw new Error(errorMsg);
            }
            const data = await res.json();
            return data.agent;
        },
        export: async (id: string): Promise<void> => {
            const res = await fetch(`${API_BASE}/agents/${id}/export`, {
                method: 'GET',
            });
            if (!res.ok) throw new Error('Failed to export agent');

            // Handle file download
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `${id}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        },
    },
    documents: {
        list: async (): Promise<DocumentMeta[]> => {
            const res = await fetch(`${API_BASE}/documents`);
            if (!res.ok) throw new Error('Failed to fetch documents');
            return res.json();
        },
        get: async (id: string): Promise<DocumentMeta> => {
            const res = await fetch(`${API_BASE}/documents/${id}`);
            if (!res.ok) throw new Error('Failed to fetch document details');
            return res.json();
        },
        getChunks: async (
            id: string,
            limit = 50,
            offset = 0,
        ): Promise<DocumentChunksResponse> => {
            const res = await fetch(
                `${API_BASE}/documents/${id}/chunks?limit=${limit}&offset=${offset}`,
            );
            if (!res.ok) throw new Error('Failed to fetch document chunks');
            return res.json();
        },
        upload: async (file: File): Promise<DocumentMeta> => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${API_BASE}/documents/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) {
                let errorMsg = 'Failed to upload document';
                try {
                    const data = await res.json();
                    if (data.error) errorMsg = data.error;
                } catch {
                    // Ignore parsing error if it's not JSON (like 413 from Nginx)
                    if (res.status === 413) {
                        errorMsg =
                            'File is too large (exceeds maximum allowed size)';
                    }
                }
                throw new Error(errorMsg);
            }
            return res.json();
        },
        delete: async (id: string): Promise<void> => {
            const res = await fetch(`${API_BASE}/documents/${id}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to delete document');
        },
    },
};
