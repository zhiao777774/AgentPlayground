import { useState } from 'react';
import type { Session } from '../types/index';
import { MessageSquare, Plus, Clock, Loader2, Pencil, Check, X, Trash2, Database } from 'lucide-react';

interface Props {
    sessions: Session[];
    activeSessionId: string | null;
    activeTab: 'chat' | 'agent' | 'knowledge';
    onChangeTab: (tab: 'chat' | 'agent' | 'knowledge') => void;
    onSelectSession: (id: string) => void;
    onNewSession: () => void;
    onRenameSession: (id: string, name: string) => void;
    onDeleteSession: (id: string) => void;
    isLoading?: boolean;
}

export function Sidebar({ sessions, activeSessionId, activeTab, onChangeTab, onSelectSession, onNewSession, onRenameSession, onDeleteSession, isLoading }: Props) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const startEditing = (e: React.SyntheticEvent, session: Session) => {
        e.stopPropagation();
        setEditingId(session.id);
        const displayName = session.name || (session.firstMessage ? session.firstMessage.substring(0, 30) : 'New Conversation');
        setEditName(displayName);
    };

    const saveEdit = (e: React.SyntheticEvent, session: Session) => {
        e.stopPropagation();
        if (editName.trim() && editName !== session.name) {
            onRenameSession(session.id, editName.trim());
        }
        setEditingId(null);
    };

    const cancelEdit = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        setEditingId(null);
    };

    return (
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col h-screen overflow-hidden shrink-0">
            {/* Top Navigation Tabs */}
            <div className="flex w-full p-2 border-b border-gray-800 gap-1 flex-wrap">
                <button
                    onClick={() => onChangeTab('chat')}
                    className={`flex-1 py-1.5 px-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'chat' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                >
                    Chat
                </button>
                <button
                    onClick={() => onChangeTab('agent')}
                    className={`flex-1 py-1.5 px-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'agent' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                >
                    Agent
                </button>
                <button
                    onClick={() => onChangeTab('knowledge')}
                    className={`flex-1 py-1.5 px-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'knowledge' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                >
                    Knowledge
                </button>
            </div>

            {activeTab === 'chat' ? (
                <>
                    <div className="p-4 border-b border-gray-800 transition-opacity">
                        <button
                            onClick={onNewSession}
                            disabled={isLoading}
                            className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            <span>New Chat</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto w-full p-2 space-y-1">
                        {[...sessions].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()).map((session) => (
                            <div
                                key={session.id}
                                onClick={() => onSelectSession(session.id)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onSelectSession(session.id);
                                    }
                                }}
                                className={`group w-full text-left px-3 py-3 rounded-md flex flex-col justify-center space-y-1 transition-colors cursor-pointer ${activeSessionId === session.id
                                    ? 'bg-blue-600/20 text-blue-400'
                                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                                    }`}
                            >
                                <div className="flex items-center space-x-3 w-full pr-6 relative">
                                    <MessageSquare className="w-4 h-4 shrink-0" />
                                    {editingId === session.id ? (
                                        <div className="flex-1 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    // Stop event bubbling so the parent container doesn't
                                                    // catch the spacebar and select the session instead of typing space.
                                                    e.stopPropagation();
                                                    if (e.key === 'Enter') saveEdit(e, session);
                                                    if (e.key === 'Escape') cancelEdit(e);
                                                }}
                                                className="w-full bg-gray-950 text-white outline-none border border-blue-500 rounded px-1 py-0.5 text-sm"
                                                autoFocus
                                            />
                                            <button onClick={(e) => saveEdit(e, session)} className="text-green-500 hover:text-green-400">
                                                <Check className="w-3 h-3" />
                                            </button>
                                            <button onClick={cancelEdit} className="text-red-500 hover:text-red-400">
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <span className="truncate text-sm font-medium flex-1 text-left">
                                                {session.name || (session.firstMessage ? session.firstMessage.substring(0, 30) : 'New Conversation')}
                                            </span>
                                            <div className="absolute right-0 opacity-0 group-hover:opacity-100 flex items-center bg-gray-900 px-1 rounded transition-opacity">
                                                <button
                                                    onClick={(e) => startEditing(e, session)}
                                                    className="p-1 hover:text-blue-400 hover:bg-gray-800 rounded cursor-pointer transition-colors z-10"
                                                    title="Rename"
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        setDeleteConfirmId(session.id);
                                                    }}
                                                    className="p-1 hover:text-red-400 hover:bg-gray-800 rounded cursor-pointer transition-colors z-10"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="flex items-center space-x-2 pl-7 w-full text-xs opacity-60">
                                    <Clock className="w-3 h-3" />
                                    <span className="truncate">
                                        {new Date(session.created).toLocaleString(undefined, {
                                            year: 'numeric',
                                            month: '2-digit',
                                            day: '2-digit',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            hour12: false
                                        })}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {sessions.length === 0 && !isLoading && (
                            <div className="text-center p-4 text-gray-500 text-sm">
                                No previous sessions
                            </div>
                        )}
                    </div>
                </>
            ) : activeTab === 'agent' ? (
                <div className="flex-1 flex flex-col px-4 text-center items-center justify-center opacity-70 gap-3 text-gray-500 dark:text-gray-400">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-1">
                        <Pencil className="w-5 h-5 opacity-70" />
                    </div>
                    <p className="text-sm font-medium">Agent Management</p>
                    <p className="text-xs">Select an agent from the dashboard to manage configurations.</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col px-4 text-center items-center justify-center opacity-70 gap-3 text-gray-500 dark:text-gray-400">
                    <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-1">
                        <Database className="w-5 h-5 text-blue-500 opacity-80" />
                    </div>
                    <p className="text-sm font-medium">Knowledge Base</p>
                    <p className="text-xs">Manage uploaded documents for RAG. Agents can query this database.</p>
                </div>
            )}

            {/* Custom Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Session</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            Are you sure you want to delete this session? This action cannot be undone.
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
                                    onDeleteSession(deleteConfirmId);
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
