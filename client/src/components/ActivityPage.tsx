import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi } from '../os/api.js';
import { EmptyState, PageHeader, StateMessage } from './ui.js';

interface AuditEntry { id: string; actor: string; action: string; subject: string; createdAt: string }

export function ActivityPage() {
  const { t, lang } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setEntries((await osApi.audit(50)) as AuditEntry[]); }
    catch (err) { setEntries([]); setError(err instanceof OsApiError ? err.message : t('activity.error')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  return <div className="tech-page">
    <PageHeader icon={Activity} eyebrow={t('activity.eyebrow')} title={t('activity.title')} description={t('activity.subtitle')}
      action={<button type="button" className="icon-button" onClick={() => void load()} aria-label={t('activity.refresh')} title={t('activity.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>} />
    {loading && <StateMessage variant="loading" title={t('app.loading')} />}
    {!loading && error && <StateMessage variant="error" title={t('activity.error')}><p>{error}</p><button type="button" className="button small" onClick={() => void load()}>{t('workspace.retry')}</button></StateMessage>}
    {!loading && !error && entries?.length === 0 && <EmptyState icon={Activity} title={t('activity.empty')}><p>{t('activity.emptyBody')}</p></EmptyState>}
    {!loading && entries && entries.length > 0 && <ol className="tech-activity-list">
      {entries.map((entry) => <li key={entry.id}>
        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(lang)}</time>
        <div><strong dir="auto">{entry.action}</strong><p dir="auto">{entry.subject}</p><small>{t('activity.actor')}: <bdi>{entry.actor}</bdi></small></div>
      </li>)}
    </ol>}
  </div>;
}
