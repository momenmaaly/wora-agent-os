import { useState } from 'react';
import { Download, Package } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi } from '../os/api.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { MissionSelect } from './MissionSelect.js';
import { EmptyState, PageHeader, StateMessage } from './ui.js';

export function ArtifactsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artifacts = feed.detail?.artifacts ?? [];

  async function download(id: string, name: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const artifact = await osApi.artifact(id);
      const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('artifacts.error'));
    } finally {
      setBusy(null);
    }
  }

  return <div className="tech-page">
    <PageHeader icon={Package} eyebrow={t('artifacts.eyebrow')} title={t('artifacts.title')} description={t('artifacts.subtitle')}
      action={<MissionSelect missions={feed.missions} value={feed.selectedId} onChange={feed.selectMission} label={t('artifacts.mission')} />} />
    {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('app.loading')} />}
    {feed.error !== null && <StateMessage variant="error" title={t('workspace.loadError')}><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('workspace.retry')}</button></StateMessage>}
    {!feed.loading && !feed.error && !feed.detail && <EmptyState icon={Package} title={t('artifacts.noMission')}><button type="button" className="button small" onClick={() => onNavigate('home')}>{t('workspace.title')}</button></EmptyState>}
    {error && <StateMessage variant="error" title={t('artifacts.error')}><p>{error}</p></StateMessage>}
    {feed.detail && artifacts.length === 0 && <EmptyState icon={Package} title={t('artifacts.empty')}><p>{t('artifacts.emptyBody')}</p></EmptyState>}
    {artifacts.length > 0 && <section className="tech-artifact-panel">
      <div className="tech-panel-head"><div><h2>{feed.detail?.objective}</h2><p>{artifacts.length} · {t('artifacts.title')}</p></div></div>
      <ul className="tech-artifact-list">
        {artifacts.map((artifact) => <li key={artifact.id}>
          <span className="tech-artifact-icon"><Package size={18} aria-hidden="true" /></span>
          <div><strong dir="auto">{artifact.name}</strong><small>{t('artifacts.kind')}: {artifact.kind}{artifact.createdAt || artifact.created_at ? ` · ${new Date(artifact.createdAt ?? artifact.created_at ?? '').toLocaleString(lang)}` : ''}</small></div>
          <button type="button" className="button small" disabled={busy === artifact.id} onClick={() => void download(artifact.id, artifact.name)}>
            <Download size={14} aria-hidden="true" />{busy === artifact.id ? t('artifacts.downloading') : t('artifacts.download')}
          </button>
        </li>)}
      </ul>
    </section>}
  </div>;
}
