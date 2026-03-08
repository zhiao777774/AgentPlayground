import { useState, useMemo } from 'react';
import type { AgentDetail as AgentDetailType } from '../types';
import { Bot, ChevronLeft, Save, FileText, AlertCircle, FolderOpen, FolderClosed, ChevronDown, ChevronRight } from 'lucide-react';

// ─── Tree Node Type ──────────────────────────────────────────────
interface TreeNode {
    name: string;
    fullPath: string; // relative path like "skills/pdf/forms.md"
    isDir: boolean;
    children: TreeNode[];
}

/** Build a recursive tree from a flat list of paths */
function buildTree(paths: string[]): TreeNode[] {
    const root: TreeNode[] = [];

    for (const filePath of paths) {
        const parts = filePath.split('/');
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            const isLast = i === parts.length - 1;
            const partialPath = parts.slice(0, i + 1).join('/');

            let existing = current.find(n => n.name === name && n.isDir === !isLast);
            if (!existing) {
                existing = {
                    name,
                    fullPath: partialPath,
                    isDir: !isLast,
                    children: [],
                };
                current.push(existing);
            }
            current = existing.children;
        }
    }

    // Sort: directories first, then alphabetically
    const sortNodes = (nodes: TreeNode[]) => {
        nodes.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });
        for (const n of nodes) {
            if (n.isDir) sortNodes(n.children);
        }
    };
    sortNodes(root);
    return root;
}

// ─── FolderTree Component ────────────────────────────────────────
function FolderTreeNode({
    node,
    depth,
    activeFile,
    isReadOnly,
    onSelectFile,
}: {
    node: TreeNode;
    depth: number;
    activeFile: string | null;
    isReadOnly: boolean;
    onSelectFile: (path: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    if (node.isDir) {
        return (
            <div>
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full text-left flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                >
                    {expanded
                        ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                        : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    }
                    {expanded
                        ? <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
                        : <FolderClosed className="w-4 h-4 shrink-0 text-amber-500" />
                    }
                    <span className="font-medium truncate">{node.name}</span>
                </button>
                {expanded && (
                    <div>
                        {node.children.map(child => (
                            <FolderTreeNode
                                key={child.fullPath}
                                node={child}
                                depth={depth + 1}
                                activeFile={activeFile}
                                isReadOnly={isReadOnly}
                                onSelectFile={onSelectFile}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // File node
    const isActive = activeFile === node.fullPath;
    return (
        <button
            onClick={() => onSelectFile(node.fullPath)}
            className={`w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${isActive
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium'
                : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
            <FileText className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
            <span className="truncate">{node.name}</span>
            {isReadOnly && (
                <span className="ml-auto text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded shrink-0">
                    RO
                </span>
            )}
        </button>
    );
}

// ─── Section Header ──────────────────────────────────────────────
function SectionHeader({ label }: { label: string }) {
    return (
        <div className="px-4 pt-4 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.15em]">
            {label}
        </div>
    );
}

// ─── Props ───────────────────────────────────────────────────────
interface Props {
    agent: AgentDetailType | null;
    onBack: () => void;
    onSaveFile: (filePath: string, content: string) => Promise<void>;
}

// ─── Main Component ──────────────────────────────────────────────
export function AgentDetail({ agent, onBack, onSaveFile }: Props) {
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [editContent, setEditContent] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Categorize files into groups
    const { configFiles, skillFiles, memoryFiles, otherFiles } = useMemo(() => {
        if (!agent) return { configFiles: [] as string[], skillFiles: [] as string[], memoryFiles: [] as string[], otherFiles: [] as string[] };

        const config: string[] = [];
        const skills: string[] = [];
        const memory: string[] = [];
        const other: string[] = [];

        for (const filePath of Object.keys(agent.files)) {
            if (filePath.startsWith('skills/')) {
                skills.push(filePath);
            } else if (filePath.startsWith('memory/')) {
                memory.push(filePath);
            } else if (!filePath.includes('/')) {
                config.push(filePath);
            } else {
                other.push(filePath);
            }
        }

        config.sort((a, b) => a.localeCompare(b));
        skills.sort((a, b) => a.localeCompare(b));
        memory.sort((a, b) => a.localeCompare(b));
        other.sort((a, b) => a.localeCompare(b));

        return { configFiles: config, skillFiles: skills, memoryFiles: memory, otherFiles: other };
    }, [agent]);

    // Build folder trees for subdirectory categories
    const skillTree = useMemo(() => buildTree(skillFiles.map(f => f.replace(/^skills\//, ''))), [skillFiles]);
    const memoryTree = useMemo(() => buildTree(memoryFiles.map(f => f.replace(/^memory\//, ''))), [memoryFiles]);
    const otherTree = useMemo(() => buildTree(otherFiles), [otherFiles]);

    if (!agent) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    const activeFile = selectedFile || (configFiles.length > 0 ? configFiles[0] : null);
    const activeFileData = activeFile ? agent.files[activeFile] : null;

    const handleSelectFile = (file: string) => {
        if (selectedFile !== file) {
            setSelectedFile(file);
            setEditContent(agent.files[file]?.content || '');
            setSaveSuccess(false);
        }
    };

    // Auto-select first file on load
    if (!selectedFile && configFiles.length > 0) {
        handleSelectFile(configFiles[0]);
    }

    const handleSave = async () => {
        if (!activeFile || !activeFileData || activeFileData.readOnly) return;
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await onSaveFile(activeFile, editContent);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to save file:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const hasUnsavedChanges = activeFile && activeFileData && editContent !== activeFileData.content;

    return (
        <div className="flex-1 flex flex-col h-screen overflow-hidden bg-white dark:bg-gray-950">
            {/* Header */}
            <header className="h-16 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-row items-center px-4 shrink-0 gap-4">
                <button
                    onClick={onBack}
                    className="p-2 -ml-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <Bot className="w-4 h-4" />
                    </div>
                    <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100 truncate max-w-sm">
                        {agent.id}
                    </h1>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* File Explorer Sidebar */}
                <div className="w-64 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-y-auto hidden md:block shrink-0">

                    {/* ── Config Section ── */}
                    {configFiles.length > 0 && (
                        <>
                            <SectionHeader label="Config" />
                            <ul className="px-2 space-y-0.5">
                                {configFiles.map((file) => {
                                    const isActive = activeFile === file;
                                    return (
                                        <li key={file}>
                                            <button
                                                onClick={() => handleSelectFile(file)}
                                                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${isActive
                                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium'
                                                    : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                                                    }`}
                                            >
                                                <FileText className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400'}`} />
                                                <span className="truncate">{file}</span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}

                    {/* ── Skills Section ── */}
                    {skillFiles.length > 0 && (
                        <>
                            <SectionHeader label="Skills" />
                            <div className="px-2 space-y-0.5">
                                {skillTree.map(node => (
                                    <FolderTreeNode
                                        key={node.fullPath}
                                        node={node}
                                        depth={0}
                                        activeFile={activeFile ? activeFile.replace(/^skills\//, '') : null}
                                        isReadOnly={true}
                                        onSelectFile={(path) => handleSelectFile(`skills/${path}`)}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* ── Memory Section ── */}
                    {memoryFiles.length > 0 && (
                        <>
                            <SectionHeader label="Memory" />
                            <div className="px-2 space-y-0.5">
                                {memoryTree.map(node => (
                                    <FolderTreeNode
                                        key={node.fullPath}
                                        node={node}
                                        depth={0}
                                        activeFile={activeFile ? activeFile.replace(/^memory\//, '') : null}
                                        isReadOnly={true}
                                        onSelectFile={(path) => handleSelectFile(`memory/${path}`)}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    {/* ── Other Section ── */}
                    {otherFiles.length > 0 && (
                        <>
                            <SectionHeader label="Other" />
                            <div className="px-2 space-y-0.5 pb-4">
                                {otherTree.map(node => (
                                    <FolderTreeNode
                                        key={node.fullPath}
                                        node={node}
                                        depth={0}
                                        activeFile={activeFile}
                                        isReadOnly={true}
                                        onSelectFile={handleSelectFile}
                                    />
                                ))}
                            </div>
                        </>
                    )}

                    <div className="h-4" /> {/* bottom padding */}
                </div>

                {/* Main Editor Area */}
                <div className="flex-1 flex flex-col bg-white dark:bg-gray-950 overflow-hidden relative">
                    {activeFile ? (
                        <>
                            <div className="h-12 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 shrink-0 bg-white dark:bg-gray-950">
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-gray-400" />
                                    <span className="font-medium text-gray-700 dark:text-gray-200 text-sm">{activeFile}</span>
                                    {hasUnsavedChanges && !activeFileData?.readOnly && (
                                        <span className="w-2 h-2 rounded-full bg-amber-500 ml-1"></span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {saveSuccess && (
                                        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium flex items-center gap-1">
                                            Saved!
                                        </span>
                                    )}
                                    {!activeFileData?.readOnly ? (
                                        <button
                                            onClick={handleSave}
                                            disabled={!hasUnsavedChanges || isSaving}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${hasUnsavedChanges && !isSaving
                                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                                : 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                                                }`}
                                        >
                                            {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                                            {isSaving ? 'Saving' : 'Save'}
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium px-2 py-1 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800/30">
                                            <AlertCircle className="w-3.5 h-3.5" />
                                            Read-only
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto p-4">
                                {activeFileData?.isImage ? (
                                    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
                                        <img
                                            src={activeFileData.content}
                                            alt={activeFile}
                                            className="max-w-full max-h-full object-contain rounded"
                                        />
                                    </div>
                                ) : (
                                    <textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        disabled={activeFileData?.readOnly}
                                        spellCheck={false}
                                        className={`w-full h-full p-4 font-mono text-sm leading-relaxed resize-none border rounded-lg focus:outline-none transition-colors ${activeFileData?.readOnly
                                            ? 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                            : 'bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-500 text-gray-800 dark:text-gray-200'
                                            }`}
                                    />
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400 flex-col gap-2">
                            <FileText className="w-8 h-8 opacity-20" />
                            <p>No file selected</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
