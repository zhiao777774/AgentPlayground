import { useState, useEffect, useRef, useMemo } from 'react';
import type { Message } from '../types/index';
import { Bot, User, Wrench, CheckCircle2, XCircle, Loader2, ChevronRight, Pencil, ChevronLeft, Check, Quote, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatWindowProps {
    messages: Message[];
    allMessages: Message[];
    onSelectLeaf: (id: string) => void;
    onResend: (content: string, parentId: string | null) => void;
    onQuote: (msg: Message) => void;
    isLoading?: boolean;
}

function EditMessageContent({
    initialContent,
    onSave,
    onCancel
}: {
    initialContent: string;
    onSave: (content: string) => void;
    onCancel: () => void;
}) {
    const [content, setContent] = useState(initialContent);
    return (
        <div className="flex flex-col gap-2 w-full min-w-75">
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-blue-500 rounded-lg p-3 text-sm focus:outline-none min-h-25"
                autoFocus
            />
            <div className="flex justify-end gap-2">
                <button
                    onClick={onCancel}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 bg-gray-100 dark:bg-gray-800 dark:text-gray-400 rounded-md"
                >
                    Cancel
                </button>
                <button
                    onClick={() => onSave(content)}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1"
                >
                    <Check className="w-3 h-3" /> Save & Submit
                </button>
            </div>
        </div>
    );
}

export function ChatWindow({
    messages,
    allMessages,
    onSelectLeaf,
    onResend,
    onQuote,
    isLoading,
}: ChatWindowProps) {

    const globalCitations = useMemo(() => {
        const citations: Record<string, { id: string, document_name: string, text: string, score: number }> = {};
        for (const m of allMessages) {
            if (m.citations) {
                Object.assign(citations, m.citations);
            }
        }
        return citations;
    }, [allMessages]);

    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const getSiblings = (parentId: string | null | undefined) => {
        return allMessages.filter(m => m.parentId === parentId);
    };

    const handleSwitchBranch = (messageId: string, direction: 'prev' | 'next') => {
        const msg = allMessages.find(m => m.id === messageId);
        if (!msg) return;
        const siblings = getSiblings(msg.parentId);
        const currentIndex = siblings.findIndex(s => s.id === messageId);
        const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        // Boundary check — no wrap-around
        if (nextIndex < 0 || nextIndex >= siblings.length) return;

        // Find the leaf for the selected sibling branch
        const findLeaf = (id: string): string => {
            const children = allMessages.filter(m => m.parentId === id);
            return children.length > 0 ? findLeaf(children[0].id) : id;
        };

        onSelectLeaf(findLeaf(siblings[nextIndex].id));
    };

    const handleSaveEdit = (message: Message, newContent: string) => {
        if (!newContent.trim() || newContent === message.content) {
            setEditingMessageId(null);
            return;
        }
        onResend(newContent.trim(), message.parentId ?? null);
        setEditingMessageId(null);
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    return (
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950 p-4 space-y-6">
            {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-6 max-w-2xl mx-auto px-4">
                    <div className="w-20 h-20 bg-linear-to-tr from-blue-500 to-indigo-500 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-blue-500/20 mb-4 transition-transform hover:scale-105 duration-300">
                        <Bot className="w-10 h-10" />
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300">
                            Welcome to AgentPlayground ⚡️
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 text-lg">
                            Start a conversation, or use quick commands to manage your agents.
                        </p>
                    </div>

                    <div className="bg-white dark:bg-gray-900/50 rounded-2xl p-6 border border-gray-100 dark:border-gray-800 shadow-sm w-full text-left space-y-4">
                        <h4 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Helpful Commands</h4>

                        <div className="grid gap-3">
                            <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-700 dark:text-gray-300 shrink-0 select-all border border-gray-200 dark:border-gray-700 font-semibold tracking-tight">/agents</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">Quick shortcut to list all available agents (alias for <code className="text-blue-600">/agent list</code>).</div>
                            </div>

                            <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-700 dark:text-gray-300 shrink-0 select-all border border-gray-200 dark:border-gray-700 font-semibold tracking-tight">/agent list</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">View all interactive agents currently active in the workspace.</div>
                            </div>

                            <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-700 dark:text-gray-300 shrink-0 select-all border border-gray-200 dark:border-gray-700 font-semibold tracking-tight">/agent &lt;id&gt;</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">Permanently switch the active conversation to this target agent.</div>
                            </div>

                            <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-700 dark:text-gray-300 shrink-0 select-all border border-gray-200 dark:border-gray-700 font-semibold tracking-tight">/agent default</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">Reset the routing and seamlessly return to normal chat.</div>
                            </div>

                            <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                <div className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-gray-700 dark:text-gray-300 shrink-0 select-all border border-gray-200 dark:border-gray-700 font-semibold tracking-tight">/agent &lt;id&gt; &lt;msg&gt;</div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 leading-snug">Assign a one-time message prompt to an agent without switching history.</div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="max-w-4xl mx-auto space-y-6">
                    {messages.map((msg, index) => {
                        // Propagate citations from history
                        const usedCitationIds = Array.from(msg.content.matchAll(/\]\(cite:([^)]+)\)/g)).map(m => m[1]);
                        const uniqueCitationIds = Array.from(new Set(usedCitationIds));
                        const activeCitations = { ...(msg.citations || {}) };
                        for (const cid of usedCitationIds) {
                            if (!activeCitations[cid] && globalCitations[cid]) {
                                activeCitations[cid] = globalCitations[cid];
                            }
                        }

                        const orderedCitations = uniqueCitationIds
                            .map(cid => activeCitations[cid])
                            .filter(Boolean);

                        const hasActiveCitations = orderedCitations.length > 0;

                        return (
                            <div
                                key={msg.id || index}
                                className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start gap-3 relative`}
                                >
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user'
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-indigo-600 text-white'
                                            }`}
                                    >
                                        {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                                    </div>

                                    <div className="flex flex-col gap-2 min-w-0 flex-1">
                                        {/* Reasoning/Thinking Content — shown before tool calls */}
                                        {msg.reasoning && (
                                            <details className="group mb-2">
                                                <summary className="flex items-center cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 select-none list-none [&::-webkit-details-marker]:hidden">
                                                    <ChevronRight className="w-3 h-3 mr-1 transition-transform group-open:rotate-90" />
                                                    Thinking Process
                                                </summary>
                                                <div className="mt-2 pl-4 border-l-2 border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap italic leading-relaxed">
                                                    {msg.reasoning}
                                                </div>
                                            </details>
                                        )}

                                        {/* Tool Calls Rendering (Progressive Disclosure) */}
                                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                                            <div className="flex flex-col gap-1.5 mb-2">
                                                {msg.toolCalls.map((tc, tcIndex) => (
                                                    <details
                                                        key={tcIndex}
                                                        className="group/tool"
                                                    >
                                                        <summary
                                                            className={`flex items-center gap-2 text-xs font-medium rounded-lg px-3 py-2 shadow-sm border transition-all duration-300 list-none [&::-webkit-details-marker]:hidden select-none ${tc.output && tc.status !== 'pending' ? 'cursor-pointer' : 'cursor-default'} ${tc.status === 'pending'
                                                                ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 animate-pulse'
                                                                : tc.status === 'success'
                                                                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                                                                    : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                                                                }`}
                                                        >
                                                            <Wrench className={`w-3 h-3 shrink-0 ${tc.status === 'pending' ? 'text-blue-500' :
                                                                tc.status === 'success' ? 'text-emerald-500' : 'text-red-500'
                                                                }`} />
                                                            <span className="text-gray-700 dark:text-gray-300 flex-1">
                                                                {tc.status === 'pending' ? 'Running' : tc.status === 'success' ? 'Used' : 'Failed'} tool{' '}
                                                                <span className={`font-bold ${tc.status === 'pending' ? 'text-blue-600 dark:text-blue-400' :
                                                                    tc.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                                                    }`}>{tc.name}</span>
                                                                {tc.status === 'pending' ? '...' : ''}
                                                            </span>
                                                            <span className="flex items-center gap-1 shrink-0">
                                                                {tc.status === 'pending' && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
                                                                {tc.status === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                                                                {tc.status === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                                                                {tc.output && tc.status !== 'pending' && (
                                                                    <ChevronRight className="w-3 h-3 text-gray-400 transition-transform group-open/tool:rotate-90" />
                                                                )}
                                                            </span>
                                                        </summary>
                                                        {tc.output && tc.status !== 'pending' && (
                                                            <div className={`mt-1 ml-1 pl-3 py-2 border-l-2 text-xs font-mono whitespace-pre-wrap leading-relaxed rounded-sm ${tc.status === 'success'
                                                                ? 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400'
                                                                : 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400'
                                                                }`}>
                                                                {tc.output}
                                                            </div>
                                                        )}
                                                    </details>
                                                ))}
                                            </div>
                                        )}

                                        {/* Main Message Content */}
                                        {msg.content && (
                                            <div className="relative group/content">
                                                {editingMessageId === msg.id ? (
                                                    <EditMessageContent
                                                        initialContent={editContent}
                                                        onSave={(newContent) => handleSaveEdit(msg, newContent)}
                                                        onCancel={() => setEditingMessageId(null)}
                                                    />
                                                ) : (
                                                    <>
                                                        <div
                                                            className={`px-4 py-3 shadow-sm overflow-visible wrap-break-word text-sm leading-relaxed prose prose-pre:bg-gray-800 dark:prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto prose-blockquote:border-l-4 prose-blockquote:border-gray-300 dark:prose-blockquote:border-gray-600 prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:italic prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400 marker:text-gray-500 max-w-none ${msg.role === 'user'
                                                                ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm prose-invert prose-p:text-white prose-blockquote:border-blue-400 prose-blockquote:text-blue-100 prose-a:text-white'
                                                                : 'bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-800 rounded-2xl rounded-tl-sm prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-strong:text-gray-900 dark:prose-strong:text-gray-100'
                                                                }`}
                                                        >
                                                            <ReactMarkdown
                                                                remarkPlugins={[remarkGfm]}
                                                                urlTransform={(url: string) => url}
                                                                components={{
                                                                    a: ({ ...props }) => {
                                                                        const href = props.href || '';
                                                                        if (href.startsWith('cite:')) {
                                                                            const citeId = href.replace('cite:', '');
                                                                            const citation = activeCitations[citeId];

                                                                            if (citation) {
                                                                                const citationIndex = uniqueCitationIds.indexOf(citeId) + 1;

                                                                                return (
                                                                                    <span className="relative inline-block group/cite ml-1">
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={(e) => e.preventDefault()}
                                                                                            className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full border border-blue-200 dark:border-blue-800 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors align-text-top"
                                                                                            title={`Source: ${citation.document_name}`}
                                                                                        >
                                                                                            {citationIndex}
                                                                                        </button>

                                                                                        {/* Popover */}
                                                                                        <span className="block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-xs rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 opacity-0 invisible group-hover/cite:opacity-100 group-hover/cite:visible transition-all z-50 pointer-events-none text-left font-sans">
                                                                                            <span className="block absolute top-3 right-3 font-mono text-gray-400 dark:text-gray-500 font-bold text-[10px]">
                                                                                                [{citationIndex}]
                                                                                            </span>
                                                                                            <span className="font-semibold mb-1 flex items-center gap-1.5 border-b border-gray-100 dark:border-gray-700 pb-1.5 pr-8">
                                                                                                <BookOpen className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                                                                                                <span className="truncate">{citation.document_name}</span>
                                                                                            </span>
                                                                                            <span className="block line-clamp-4 text-gray-600 dark:text-gray-400 italic">
                                                                                                &quot;{citation.text}&quot;
                                                                                            </span>
                                                                                            <span className="block mt-1.5 text-[9px] text-gray-400 dark:text-gray-500 text-right">
                                                                                                Relevance: {(citation.score * 100).toFixed(1)}%
                                                                                            </span>
                                                                                            {/* Arrow */}
                                                                                            <span className="block absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 rotate-45"></span>
                                                                                        </span>
                                                                                    </span>
                                                                                );
                                                                            }
                                                                        }
                                                                        // Default link renderer
                                                                        return <a {...props} target="_blank" rel="noopener noreferrer" />;
                                                                    }
                                                                }}
                                                            >
                                                                {msg.content}
                                                            </ReactMarkdown>

                                                            {/* References Block (Bottom of message) */}
                                                            {hasActiveCitations && (
                                                                <div className="not-prose mt-4 pt-4 border-t border-gray-200 dark:border-gray-700/50 space-y-2">
                                                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                                                        <BookOpen className="w-3.5 h-3.5" />
                                                                        References
                                                                    </h4>
                                                                    <ul className="space-y-2">
                                                                        {orderedCitations.map((citation: { id: string, document_name: string, text: string, score: number }, i: number) => (
                                                                            <li key={citation.id} className="relative text-xs bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-800 flex gap-3 group/ref">
                                                                                <div className="font-mono text-gray-400 dark:text-gray-500 shrink-0 select-none mt-0.5">[{i + 1}]</div>
                                                                                <div className="flex-1 min-w-0 pr-14">
                                                                                    <details className="group/details">
                                                                                        <summary className="font-medium text-gray-700 dark:text-gray-300 truncate cursor-pointer select-none list-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors [&::-webkit-details-marker]:hidden flex items-center gap-1.5" title={citation.document_name}>
                                                                                            <ChevronRight className="w-3.5 h-3.5 text-gray-400 transition-transform group-open/details:rotate-90 shrink-0" />
                                                                                            <span className="truncate">{citation.document_name}</span>
                                                                                        </summary>
                                                                                        <div className="text-gray-600 dark:text-gray-300 mt-2 leading-relaxed italic pl-5 pr-2 whitespace-pre-wrap">
                                                                                            "{citation.text}"
                                                                                        </div>
                                                                                    </details>
                                                                                    <div className="text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5 leading-relaxed italic pl-5 group-open/details:hidden pointer-events-none">
                                                                                        "{citation.text}"
                                                                                    </div>
                                                                                </div>
                                                                                <div className="absolute top-3 right-3 text-[10px] text-gray-400 dark:text-gray-500 font-medium" title="Relevance Score">
                                                                                    {(citation.score * 100).toFixed(1)}%
                                                                                </div>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Error State Banner */}
                                                        {msg.stopReason === 'error' && msg.errorMessage && (
                                                            <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
                                                                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                                                <div className="flex-1 whitespace-pre-wrap font-mono relative pr-12 text-xs leading-relaxed">
                                                                    <div className="font-semibold mb-1 text-sm font-sans">Message generation failed</div>
                                                                    {msg.errorMessage}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* User: edit button (left side) */}
                                                        {msg.role === 'user' && (
                                                            <button
                                                                onClick={() => {
                                                                    setEditingMessageId(msg.id);
                                                                    setEditContent(msg.content);
                                                                }}
                                                                className="absolute -left-8 top-2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 opacity-0 group-hover/content:opacity-100 transition-opacity"
                                                                title="Edit message"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                        )}

                                                        {/* Assistant: quote button (right side) */}
                                                        {msg.role === 'assistant' && (
                                                            <button
                                                                onClick={() => onQuote(msg)}
                                                                className="absolute -right-8 top-2 p-1.5 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover/content:opacity-100 transition-opacity"
                                                                title="Quote this reply"
                                                            >
                                                                <Quote className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* Branch Navigation */}
                                        {getSiblings(msg.parentId).length > 1 && (() => {
                                            const siblings = getSiblings(msg.parentId);
                                            const currentIndex = siblings.findIndex(s => s.id === msg.id);
                                            const isFirst = currentIndex === 0;
                                            const isLastSib = currentIndex === siblings.length - 1;
                                            return (
                                                <div className={`flex items-center gap-2 mt-1 text-[10px] font-medium text-gray-400 select-none ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                    <div className="flex items-center gap-1 bg-gray-200/50 dark:bg-gray-800/50 px-1.5 py-0.5 rounded-full">
                                                        <button
                                                            onClick={() => handleSwitchBranch(msg.id, 'prev')}
                                                            disabled={isFirst}
                                                            className={`transition-colors ${isFirst ? 'opacity-30 cursor-not-allowed' : 'hover:text-blue-500'}`}
                                                        >
                                                            <ChevronLeft className="w-3 h-3" />
                                                        </button>
                                                        <span>{currentIndex + 1} / {siblings.length}</span>
                                                        <button
                                                            onClick={() => handleSwitchBranch(msg.id, 'next')}
                                                            disabled={isLastSib}
                                                            className={`transition-colors ${isLastSib ? 'opacity-30 cursor-not-allowed' : 'hover:text-blue-500'}`}
                                                        >
                                                            <ChevronRight className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Generating Indicator for Active Stream */}
                                        {isLoading && index === messages.length - 1 && msg.role === 'assistant' && (
                                            <div className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500 dark:text-gray-400 animate-pulse select-none">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                                <span>
                                                    {(!msg.reasoning && (!msg.toolCalls || msg.toolCalls.length === 0) && !msg.content) ? 'Connecting to agent...' : 'Generating...'}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
    );
}
