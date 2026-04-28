import { useState } from 'react';
import type { Session, User } from '../types/index';
import { MessageSquare, Plus, Clock, Loader2, Pencil, Check, X, Trash2, Database, Users } from 'lucide-react';
import { ShareModal } from './ShareModal';

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
    user: User;
    onLogout: () => void;
    onShareSession?: (id: string, targetUserId: string, targetUserName: string) => Promise<void>;
    onUnshareSession?: (id: string, targetUserId: string) => Promise<void>;
}

export function Sidebar({ sessions, activeSessionId, activeTab, onChangeTab, onSelectSession, onNewSession, onRenameSession, onDeleteSession, isLoading, user, onLogout, onShareSession, onUnshareSession }: Props) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [shareModalId, setShareModalId] = useState<string | null>(null);
    const [currentSharedWith, setCurrentSharedWith] = useState<{ userId: string, name: string }[]>([]);

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

    const openShareModal = (e: React.SyntheticEvent, session: Session) => {
        e.stopPropagation();
        setShareModalId(session.id);
        setCurrentSharedWith(session.sharedWith || []);
    };

    const ownedSessions = sessions.filter(s => !s.isShared && !s.isExternal).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    const sharedSessions = sessions.filter(s => s.isShared && !s.isExternal).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    const externalSessions = sessions.filter(s => s.isExternal).sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    const renderSessionItem = (session: Session) => {
        const isReadOnly = session.readOnly || session.isExternal || session.isShared;

        return (
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
                        {!isReadOnly && (
                            <div className="absolute right-0 opacity-0 group-hover:opacity-100 flex items-center bg-gray-900 px-1 rounded transition-opacity">
                                <button
                                    onClick={(e) => openShareModal(e, session)}
                                    className="p-1 hover:text-green-400 hover:bg-gray-800 rounded cursor-pointer transition-colors z-10"
                                    title="Share"
                                >
                                    <Users className="w-3 h-3" />
                                </button>
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
                        )}
                    </>
                )}
            </div>
            <div className="flex flex-col space-y-1 pl-7 w-full text-[10px] opacity-70">
                {session.isExternal && (
                    <div className="flex flex-wrap gap-1">
                        <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold rounded-full max-w-[130px] truncate" title={session.externalAgentId || 'External agent'}>
                            {session.externalAgentId || 'Agent'}
                        </span>
                        <span className="px-1.5 py-0.5 bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold rounded-full max-w-[130px] truncate" title={session.externalSystemId || 'External system'}>
                            {session.externalSystemId || 'System'}
                        </span>
                        {session.externalUserId && (
                            <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-bold rounded-full max-w-[130px] truncate" title={session.externalUserId}>
                                {session.externalUserId}
                            </span>
                        )}
                    </div>
                )}
                {session.isShared && !session.isExternal && (
                    <span className="self-start px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold rounded-full max-w-[120px] truncate" title={session.ownerName || 'Shared'}>
                        {session.ownerName || 'Shared'}
                    </span>
                )}
                <div className="flex items-center space-x-1">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                        {new Date(session.created).toLocaleString(undefined, {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit', hour12: false
                        })}
                    </span>
                </div>
            </div>
        </div>
        );
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

                    <div className="flex-1 overflow-y-auto w-full p-2 space-y-4">
                        {/* My Conversations Section */}
                        <div className="space-y-1">
                            <div className="px-3 mb-1">
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">My Conversations</span>
                            </div>
                            {ownedSessions.map(renderSessionItem)}
                            {ownedSessions.length === 0 && !isLoading && (
                                <div className="text-center p-2 text-gray-600 text-xs italic">
                                    No owned chats
                                </div>
                            )}
                        </div>

                        {/* Shared With Me Section */}
                        {sharedSessions.length > 0 && (
                            <div className="space-y-1 pt-2 border-t border-gray-800/50">
                                <div className="px-3 mb-1 flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Shared with me</span>
                                </div>
                                {sharedSessions.map(renderSessionItem)}
                            </div>
                        )}

                        {/* External Conversations Section */}
                        {externalSessions.length > 0 && (
                            <div className="space-y-1 pt-2 border-t border-gray-800/50">
                                <div className="px-3 mb-1 flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">External Conversations</span>
                                </div>
                                {externalSessions.map(renderSessionItem)}
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

            {/* User Profile Panel at Bottom */}
            <div className="mt-auto border-t border-gray-800 p-3">
                <div className="flex items-center justify-between group rounded-lg p-2 hover:bg-gray-800 transition-colors">
                    <div className="flex items-center space-x-3 overflow-hidden">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0 font-medium">
                            {user.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col overflow-hidden">
                            <span className="text-sm font-medium text-gray-200 truncate">{user.displayName}</span>
                            <span className="text-xs text-gray-500 truncate">{user.username}</span>
                        </div>
                    </div>
                    <button
                        onClick={onLogout}
                        className="p-2 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded hover:bg-gray-700"
                        title="Logout"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    </button>
                </div>
            </div>

            {/* Share Session Modal */}
            {shareModalId && (
                <ShareModal 
                    title="Share Conversation"
                    sharedWith={currentSharedWith}
                    onClose={() => setShareModalId(null)}
                    onShare={async (targetUserId, targetUserName) => {
                        if (onShareSession) {
                            await onShareSession(shareModalId, targetUserId, targetUserName);
                            setCurrentSharedWith(prev => [...prev, { userId: targetUserId, name: targetUserName }]);
                        }
                    }}
                    onUnshare={async (targetUserId) => {
                        if (onUnshareSession) {
                            await onUnshareSession(shareModalId, targetUserId);
                            setCurrentSharedWith(prev => prev.filter(u => u.userId !== targetUserId));
                        }
                    }}
                />
            )}

            {/* Custom Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
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
