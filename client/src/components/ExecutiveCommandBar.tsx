import { useState, type FormEvent } from 'react';
import { Bot, Send } from 'lucide-react';

/**
 * Persistent Command Center. Every submission launches a real WORA mission
 * (understand → plan → route → execute → review) and opens مركز التنفيذ.
 */
export function ExecutiveCommandBar({ onSubmit }: { onSubmit: (brief: string) => void }) {
  const [draft, setDraft] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const brief = draft.trim();
    if (!brief) return;
    setDraft('');
    onSubmit(brief);
  }
  return <form className="executive-command-bar" onSubmit={submit} aria-label="Executive Command">
    <span className="executive-command-avatar" aria-hidden="true"><Bot size={20} strokeWidth={1.8} /></span>
    <span className="executive-command-label"><strong>Executive Command</strong><small>ينشئ مهمة تنفيذ حقيقية ويتتبعها في مركز التنفيذ</small></span>
    <input
      type="text"
      dir="auto"
      maxLength={1200}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      aria-label="اكتب هدفك لـ WORA"
      placeholder="اكتب هدفك — مثال: افحص جهازي وحدد المشاكل…"
    />
    <button type="submit" className="executive-command-submit" disabled={!draft.trim()}><Send size={15} aria-hidden="true" /><span>نفّذ الآن</span></button>
  </form>;
}
