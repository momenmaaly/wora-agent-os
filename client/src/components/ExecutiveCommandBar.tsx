import { useState, type FormEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';

/**
 * Persistent command bar — every submission launches a real WORA mission
 * (understand → plan → route → execute → review) and opens Tasks & Executions.
 */
export function ExecutiveCommandBar({ onSubmit }: { onSubmit: (brief: string) => void }) {
  const [draft, setDraft] = useState('');
  const { t, dir } = useI18n();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const brief = draft.trim();
    if (!brief) return;
    setDraft('');
    onSubmit(brief);
  }
  return <form className="executive-command-bar" onSubmit={submit} aria-label={t('commandBar.label')}>
    <div className="executive-command-field">
      <span className="executive-command-label">{t('commandBar.label')}<small>{t('commandBar.hint')}</small></span>
      <input
        type="text"
        dir="auto"
        maxLength={1200}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={t('commandBar.ariaLabel')}
        placeholder={t('commandBar.placeholder')}
      />
      <button type="submit" className="executive-command-submit" disabled={!draft.trim()} aria-label={t('commandBar.submit')}><ArrowUp size={17} aria-hidden="true" /><span>{t('commandBar.submit')}</span></button>
    </div>
  </form>;
}
