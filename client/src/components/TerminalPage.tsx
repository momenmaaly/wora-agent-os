import { Terminal } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { MissionLogPanel } from './MissionLogPanel.js';
import { MissionSelect } from './MissionSelect.js';
import { EmptyState, Notice, PageHeader, StateMessage } from './ui.js';

export function TerminalPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const feed = useMissionFeed();
  return <div className="tech-page">
    <PageHeader icon={Terminal} eyebrow={t('terminal.eyebrow')} title={t('terminal.title')} description={t('terminal.subtitle')}
      action={<MissionSelect missions={feed.missions} value={feed.selectedId} onChange={feed.selectMission} label={t('terminal.mission')} />} />
    <Notice>{t('terminal.readOnly')}</Notice>
    {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('app.loading')} />}
    {feed.error !== null && <StateMessage variant="error" title={t('workspace.loadError')}><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('workspace.retry')}</button></StateMessage>}
    {!feed.loading && !feed.error && !feed.detail && <EmptyState icon={Terminal} title={t('terminal.empty')}><p>{t('terminal.emptyBody')}</p><button type="button" className="button small" onClick={() => onNavigate('home')}>{t('workspace.title')}</button></EmptyState>}
    {feed.detail && <MissionLogPanel detail={feed.detail} showFilters defaultOpen />}
  </div>;
}
