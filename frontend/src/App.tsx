import { useState, useEffect, useRef, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { ChatInput } from './components/ChatInput';
import { ModelSelector } from './components/ModelSelector';
import { AgentDashboard } from './components/AgentDashboard';
import { AgentDetail } from './components/AgentDetail';
import { KnowledgeBase } from './components/KnowledgeBase';
import { api, API_BASE } from './services/api';
import type { Model, Session, Message, Agent, AgentDetail as AgentDetailType, DocumentMeta } from './types/index';
import { Bot, AlertCircle } from 'lucide-react';

function App() {
  const [models, setModels] = useState<Model[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
  const [sessionMessages, setSessionMessages] = useState<Message[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [quotedMessage, setQuotedMessage] = useState<{ id: string; content: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [generationStatus, setGenerationStatus] = useState<'generating' | 'compacting' | 'retrying' | false>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<{ id: string, type: 'steer' | 'followUp', text: string }[]>([]);

  // Agent Management State
  const [activeTab, setActiveTab] = useState<'chat' | 'agent' | 'knowledge'>('chat');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [activeAgentDetail, setActiveAgentDetail] = useState<AgentDetailType | null>(null);

  const [contextUsage, setContextUsage] = useState<{ tokens: number | null, contextWindow: number, percent: number | null } | null>(null);


  // Knowledge Base State
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);

  useEffect(() => {
    fetchModels();
    fetchSessions();
  }, []);

  useEffect(() => {
    if (activeTab === 'agent') {
      fetchAgents();
    } else if (activeTab === 'knowledge') {
      fetchDocuments();
    }
  }, [activeTab]);

  const fetchAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const data = await api.agents.list();
      setAgents(data);
    } catch (err) {
      setError('Failed to load agents.');
      console.error(err);
    } finally {
      setIsLoadingAgents(false);
    }
  };

  const fetchDocuments = async () => {
    setIsLoadingDocs(true);
    try {
      const data = await api.documents.list();
      setDocuments(data);
    } catch (err) {
      setError('Failed to load documents.');
      console.error(err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const activeSession = useMemo(() => {
    if (!activeSessionId) return undefined;
    return sessions.find(s => s.id === activeSessionId || s.id.endsWith(`_${activeSessionId}`));
  }, [sessions, activeSessionId]);
  // Compute activeAgentId per-branch by scanning visible messages for /agent commands.
  // visibleMessages changes when branches change, so this naturally gives per-branch state.
  // NOTE: This is computed AFTER visibleMessages below, so we use a ref + effect pattern
  // to avoid circular dependency. For the initial render, fall back to session-level state.
  const [branchAgentId, setBranchAgentId] = useState<string | null | undefined>(undefined);

  const handleSelectAgent = async (id: string) => {
    try {
      const data = await api.agents.get(id);
      setActiveAgentDetail(data);
    } catch (err) {
      setError(`Failed to load details for agent ${id}`);
      console.error(err);
    }
  };

  const handleSaveAgentFile = async (filePath: string, content: string) => {
    if (!activeAgentDetail) return;
    try {
      await api.agents.updateFile(activeAgentDetail.id, filePath, content);
      // Optimistically update local state
      setActiveAgentDetail(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          files: {
            ...prev.files,
            [filePath]: { ...prev.files[filePath], content }
          }
        };
      });
    } catch (err) {
      setError(`Failed to save file ${filePath}`);
      console.error(err);
      throw err; // Propagate to AgentDetail for UI feedback
    }
  };

  const handleDeleteAgent = async (id: string) => {
    try {
      await api.agents.delete(id);
      if (activeAgentDetail?.id === id) {
        setActiveAgentDetail(null);
      }
      await fetchAgents();
    } catch (err) {
      setError(`Failed to delete agent ${id}`);
      console.error(err);
    }
  };

  const handleNewAgent = () => {
    // Placeholder for Agent generation workflow
    alert("This will invoke the km-agent-creator skill to scaffold a new agent.");
  };

  const fetchModels = async () => {
    try {
      const data = await api.models.list();
      setModels(data);
      if (data.length > 0) {
        setSelectedModelId(data[0].id);
      }
    } catch (err) {
      setError('Failed to load models. Ensure backend is running.');
      console.error(err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const fetchSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const data = await api.sessions.list();
      setSessions(data);
    } catch (err) {
      setError('Failed to load sessions.');
      console.error(err);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleNewSession = async () => {
    setActiveSessionId(null);
    setSessionMessages([]);
    setActiveLeafId(null);
    setQuotedMessage(null);
    setContextUsage(null);
  };


  const fetchCurrentSession = async (id: string) => {
    try {
      const session = await api.sessions.get(id);
      const msgs = session.messages || [];
      setSessionMessages(msgs);
      setActiveLeafId(msgs.length > 0 ? msgs[msgs.length - 1].id : null);
      setContextUsage(session.contextUsage || null);

      // Synchronize restored activeAgentId into the sessions list state
      if (session.activeAgentId !== undefined) {
        setSessions(prev => prev.map(s => {
          const isMatch = s.id === id || s.id.endsWith(`_${id}`);
          return isMatch ? { ...s, activeAgentId: session.activeAgentId } : s;
        }));
      }

    } catch (err) {
      setError('Failed to refresh session');
      console.error(err);
    }
  };

  const handleSelectSession = async (id: string) => {
    setActiveSessionId(id);
    setQuotedMessage(null); // clear any pending quote when switching sessions
    setContextUsage(null);
    try {
      setGenerationStatus('generating');
      const session = await api.sessions.get(id);
      const msgs = session.messages || [];
      setSessionMessages(msgs);
      setActiveLeafId(msgs.length > 0 ? msgs[msgs.length - 1].id : null);
      setContextUsage(session.contextUsage || null);

      // Synchronize restored activeAgentId into the sessions list state
      if (session.activeAgentId !== undefined) {
        setSessions(prev => prev.map(s => {
          const isMatch = s.id === id || s.id.endsWith(`_${id}`);
          return isMatch ? { ...s, activeAgentId: session.activeAgentId } : s;
        }));
      }

    } catch (err) {
      console.error('Failed to load session details', err);
    } finally {
      setGenerationStatus(false);
    }
  };

  const handleRenameSession = async (id: string, newName: string) => {
    try {
      await api.sessions.update(id, { name: newName });
      fetchSessions();
    } catch (err) {
      console.error('Failed to rename session', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await api.sessions.delete(id);
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setSessionMessages([]);
        setActiveLeafId(null);
      }
      fetchSessions();
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  };

  const handleSendMessage = async (content: string, branchFromId: string | null | undefined = undefined) => {
    if (!selectedModelId) {
      setError('Please select a model first');
      return;
    }

    // If a message is quoted, prepend it as a blockquote
    const currentQuote = quotedMessage;
    const finalContent = currentQuote
      ? `> ${currentQuote.content.split('\n').join('\n> ')}\n\n${content}`
      : content;
    setQuotedMessage(null);

    const isFirstMessage = sessionMessages.length === 0;
    const parentId = branchFromId !== undefined ? branchFromId : activeLeafId;
    const newUserId = Date.now().toString();

    const newMessage: Message = {
      id: newUserId,
      parentId,
      role: 'user',
      content: finalContent,
      activeAgentId: activeAgentId
    };
    setSessionMessages((prev) => [...prev, newMessage]);
    setActiveLeafId(newUserId);

    setGenerationStatus('generating');
    setError(null);

    let currentSessionId = activeSessionId;
    if (!currentSessionId) {
      try {
        const res = await api.sessions.create();
        currentSessionId = res.sessionId;
        setActiveSessionId(currentSessionId);

        // Auto-name the session based on the first message (truncated)
        const autoName = finalContent.length > 30
          ? finalContent.slice(0, 30) + '…'
          : finalContent;
        await api.sessions.update(currentSessionId, { name: autoName });

        await fetchSessions(); // Update sidebar with the new session
      } catch (err) {
        console.error('Deferred session creation failed:', err);
        setError('Failed to create session');
        setGenerationStatus(false);
        return;
      }
    }

    // Initial assistant message for progressive appending
    const assistantMessageId = (Date.now() + 1).toString();
    setSessionMessages((prev) => [
      ...prev,
      { id: assistantMessageId, parentId: newUserId, role: 'assistant', content: '', toolCalls: [], activeAgentId: activeAgentId }
    ]);
    setActiveLeafId(assistantMessageId);

    // Set up AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Connect specifically via fetch then read stream directly
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: currentSessionId,
          modelId: selectedModelId,
          message: finalContent,
          branchFromId: branchFromId !== undefined ? branchFromId : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat API returned an error');
      }

      if (!response.body) throw new Error('ReadableStream not yet supported in this browser.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let buffer = '';
      let accumulatedReasoning = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          if (chunk.startsWith('data: ')) {
            const dataStr = chunk.slice(6).trim();
            if (dataStr) {
              try {
                const event = JSON.parse(dataStr);

                switch (event.type) {
                  case 'session_id':
                    activeSessionIdRef.current = event.id;
                    setActiveSessionId(event.id);
                    break;

                  case 'active_agent':
                    setBranchAgentId(event.id || null);
                    setSessions(prev => prev.map(s => {
                      const currentId = activeSessionId || activeSessionIdRef.current;
                      const isMatch = s.id === currentId || (currentId && s.id.endsWith(`_${currentId}`));
                      return isMatch ? { ...s, activeAgentId: event.id } : s;
                    }));
                    break;

                  case 'message':
                    setSessionMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: msg.content + (event.text || '') }
                          : msg
                      )
                    );
                    break;

                  case 'thinking':
                    accumulatedReasoning += (event.text || '');
                    setSessionMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, reasoning: accumulatedReasoning }
                          : msg
                      )
                    );
                    break;

                  case 'tool_call':
                    setSessionMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                            ...msg,
                            toolCalls: [
                              ...(msg.toolCalls || []),
                              { name: event.tool, input: event.input, status: 'pending' },
                            ],
                          }
                          : msg
                      )
                    );
                    break;

                  case 'tool_result':
                    setSessionMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id !== assistantMessageId) return msg;

                        // Merge parsed citations
                        const newCitations = msg.citations ? { ...msg.citations } : {};
                        if (event.citations) {
                          Object.assign(newCitations, event.citations);
                        }

                        return {
                          ...msg,
                          citations: Object.keys(newCitations).length > 0 ? newCitations : undefined,
                          toolCalls: msg.toolCalls?.map((tc) =>
                            tc.name === event.tool && tc.status === 'pending'
                              ? { ...tc, status: event.status, output: event.output || '' }
                              : tc
                          ),
                        };
                      })
                    );
                    break;

                  case 'error':
                    setError(event.message);
                    break;

                  case 'context_usage':
                    if (event.usage) {
                      setContextUsage(event.usage);
                    }
                    break;

                  case 'status':
                    if (event.status === 'generative') {
                      setGenerationStatus('generating');
                    } else if (event.status === 'compacting') {
                      setGenerationStatus('compacting');
                    } else if (event.status === 'retrying') {
                      setGenerationStatus('retrying');
                    }
                    break;

                  case 'done': {
                    setGenerationStatus(false);
                    setPendingActions([]);
                    if (isFirstMessage) {
                      fetchSessions();
                    }
                    const finalId = activeSessionIdRef.current || activeSessionId;
                    if (finalId) {
                      fetchCurrentSession(finalId);
                    }
                    break;
                  }
                }

              } catch (e) {
                console.warn('Failed to parse SSE line', dataStr, e);
              }
            }
          }
          boundary = buffer.indexOf('\n\n'); // Update boundary for next iteration
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Generation stopped by user');
      } else {
        console.error('Streaming error', err);
        setError('Connection to chat server failed.');
      }
    } finally {
      setGenerationStatus(false);
      abortControllerRef.current = null;
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSteerMessage = async (text: string, mode: 'steer' | 'followUp' = 'steer') => {
    const sid = activeSessionIdRef.current;
    if (!sid) {
      setError('No active session to steer.');
      return;
    }

    // Add to pending actions UI state
    setPendingActions(prev => [...prev, { id: Date.now().toString(), type: mode, text }]);

    try {
      const res = await fetch(`${API_BASE}/chat/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, text, mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Steer failed');
      }
    } catch (err) {
      console.error('Steer error', err);
      setError('Failed to steer agent.');
    }
  };

  const visibleMessages = useMemo(() => {
    if (!activeLeafId) return [];
    const thread: Message[] = [];
    let currentId: string | null = activeLeafId;
    const byId = new Map(sessionMessages.map(m => [m.id, m]));

    // Safety limit to prevent infinite loops in case of circular references
    let maxDepth = 1000;
    while (currentId && byId.has(currentId) && maxDepth > 0) {
      const msg: Message = byId.get(currentId)!;
      thread.unshift(msg);
      currentId = msg.parentId ?? null;
      maxDepth--;
    }
    return thread;
  }, [sessionMessages, activeLeafId]);

  // Derive per-branch agent state from the last visible message.
  useEffect(() => {
    if (visibleMessages.length > 0) {
      // Find the most recent message that explicitly specifies an activeAgentId
      for (let i = visibleMessages.length - 1; i >= 0; i--) {
        const msg = visibleMessages[i];
        if (msg.activeAgentId !== undefined) {
          setBranchAgentId(msg.activeAgentId);
          return;
        }
      }
    }
    // If no message explicitly defines the state, clear the branch override
    setBranchAgentId(undefined);
  }, [visibleMessages]);

  // Final activeAgentId: prefer branch-level, fall back to session-level
  const activeAgentId = branchAgentId !== undefined ? branchAgentId : (activeSession?.activeAgentId ?? null);

  return (
    <div className="flex h-screen bg-white dark:bg-black font-sans text-gray-900 dark:text-gray-100 antialiased selection:bg-blue-500/30">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        activeTab={activeTab as 'chat' | 'agent' | 'knowledge'}
        onChangeTab={setActiveTab}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        isLoading={isLoadingSessions}
      />

      {/* Agent Tab */}
      {activeTab === 'agent' && (
        activeAgentDetail ? (
          <AgentDetail
            agent={activeAgentDetail}
            onBack={() => setActiveAgentDetail(null)}
            onSaveFile={handleSaveAgentFile}
          />
        ) : (
          <AgentDashboard
            agents={agents}
            onSelectAgent={handleSelectAgent}
            onNewAgent={handleNewAgent}
            onDeleteAgent={handleDeleteAgent}
            onRefreshAgents={fetchAgents}
            isLoading={isLoadingAgents}
          />
        )
      )}

      {/* Knowledge Base Tab */}
      {activeTab === 'knowledge' && (
        <KnowledgeBase
          documents={documents}
          isLoading={isLoadingDocs}
          onRefresh={fetchDocuments}
        />
      )}

      {/* Chat Tab */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col relative w-full h-full overflow-hidden">
          {/* Header */}
          <header className="h-16 flex items-center justify-between px-6 bg-white/80 dark:bg-black/50 backdrop-blur-md border-b border-gray-200 dark:border-white/10 z-20 shrink-0">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-600 w-8 h-8 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-lg font-bold tracking-tight bg-linear-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
                AgentPlayground
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center gap-4 overflow-hidden">
                <div className="flex items-center gap-4 overflow-hidden">
                  <div className="flex flex-col min-w-0 justify-center">
                    <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest truncate leading-none">
                      {activeSession?.name || 'Chat Window'}
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      {activeAgentId && (
                        <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-left-2 duration-500">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-tight">
                            Active Agent: {activeAgentId}
                          </span>
                        </div>
                      )}
                      {contextUsage && contextUsage.percent != null && contextUsage.tokens != null && contextUsage.contextWindow != null && (
                        <div className="flex items-center gap-1.5 animate-in fade-in duration-500" title={`${contextUsage.tokens} / ${contextUsage.contextWindow} tokens`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${contextUsage.percent > 90 ? 'bg-red-500' : contextUsage.percent > 75 ? 'bg-orange-500' : 'bg-blue-500'}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-tight ${contextUsage.percent > 90 ? 'text-red-600 dark:text-red-400' : contextUsage.percent > 75 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-500 dark:text-gray-400'}`}>
                            Context: {contextUsage.percent.toFixed(1)}% ({contextUsage.tokens >= 1000 ? `${(contextUsage.tokens / 1000).toFixed(1).replace(/\.0$/, '')}k` : contextUsage.tokens} / {contextUsage.contextWindow >= 1000 ? `${(contextUsage.contextWindow / 1000).toFixed(1).replace(/\.0$/, '')}k` : contextUsage.contextWindow})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <ModelSelector
                    models={models}
                    selectedModelId={selectedModelId}
                    onSelect={setSelectedModelId}
                    disabled={generationStatus !== false}
                    isLoading={isLoadingModels}
                  />
                </div>
              </div>
            </div>
          </header>

          {/* Error Banner */}
          {error && (
            <div className="absolute top-16 left-0 right-0 z-30 m-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl flex items-start space-x-3 shadow-sm backdrop-blur-sm">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                ×
              </button>
            </div>
          )}

          {/* Chat Area */}
          <div className="flex-1 overflow-hidden relative flex flex-col pt-0">
            <ChatWindow
              messages={visibleMessages}
              allMessages={sessionMessages}
              onSelectLeaf={setActiveLeafId}
              onResend={handleSendMessage}
              onQuote={(msg) => setQuotedMessage({ id: msg.id, content: msg.content })}
              isLoading={generationStatus || undefined}
            />
          </div>

          {/* Input Area */}
          <div className="shrink-0">
            <ChatInput
              onSend={handleSendMessage}
              onStop={handleStopGeneration}
              onSteer={handleSteerMessage}
              isGenerating={generationStatus}
              disabled={generationStatus !== false || !selectedModelId}
              quotedMessage={quotedMessage}
              onClearQuote={() => setQuotedMessage(null)}
              pendingActions={pendingActions}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
