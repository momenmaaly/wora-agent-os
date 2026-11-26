import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Ban, Bot, Check, CircleAlert, CircleDashed, Clock, Download, FileText, GitBranch,
  Pause, Play, RefreshCw, ShieldAlert, ShieldCheck, X,
} from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import { OsApiError, osApi, type ApprovalRecord, type MissionDetail, type OsTask } from '../os/api.js';
import { missionStatusLabel, missionTone, outcomeStatusLabel, taskStatusLabel, taskTone } from '../os/labels.js';
import { useMissionFeed } from '../os/useMissionFeed.js';
import type { PageId } from '../pages.js';
import { extensionsApi, type CapabilitySnapshot } from '../extensions/api.js';
import { Button, EmptyState, RiskBadge, StateMessage, StatusBadge } from '../components/ui.js';
import { attentionItems, derivePhases, fill, formatDate, missionActivity, missionProgress, nextAction } from './model.js';

type RunTab = 'plan' | 'activity' | 'evidence' | 'artifact' | 'context';

function fillTemplate(template: string, values: Record<string, string | number>): string {
  return fill(template, values);
}

function TaskRow({ task, selected, onSelect }: { task: OsTask; selected: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  return <li>
    <button type="button" className={`op-task-row${selected ? ' is-selected' : ''}`} data-status={task.status} onClick={onSelect} aria-pressed={selected}>
      <span className="op-task-index">{String(task.orderIndex + 1).padStart(2, '0')}</span>
      <span className="op-task-copy">
        <strong dir="auto">{task.title}</strong>
        <small>{task.agent?.name ?? t('op.run.unassigned')} · {task.specialization.replace(/_/g, ' ')}{task.tool ? ` · ${task.tool}` : ''}</small>
        {task.dependsOn.length > 0 && <small>{t('op.run.dependencies')}: {task.dependsOn.length}</small>}
      </span>
      <StatusBadge tone={taskTone(task.status)} dot>{taskStatusLabel(t, task.status)}</StatusBadge>
      <ArrowRight size={15} aria-hidden="true" />
    </button>
  </li>;
}

function ApprovalCard({ approval, busy, onDecide }: { approval: ApprovalRecord; busy: boolean; onDecide: (decision: 'approved' | 'denied') => Promise<void> }) {
  const { t } = useI18n();
  return <div className="op-approval" role="alert">
    <div className="op-approval-head">
      <ShieldAlert size={16} aria-hidden="true" />
      <strong>{t('op.run.approvalNeeded')}</strong>
      <RiskBadge risk={approval.risk} label={`${approval.toolId ?? approval.kind} · ${approval.risk}`} />
    </div>
    <p dir="auto">{approval.actionSummary}</p>
    {approval.target && <p className="op-muted" dir="auto">{approval.target}</p>}
    {approval.consequences && <p className="op-muted" dir="auto">{approval.consequences}</p>}
    {approval.payloadDigest && <small className="op-mono" dir="ltr">{approval.payloadDigest.slice(0, 28)}…</small>}
    <div className="op-actions">
      <Button variant="primary" size="small" icon={Check} loading={busy} onClick={() => void onDecide('approved')}>{t('op.run.approve')}</Button>
      <Button variant="destructive" size="small" icon={X} disabled={busy} onClick={() => void onDecide('denied')}>{t('op.run.deny')}</Button>
    </div>
  </div>;
}

function Inspector({ detail, task, onOpenArtifact }: { detail: MissionDetail; task: OsTask | null; onOpenArtifact: () => void }) {
  const { t, lang } = useI18n();
  if (!task) return <aside className="op-inspector op-panel" aria-label={t('op.run.context')}>
    <div className="op-panel-head"><div><h2>{t('op.run.context')}</h2><p>{t('op.run.selectTask')}</p></div></div>
    <dl className="op-meta-list">
      <div><dt>{t('op.run.missionId')}</dt><dd className="op-mono" dir="ltr">{detail.id}</dd></div>
      <div><dt>{t('op.run.created')}</dt><dd>{formatDate(detail.createdAt, lang)}</dd></div>
      <div><dt>{t('op.run.updated')}</dt><dd>{formatDate(detail.updatedAt, lang)}</dd></div>
      <div><dt>{t('op.run.progress')}</dt><dd>{missionProgress(detail).done}/{missionProgress(detail).total}</dd></div>
      <div><dt>{t('op.run.outcome')}</dt><dd>{detail.outcomeStatus ? outcomeStatusLabel(t, detail.outcomeStatus) : '—'}</dd></div>
    </dl>
    {detail.artifacts.length > 0 && <button type="button" className="op-text-link" onClick={onOpenArtifact}>{t('op.run.artifact')}<ArrowRight size={14} aria-hidden="true" /></button>}
  </aside>;

  return <aside className="op-inspector op-panel" aria-label={t('op.run.inspect')}>
    <div className="op-panel-head">
      <div><h2>{task.title}</h2><p>{task.specialization.replace(/_/g, ' ')}{task.agent ? ` · ${task.agent.name}` : ''}</p></div>
      <StatusBadge tone={taskTone(task.status)} dot>{taskStatusLabel(t, task.status)}</StatusBadge>
    </div>
    <dl className="op-meta-list">
      <div><dt>{t('op.run.tool')}</dt><dd>{task.tool ?? '—'}</dd></div>
      <div><dt>{t('op.run.dependencies')}</dt><dd>{task.dependsOn.length ? task.dependsOn.join(', ') : t('op.run.noDependencies')}</dd></div>
    </dl>
    <section className="op-inspector-section">
      <h3>{t('op.run.objective')}</h3>
      <p dir="auto">{task.objective}</p>
    </section>
    <section className="op-inspector-section">
      <h3>{t('op.run.acceptance')}</h3>
      <ul className="op-list">{task.acceptance.map((item) => <li key={item}><ShieldCheck size={13} aria-hidden="true" />{item}</li>)}</ul>
    </section>
    {task.detail && <section className="op-inspector-section"><h3>{t('op.run.taskDetail')}</h3><p dir="auto">{task.detail}</p></section>}
    <section className="op-inspector-section">
      <h3>{t('op.run.runs')}</h3>
      {task.runs.length === 0 && <p className="op-muted">{t('op.run.noRuns')}</p>}
      {task.runs.map((run) => <div key={run.id} className="op-run-block">
        <strong>#{run.attempt} · {run.status}</strong>
        <p>{run.summary}</p>
        {run.issues.length > 0 && <ul className="op-list op-danger">{run.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
        {run.evidence.map((evidence, index) => <details key={index} className="op-evidence">
          <summary><FileText size={12} aria-hidden="true" />{t('op.run.taskEvidence')} {index + 1} · {String(evidence['tool'] ?? '')}</summary>
          <pre className="op-pre" dir="ltr">{JSON.stringify(evidence, null, 2).slice(0, 5000)}</pre>
        </details>)}
      </div>)}
    </section>
    {task.toolInput && Object.keys(task.toolInput).length > 0 && <section className="op-inspector-section">
      <h3>{t('op.run.toolInput')}</h3>
      <pre className="op-pre" dir="ltr">{JSON.stringify(task.toolInput, null, 2).slice(0, 3000)}</pre>
    </section>}
  </aside>;
}

export function RunZone({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { t, lang } = useI18n();
  const feed = useMissionFeed();
  const [tab, setTab] = useState<RunTab>('plan');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replanReason, setReplanReason] = useState('');
  const [artifact, setArtifact] = useState<{ id: string; name: string; kind: string; content: string } | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<CapabilitySnapshot[] | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem('wora:selectedMission'); } catch { /* private mode */ }
    if (!stored) return;
    if (feed.missions?.some((mission) => mission.id === stored)) {
      feed.selectMission(stored);
      try { sessionStorage.removeItem('wora:selectedMission'); } catch { /* private mode */ }
    }
  }, [feed.missions, feed.selectMission]);

  const detail = feed.detail;
  const tasks = detail?.tasks ?? [];
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null, [tasks, selectedTaskId]);
  const progress = missionProgress(detail);
  const phases = useMemo(() => derivePhases(detail, t), [detail, t]);
  const attention = useMemo(() => attentionItems(detail, t), [detail, t]);
  const activity = useMemo(() => detail ? missionActivity(detail, t) : [], [detail, t]);
  const strategy = detail?.composition?.selectedStrategy ?? detail?.planVersions?.[0]?.strategy ?? null;
  const pendingApproval = detail?.approvals.find((approval) => approval.status === 'pending') ?? null;

  useEffect(() => {
    if (!detail) { setArtifact(null); return; }
    setSelectedTaskId((current) => current && detail.tasks.some((task) => task.id === current) ? current : detail.tasks[0]?.id ?? null);
  }, [detail?.id, detail?.tasks.length]);

  useEffect(() => {
    if (tab !== 'artifact' || !detail?.artifacts.length) { if (tab !== 'artifact') setArtifact(null); return; }
    let cancelled = false;
    setArtifactLoading(true);
    setArtifactError(null);
    void osApi.artifact(detail.artifacts[0]!.id)
      .then((value) => { if (!cancelled) setArtifact(value); })
      .catch((err: unknown) => { if (!cancelled) setArtifactError(err instanceof OsApiError ? err.message : t('op.run.errorAction')); })
      .finally(() => { if (!cancelled) setArtifactLoading(false); });
    return () => { cancelled = true; };
  }, [tab, detail?.id, detail?.artifacts.length, t]);

  useEffect(() => {
    if (tab !== 'context' || !detail) return;
    let cancelled = false;
    setContextLoading(true);
    void extensionsApi.snapshots({ missionId: detail.id })
      .then((rows) => { if (!cancelled) setSnapshots(rows); })
      .catch(() => { if (!cancelled) setSnapshots([]); })
      .finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [tab, detail?.id]);

  const runAction = useCallback(async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await feed.refresh();
      await feed.refreshDetail();
      if (success) setNotice(success);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('op.run.errorAction'));
    } finally {
      setBusy(null);
    }
  }, [feed, t]);

  async function decide(approvalId: string, decision: 'approved' | 'denied') {
    await runAction(`approval-${approvalId}`, () => osApi.decideApproval(approvalId, decision), t('op.run.approvalNeeded'));
  }

  async function replan() {
    if (!detail || replanReason.trim().length < 3) return;
    await runAction('replan', () => osApi.replanMission(detail.id, replanReason.trim()), t('op.run.replanSuccess'));
    setReplanReason('');
  }

  async function downloadArtifact() {
    if (!artifact) return;
    const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = artifact.name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const loadError = feed.error instanceof OsApiError ? feed.error.message : t('op.error');
  const status = detail?.status;

  return <div className="op-zone op-run">
    <header className="op-zone-head">
      <div>
        <p className="op-eyebrow">{t('op.eyebrow')}</p>
        <h1>{t('op.run.title')}</h1>
        <p>{t('op.run.subtitle')}</p>
      </div>
      {detail && <div className="op-zone-state"><span><GitBranch size={14} aria-hidden="true" />{progress.done}/{progress.total} {t('op.run.tasks')}</span></div>}
    </header>

    <div className="op-run-toolbar">
      <label className="op-select"><span>{t('op.run.selectMission')}</span>
        <select value={feed.selectedId ?? ''} onChange={(event) => feed.selectMission(event.target.value)} aria-label={t('op.run.selectMission')}>
          {(feed.missions ?? []).map((mission) => <option key={mission.id} value={mission.id}>{mission.objective.slice(0, 72)}</option>)}
        </select>
      </label>
      <button type="button" className="icon-button" onClick={() => void feed.refresh()} aria-label={t('op.run.refreshAria')} title={t('op.run.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
    </div>

    {feed.loading && !feed.missions && <StateMessage variant="loading" title={t('op.loading')} />}
    {!feed.loading && feed.error !== null && <StateMessage variant="error" title={t('op.error')}><p>{loadError}</p><button type="button" className="button small" onClick={() => void feed.refresh()}>{t('op.retry')}</button></StateMessage>}
    {!feed.loading && !feed.error && !detail && <EmptyState icon={CircleDashed} title={t('op.run.noMission')}><p>{t('op.run.noMissionBody')}</p><button type="button" className="button small" onClick={() => onNavigate('brief')}>{t('op.brief.title')}</button></EmptyState>}

    {detail && <>
      <section className="op-mission-head op-panel" aria-labelledby="op-mission-objective">
        <div className="op-mission-title">
          <StatusBadge tone={missionTone(detail.status)} dot>{missionStatusLabel(t, detail.status)}</StatusBadge>
          <h2 id="op-mission-objective" dir="auto">{detail.objective}</h2>
          <p dir="auto">{detail.summary}</p>
          <div className="op-meta-line">
            <span><Clock size={13} aria-hidden="true" />{t('op.run.created')}: {formatDate(detail.createdAt, lang)}</span>
            <span><Clock size={13} aria-hidden="true" />{t('op.run.updated')}: {formatDate(detail.updatedAt, lang)}</span>
            {strategy && <span><GitBranch size={13} aria-hidden="true" />{t('op.run.strategy')}: <bdi>{strategy}</bdi></span>}
            <span className="op-mono" dir="ltr">{detail.id}</span>
          </div>
        </div>
        <div className="op-mission-actions">
          {(status === 'paused' || status === 'failed' || status === 'awaiting_approval') && <Button variant="ghost" size="small" icon={Play} loading={busy === 'resume'} onClick={() => void runAction('resume', () => osApi.resumeMission(detail.id))}>{t('op.run.resume')}</Button>}
          {(status === 'running' || status === 'planning') && <Button variant="ghost" size="small" icon={Pause} loading={busy === 'pause'} onClick={() => void runAction('pause', () => osApi.pauseMission(detail.id))}>{t('op.run.pause')}</Button>}
          {status !== 'completed' && status !== 'cancelled' && <Button variant="destructive" size="small" icon={Ban} loading={busy === 'cancel'} onClick={() => { if (window.confirm(t('op.run.cancelConfirm'))) void runAction('cancel', () => osApi.cancelMission(detail.id)); }}>{t('op.run.cancel')}</Button>}
          {detail.artifacts.length > 0 && <Button variant="secondary" size="small" icon={Download} onClick={() => setTab('artifact')}>{t('op.run.artifact')}</Button>}
        </div>
        <div className="op-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={fillTemplate(t('op.run.progress'), { done: progress.done, total: progress.total })}>
          <span style={{ inlineSize: `${progress.percent}%` }} />
        </div>
        <p className="op-muted">{fillTemplate(t('op.run.progress'), { done: progress.done, total: progress.total })}</p>
      </section>

      <section className="op-phase-spine" aria-label={t('op.run.phaseTitle')}>
        {phases.map((phase) => <div key={phase.id} className="op-phase" data-state={phase.state}>
          <span className="op-phase-dot" aria-hidden="true" />
          <strong>{phase.label}</strong>
          <small>{t(`op.run.phase${phase.state.charAt(0).toUpperCase()}${phase.state.slice(1)}`)}</small>
          {phase.detail && <small className="op-phase-detail" dir="auto">{phase.detail}</small>}
        </div>)}
      </section>

      {attention.length > 0 && <section className="op-attention" aria-live="polite">
        <div className="op-attention-head"><ShieldAlert size={16} aria-hidden="true" /><strong>{t('op.run.attention')}</strong><span>{attention.length}</span></div>
        {attention.slice(0, 3).map((item) => item.approval
          ? <ApprovalCard key={item.id} approval={item.approval} busy={busy === `approval-${item.approval.id}`} onDecide={(decision) => decide(item.approval!.id, decision)} />
          : <div key={item.id} className="op-attention-row" data-tone={item.tone}>
            <CircleAlert size={15} aria-hidden="true" /><div><strong>{item.title}</strong><p>{item.detail}</p></div>
            {item.task && <button type="button" className="button small ghost" onClick={() => setSelectedTaskId(item.task!.id)}>{t('op.run.inspect')}</button>}
          </div>)}
      </section>}
      <p className="op-next"><strong>{t('op.run.next')}:</strong> {nextAction(detail, t)}</p>

      {error && <div className="op-alert" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</div>}
      {notice && <div className="op-notice" role="status"><ShieldCheck size={15} aria-hidden="true" />{notice}</div>}

      <div className="op-tabs" role="tablist" aria-label={t('op.run.title')}>
        {(['plan', 'activity', 'evidence', 'artifact', 'context'] as const).map((entry) => <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={`op-tab${tab === entry ? ' is-active' : ''}`} onClick={() => setTab(entry)}>
          {entry === 'plan' && <GitBranch size={15} aria-hidden="true" />}
          {entry === 'activity' && <Activity size={15} aria-hidden="true" />}
          {entry === 'evidence' && <ShieldCheck size={15} aria-hidden="true" />}
          {entry === 'artifact' && <FileText size={15} aria-hidden="true" />}
          {entry === 'context' && <Bot size={15} aria-hidden="true" />}
          {t(`op.run.${entry}`)}
        </button>)}
      </div>

      <div className="op-run-grid">
        <section className="op-run-main op-panel" aria-label={t(`op.run.${tab}`)}>
          {tab === 'plan' && <>
            <div className="op-panel-head"><div><h2>{t('op.run.plan')}</h2><p>{tasks.length} · {t('op.run.tasks')}</p></div></div>
            {tasks.length === 0 && <p className="op-muted">{t('op.run.noTasks')}</p>}
            {tasks.length > 0 && <ol className="op-task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} selected={selectedTask?.id === task.id} onSelect={() => setSelectedTaskId(task.id)} />)}</ol>}
            <div className="op-replan">
              <h3>{t('op.run.replan')}</h3><p>{t('op.run.replanHint')}</p>
              <div className="op-inline-form">
                <input value={replanReason} onChange={(event) => setReplanReason(event.target.value)} placeholder={t('op.run.replanReason')} aria-label={t('op.run.replanReason')} maxLength={500} />
                <Button size="small" icon={GitBranch} loading={busy === 'replan'} disabled={replanReason.trim().length < 3} onClick={() => void replan()}>{t('op.run.replanSubmit')}</Button>
              </div>
            </div>
          </>}

          {tab === 'activity' && <>
            <div className="op-panel-head"><div><h2>{t('op.run.activity')}</h2><p>{activity.length} events</p></div></div>
            {activity.length === 0 && <p className="op-muted">{t('op.run.noActivity')}</p>}
            <ol className="op-timeline">{activity.map((event) => <li key={event.id} data-tone={event.tone}>
              <span className="op-timeline-dot" aria-hidden="true" /><div><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.at}>{formatDate(event.at, lang)}</time></div>
            </li>)}</ol>
          </>}

          {tab === 'evidence' && <EvidenceView detail={detail} />}

          {tab === 'artifact' && <>
            <div className="op-panel-head"><div><h2>{t('op.run.artifact')}</h2><p>{detail.artifacts.length} {t('op.library.artifactsCount')}</p></div>{artifact && <Button size="small" icon={Download} onClick={() => void downloadArtifact()}>{t('op.run.download')}</Button>}</div>
            {detail.artifacts.length === 0 && <p className="op-muted">{t('op.run.noArtifact')}</p>}
            {detail.artifacts.length > 0 && <ul className="op-artifact-list">{detail.artifacts.map((entry) => <li key={entry.id}><FileText size={15} aria-hidden="true" /><span><strong>{entry.name}</strong><small>{entry.kind}</small></span><span className="op-chip">{entry.id}</span></li>)}</ul>}
            {artifactLoading && <StateMessage variant="loading" title={t('op.run.loadingArtifact')} />}
            {artifactError && <StateMessage variant="error" title={t('op.run.artifact')}><p>{artifactError}</p></StateMessage>}
            {artifact && <section className="op-artifact-preview"><h3>{t('op.run.artifactPreview')}</h3><pre dir="ltr">{artifact.content.slice(0, 20000)}</pre></section>}
          </>}

          {tab === 'context' && <ContextView detail={detail} snapshots={snapshots} loading={contextLoading} />}
        </section>
        <Inspector detail={detail} task={selectedTask} onOpenArtifact={() => setTab('artifact')} />
      </div>
    </>}
  </div>;
}

function EvidenceView({ detail }: { detail: MissionDetail }) {
  const { t, lang } = useI18n();
  const checks = detail.outcomeVerification?.checks ?? [];
  return <>
    <div className="op-panel-head"><div><h2>{t('op.run.evidence')}</h2><p>{t('op.run.outcome')}: {detail.outcomeStatus ? outcomeStatusLabel(t, detail.outcomeStatus) : '—'}</p></div></div>
    {checks.length === 0 && detail.verifications?.length === 0 && <p className="op-muted">{t('op.run.noEvidence')}</p>}
    {checks.length > 0 && <section className="op-evidence-section"><h3>{t('op.run.evidenceChecks')}</h3><ul className="op-check-list">{checks.map((check) => <li key={check.id} data-status={check.status}><span className="op-check-icon">{check.status === 'passed' ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}</span><div><strong>{check.description}</strong><small>{check.kind} · {check.evidence}</small></div></li>)}</ul></section>}
    {detail.outcomeVerification && <section className="op-evidence-section"><h3>{t('op.run.outcome')}</h3><p>{outcomeStatusLabel(t, detail.outcomeStatus ?? detail.outcomeVerification.status)}</p>{detail.outcomeVerification.reasons.map((reason) => <p key={reason} className="op-muted">{reason}</p>)}</section>}
    {detail.verifications && detail.verifications.length > 0 && <section className="op-evidence-section"><h3>{t('op.run.verification')}</h3><ul className="op-verification-list">{detail.verifications.map((record) => <li key={record.id}><StatusBadge tone={record.result === 'passed' ? 'success' : 'danger'} dot>{record.result}</StatusBadge><div><strong>{record.verifier}</strong><small>{record.independence} · {formatDate(record.createdAt, lang)}</small>{record.checks.map((check) => <small key={check.id}>{check.description}: {check.status}</small>)}</div></li>)}</ul></section>}
    <section className="op-evidence-section"><h3>{t('op.run.taskEvidence')}</h3>{detail.tasks.flatMap((task) => task.runs.flatMap((run) => run.evidence.map((evidence, index) => ({ task, run, evidence, index })))).map(({ task, run, evidence, index }) => <details key={`${run.id}-${index}`} className="op-evidence"><summary><FileText size={12} aria-hidden="true" />{task.title} · #{run.attempt} · {String(evidence['tool'] ?? '')}</summary><pre className="op-pre" dir="ltr">{JSON.stringify(evidence, null, 2).slice(0, 5000)}</pre></details>)}</section>
  </>;
}

function ContextView({ detail, snapshots, loading }: { detail: MissionDetail; snapshots: CapabilitySnapshot[] | null; loading: boolean }) {
  const { t } = useI18n();
  return <>
    <div className="op-panel-head"><div><h2>{t('op.run.context')}</h2><p>{t('op.run.reasoning')}</p></div></div>
    {detail.problemProfile && <section className="op-context-section"><h3>{t('op.run.reasoning')}</h3><p><strong>{detail.problemProfile.domain}</strong> · {Math.round(detail.problemProfile.confidence * 100)}%</p><p className="op-muted">{detail.problemProfile.algorithmSelection.primary?.name ?? t('op.capabilities.notExposed')}</p>{detail.problemProfile.missingInformation.length > 0 && <p className="op-muted">{detail.problemProfile.missingInformation.join(' · ')}</p>}</section>}
    {detail.reasoning && <section className="op-context-section"><h3>{t('op.run.reasoning')}</h3><p>{detail.reasoning.problemType} · {detail.reasoning.mode} · {Math.round(detail.reasoning.confidence.value * 100)}%</p><p dir="auto">{detail.reasoning.desiredOutcome}</p>{detail.reasoning.limitations.slice(0, 3).map((item) => <p key={item} className="op-muted">{item}</p>)}</section>}
    {detail.composition && <section className="op-context-section"><h3>{t('op.run.composition')}</h3><p>{detail.composition.explanation}</p><ul className="op-list">{detail.composition.graph.nodes.map((node) => <li key={node.id}><GitBranch size={13} aria-hidden="true" /><span><strong>{node.title}</strong><small>{node.role} · {node.tool} · {node.available ? t('op.capabilities.available') : t('op.capabilities.unavailable')}</small></span></li>)}</ul></section>}
    <section className="op-context-section"><h3>{t('op.run.snapshot')}</h3>{loading && <StateMessage variant="loading" title={t('op.loading')} />}{!loading && (!snapshots || snapshots.length === 0) && <p className="op-muted">{t('op.run.noContext')}</p>}{snapshots && snapshots.map((snapshot) => <div key={snapshot.id} className="op-snapshot"><strong>{snapshot.agentId}</strong><small>{snapshot.digest} · {snapshot.createdAt}</small></div>)}</section>
    {!detail.problemProfile && !detail.reasoning && !detail.composition && <p className="op-muted">{t('op.run.noContext')}</p>}
  </>;
}
