import { useState, useRef } from 'react';
import type { Agent } from '../types';
import { Bot, Plus, Trash2, Calendar, FileText, UploadCloud, Loader2, Download } from 'lucide-react';
import { api } from '../services/api';

interface Props {
    agents: Agent[];
    onSelectAgent: (id: string) => void;
    onNewAgent: () => void;
    onDeleteAgent: (id: string) => void;
    onRefreshAgents: () => void;
    isLoading?: boolean;
}

export function AgentDashboard({ agents, onSelectAgent, onNewAgent, onDeleteAgent, onRefreshAgents, isLoading }: Props) {
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed' && !file.name.endsWith('.zip')) {
            alert('Only ZIP files are supported for agent upload.');
            return;
        }

        setIsUploading(true);
        try {
            await api.agents.upload(file);
            onRefreshAgents();
        } catch (error) {
            console.error('Upload failed:', error);
            alert(error instanceof Error ? error.message : 'Failed to upload agent.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    if (isLoading && !isUploading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    const agentToDelete = deleteConfirmId ? agents.find(a => a.id === deleteConfirmId) : null;

    return (
        <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-row items-center justify-between px-6 shrink-0">
                <h1 className="text-lg font-bold tracking-tight bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent flex items-center gap-2">
                    <Bot className="w-5 h-5 text-blue-500" />
                    Agent Management
                </h1>
                <div className="flex items-center gap-3">
                    <input
                        type="file"
                        accept=".zip"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-2 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                        {isUploading ? 'Uploading...' : 'Upload Agent'}
                    </button>
                    <button
                        onClick={onNewAgent}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        New Agent
                    </button>
                </div>
            </header>

            {/* Content Area */}
            <main className="flex-1 overflow-y-auto p-6 md:p-8">
                {agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
                        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-6">
                            <Bot className="w-8 h-8 text-gray-400" />
                        </div>
                        <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-2">No agents found</h2>
                        <p className="text-gray-500 dark:text-gray-400 mb-8">
                            You haven't created any custom Knowledge Management agents yet. Click "New Agent" to get started.
                        </p>
                        <button
                            onClick={onNewAgent}
                            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Create First Agent
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {agents.map((agent) => (
                            <div
                                key={agent.id}
                                onClick={() => onSelectAgent(agent.id)}
                                className="group bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col relative"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                        <Bot className="w-5 h-5" />
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                    await api.agents.export(agent.id);
                                                } catch {
                                                    alert('Failed to export agent');
                                                }
                                            }}
                                            className="p-2 rounded-lg transition-colors text-gray-400 hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-700 dark:hover:text-blue-400"
                                            title="Export Agent"
                                        >
                                            <Download className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteConfirmId(agent.id);
                                            }}
                                            className="p-2 rounded-lg transition-colors text-gray-400 hover:bg-gray-100 hover:text-red-500 dark:hover:bg-gray-700 dark:hover:text-red-400"
                                            title="Delete Agent"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1 truncate" title={agent.name}>
                                    {agent.name}
                                </h3>

                                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-6 font-medium">
                                    <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">{agent.type}</span>
                                </div>

                                <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-2">
                                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        <Calendar className="w-3.5 h-3.5" />
                                        Created: {new Date(agent.createdAt).toLocaleDateString()}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        <FileText className="w-3.5 h-3.5" />
                                        Updated: {new Date(agent.updatedAt).toLocaleDateString()}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Agent</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            Are you sure you want to delete <span className="font-semibold text-gray-700 dark:text-gray-200">{agentToDelete?.name || deleteConfirmId}</span>? This will remove all its files and cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    onDeleteAgent(deleteConfirmId);
                                    setDeleteConfirmId(null);
                                }}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

