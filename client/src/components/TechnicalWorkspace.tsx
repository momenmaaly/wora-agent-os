import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight, Bot, CircleDashed, Clock, CornerDownLeft, GitBranch, LoaderCircle, Play, RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError } from '../os/api.js';
import { missionStatusLabel, missionTone, taskStatusLabel, taskTone } from '../os/labels.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { ExecutionInspector } from './ExecutionInspector.js';
import { MissionLogPanel } from './MissionLogPanel.js';
import { MissionSelect } from './MissionSelect.js';
import { Button, StateMessage, StatusBadge } from './ui.js';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function TechnicalWorkspace({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [draft, setDraft] = useState('');
  const [composite, setComposite] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detail = feed.detail;
  const tasks = detail?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const specialists = useMemo(() => [...new Set(tasks.flatMap((task) => task.agent?.name ? [task.agent.name] : []))], [tasks]);
  const strategy = detail?.composition?.strategies.find((item) => item.id === detail.composition?.selectedStrategy)?.name
    ?? detail?.planVersions?.[0]?.strategy
    ?? null;
  const examples = [t('workspace.example1'), t('workspace.example2'), t('workspace.example3')];
  const loadError = feed.error instanceof OsApiError ? feed.error.message : t('workspace.loadError');

  async function startMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = draft.trim();
    if (!objective || launching) return;
    setLaunching(true);
    setLaunchError(null);
    setNotice(null);
    try {
      await feed.launch(objective, composite ? 'composite' : undefined);
      setDraft('');
      setNotice(t('workspace.launchSuccess'));
    } catch (err) {
      setLaunchError(err instanceof OsApiError ? err.message : t('workspace.launchError'));
    } finally {
      setLaunching(false);
    }
  }

  return <div className="tech-workspace">
    <header className="tech-workspace-head">
      <div>
        <p className="tech-eyebrow">{t('workspace.eyebrow')}</p>
        <h1>{t('workspace.title')}</h1>
        <p className="tech-workspace-subtitle">{t('workspace.subtitle')}</p>
      </div>
      <div className="tech-workspace-state" aria-live="polite">
        <span><GitBranch size={14} aria-hidden="true" />{detail ? missionStatusLabel(t, detail.status) : t('workspace.noMission')}</span>
        <span><ShieldCheck size={14} aria-hidden="true" />{fill(t('workspace.progress'), { done: completed, total: tasks.length })}</span>
      </div>
    </header>

    <section className="tech-composer" aria-labelledby="tech-composer-title">
      <div className="tech-composer-head">
        <span className="tech-kicker"><Bot size={14} aria-hidden="true" /> WORA Intelligence</span>
        <h2 id="tech-composer-title">{t('workspace.composerTitle')}</h2>
        <p>{t('workspace.composerHint')}</p>
      </div>
      <form onSubmit={(event) => void startMission(event)}>
        <textarea
          dir="auto"
          rows={4}
          maxLength={1200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
          placeholder={t('workspace.placeholder')}
          aria-label={t('workspace.composerTitle')}
        />
        <div className="tech-composer-bar">
          <div className="tech-composer-context">
            <span className="tech-context-chip"><ShieldCheck size={13} aria-hidden="true" />{t('workspace.context')}: {t('workspace.contextValue')}</span>
            <label className="tech-check" title={t('workspace.compositionHint')}>
              <input type="checkbox" checked={composite} onChange={(event) => setComposite(event.target.checked)} />
              <span>{t('workspace.composition')}<small>{t('workspace.compositionHint')}</small></span>
            </label>
          </div>
          <Button type="submit" variant="primary" loading={launching} icon={Play} disabled={!draft.trim()}>
            {launching ? t('workspace.submitting') : t('workspace.submit')}
          </Button>
        </div>
      </form>
      <div className="tech-examples">
        <small>{t('workspace.examplesLabel')}</small>
        {examples.map((example) => <button key={example} type="button" className="tech-example" dir="auto" onClick={() => setDraft(example)}>{example}</button>)}
      </div>
      {launchError && <p className="tech-alert" role="alert">{launchError}</p>}
      {notice && <p className="tech-notice" role="status">{notice}</p>}
    </section>

    <div className="tech-workbench">
      <section className="tech-mission" aria-labelledby="tech-mission-title">
        <div className="tech-panel-head">
          <div>
            <h2 id="tech-mission-title">{t('workspace.currentMission')}</h2>
            <p>{t('workspace.missionSelector')}</p>
          </div>
          <div className="tech-mission-tools">
            <MissionSelect missions={feed.missions} value={feed.selectedId} onChange={feed.selectMission} label={t('workspace.missionSelector')} />
            <button type="button" className="icon-button" onClick={() => void feed.refresh()} aria-label={t('workspace.refresh')} title={t('workspace.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
          </div>
        </div>

        {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('app.loading')} />}
        {!feed.loading && feed.error !== null && <StateMessage variant="error" title={t('workspace.loadError')}><p>{loadError}</p><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('workspace.retry')}</button></StateMessage>}
        {!feed.loading && !feed.error && !detail && <div className="tech-empty">
          <CircleDashed size={26} aria-hidden="true" />
          <strong>{t('workspace.noMission')}</strong>
          <p>{t('workspace.noMissionBody')}</p>
        </div>}

        {detail && <>
          <div className="tech-mission-head">
            <div>
              <StatusBadge tone={missionTone(detail.status)} dot>{missionStatusLabel(t, detail.status)}</StatusBadge>
              <h3 dir="auto">{detail.objective}</h3>
              <p className="tech-mission-summary" dir="auto">{detail.summary}</p>
            </div>
            <button type="button" className="button small" onClick={() => onNavigate('execution')}>{t('workspace.openMissions')}<ArrowRight size={14} aria-hidden="true" /></button>
          </div>

          <div className="tech-mission-meta">
            <span><Clock size={13} aria-hidden="true" />{t('workspace.createdLabel')}: {new Date(detail.createdAt).toLocaleString(lang)}</span>
            <span><Clock size={13} aria-hidden="true" />{t('workspace.updatedLabel')}: {new Date(detail.updatedAt).toLocaleString(lang)}</span>
            {strategy && <span><GitBranch size={13} aria-hidden="true" />{t('workspace.planStrategy')}: <bdi>{strategy}</bdi></span>}
          </div>

          <div className="tech-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={fill(t('workspace.progress'), { done: completed, total: tasks.length })}>
            <span style={{ inlineSize: `${progress}%` }} />
          </div>
          <p className="tech-progress-label">{fill(t('workspace.progress'), { done: completed, total: tasks.length })}</p>

          {specialists.length > 0 && <div className="tech-specialists">
            <span>{t('workspace.specialists')}</span>
            {specialists.map((specialist) => <span key={specialist} className="tech-specialist"><Bot size={12} aria-hidden="true" />{specialist}</span>)}
          </div>}

          <div className="tech-plan">
            <div className="tech-plan-head">
              <h3>{t('workspace.planTitle')}</h3>
              <span className="tech-muted">{tasks.length} · {t('workspace.planTasks')}</span>
            </div>
            {tasks.length === 0 ? <p className="tech-muted">{t('workspace.emptyTasks')}</p> : <ol className="tech-task-list">
              {tasks.slice(0, 8).map((task) => <li key={task.id} className="tech-task" data-status={task.status}>
                <span className="tech-task-index">{task.orderIndex + 1}</span>
                <div className="tech-task-copy">
                  <strong dir="auto">{task.title}</strong>
                  <small>
                    {task.agent?.name ?? t('workspace.unassigned')}
                    {task.tool ? ` · ${task.tool}` : ''}
                    {task.dependsOn.length > 0 ? ` · ${t('workspace.taskDependencies')}: ${task.dependsOn.length}` : ` · ${t('workspace.noDependencies')}`}
                  </small>
                </div>
                <StatusBadge tone={taskTone(task.status)} dot>{taskStatusLabel(t, task.status)}</StatusBadge>
              </li>)}
            </ol>}
            {tasks.length > 8 && <button type="button" className="tech-text-link" onClick={() => onNavigate('execution')}>{t('workspace.openMissions')}<ArrowRight size={14} aria-hidden="true" /></button>}
          </div>
        </>}
      </section>

      <ExecutionInspector detail={detail} leases={feed.leases} verifications={feed.verifications} onOpenApprovals={() => onNavigate('approvals')} onOpenArtifacts={() => onNavigate('artifacts')} />
    </div>

    <MissionLogPanel detail={detail} />
  </div>;
}
