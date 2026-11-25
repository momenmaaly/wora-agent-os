import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Database, RefreshCw, Search } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi } from '../os/api.js';
import type { PageId } from '../pages.js';
import { EmptyState, PageHeader, StateMessage } from './ui.js';

interface MemoryEntry {
  id: string;
  scope: string;
  content: string;
  tags: string[];
  provenance: string;
  createdAt: string;
  visibility?: string;
}

export function KnowledgePage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search = '') => {
    setLoading(true);
    setError(null);
    try {
      setEntries((await osApi.memory(search)) as unknown as MemoryEntry[]);
    } catch (err) {
      setEntries([]);
      setError(err instanceof OsApiError ? err.message : t('knowledge.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query.trim());
  }

  return <div className="tech-page">
    <PageHeader icon={BookOpen} eyebrow={t('knowledge.eyebrow')} title={t('knowledge.title')} description={t('knowledge.subtitle')}
      action={<div className="tech-page-actions">
        <button type="button" className="button small" onClick={() => onNavigate('system')}><Database size={14} aria-hidden="true" />{t('knowledge.manage')}</button>
        <button type="button" className="icon-button" onClick={() => void load(query.trim())} aria-label={t('knowledge.refresh')} title={t('knowledge.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
      </div>} />
    <form className="tech-search" onSubmit={search} role="search">
      <Search size={16} aria-hidden="true" />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('knowledge.searchPlaceholder')} aria-label={t('knowledge.search')} />
      <button type="submit" className="button small">{t('knowledge.search')}</button>
    </form>
    {loading && <StateMessage variant="loading" title={t('app.loading')} />}
    {!loading && error && <StateMessage variant="error" title={t('knowledge.error')}><p>{error}</p><button type="button" className="button small" onClick={() => void load(query.trim())}>{t('workspace.retry')}</button></StateMessage>}
    {!loading && !error && entries?.length === 0 && <EmptyState icon={BookOpen} title={query ? t('knowledge.noResults') : t('knowledge.empty')}><p>{t('knowledge.emptyBody')}</p></EmptyState>}
    {!loading && entries && entries.length > 0 && <ul className="tech-knowledge-list">
      {entries.map((entry) => <li key={entry.id}>
        <div className="tech-knowledge-head">
          <span className="tech-scope">{entry.scope}</span>
          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(lang)}</time>
        </div>
        <p dir="auto">{entry.content}</p>
        <div className="tech-knowledge-meta">
          <small>{t('knowledge.provenance')}: <bdi>{entry.provenance}</bdi></small>
          {entry.tags?.length > 0 && <span>{entry.tags.map((tag) => <b key={tag}>#{tag}</b>)}</span>}
        </div>
      </li>)}
    </ul>}
  </div>;
}
