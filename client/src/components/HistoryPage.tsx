import { useState } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { missionStatusLabel, missionTone, outcomeStatusLabel } from '../os/labels.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { EmptyState, PageHeader, StateMessage, StatusBadge } from './ui.js';

type Filter = 'all' | 'completed' | 'failed';

export function HistoryPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [filter, setFilter] = useState<Filter>('all');
  const missions = [...(feed.missions ?? [])]
    .filter((mission) => filter === 'all' || (filter === 'completed' ? mission.status === 'completed' : mission.status === 'failed' || mission.status === 'cancelled'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return <div className="tech-page">
    <PageHeader icon={History} eyebrow={t('history.eyebrow')} title={t('history.title')} description={t('history.subtitle')}
      action={<div className="tech-filter-group" role="group" aria-label={t('history.title')}>
        {(['all', 'completed', 'failed'] as const).map((item) => <button key={item} type="button" className="tech-filter" aria-pressed={filter === item} onClick={() => setFilter(item)}>{t(`history.${item}`)}</button>)}
      </div>} />
    {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('app.loading')} />}
    {feed.error !== null && <StateMessage variant="error" title={t('history.error')}><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('workspace.retry')}</button></StateMessage>}
    {!feed.loading && !feed.error && missions.length === 0 && <EmptyState icon={History} title={t('history.empty')}><p>{t('history.emptyBody')}</p></EmptyState>}
    {missions.length > 0 && <ul className="tech-history-list">
      {missions.map((mission) => <li key={mission.id}>
        <div className="tech-history-main">
          <StatusBadge tone={missionTone(mission.status)} dot>{missionStatusLabel(t, mission.status)}</StatusBadge>
          <strong dir="auto">{mission.objective}</strong>
          <p dir="auto">{mission.summary}</p>
        </div>
        <div className="tech-history-meta">
          {mission.outcomeStatus && <span>{t('history.outcome')}: {outcomeStatusLabel(t, mission.outcomeStatus)}</span>}
          <time dateTime={mission.updatedAt}>{new Date(mission.updatedAt).toLocaleString(lang)}</time>
          <button type="button" className="button small" onClick={() => onNavigate('execution')}>{t('history.open')}<ArrowRight size={14} aria-hidden="true" /></button>
        </div>
      </li>)}
    </ul>}
  </div>;
}
