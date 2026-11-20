import { useState, type FormEvent } from 'react';
import { Bot, Send } from 'lucide-react';
import { queueExecutiveCommand } from '../executiveCommand.js';

export function ExecutiveCommandBar({ onSubmit }: { onSubmit: (brief: string) => void }) {
  const [draft, setDraft] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const brief = queueExecutiveCommand(draft);
    if (!brief) return;
    setDraft('');
    onSubmit(brief);
  }
  return <form className="executive-command-bar" onSubmit={submit} aria-label="Executive Command">
    <span className="executive-command-avatar" aria-hidden="true"><Bot size={20} strokeWidth={1.8} /></span>
    <span className="executive-command-label"><strong>Executive Command</strong><small>Routed to the existing Manager Office for grounded review and assignment</small></span>
    <input
      type="text"
      dir="auto"
      maxLength={1200}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      aria-label="Write an instruction for the General Manager"
      placeholder="Tell the General Manager what the company should do…"
    />
    <button type="submit" className="executive-command-submit" disabled={!draft.trim()}><Send size={15} aria-hidden="true" /><span>Open command</span></button>
  </form>;
}
