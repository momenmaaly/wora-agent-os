import { ArrowRight, GitBranch, Network } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { MissionSelect } from './MissionSelect.js';
import { EmptyState, PageHeader, StateMessage, StatusBadge } from './ui.js';

export function WorkflowsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t } = useI18n();
  const feed = useMissionFeed();
  const detail = feed.detail;
  const graph = detail?.composition?.graph ?? null;
  const tasks = detail?.tasks ?? [];

  return <div className="tech-page">
    <PageHeader icon={GitBranch} eyebrow={t('workflows.eyebrow')} title={t('workflows.title')} description={t('workflows.subtitle')}
      action={<MissionSelect missions={feed.missions} value={feed.selectedId} onChange={feed.selectMission} label={t('workflows.mission')} />} />

    {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('app.loading')} />}
    {feed.error !== null && <StateMessage variant="error" title={t('workspace.loadError')}><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('workspace.retry')}</button></StateMessage>}
    {!feed.loading && !feed.error && !detail && <EmptyState icon={GitBranch} title={t('workflows.emptyTitle')}><p>{t('workflows.emptyBody')}</p><button type="button" className="button small" onClick={() => onNavigate('home')}>{t('workspace.title')}</button></EmptyState>}

    {detail && <section className="tech-workflow-panel">
      <div className="tech-panel-head">
        <div>
          <h2 dir="auto">{detail.objective}</h2>
          <p>{t('workflows.strategy')}: <bdi>{detail.composition?.selectedStrategy ?? '—'}</bdi></p>
        </div>
        <button type="button" className="button small" onClick={() => onNavigate('execution')}>{t('workflows.openMission')}<ArrowRight size={14} aria-hidden="true" /></button>
      </div>

      {graph ? <>
        <div className="tech-workflow-grid">
          {graph.nodes.map((node) => <article className="tech-workflow-node" key={node.id}>
            <header>
              <span className="tech-workflow-kind">{node.capabilityKind}</span>
              <StatusBadge tone={node.available ? 'success' : 'warning'} dot>{node.available ? t('workflows.available') : t('workflows.unavailable')}</StatusBadge>
            </header>
            <h3 dir="auto">{node.title}</h3>
            <p dir="auto">{node.objective}</p>
            <dl>
              <div><dt>{t('workflows.assignedTo')}</dt><dd>{node.agentId ?? t('workflows.unassigned')}</dd></div>
              <div><dt>{t('workflows.role')}</dt><dd>{node.role}</dd></div>
              <div><dt>{t('workflows.risk')}</dt><dd>{node.risk}</dd></div>
              <div><dt>{t('workflows.dependencies')}</dt><dd>{node.dependsOn.length ? node.dependsOn.join(', ') : t('workspace.noDependencies')}</dd></div>
            </dl>
          </article>)}
        </div>
        <div className="tech-workflow-edges">
          <h3><Network size={15} aria-hidden="true" /> {t('workflows.edges')}</h3>
          {graph.edges.length === 0 ? <p className="tech-muted">{t('workspace.noDependencies')}</p> : <ul>
            {graph.edges.map((edge, index) => <li key={`${edge.from}-${edge.to}-${index}`}><bdi>{edge.from}</bdi><span aria-hidden="true"> → </span><bdi>{edge.to}</bdi><small>{edge.kind}</small></li>)}
          </ul>}
        </div>
      </> : <>
        <p className="tech-muted">{t('workflows.noGraph')}</p>
        <div className="tech-plan">
          <h3>{t('workflows.taskFallback')}</h3>
          <ol className="tech-task-list">
            {tasks.map((task) => <li key={task.id} className="tech-task" data-status={task.status}>
              <span className="tech-task-index">{task.orderIndex + 1}</span>
              <div className="tech-task-copy"><strong dir="auto">{task.title}</strong><small>{task.agent?.name ?? t('workspace.unassigned')} · {task.specialization}</small></div>
            </li>)}
          </ol>
        </div>
      </>}
    </section>}
  </div>;
}
