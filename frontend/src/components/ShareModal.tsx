import { useState, useEffect } from 'react';
import { X, Search, UserMinus, Loader2 } from 'lucide-react';
import type { SearchUser } from '../types/index';
import { api } from '../services/api';

interface ShareModalProps {
    title: string;
    sharedWith: { userId: string, name: string }[];
    onShare: (userId: string, name: string) => Promise<void>;
    onUnshare: (userId: string) => Promise<void>;
    onClose: () => void;
}

export function ShareModal({ title, sharedWith, onShare, onUnshare, onClose }: ShareModalProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [localSharedWith, setLocalSharedWith] = useState(sharedWith);

    useEffect(() => {
        setLocalSharedWith(sharedWith);
    }, [sharedWith]);

    const handleSearch = async () => {
        if (searchQuery.length < 2) return;
        setIsSearching(true);
        setSearchError('');
        try {
            const users = await api.auth.searchUsers(searchQuery);
            setSearchResults(users);
        } catch (err) {
            setSearchError('Search failed');
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[80vh] border border-gray-200 dark:border-gray-800">
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Current Shared List */}
                    <div>
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 tracking-wider">Shared with</h4>
                        <div className="space-y-2">
                            {localSharedWith.length > 0 ? (
                                localSharedWith.map(sharedUser => (
                                    <div key={sharedUser.userId} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold uppercase">
                                                {sharedUser.name.charAt(0)}
                                            </div>
                                            <span className="text-sm text-gray-700 dark:text-gray-300">{sharedUser.name}</span>
                                        </div>
                                        <button 
                                            onClick={async () => {
                                                await onUnshare(sharedUser.userId);
                                            }}
                                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                            <UserMinus className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-gray-500 italic">Not shared with anyone yet</p>
                            )}
                        </div>
                    </div>

                    {/* Search and Add */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Find People</h4>
                        <div className="relative">
                            <input 
                                type="text" 
                                placeholder="Search by name or username..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                className="w-full bg-gray-50 dark:bg-gray-800 border-none rounded-lg py-2 pl-9 pr-4 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                            />
                            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                            <button 
                                onClick={handleSearch}
                                disabled={isSearching || searchQuery.length < 2}
                                className="absolute right-2 top-1.5 px-2 py-1 bg-blue-600 text-white text-[10px] font-bold rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
                            </button>
                        </div>

                        {searchError && <p className="text-xs text-red-500">{searchError}</p>}

                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {searchResults.map(foundUser => (
                                <div key={foundUser.id} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-700">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold uppercase shrink-0">
                                            {foundUser.displayName.charAt(0)}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{foundUser.displayName}</span>
                                            <span className="text-xs text-gray-500 truncate">{foundUser.department} • {foundUser.username}</span>
                                        </div>
                                    </div>
                                    <button 
                                        disabled={localSharedWith.some(u => u.userId === foundUser.id)}
                                        onClick={async () => {
                                            await onShare(foundUser.id, foundUser.displayName);
                                            setSearchResults([]);
                                            setSearchQuery('');
                                        }}
                                        className="px-3 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-blue-600 hover:text-white text-gray-700 dark:text-gray-300 text-xs font-bold rounded-md transition-all disabled:opacity-30 disabled:hover:bg-gray-100 disabled:hover:text-gray-300"
                                    >
                                        {localSharedWith.some(u => u.userId === foundUser.id) ? 'Already Shared' : 'Add'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700">Done</button>
                </div>
            </div>
        </div>
    );
}
