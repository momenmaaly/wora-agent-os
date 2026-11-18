import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AtSign, Bot, MessageCircle, Send } from 'lucide-react';
import { useWoraStore } from '../store/useWoraStore.js';
import { useSocket } from '../hooks/useSocket.js';
import { orderedAgents } from '../office/presentation.js';
import { MessageType, type Message } from '../types.js';
import { AgentAvatar } from './OfficePeople.js';
import { Dialog, EmptyState } from './ui.js';

const timeFormat = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit' });

function Messages({ messages }: { messages: Array<Message & { streaming?: boolean }> }) {
  const agents = useWoraStore((s) => s.agents);
  const localUser = useWoraStore((s) => s.localUserId);
  const scroll = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (stickToBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);

  return <div className="chat-messages hq-scroll" ref={scroll}
    onScroll={(event) => { const list = event.currentTarget; stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64; }}>
    {messages.length ? <ul aria-label="رسائل الفريق">
      {messages.map((message) => {
        const isMe = message.senderId === localUser;
        const sender = agents[message.senderId];
        if (message.type === MessageType.System) return <li className="chat-system" key={message.id} dir="auto">{message.content}</li>;
        return <li className={`chat-message${isMe ? ' is-me' : ''}`} key={message.id}>
          {!isMe && (sender ? <AgentAvatar agent={sender} /> : <span className="agent-avatar"><Bot size={17} /></span>)}
          <div className="chat-bubble">
            <div className="chat-meta"><bdi>{isMe ? 'أنت' : sender?.displayName ?? 'Wora'}</bdi><time dateTime={message.timestamp}>{timeFormat.format(new Date(message.timestamp))}</time></div>
            <p dir="auto">{message.content}{message.streaming && <span className="stream-cursor" aria-label="ردّ قيد الكتابة" />}</p>
          </div>
        </li>;
      })}
    </ul> : <EmptyState icon={MessageCircle} title="ابدأ المحادثة">أرسل رسالة للفريق أو اختر وكيلاً لمراسلته مباشرة.</EmptyState>}
  </div>;
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const agentMap = useWoraStore((s) => s.agents);
  const messages = useWoraStore((s) => s.messages);
  const streams = useWoraStore((s) => s.activeStreams);
  const connected = useWoraStore((s) => s.connected);
  const { sendMessage } = useSocket();
  const [target, setTarget] = useState(() => useWoraStore.getState().selectedAgentId ?? '');
  const [draft, setDraft] = useState('');
  const recipients = useMemo(() => orderedAgents(agentMap), [agentMap]);
  const targetId = agentMap[target] ? target : '';
  const visibleMessages = useMemo(() => {
    const inFlight: Array<Message & { streaming: true }> = Object.values(streams).map((stream) => ({
      id: stream.messageId, senderId: stream.agentId, roomId: '', content: stream.content,
      timestamp: new Date().toISOString(), type: MessageType.Text, mentions: [], streaming: true,
    }));
    return [...messages, ...inFlight.filter((stream) => !messages.some((message) => stream.id === message.id))];
  }, [messages, streams]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendMessage(draft, { targetAgentId: targetId || null })) setDraft('');
  }

  return <Dialog icon={MessageCircle} variant="drawer" className="chat-drawer" title="محادثة الفريق" onClose={onClose}
    description={connected && !targetId.startsWith('agent-custom-') ? 'محادثة داخل مساحة العمل الحالية.' : 'تجربة محلية: الردود في هذا الوضع محاكاة.'}
    footer={<form className="chat-form" onSubmit={send}>
      <input className="field" aria-label="رسالتك" maxLength={4_000} value={draft} dir="auto" onChange={(event) => setDraft(event.target.value)} placeholder="اكتب رسالة…" />
      <button type="submit" aria-label="إرسال الرسالة" className="button primary" disabled={!draft.trim()}><Send size={17} aria-hidden="true" /></button>
    </form>}>
    <label className="chat-target"><AtSign size={16} /><span>إلى</span><select className="field" aria-label="المستلم" value={targetId} onChange={(event) => setTarget(event.target.value)}>
      <option value="">الفريق · محادثة عامة</option>
      {recipients.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName} — {agent.profile.customRole}</option>)}
    </select></label>
    <Messages messages={visibleMessages} />
    <p className="field-note chat-tip">للرد من وكيل محدّد، اختَره أو اذكره بـ <bdi>@الاسم</bdi>.</p>
  </Dialog>;
}

export function ChatDrawer() {
  const open = useWoraStore((s) => s.ui.showChat);
  const toggle = useWoraStore((s) => s.toggleChat);
  return open ? <ChatPanel onClose={() => toggle(false)} /> : null;
}
