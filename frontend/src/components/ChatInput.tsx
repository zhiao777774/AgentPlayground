import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Send, Square, Zap, X, MessageSquareQuote } from 'lucide-react';

interface Props {
    onSend: (message: string) => void;
    onStop?: () => void;
    onSteer?: (text: string, mode?: 'steer' | 'followUp') => void;
    disabled?: boolean;
    isGenerating?: 'generating' | 'compacting' | 'retrying' | false;
    quotedMessage?: { id: string; content: string } | null;
    onClearQuote?: () => void;
    pendingActions?: { id: string, type: 'steer' | 'followUp', text: string }[];
    readOnly?: boolean;
}

export function ChatInput({ onSend, onStop, onSteer, disabled, isGenerating = false, quotedMessage, onClearQuote, pendingActions = [], readOnly = false }: Props) {
    const [content, setContent] = useState('');
    const [steerContent, setSteerContent] = useState('');

    const handleSubmit = (e?: FormEvent) => {
        e?.preventDefault();
        if (!content.trim() || disabled) return;
        onSend(content.trim());
        setContent('');
    };

    const handleSteerSubmit = (mode: 'steer' | 'followUp') => {
        if (!steerContent.trim() || !onSteer) return;
        onSteer(steerContent.trim(), mode);
        setSteerContent('');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleSteerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSteerSubmit('steer');
        }
    };
    return (
        <div className="px-4 pb-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
            <div className="max-w-4xl mx-auto flex flex-col gap-2 pt-2">

                {/* Quote Preview */}
                {quotedMessage && (
                    <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-950/40 border-l-2 border-blue-400 dark:border-blue-500 rounded-r-lg px-3 py-2 text-xs">
                        <MessageSquareQuote className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                        <span className="text-gray-600 dark:text-gray-400 flex-1 line-clamp-2 italic">
                            {quotedMessage.content.slice(0, 120)}{quotedMessage.content.length > 120 ? '…' : ''}
                        </span>
                        <button
                            onClick={onClearQuote}
                            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                            title="Clear quote"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* Pending Actions UI */}
                {pendingActions && pendingActions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 pointer-events-none">
                        {pendingActions.map((action, index) => (
                            <div key={action.id} className={`flex items-center gap-1.5 border rounded-full px-3 py-1 text-[11px] shadow-sm bg-white dark:bg-gray-800 wrap-break-word max-w-full ${action.type === 'steer' ? 'border-amber-200 dark:border-amber-900/50' : 'border-blue-200 dark:border-blue-900/50'}`}>
                                <span className={`shrink-0 font-bold ${action.type === 'steer' ? 'text-amber-500' : 'text-blue-500'}`}>
                                    {index + 1}. {action.type === 'steer' ? '⚡️ Steering:' : '📥 Queued:'}
                                </span>
                                <span className="text-gray-700 dark:text-gray-300 truncate max-w-50">{action.text}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Steer Panel — only visible while agent is generating AND not readOnly */}
                {isGenerating && !readOnly && (
                    <div className="relative flex flex-col bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-2.5 py-2 mb-2">
                        {/* Header Text */}
                        <div className="flex flex-col gap-0.5 mb-2 pr-35">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                <Zap className="w-3 h-3" />
                                Steer Agent
                            </div>
                            <span className="text-[11px] text-amber-600/70 dark:text-amber-500/70">
                                <strong className="font-medium text-amber-600 dark:text-amber-500">Steer:</strong> interrupt mid-run • <strong className="font-medium text-amber-600 dark:text-amber-500">Queue:</strong> send after completion
                            </span>
                        </div>

                        {/* Top-Right Action Buttons */}
                        <div className="absolute top-2 right-2.5 flex items-center gap-2">
                            <button
                                onClick={() => handleSteerSubmit('followUp')}
                                disabled={!steerContent.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                title="Follow-up: queue message for after agent finishes"
                            >
                                Queue
                            </button>
                            <button
                                onClick={() => handleSteerSubmit('steer')}
                                disabled={!steerContent.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                title="Steer: interrupt after current tool"
                            >
                                <Zap className="w-3 h-3" /> Steer
                            </button>
                        </div>

                        <div className="flex flex-col gap-2 mt-0.5">
                            <textarea
                                value={steerContent}
                                onChange={(e) => setSteerContent(e.target.value)}
                                onKeyDown={handleSteerKeyDown}
                                placeholder="Type steering instruction... (Enter to steer, Shift+Enter for new line)"
                                className="w-full resize-none bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 text-gray-900 dark:text-gray-100 placeholder-gray-400 min-h-10 max-h-32"
                                rows={1}
                            />
                        </div>
                    </div>
                )}

                {/* Main Input */}
                <form onSubmit={handleSubmit} className="relative">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={(disabled && !isGenerating) || readOnly}
                        placeholder={
                            readOnly ? 'This conversation is read-only.' :
                            isGenerating === 'compacting' ? 'Compacting context — please wait...' : 
                            isGenerating === 'retrying' ? 'Retrying — please wait...' : 
                            isGenerating ? 'Agent is generating... (use Steer above to redirect)' : 
                            disabled ? 'Select a model first' : 
                            'Type a message, or use /agent list to view agents... (Shift+Enter for new line)'
                        }
                        className="w-full resize-none overflow-y-auto rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 py-3 pr-12 pl-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors shadow-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 disabled:cursor-not-allowed min-h-12 max-h-50 chat-scrollbar"
                        rows={1}
                    />
                    {isGenerating ? (
                        <button
                            type="button"
                            onClick={onStop}
                            className="absolute right-2.5 top-2 h-8 w-8 rounded-lg text-white bg-red-500 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors flex items-center justify-center shrink-0"
                            title="Stop Generation"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={!content.trim() || disabled}
                            className="absolute right-2.5 top-2 h-8 w-8 rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-gray-600 transition-colors flex items-center justify-center shrink-0"
                            title="Send Message"
                        >
                            <Send className="w-4 h-4 ml-0.5" />
                        </button>
                    )}
                </form>
            </div>
        </div>
    );
}
