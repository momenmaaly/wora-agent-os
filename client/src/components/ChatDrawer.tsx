import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, X, AtSign, Sparkles, Bot, User } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import type { Message } from '../types.js';
import { MessageType } from '../types.js';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

export function ChatDrawer() {
  const messages      = useWoraStore((s) => s.messages);
  const streams       = useWoraStore((s) => s.activeStreams);
  const agents        = useWoraStore((s) => s.agents);
  const selectedId    = useWoraStore((s) => s.selectedAgentId);
  const showChat      = useWoraStore((s) => s.ui.showChat);
  const toggleChat    = useWoraStore((s) => s.toggleChat);
  const localUserId   = useWoraStore((s) => s.localUserId);
  const { sendMessage } = useSocket();

  const [draft, setDraft] = useState('');
  const [targetId, setTargetId] = useState<string>('');

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId) setTargetId(selectedId);
  }, [selectedId]);

  const agentList = useMemo(
    () => Object.values(agents).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [agents],
  );

  const visibleMessages: Array<Message & { isStreaming?: boolean }> = useMemo(() => {
    const streamPlaceholders: Message[] = Object.values(streams).map((s) => ({
      id:        s.messageId,
      roomId:    'stream',
      senderId:  s.agentId,
      type:      MessageType.Text,
      content:   s.content + ' ▌',
      timestamp: new Date().toISOString(),
      mentions:  [],
    }));
    const merged = [...messages, ...streamPlaceholders];
    // dedupe by id keep last
    const byId = new Map<string, Message & { isStreaming?: boolean }>();
    for (const m of merged) byId.set(m.id, m);
    for (const s of Object.values(streams)) {
      const v = byId.get(s.messageId);
      if (v) (v as Message & { isStreaming?: boolean }).isStreaming = true;
    }
    return [...byId.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }, [messages, streams]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [visibleMessages.length, showChat]);

  if (!showChat) {
    return (
      <button
        onClick={() => toggleChat(true)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-slate-800 dark:bg-white dark:text-slate-900"
      >
        <MessageCircle className="h-4 w-4" />
        الدردشة الحية
        {Object.keys(streams).length > 0 && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        )}
      </button>
    );
  }

  const targetAgent = targetId ? agents[targetId] : null;

  return (
    <div className="pointer-events-auto flex h-[min(64vh,560px)] w-[min(420px,calc(100vw-12px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-office">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-bold leading-none text-foreground">دردشة المقر</div>
            <div className="text-[11px] text-muted-foreground">
              {targetAgent ? `مراسلة ${targetAgent.displayName} مباشرة` : 'رسالة عامة — اذكر @الاسم لتوجيهها'}
            </div>
          </div>
        </div>
        <button
          onClick={() => toggleChat(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Target selector */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
          <AtSign className="h-3.5 w-3.5" />
          إلى
        </span>
        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="h-8 flex-1 rounded-full border border-border bg-white px-3 text-xs font-bold text-foreground outline-none dark:bg-white/5"
        >
          <option value="">الجميع (عام)</option>
          {agentList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName} — {a.profile.customRole}
            </option>
          ))}
        </select>
        {targetAgent && (
          <span className="hidden items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 sm:inline-flex">
            <Sparkles className="h-3 w-3" />
            مباشر
          </span>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto bg-muted/20 px-3 py-3 hq-scroll">
        <div className="flex flex-col gap-2">
          {visibleMessages.map((m) => {
            const isMe = m.senderId === localUserId;
            const sender = agents[m.senderId];
            const isSystem = m.type === MessageType.System;
            if (isSystem) {
              return (
                <div key={m.id} className="mx-auto max-w-[90%] rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs font-medium text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300">
                  {m.content}
                </div>
              );
            }
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: sender?.profile.avatarColor ?? '#64748b' }}
                  >
                    {sender ? sender.displayName.slice(0, 2).toUpperCase() : <Bot className="h-3.5 w-3.5" />}
                  </span>
                )}
                <div className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${isMe ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : sender ? 'border border-border bg-card text-foreground' : 'border border-border bg-card text-foreground'} ${isMe ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
                  {!isMe && (
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="text-xs font-bold leading-none">{sender?.displayName ?? m.senderId}</span>
                      {sender?.brainConfig && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-muted-foreground" dir="ltr">
                          {sender.brainConfig.model}
                        </span>
                      )}
                      {m.isStreaming && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</div>
                  <div className={`mt-1 text-[10px] ${isMe ? 'text-white/60 dark:text-slate-500' : 'text-muted-foreground'}`}>{formatTime(m.timestamp)}</div>
                </div>
                {isMe && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                    <User className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            );
          })}
          {visibleMessages.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
              لا توجد رسائل بعد — ابدأ محادثة مع الفريق
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!draft.trim()) return;
                sendMessage(draft, targetId ? { targetAgentId: targetId } : undefined);
                setDraft('');
              }
            }}
            placeholder={targetAgent ? `رسالة إلى ${targetAgent.displayName}…` : 'اكتب رسالتك… استخدم @الاسم للمناداة'}
            className="h-10 flex-1 rounded-full border border-border bg-white px-4 text-sm outline-none placeholder:text-muted-foreground focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 dark:bg-white/5"
          />
          <button
            onClick={() => {
              if (!draft.trim()) return;
              sendMessage(draft, targetId ? { targetAgentId: targetId } : undefined);
              setDraft('');
            }}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
