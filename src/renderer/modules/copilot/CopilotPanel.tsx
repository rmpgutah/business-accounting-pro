import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { Bot, X, Plus, Send, Square, Trash2, ChevronDown, Zap, CheckCircle, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { useAppStore } from '../../stores/appStore';

// ─── Types ───────────────────────────────────────────────

interface ProposalData {
  proposalId: string;
  action_type: 'navigate' | 'create_invoice' | 'create_expense' | 'export_report' | 'run_report';
  description: string;
  params?: Record<string, any>;
}

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolName: string }
  | { type: 'proposal'; proposal: ProposalData };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  streaming?: boolean;
}

interface Thread {
  id: string;
  title: string;
  updated_at: string;
}

// ─── Proposal Card ───────────────────────────────────────

const ProposalCard: React.FC<{ proposal: ProposalData; onApprove: () => void; onDismiss: () => void }> = ({
  proposal, onApprove, onDismiss,
}) => {
  const [state, setState] = useState<'pending' | 'approved' | 'dismissed'>('pending');

  const handleApprove = () => {
    setState('approved');
    onApprove();
  };
  const handleDismiss = () => {
    setState('dismissed');
    onDismiss();
  };

  return (
    <div
      className="mt-2 rounded-md border p-3 text-sm"
      style={{
        borderColor: state === 'approved' ? 'var(--color-accent-income)' : state === 'dismissed' ? 'var(--structure)' : 'var(--accent-primary)',
        background: 'rgba(255,255,255,0.03)',
        opacity: state !== 'pending' ? 0.7 : 1,
      }}
    >
      <div className="flex items-start gap-2 mb-2">
        <Zap size={13} style={{ color: 'var(--accent-primary)', marginTop: 1 }} className="shrink-0" />
        <div>
          <div className="font-medium text-text-primary text-[12px] leading-tight">Proposed Action</div>
          <div className="text-text-secondary text-[12px] mt-0.5">{proposal.description}</div>
        </div>
      </div>
      {state === 'pending' ? (
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleApprove}
            className="px-3 py-1 text-[11px] font-semibold rounded"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            Approve
          </button>
          <button
            onClick={handleDismiss}
            className="px-3 py-1 text-[11px] text-text-secondary rounded"
            style={{ border: '1px solid var(--structure)' }}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted mt-1">
          {state === 'approved'
            ? <><CheckCircle size={11} style={{ color: 'var(--color-accent-income)' }} /> Approved</>
            : <><XCircle size={11} /> Dismissed</>}
        </div>
      )}
    </div>
  );
};

// ─── Message Bubble ──────────────────────────────────────

const MessageBubble: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const setModule = useAppStore((s) => s.setModule);

  const handleProposalApprove = (proposal: ProposalData) => {
    switch (proposal.action_type) {
      case 'navigate':
        if (proposal.params?.module) setModule(proposal.params.module);
        break;
      case 'create_invoice':
        setModule('invoicing');
        break;
      case 'create_expense':
        setModule('expenses');
        break;
      case 'run_report':
      case 'export_report':
        setModule('reports');
        break;
    }
  };

  const isUser = msg.role === 'user';

  return (
    <div className={`mb-3 ${isUser ? 'flex justify-end' : ''}`}>
      {!isUser && (
        <div className="flex items-center gap-1.5 mb-1">
          <Bot size={12} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>Copilot</span>
        </div>
      )}
      <div
        className={`text-[13px] leading-relaxed ${isUser ? 'inline-block rounded-lg px-3 py-2 max-w-[85%] text-right' : 'text-text-primary'}`}
        style={isUser ? { background: 'color-mix(in srgb, var(--accent-primary) 20%, transparent)', color: 'var(--text-primary)' } : undefined}
      >
        {msg.parts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {part.text}
              </span>
            );
          }
          if (part.type === 'tool_call') {
            return (
              <div key={i} className="flex items-center gap-1.5 my-1 text-[11px]" style={{ color: 'var(--accent-primary)', opacity: 0.8 }}>
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)' }} />
                Using {part.toolName.replace(/_/g, ' ')}…
              </div>
            );
          }
          if (part.type === 'proposal') {
            return (
              <ProposalCard
                key={i}
                proposal={part.proposal}
                onApprove={() => handleProposalApprove(part.proposal)}
                onDismiss={() => {}}
              />
            );
          }
          return null;
        })}
        {msg.streaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle animate-pulse" style={{ background: 'var(--accent-primary)', borderRadius: 1 }} />
        )}
      </div>
    </div>
  );
};

// ─── CopilotPanel ────────────────────────────────────────

interface CopilotPanelProps {
  onClose: () => void;
}

const CopilotPanel: React.FC<CopilotPanelProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadId, setThreadId] = useState<string>(() => uuid());
  const [showThreads, setShowThreads] = useState(false);
  const [threadTitle, setThreadTitle] = useState('New Conversation');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const offChunkRef = useRef<(() => void) | null>(null);

  // Load thread list on mount
  useEffect(() => {
    api.copilotThreadsList().then(setThreads).catch(() => {});
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Cleanup stream listener on unmount
  useEffect(() => {
    return () => { offChunkRef.current?.(); };
  }, []);

  const saveThread = useCallback((msgs: ChatMessage[], title: string) => {
    const apiMessages = msgs
      .filter(m => !m.streaming)
      .map(m => ({
        role: m.role,
        content: m.parts
          .filter(p => p.type === 'text')
          .map(p => (p as { type: 'text'; text: string }).text)
          .join(''),
      }))
      .filter(m => m.content.trim());
    if (apiMessages.length > 0) {
      api.copilotThreadsSave(threadId, title, apiMessages).catch(() => {});
    }
  }, [threadId]);

  const startNewThread = () => {
    if (streaming && currentStreamId) {
      api.copilotStop(currentStreamId);
    }
    offChunkRef.current?.();
    setMessages([]);
    setInput('');
    setStreaming(false);
    setCurrentStreamId(null);
    const newId = uuid();
    setThreadId(newId);
    setThreadTitle('New Conversation');
    setShowThreads(false);
    api.copilotThreadsList().then(setThreads).catch(() => {});
  };

  const loadThread = async (id: string) => {
    const data = await api.copilotThreadsLoad(id);
    if (!data) return;
    setThreadId(id);
    setThreadTitle(data.title || 'Conversation');
    setMessages(
      (data.messages as Array<{ role: 'user' | 'assistant'; content: string }>).map(m => ({
        id: uuid(),
        role: m.role,
        parts: [{ type: 'text' as const, text: m.content }],
      }))
    );
    setShowThreads(false);
  };

  const deleteThread = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.copilotThreadsDelete(id);
    setThreads(prev => prev.filter(t => t.id !== id));
    if (id === threadId) startNewThread();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { id: uuid(), role: 'user', parts: [{ type: 'text', text }] };
    const assistantId = uuid();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', parts: [], streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    const streamId = uuid();
    setCurrentStreamId(streamId);

    // Derive the new title from the first user message
    const newTitle = text.length > 50 ? text.slice(0, 47) + '…' : text;
    if (threadTitle === 'New Conversation') setThreadTitle(newTitle);

    // Build the API messages array (exclude streaming placeholder)
    const apiMessages = [...messages, userMsg]
      .map(m => ({
        role: m.role,
        content: m.parts
          .filter(p => p.type === 'text')
          .map(p => (p as { type: 'text'; text: string }).text)
          .join(''),
      }))
      .filter(m => m.content.trim());

    // Clean up previous listener
    offChunkRef.current?.();

    offChunkRef.current = api.on('copilot:chunk', (raw: unknown) => {
      const chunk = raw as { streamId: string; type: string; text?: string; toolName?: string; proposal?: ProposalData; error?: string };
      if (chunk.streamId !== streamId) return;

      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(m => m.id === assistantId);
        if (idx === -1) return prev;
        const msg = { ...updated[idx], parts: [...updated[idx].parts] };

        switch (chunk.type) {
          case 'delta': {
            const lastPart = msg.parts[msg.parts.length - 1];
            if (lastPart?.type === 'text') {
              msg.parts[msg.parts.length - 1] = { type: 'text', text: lastPart.text + (chunk.text ?? '') };
            } else {
              msg.parts.push({ type: 'text', text: chunk.text ?? '' });
            }
            break;
          }
          case 'tool_call':
            msg.parts.push({ type: 'tool_call', toolName: chunk.toolName ?? '' });
            break;
          case 'proposal':
            if (chunk.proposal) msg.parts.push({ type: 'proposal', proposal: chunk.proposal });
            break;
          case 'done':
          case 'error': {
            msg.streaming = false;
            if (chunk.type === 'error') {
              msg.parts.push({ type: 'text', text: `\n\n⚠️ ${chunk.error ?? 'An error occurred.'}` });
            }
            setStreaming(false);
            setCurrentStreamId(null);
            offChunkRef.current?.();
            offChunkRef.current = null;
            // Save thread after completion
            const finalTitle = threadTitle === 'New Conversation' ? newTitle : threadTitle;
            const completedMsgs = updated.map((m, i) => i === idx ? msg : m);
            saveThread(completedMsgs, finalTitle);
            api.copilotThreadsList().then(setThreads).catch(() => {});
            return completedMsgs;
          }
        }
        updated[idx] = msg;
        return updated;
      });
    });

    await api.copilotAsk(streamId, apiMessages);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stopStreaming = () => {
    if (currentStreamId) {
      api.copilotStop(currentStreamId);
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        width: 380,
        background: 'var(--color-bg-secondary)',
        borderLeft: '1px solid var(--structure)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--hairline)' }}
      >
        <div className="flex items-center gap-2">
          <Bot size={15} style={{ color: 'var(--accent-primary)' }} />
          <span className="text-[13px] font-semibold text-text-primary">AI Copilot</span>
          <button
            onClick={() => setShowThreads(v => !v)}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
            title="Conversation history"
          >
            <span className="truncate max-w-[100px]">{threadTitle}</span>
            <ChevronDown size={10} className={showThreads ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewThread}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            title="New conversation"
          >
            <Plus size={14} className="text-text-secondary" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            title="Close"
          >
            <X size={14} className="text-text-secondary" />
          </button>
        </div>
      </div>

      {/* Thread History Dropdown */}
      {showThreads && (
        <div
          className="shrink-0 overflow-y-auto"
          style={{ maxHeight: 200, borderBottom: '1px solid var(--hairline)', background: 'rgba(0,0,0,0.2)' }}
        >
          {threads.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-text-muted">No saved conversations yet.</div>
          ) : (
            threads.map(t => (
              <button
                key={t.id}
                onClick={() => loadThread(t.id)}
                className={`flex items-center justify-between w-full px-4 py-2 text-left hover:bg-white/5 transition-colors ${t.id === threadId ? 'bg-white/5' : ''}`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] text-text-primary truncate">{t.title || 'Untitled'}</span>
                  <span className="text-[10px] text-text-muted">{new Date(t.updated_at).toLocaleDateString()}</span>
                </div>
                <button
                  onClick={(e) => deleteThread(t.id, e)}
                  className="p-1 rounded hover:bg-white/10 shrink-0"
                  title="Delete"
                >
                  <Trash2 size={11} className="text-text-muted" />
                </button>
              </button>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <Bot size={28} style={{ color: 'var(--accent-primary)', opacity: 0.5 }} />
            <div className="text-[13px] text-text-muted max-w-[260px]">
              Ask about your finances, find records, or get AI insights on your accounting data.
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-[260px]">
              {[
                'Summarize my Q2 finances',
                'Are there any anomalies?',
                'Forecast cash flow for 30 days',
              ].map(hint => (
                <button
                  key={hint}
                  onClick={() => { setInput(hint); inputRef.current?.focus(); }}
                  className="text-left text-[12px] px-3 py-2 rounded"
                  style={{ border: '1px solid var(--hairline)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)' }}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 px-3 pb-3 pt-2"
        style={{ borderTop: '1px solid var(--hairline)' }}
      >
        <div
          className="flex items-end gap-2 rounded-lg px-3 py-2"
          style={{ border: '1px solid var(--structure)', background: 'rgba(255,255,255,0.03)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none bg-transparent text-[13px] text-text-primary placeholder:text-text-muted outline-none leading-relaxed"
            style={{ maxHeight: 120, overflowY: 'auto' }}
          />
          {streaming ? (
            <button
              onClick={stopStreaming}
              className="shrink-0 p-1.5 rounded transition-colors hover:bg-white/10"
              title="Stop"
            >
              <Square size={14} style={{ color: 'var(--color-accent-expense)' }} />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="shrink-0 p-1.5 rounded transition-colors"
              style={{
                color: input.trim() ? 'var(--accent-primary)' : 'var(--text-muted)',
                opacity: input.trim() ? 1 : 0.4,
              }}
              title="Send (Enter)"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 text-[10px] text-text-muted text-center">
          AI can make mistakes. Always verify financial data.
        </div>
      </div>
    </div>
  );
};

export default CopilotPanel;
