import { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileText, Trash2, CheckCircle2, AlertCircle, Loader2, Database, ArrowLeft, ChevronLeft, ChevronRight, Hash, Calendar, Layers } from 'lucide-react';
import type { DocumentMeta, DocumentChunk } from '../types';
import { api } from '../services/api';

interface Props {
    documents: DocumentMeta[];
    onRefresh: () => void;
    isLoading?: boolean;
}

export function KnowledgeBase({ documents, onRefresh, isLoading }: Props) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [duplicateFile, setDuplicateFile] = useState<File | null>(null);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [docDetail, setDocDetail] = useState<DocumentMeta | null>(null);
    const [chunks, setChunks] = useState<DocumentChunk[]>([]);
    const [chunksTotal, setChunksTotal] = useState(0);
    const [chunksPage, setChunksPage] = useState(0);
    const [isLoadingDetail, setIsLoadingDetail] = useState(false);
    const [isLoadingChunks, setIsLoadingChunks] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const CHUNKS_PER_PAGE = 20;

    // Auto-refresh periodically if there are pending/processing documents
    useEffect(() => {
        const hasProcessing = documents.some(d => d.status === 'processing' || d.status === 'pending');
        if (hasProcessing) {
            const interval = setInterval(onRefresh, 3000);
            return () => clearInterval(interval);
        }
    }, [documents, onRefresh]);

    // Load document detail & chunks when selected
    const loadDocDetail = useCallback(async (id: string) => {
        setIsLoadingDetail(true);
        try {
            const detail = await api.documents.get(id);
            setDocDetail(detail);
        } catch (error) {
            console.error('Failed to load document detail:', error);
        } finally {
            setIsLoadingDetail(false);
        }
    }, []);

    const loadChunks = useCallback(async (id: string, page: number) => {
        setIsLoadingChunks(true);
        try {
            const data = await api.documents.getChunks(id, CHUNKS_PER_PAGE, page * CHUNKS_PER_PAGE);
            setChunks(data.chunks);
            setChunksTotal(data.total);
        } catch (error) {
            console.error('Failed to load chunks:', error);
            setChunks([]);
            setChunksTotal(0);
        } finally {
            setIsLoadingChunks(false);
        }
    }, []);

    useEffect(() => {
        if (selectedDocId) {
            loadDocDetail(selectedDocId);
            setChunksPage(0);
            loadChunks(selectedDocId, 0);
        }
    }, [selectedDocId, loadDocDetail, loadChunks]);

    const handlePageChange = (newPage: number) => {
        setChunksPage(newPage);
        if (selectedDocId) {
            loadChunks(selectedDocId, newPage);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await checkAndUpload(files[0]);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            await checkAndUpload(files[0]);
        }
    };

    const checkAndUpload = async (file: File) => {
        if (file.type !== 'application/pdf') {
            alert('Only PDF files are supported.');
            return;
        }
        const duplicate = documents.find(d => d.name === file.name);
        if (duplicate) {
            setDuplicateFile(file);
        } else {
            await handleFileUpload(file);
        }
    };

    const handleFileUpload = async (file: File) => {

        setIsUploading(true);
        try {
            await api.documents.upload(file);
            onRefresh();
        } catch (error) {
            console.error('Upload failed:', error);
            alert(error instanceof Error ? error.message : 'Failed to upload document.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.documents.delete(id);
            if (selectedDocId === id) {
                setSelectedDocId(null);
                setDocDetail(null);
                setChunks([]);
            }
            onRefresh();
        } catch (error) {
            console.error('Delete failed:', error);
            alert('Failed to delete document.');
        } finally {
            setDeleteConfirmId(null);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
            case 'processing': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
            case 'pending': return <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />;
            case 'failed': return <AlertCircle className="w-5 h-5 text-red-500" />;
            default: return <FileText className="w-5 h-5 text-gray-500" />;
        }
    };

    const docToDelete = deleteConfirmId ? documents.find(d => d.id === deleteConfirmId) : null;
    const totalPages = Math.ceil(chunksTotal / CHUNKS_PER_PAGE);

    if (isLoading && documents.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
        );
    }

    // ─── Document Detail View ───
    if (selectedDocId && docDetail) {
        return (
            <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
                {/* Header */}
                <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-row items-center px-6 shrink-0 gap-4">
                    <button
                        onClick={() => { setSelectedDocId(null); setDocDetail(null); setChunks([]); }}
                        className="p-2 -ml-2 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 truncate">
                            {docDetail.name}
                        </h1>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-6 md:p-8">
                    <div className="max-w-4xl mx-auto space-y-6">

                        {/* Metadata Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-blue-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Uploaded</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        {new Date(docDetail.createdAt).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                                    {getStatusIcon(docDetail.status)}
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Status</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">
                                        {docDetail.status}
                                    </p>
                                </div>
                            </div>
                            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                                    <Layers className="w-5 h-5 text-purple-500" />
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Chunks</p>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                        {isLoadingDetail ? '...' : (docDetail.chunkCount ?? chunksTotal)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Chunks Preview */}
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between">
                                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                                    Parsed Chunks
                                </h2>
                                {totalPages > 1 && (
                                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                        <button
                                            onClick={() => handlePageChange(chunksPage - 1)}
                                            disabled={chunksPage === 0}
                                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>
                                        <span className="font-medium">{chunksPage + 1} / {totalPages}</span>
                                        <button
                                            onClick={() => handlePageChange(chunksPage + 1)}
                                            disabled={chunksPage >= totalPages - 1}
                                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {isLoadingChunks ? (
                                <div className="p-8 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                                </div>
                            ) : chunks.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
                                    {docDetail.status === 'completed'
                                        ? 'No chunks found for this document.'
                                        : 'Document is still being processed. Chunks will appear once complete.'}
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                    {chunks.map((chunk, idx) => (
                                        <li key={chunk.id} className="p-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                                            <div className="flex items-start gap-3">
                                                <span className="shrink-0 mt-0.5 flex items-center gap-1 text-xs font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-900 px-2 py-0.5 rounded">
                                                    <Hash className="w-3 h-3" />
                                                    {chunksPage * CHUNKS_PER_PAGE + idx + 1}
                                                </span>
                                                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                                                    {chunk.text}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    // ─── Document List View ───
    return (
        <div className="flex-1 flex flex-col h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-row items-center justify-between px-6 shrink-0">
                <h1 className="text-lg font-bold tracking-tight bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent flex items-center gap-2">
                    <Database className="w-5 h-5 text-blue-500" />
                    Knowledge Base
                </h1>
            </header>

            <main className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="max-w-4xl mx-auto space-y-8">

                    {/* Upload Zone */}
                    <div
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-colors ${isDragging
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800/80'
                            }`}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            accept="application/pdf"
                            className="hidden"
                        />
                        {isUploading ? (
                            <div className="flex flex-col items-center text-blue-600 dark:text-blue-400">
                                <Loader2 className="w-10 h-10 mb-2 animate-spin" />
                                <p className="font-medium">Uploading document...</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center text-gray-500 dark:text-gray-400">
                                <UploadCloud className="w-10 h-10 mb-2 text-gray-400 dark:text-gray-500" />
                                <p className="font-medium text-gray-700 dark:text-gray-300">Click or drag a PDF file to upload</p>
                                <p className="text-sm mt-1">Files will be parsed, chunked, and embedded for RAG</p>
                                <p className="text-xs mt-1.5 font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800/50 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">Maximum size: 100MB</p>
                            </div>
                        )}
                    </div>

                    {/* Document List */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Uploaded Documents</h2>
                        </div>

                        {documents.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                                No documents in the knowledge base yet.
                            </div>
                        ) : (
                            <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {documents.map((doc) => (
                                    <li
                                        key={doc.id}
                                        className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors flex items-center justify-between group cursor-pointer"
                                        onClick={() => doc.status !== 'pending' && setSelectedDocId(doc.id)}
                                    >
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-900 flex items-center justify-center shrink-0">
                                                {getStatusIcon(doc.status)}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                                    {doc.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${doc.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                        doc.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                        }`}>
                                                        {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                                                    </span>
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                                        {new Date(doc.createdAt).toLocaleString()}
                                                    </span>
                                                </div>
                                                {doc.status === 'failed' && doc.error && (
                                                    <p className="text-xs text-red-500 mt-1 truncate max-w-md">
                                                        Error: {doc.error}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(doc.id); }}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all shrink-0 ml-4"
                                            title="Delete document"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                </div>
            </main>

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Document</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            Are you sure you want to delete <span className="font-semibold text-gray-700 dark:text-gray-200">{docToDelete?.name}</span>? This will remove its vectors from the database and cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirmId)}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Duplicate File Confirmation Modal */}
            {duplicateFile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Duplicate File Name</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            A document named <span className="font-semibold text-gray-700 dark:text-gray-200">{duplicateFile.name}</span> already exists in the knowledge base. Do you want to upload it anyway?
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => { setDuplicateFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={async () => { const file = duplicateFile; setDuplicateFile(null); await handleFileUpload(file); }}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2"
                            >
                                <UploadCloud className="w-4 h-4" />
                                Upload Anyway
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
