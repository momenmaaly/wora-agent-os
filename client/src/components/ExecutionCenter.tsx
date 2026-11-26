import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRight, Ban, Bot, CheckCircle2, ChevronDown, ChevronLeft, Circle, CircleAlert,
  Check, Download, FileText, FlaskConical, GitBranch, LoaderCircle, Network, Pause, Play, RefreshCw, Rocket, ScrollText, ShieldAlert, ShieldCheck, Wrench, X, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { OsApiError, osApi, type ApprovalRecord, type MissionDetail, type MissionSummary, type OsTask, type TaskLease, type VerificationRecord } from '../os/api.js';
import { useI18n } from '../i18n/I18nContext.js';
import { Button, RiskBadge, StateMessage, StatusBadge } from './ui.js';

type Translate = (path: string) => string;

const STATUS_KEY: Record<MissionSummary['status'], string> = {
  planning: 'statusPlanning', running: 'statusRunning', paused: 'statusPaused', awaiting_approval: 'statusAwaitingApproval',
  completed: 'statusCompleted', failed: 'statusFailed', cancelled: 'statusCancelled',
};
const TASK_STATUS_KEY: Record<OsTask['status'], string> = {
  created: 'taskCreated', planned: 'taskPlanned', assigned: 'taskAssigned', running: 'taskRunning', reviewing: 'taskReviewing',
  completed: 'taskCompleted', failed: 'taskFailed', blocked: 'taskBlocked', cancelled: 'taskCancelled',
};
const TASK_ICON: Record<OsTask['status'], typeof CheckCircle2> = {
  created: Circle, planned: Circle, assigned: Circle, running: LoaderCircle, reviewing: LoaderCircle,
  completed: CheckCircle2, failed: XCircle, blocked: CircleAlert, cancelled: Ban,
};

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function relTime(iso: string, t: Translate): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return t('execution.relNow');
  if (diff < 3_600_000) return fill(t('execution.relMinutes'), { n: Math.max(1, Math.floor(diff / 60_000)) });
  if (diff < 86_400_000) return fill(t('execution.relHours'), { n: Math.floor(diff / 3_600_000) });
  return fill(t('execution.relDays'), { n: Math.floor(diff / 86_400_000) });
}

function riskLabel(t: Translate, risk: string): string {
  if (risk === 'high') return t('execution.riskHigh');
  if (risk === 'medium') return t('execution.riskMedium');
  if (risk === 'low') return t('execution.riskLow');
  return risk;
}

function approvalStatusLabel(t: Translate, status: string): string {
  if (status === 'approved') return t('execution.approvalApproved');
  if (status === 'denied') return t('execution.approvalDenied');
  if (status === 'expired') return t('execution.approvalExpired');
  return t('execution.approvalPending');
}

function verificationResultLabel(t: Translate, result: string): string {
  if (result === 'passed') return t('execution.verificationPassed');
  if (result === 'failed') return t('execution.verificationFailed');
  if (result === 'inconclusive') return t('execution.verificationInconclusive');
  return result || t('execution.verificationUnknown');
}

function outcomeStatusLabel(t: Translate, status: string): string {
  if (status === 'verified') return t('execution.outcomeVerified');
  if (status === 'failed') return t('execution.outcomeFailed');
  if (status === 'unverified') return t('execution.outcomeUnverified');
  if (status === 'requires_human_review') return t('execution.outcomeRequiresReview');
  if (status === 'pending') return t('execution.outcomePending');
  if (status === 'blocked') return t('execution.outcomeBlocked');
  return status || t('execution.outcomeUnknown');
}

function missionTone(status: MissionSummary['status']) {
  if (status === 'completed') return 'success' as const;
  if (status === 'failed' || status === 'cancelled') return 'danger' as const;
  if (status === 'awaiting_approval') return 'warning' as const;
  if (status === 'running' || status === 'planning') return 'brand' as const;
  return 'neutral' as const;
}

function StatusPill({ status }: { status: MissionSummary['status'] }) {
  const { t } = useI18n();
  return <StatusBadge tone={missionTone(status)} dot>{t(`execution.${STATUS_KEY[status]}`)}</StatusBadge>;
}

function TaskRow({ task }: { task: OsTask }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const Icon = TASK_ICON[task.status];
  return (
    <div className={`os-task os-task-${task.status}`}>
      <button type="button" className="os-task-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon size={17} className={task.status === 'running' ? 'os-spin' : undefined} aria-hidden="true" />
        <span className="os-task-title">{task.title}
          <small>{task.specialization.replace(/_/g, ' ')}{task.agent ? ` · ${task.agent.name}` : ''}{task.tool ? ` · ${task.tool}` : ''}</small>
        </span>
        <span className={`os-pill os-pill-task-${task.status}`}>{t(`execution.${TASK_STATUS_KEY[task.status]}`)}</span>
        {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
      </button>
      {open && <div className="os-task-body">
        <p className="os-task-detail">{task.detail}</p>
        <div className="os-columns">
          <div>
            <h4>{t('execution.acceptanceCriteria')}</h4>
            <ul className="os-acceptance">{task.acceptance.map((a) => <li key={a}><ShieldCheck size={13} aria-hidden="true" />{a}</li>)}</ul>
          </div>
          <div>
            <h4>{t('execution.toolInput')}</h4>
            <pre className="os-pre">{JSON.stringify(task.toolInput, null, 2).slice(0, 2500)}</pre>
          </div>
        </div>
        {task.runs.map((run) => (
          <div key={run.id} className="os-run">
            <div className="os-run-head">
              <strong>{fill(t('execution.attempt'), { n: run.attempt })}</strong>
              <span>{run.summary}</span>
              <small className="subtle">{run.finishedAt ? relTime(run.finishedAt, t) : ''}</small>
            </div>
            {run.issues.length > 0 && <ul className="os-issues">{run.issues.map((i) => <li key={i}><CircleAlert size={12} aria-hidden="true" />{i}</li>)}</ul>}
            {run.evidence.map((ev, index) => (
              <details key={index} className="os-evidence">
                <summary><FileText size={12} aria-hidden="true" /> {fill(t('execution.evidence'), { n: index + 1 })} — {String(ev['tool'] ?? '')} {ev['ok'] === false ? t('execution.evidenceFailed') : t('execution.evidenceSuccess')}</summary>
                <pre className="os-pre">{JSON.stringify(ev, null, 2).slice(0, 6000)}</pre>
              </details>
            ))}
          </div>
        ))}
      </div>}
    </div>
  );
}

function PendingApproval({ approval, onDecide }: { approval: ApprovalRecord; onDecide: (id: string, decision: 'approved' | 'denied') => Promise<void> }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approved' | 'denied') => {
    if (busy) return;
    setBusy(true);
    try { await onDecide(approval.id, decision); } finally { setBusy(false); }
  };
  return (
    <div className="os-approval" role="alert">
      <div className="os-approval-head">
        <ShieldAlert size={16} aria-hidden="true" />
        <strong>{t('execution.awaitingApproval')}</strong>
        <RiskBadge risk={approval.risk} label={`${approval.toolId ?? approval.kind} · ${riskLabel(t, approval.risk)}`} />
      </div>
      <p dir="auto">{approval.actionSummary}</p>
      <dl className="os-approval-review">
        {approval.target && <><dt>{t('execution.target')}</dt><dd dir="auto">{approval.target}</dd></>}
        {approval.consequences && <><dt>{t('execution.impact')}</dt><dd dir="auto">{approval.consequences}</dd></>}
        {approval.resourceImpact && <><dt>{t('execution.resources')}</dt><dd dir="auto">{approval.resourceImpact}</dd></>}
      </dl>
      <div className="os-detail-meta">
        {approval.actionClass && <span className="os-risk-chip">{fill(t('execution.classLabel'), { value: approval.actionClass })}</span>}
        {approval.amountUsd != null && <span className="os-risk-chip">{fill(t('execution.amountLabel'), { value: approval.amountUsd })}</span>}
        {approval.expiresAt && <small className="subtle">{fill(t('execution.expires'), { value: new Date(approval.expiresAt).toLocaleString(lang) })}</small>}
      </div>
      {approval.scope && <small className="subtle mono" dir="ltr">{approval.scope}</small>}
      {approval.payloadDigest && <small className="subtle mono" dir="ltr">{t('execution.digestLabel')} {approval.payloadDigest.slice(0, 24)}…</small>}
      {approval.reviewDigest && <small className="subtle mono" dir="ltr">{t('execution.reviewLabel')} {approval.reviewDigest.slice(0, 24)}…</small>}
      <details>
        <summary>{t('execution.exactPayload')}</summary>
        <pre className="os-pre">{JSON.stringify(approval.toolInput, null, 2).slice(0, 2500)}</pre>
      </details>
      <div className="os-approval-actions">
        <Button variant="primary" size="small" loading={busy} icon={Check} onClick={() => void decide('approved')}>{t('execution.approveExecute')}</Button>
        <Button variant="destructive" size="small" icon={X} disabled={busy} onClick={() => void decide('denied')}>{t('execution.reject')}</Button>
      </div>
    </div>
  );
}

type ActivityTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
interface MissionActivityEvent {
  id: string;
  at: string;
  title: string;
  detail?: string;
  tone: ActivityTone;
  icon: LucideIcon;
}

function buildMissionActivity(detail: MissionDetail, t: Translate): MissionActivityEvent[] {
  const events: MissionActivityEvent[] = [];
  for (const task of detail.tasks) {
    events.push({
      id: `task-${task.id}`,
      at: task.createdAt,
      title: fill(t('execution.activityTask'), { title: task.title }),
      detail: `${task.specialization}${task.agent ? ` · ${task.agent.name}` : ''}`,
      tone: 'neutral',
      icon: Circle,
    });
    for (const run of task.runs) {
      const tone: ActivityTone = run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'brand';
      events.push({
        id: `run-${run.id}`,
        at: run.finishedAt ?? run.startedAt,
        title: fill(t('execution.activityAttempt'), { n: run.attempt, summary: run.summary || task.title }),
        detail: fill(t('execution.activityEvidence'), { n: run.evidence.length, tool: task.tool ?? t('execution.noTool') }),
        tone,
        icon: run.status === 'completed' ? CheckCircle2 : run.status === 'failed' ? XCircle : LoaderCircle,
      });
    }
  }
  for (const handoff of detail.handoffs) {
    events.push({
      id: `handoff-${handoff.id}`,
      at: handoff.createdAt,
      title: fill(t('execution.handoff'), { from: handoff.from, to: handoff.to }),
      detail: t('execution.handoffContract'),
      tone: 'brand',
      icon: GitBranch,
    });
  }
  for (const approval of detail.approvals) {
    const tone: ActivityTone = approval.status === 'approved' ? 'success' : approval.status === 'denied' ? 'danger' : 'warning';
    events.push({
      id: `approval-${approval.id}`,
      at: approval.decidedAt ?? approval.createdAt,
      title: fill(t('execution.activityApproval'), { summary: approval.actionSummary }),
      detail: `${riskLabel(t, approval.risk)} · ${approvalStatusLabel(t, approval.status)}`,
      tone,
      icon: ShieldAlert,
    });
  }
  for (const verification of detail.verifications ?? []) {
    events.push({
      id: `verification-${verification.id}`,
      at: verification.createdAt,
      title: fill(t('execution.activityVerification'), { result: verificationResultLabel(t, verification.result) }),
      detail: `${verification.verifier} · ${verification.independence}`,
      tone: verification.result === 'passed' ? 'success' : 'danger',
      icon: ShieldCheck,
    });
  }
  if (detail.outcomeVerification) {
    events.push({
      id: 'outcome',
      at: detail.outcomeVerification.generatedAt,
      title: fill(t('execution.activityOutcome'), { status: outcomeStatusLabel(t, detail.outcomeStatus ?? detail.outcomeVerification.status) }),
      detail: detail.outcomeVerification.reasons.slice(0, 2).join(' · ') || t('execution.activityFinal'),
      tone: detail.outcomeVerification.status === 'verified' ? 'success' : detail.outcomeVerification.status === 'failed' ? 'danger' : 'warning',
      icon: FlaskConical,
    });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

function MissionActivity({ detail }: { detail: MissionDetail }) {
  const { t, lang } = useI18n();
  const events = useMemo(() => buildMissionActivity(detail, t), [detail, t]);
  if (events.length === 0) return null;
  return <details className="os-handoffs mission-activity" open>
    <summary><Activity size={14} aria-hidden="true" /> {fill(t('execution.activityLog'), { n: events.length })}</summary>
    <ol className="activity-timeline" aria-label={t('execution.activityAria')}>
      {events.map((event) => {
        const Icon = event.icon;
        return <li className="activity-item" data-tone={event.tone} key={event.id}>
          <span className="activity-marker"><Icon size={12} aria-hidden="true" /></span>
          <div className="activity-copy">
            <strong>{event.title}</strong>
            {event.detail && <small>{event.detail}</small>}
            <time dateTime={event.at}>{new Date(event.at).toLocaleString(lang)}</time>
          </div>
        </li>;
      })}
    </ol>
  </details>;
}

export function ExecutionCenter() {
  const { t, lang } = useI18n();
  const listSeparator = lang === 'ar' ? '\u060C ' : ', ';
  const clauseSeparator = lang === 'ar' ? '\u061B ' : '; ';
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leases, setLeases] = useState<TaskLease[]>([]);
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [replanReason, setReplanReason] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [composite, setComposite] = useState(false);

  const refreshMissions = useCallback(async () => {
    try {
      const list = await osApi.missions();
      setMissions(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('execution.errorConnection'));
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const [mission, leaseList, verificationList] = await Promise.all([
        osApi.mission(id), osApi.missionLeases(id), osApi.missionVerifications(id),
      ]);
      setDetail(mission);
      setLeases(leaseList);
      setVerifications(verificationList);
    } catch { /* transient poll failure */ }
  }, []);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('wora:os:launchError');
      if (pending) { setError(pending); sessionStorage.removeItem('wora:os:launchError'); }
    } catch { /* ignore */ }
    void refreshMissions();
  }, [refreshMissions]);
  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    else setDetail(null);
  }, [selectedId, refreshDetail]);

  const anyRunning = (missions ?? []).some((m) => m.status === 'planning' || m.status === 'running' || m.status === 'awaiting_approval') || detail?.status === 'running' || detail?.status === 'planning' || detail?.status === 'awaiting_approval';
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => {
      void refreshMissions();
      if (selectedId) void refreshDetail(selectedId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [anyRunning, refreshMissions, refreshDetail, selectedId]);

  async function launch(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await osApi.launchMission(trimmed, composite ? 'composite' : undefined);
      setObjective('');
      setSelectedId(created.id);
      setDetail(created);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('execution.errorLaunch'));
    } finally {
      setBusy(false);
    }
  }

  async function resumeMission() {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      const updated = await osApi.resumeMission(selectedId);
      setDetail(updated);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('execution.errorResume'));
    } finally {
      setBusy(false);
    }
  }

  async function pauseMission() {
    if (!selectedId || busy) return;
    setBusy(true);
    try { setDetail(await osApi.pauseMission(selectedId)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : t('execution.errorPause')); }
    finally { setBusy(false); }
  }

  async function cancelMission() {
    if (!selectedId || busy || !window.confirm(t('execution.errorCancelConfirm'))) return;
    setBusy(true);
    try { setDetail(await osApi.cancelMission(selectedId)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : t('execution.errorCancel')); }
    finally { setBusy(false); }
  }

  async function executeParallel() {
    if (!selectedId || busy) return;
    setBusy(true);
    try { setDetail(await osApi.executeMission(selectedId, concurrency)); await refreshMissions(); }
    catch (err) { setError(err instanceof OsApiError ? err.message : t('execution.errorExecute')); }
    finally { setBusy(false); }
  }

  async function replan() {
    if (!selectedId || busy || replanReason.trim().length < 3) return;
    setBusy(true);
    try { await osApi.replanMission(selectedId, replanReason.trim()); setReplanReason(''); await refreshDetail(selectedId); }
    catch (err) { setError(err instanceof OsApiError ? err.message : t('execution.errorReplan')); }
    finally { setBusy(false); }
  }

  async function decideApproval(approvalId: string, decision: 'approved' | 'denied') {
    try {
      await osApi.decideApproval(approvalId, decision);
      if (selectedId) await refreshDetail(selectedId);
      await refreshMissions();
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('execution.errorDecision'));
    }
  }

  async function downloadArtifact(artifactId: string) {
    try {
      const artifact = await osApi.artifact(artifactId);
      const blob = new Blob([artifact.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.name;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof OsApiError ? err.message : t('execution.errorArtifact'));
    }
  }

  const selected = missions?.find((m) => m.id === selectedId) ?? null;
  const taskProgress = useMemo(() => {
    if (!detail) return null;
    const done = detail.tasks.filter((t) => t.status === 'completed').length;
    return { done, total: detail.tasks.length };
  }, [detail]);

  return (
    <div className="os-page">
      <header className="os-page-head">
        <div>
          <h1><Rocket size={20} aria-hidden="true" /> {t('execution.title')}</h1>
          <p className="subtle">{t('execution.subtitle')}</p>
        </div>
        <button type="button" className="button ghost small" onClick={() => void refreshMissions()} aria-label={t('execution.refreshAria')}>
          <RefreshCw size={15} aria-hidden="true" /> {t('execution.refresh')}
        </button>
      </header>

      {error && <div role="alert" className="os-alert"><CircleAlert size={16} aria-hidden="true" />{error}</div>}

      <form className="os-launch" onSubmit={(event) => { event.preventDefault(); void launch(objective); }}>
        <span className="os-launch-icon" aria-hidden="true"><Bot size={20} strokeWidth={1.8} /></span>
        <input
          type="text" dir="auto" maxLength={4000} value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder={t('execution.launchPlaceholder')}
          aria-label={t('execution.launchAria')} disabled={busy}
        />
        <label className="os-inline-control" title={t('execution.compositeTitle')}>
          <input type="checkbox" checked={composite} onChange={(event) => setComposite(event.target.checked)} disabled={busy} />
          {t('execution.composite')}
        </label>
        <button type="submit" className="button primary" disabled={busy || !objective.trim()}>
          {busy ? <LoaderCircle size={16} className="os-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} {t('execution.run')}
        </button>
      </form>
      <div className="os-examples" aria-label={t('execution.examplesAria')}>
        {[t('execution.example1'), t('execution.example2'), t('execution.example3'), t('execution.example4'), t('execution.example5')].map((example) => (
          <button key={example} type="button" className="os-chip" onClick={() => void launch(example)} disabled={busy} dir="auto">{example}</button>
        ))}
      </div>

      <div className="os-exec-layout">
        <aside className="os-mission-list panel" aria-label={t('execution.missionsAria')}>
          <h2>{t('execution.missionsTitle')}</h2>
          {missions === null && <StateMessage variant="loading" title={t('execution.missionsLoading')} />}
          {missions?.length === 0 && (
            <StateMessage variant="empty" icon={FlaskConical} title={t('execution.missionsEmptyTitle')}>
              {t('execution.missionsEmptyBody')}
            </StateMessage>
          )}
          {missions?.map((mission) => (
            <button key={mission.id} type="button" className={`os-mission-item${mission.id === selectedId ? ' is-active' : ''}`} onClick={() => setSelectedId(mission.id)} aria-pressed={mission.id === selectedId}>
              <span className="os-mission-objective" dir="auto">{mission.objective}</span>
              <span className="os-mission-meta"><StatusPill status={mission.status} /><small className="subtle">{relTime(mission.updatedAt, t)}</small></span>
            </button>
          ))}
        </aside>

        <section className="os-mission-detail panel" aria-label={t('execution.detailAria')}>
          {!selected && <StateMessage variant="empty" icon={ArrowRight} title={t('execution.selectMissionTitle')}>{t('execution.selectMissionBody')}</StateMessage>}
          {selected && detail && (
            <>
              <div className="os-detail-head">
                <h2 dir="auto">{detail.objective}</h2>
                <div className="os-detail-meta">
                  <StatusPill status={detail.status} />
                  {(detail.status === 'failed' || detail.status === 'awaiting_approval' || detail.status === 'planning' || detail.status === 'paused') && (
                    <Button variant="ghost" size="small" icon={Play} onClick={() => void resumeMission()} disabled={busy}>{t('execution.resume')}</Button>
                  )}
                  {(detail.status === 'running' || detail.status === 'planning' || detail.status === 'awaiting_approval') && (
                    <Button variant="ghost" size="small" icon={Pause} onClick={() => void pauseMission()} disabled={busy}>{t('execution.pause')}</Button>
                  )}
                  {detail.status !== 'completed' && detail.status !== 'cancelled' && (
                    <Button variant="destructive" size="small" icon={Ban} onClick={() => void cancelMission()} disabled={busy}>{t('execution.cancel')}</Button>
                  )}
                  <label className="os-inline-control">
                    <Network size={12} aria-hidden="true" />
                    <select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} aria-label={t('execution.concurrencyAria')} disabled={busy}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <Button variant="ghost" size="small" icon={Play} onClick={() => void executeParallel()} disabled={busy}>{t('execution.runParallel')}</Button>
                  </label>
                  {taskProgress && <span className="subtle">{taskProgress.done}/{taskProgress.total} {t('execution.completedTasks')}</span>}
                  <small className="subtle mono">{detail.id}</small>
                </div>
                {detail.summary && <p className="subtle">{detail.summary}</p>}
                {detail.artifacts.length > 0 && (
                  <div className="os-artifacts">
                    {detail.artifacts.map((artifact) => (
                      <button key={artifact.id} type="button" className="button small" onClick={() => void downloadArtifact(artifact.id)}>
                        <Download size={13} aria-hidden="true" /> {artifact.name}
                      </button>
                    ))}
                  </div>
                )}
                {(detail.approvals ?? []).filter((a) => a.status === 'pending').map((approval) => (
                  <PendingApproval key={approval.id} approval={approval} onDecide={decideApproval} />
                ))}
                <MissionActivity detail={detail} />
              </div>
              <ol className="os-task-list">
                {detail.tasks.map((task) => <li key={task.id}><TaskRow task={task} /></li>)}
              </ol>

              {detail.problemProfile && (
                <details className="os-handoffs" open>
                  <summary><GitBranch size={14} aria-hidden="true" /> {t('execution.problemProfileTitle')}</summary>
                  <div className="os-columns">
                    <div>
                      <p><strong>{t('execution.domainLabel')}</strong> {detail.problemProfile.domain} · <strong>{t('execution.confidenceLabel')}</strong> {Math.round(detail.problemProfile.confidence * 100)}%</p>
                      <p><strong>{t('execution.algorithmLabel')}</strong> {detail.problemProfile.algorithmSelection.primary?.name ?? t('execution.undetermined')} ({detail.problemProfile.algorithmSelection.primary?.toolId ?? '—'})</p>
                      <p className="subtle">{detail.problemProfile.algorithmSelection.primary?.guarantee ?? detail.problemProfile.algorithmSelection.rationale.join(' ')}</p>
                    </div>
                    <div>
                      <h4>{t('execution.constraintsTitle')}</h4>
                      <ul className="os-acceptance">{detail.problemProfile.constraints.map((item) => <li key={item}>{item}</li>)}</ul>
                      <h4>{t('execution.missingInfoTitle')}</h4>
                      <ul className="os-acceptance">{detail.problemProfile.missingInformation.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </details>
              )}

              {detail.problemModel && (
                <details className="os-handoffs" open>
                  <summary><FlaskConical size={14} aria-hidden="true" /> {t('execution.problemModelTitle')}</summary>
                  <div className="os-columns">
                    <div>
                      <p><strong>{t('execution.domainLabel')}</strong> {detail.problemModel.domain} · <strong>{t('execution.goalLabel')}</strong> {detail.problemModel.desiredOutcome}</p>
                      <p><strong>{t('execution.confidenceLabel')}</strong> {Math.round(detail.problemModel.confidence * 100)}% · <strong>{t('execution.riskLabel')}</strong> {riskLabel(t, detail.problemModel.risk)} · <strong>{t('execution.reversibilityLabel')}</strong> {detail.problemModel.reversibility}</p>
                      <p><strong>{t('execution.needsLabel')}</strong> {detail.problemModel.needs.join(listSeparator) || '—'}</p>
                      <h4>{t('execution.factsTitle')}</h4>
                      <ul className="os-acceptance">{detail.problemModel.facts.map((fact) => <li key={fact.id}><span className="subtle">[{fact.provenance}]</span> {fact.statement}</li>)}</ul>
                      {detail.problemModel.evidence.length > 0 && <><h4>{t('execution.retrievedEvidenceTitle')}</h4><ul className="os-acceptance">{detail.problemModel.evidence.map((item) => <li key={item.id}>{item.statement} <span className="subtle">({item.source})</span></li>)}</ul></>}
                    </div>
                    <div>
                      <h4>{t('execution.assumptionsTitle')}</h4>
                      <ul className="os-acceptance">{detail.problemModel.assumptions.map((item) => <li key={item.id}>{item.statement}</li>)}</ul>
                      <h4>{t('execution.missingInfoTitle')}</h4>
                      {detail.problemModel.unknowns.length ? <ul className="os-acceptance">{detail.problemModel.unknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">{t('execution.noUnknowns')}</p>}
                      <h4>{t('execution.methodTitle')}</h4>
                      <p>{detail.problemModel.methods.selected ? `${detail.problemModel.methods.selected.name} (${detail.problemModel.methods.selected.toolId ?? '—'})` : t('execution.noExecutableMethod')}</p>
                      {detail.problemModel.methods.rejected.length > 0 && <ul className="os-acceptance">{detail.problemModel.methods.rejected.map((item) => <li key={item.name}>{item.name}: {item.reason}</li>)}</ul>}
                    </div>
                  </div>
                </details>
              )}

              {detail.reasoning && (
                <details className="os-handoffs" open>
                  <summary><FlaskConical size={14} aria-hidden="true" /> {t('execution.reasoningTitle')}</summary>
                  <p>
                    <strong>{t('execution.modeLabel')}</strong> {detail.reasoning.mode === 'model-assisted' ? t('execution.modeModel') : detail.reasoning.mode === 'deterministic-fallback' ? t('execution.modeFallback') : t('execution.modeDeterministic')}
                    {' · '}<strong>{t('execution.versionLabel')}</strong> {detail.reasoning.version}
                    {' · '}<strong>{t('execution.problemTypeLabel')}</strong> {detail.reasoning.problemType}
                    {' · '}<strong>{t('execution.confidenceLabel')}</strong> {Math.round(detail.reasoning.confidence.value * 100)}% ({detail.reasoning.confidence.kind})
                  </p>
                  <p><strong>{t('execution.desiredOutcomeLabel')}</strong> {detail.reasoning.desiredOutcome}</p>
                  {detail.reasoning.problemStructure?.forecasting && (
                    <div className="os-subpanel" aria-label={t('execution.problemStructureLabel')}>
                      <p><strong>{t('execution.problemStructureLabel')}</strong> {t('execution.forecastingLabel')} · {t('execution.targetVariableLabel')} <span dir="ltr">{detail.reasoning.problemStructure.forecasting.targetVariable ?? t('execution.unspecified')}</span> · {t('execution.horizonLabel')} <span dir="ltr">{detail.reasoning.problemStructure.forecasting.horizon?.steps ?? t('execution.unspecified')}</span> {detail.reasoning.problemStructure.forecasting.horizon?.unit ?? ''} · {t('execution.observationsLabel')} <span dir="ltr">{detail.reasoning.problemStructure.forecasting.observations.length}</span></p>
                      <p className={detail.reasoning.problemStructure.forecasting.canExecute ? 'subtle' : 'os-warning'}>
                        {detail.reasoning.problemStructure.forecasting.canExecute ? t('execution.canExecute') : fill(t('execution.cannotExecute'), { missing: detail.reasoning.problemStructure.forecasting.missingInputs.join(listSeparator) || t('execution.unspecified') })}
                      </p>
                      {detail.reasoning.problemStructure.forecasting.conflictingRecords && <p className="os-warning">{t('execution.conflictingRecords')}</p>}
                      {detail.reasoning.problemStructure.forecasting.extractionNotes.length > 0 && <ul className="os-acceptance">{detail.reasoning.problemStructure.forecasting.extractionNotes.map((note) => <li key={note}>{note}</li>)}</ul>}
                    </div>
                  )}
                  <p className={detail.reasoning.sufficientToProceed ? 'subtle' : 'os-warning'}>
                    {detail.reasoning.sufficientToProceed ? t('execution.sufficient') : t('execution.criticalMissing')}
                  </p>
                  {detail.reasoning.clarificationQuestion && <p className="os-warning"><strong>{t('execution.requiredQuestion')}</strong> {detail.reasoning.clarificationQuestion}</p>}
                  <div className="os-columns">
                    <div>
                      <h4>{t('execution.userFacts')} ({detail.reasoning.claims.filter((item) => item.kind === 'user-fact').length})</h4>
                      <ul className="os-acceptance">{detail.reasoning.claims.filter((item) => item.kind === 'user-fact').slice(0, 8).map((item) => <li key={item.id}>{item.statement} <span className="subtle">[{item.provenance.trust}]</span></li>)}</ul>
                      <h4>{t('execution.assumptionsCount')} ({detail.reasoning.assumptions.length})</h4>
                      {detail.reasoning.assumptions.length ? <ul className="os-acceptance">{detail.reasoning.assumptions.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">{t('execution.noAssumptions')}</p>}
                      <h4>{t('execution.unknownsCount')} ({detail.reasoning.unknowns.length})</h4>
                      {detail.reasoning.unknowns.length ? <ul className="os-acceptance">{detail.reasoning.unknowns.slice(0, 8).map((item) => <li key={item}>{item}</li>)}</ul> : <p className="subtle">{t('execution.noUnknowns')}</p>}
                    </div>
                    <div>
                      <h4>{t('execution.hypothesesCount')} ({detail.reasoning.hypotheses.length})</h4>
                      {detail.reasoning.hypotheses.length ? <ul className="os-acceptance">{detail.reasoning.hypotheses.slice(0, 6).map((item) => <li key={item.id}><strong>{item.rank}. {item.status}</strong> · {item.statement} <span className="subtle">({t('execution.scoreLabel')} {item.score} · {item.scoreKind === 'heuristic-uncalibrated' ? t('execution.uncalibrated') : item.scoreKind})</span>{item.rejectionReason ? <span className="subtle"> — {item.rejectionReason}</span> : null}</li>)}</ul> : <p className="subtle">{t('execution.noHypotheses')}</p>}
                      <h4>{t('execution.causalTitle')}</h4>
                      {detail.reasoning.causalGraph.length ? <ul className="os-acceptance">{detail.reasoning.causalGraph.slice(0, 6).map((edge) => <li key={edge.id}>{edge.cause} ← {edge.relation} → {edge.effect} <span className="subtle">({edge.evidenceKind} · {edge.identified ? t('execution.identified') : t('execution.unidentified')})</span><br /><small className="subtle">{edge.limitation}</small></li>)}</ul> : <p className="subtle">{t('execution.noCausal')}</p>}
                    </div>
                  </div>
                  <div className="os-columns">
                    <div>
                      <h4>{t('execution.infoNeedsTitle')}</h4>
                      {detail.reasoning.informationNeeds.length ? <ul className="os-acceptance">{detail.reasoning.informationNeeds.slice(0, 8).map((need) => <li key={need.id}><strong>{need.materiality}</strong> · {need.question} <span className="subtle">({need.recommendedAction} · {need.canSelfGather ? t('execution.canSelfGather') : t('execution.requiresUser')} · {t('execution.expectedGain')} {Math.round(need.expectedInformationGain * 100)}%)</span></li>)}</ul> : <p className="subtle">{t('execution.noInfoNeeds')}</p>}
                    </div>
                    <div>
                      <h4>{t('execution.methodsTitle')}</h4>
                      <ul className="os-acceptance">{detail.reasoning.methods.slice(0, 8).map((method) => <li key={method.id}><strong>{method.name}</strong> {method.selected ? `· ${t('execution.selected')}` : ''} · {method.status}{method.gap ? ` · ${t('execution.gapLabel')} ${method.gap}` : ''}<br /><small className="subtle">{method.reason}</small></li>)}</ul>
                    </div>
                  </div>
                  {detail.reasoning.contradictions.length > 0 && <><h4>{t('execution.contradictionsTitle')}</h4><ul className="os-acceptance">{detail.reasoning.contradictions.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul></>}
                  {detail.reasoning.changes.length > 0 && <><h4>{t('execution.changesTitle')}</h4><ul className="os-acceptance">{detail.reasoning.changes.slice(-4).map((change) => <li key={`${change.version}-${change.kind}`}>v{change.version} · {change.kind} · {change.description}{change.replanRecommended ? ` · ${t('execution.replanRecommended')}` : ''}</li>)}</ul></>}
                  {detail.reasoning.limitations.length > 0 && <><h4>{t('execution.limitationsTitle')}</h4><ul className="os-acceptance">{detail.reasoning.limitations.map((item) => <li key={item}>{item}</li>)}</ul></>}
                  {detail.reasoning.provider.notice && <p className="subtle">{detail.reasoning.provider.notice}</p>}
                </details>
              )}

              {detail.outcomeVerification && (
                <div className="os-subpanel" aria-label={t('execution.outcomeVerificationAria')}>
                  <h3><FlaskConical size={15} aria-hidden="true" /> {t('execution.outcomeVerificationTitle')}</h3>
                  <p><strong>{t('execution.statusLabel')}</strong> {outcomeStatusLabel(t, detail.outcomeStatus ?? detail.outcomeVerification.status)}</p>
                  {(detail.outcomeVerification.reasons ?? []).length > 0 && <ul className="os-acceptance">{(detail.outcomeVerification.reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  <ul className="os-acceptance">
                    {(detail.outcomeVerification.checks ?? []).slice(0, 24).map((check) => (
                      <li key={check.id}><strong>{check.status}</strong> · {check.description} <span className="subtle">({check.evidence})</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.composition && (
                <details className="os-handoffs" open>
                  <summary><Network size={14} aria-hidden="true" /> {t('execution.compositionTitle')}</summary>
                  <p className="subtle">{detail.composition.graph.explanation}</p>
                  <p><strong>{t('execution.strategyLabel')}</strong> {detail.composition.strategies.find((strategy) => strategy.id === detail.composition?.selectedStrategy)?.name ?? detail.composition.selectedStrategy ?? '—'}</p>
                  <p className="subtle">{detail.composition.explanation}</p>
                  <ul className="os-acceptance">
                    {detail.composition.graph.nodes.map((node) => (
                      <li key={node.id}><strong>{node.title}</strong> — {node.tool} · {node.role} · {node.capabilityKind} · {t('execution.agentLabel')} {node.agentId ?? t('execution.unspecified')} · {t('execution.nodeRiskLabel')} {riskLabel(t, node.risk)}{node.fallbackTools.length ? ` · ${t('execution.fallbackLabel')} ${node.fallbackTools.join(listSeparator)}` : ''}</li>
                    ))}
                  </ul>
                  {detail.composition.gaps.length > 0 && <><h4>{t('execution.gapsTitle')}</h4><ul className="os-acceptance">{detail.composition.gaps.map((gap) => <li key={`${gap.node ?? 'global'}-${gap.message}`}>{gap.message} <span className="subtle">({t('execution.missingLabel')}: {gap.missing.join(listSeparator)})</span></li>)}</ul></>}
                  {detail.composition.strategies.length > 0 && <><h4>{t('execution.alternativesTitle')}</h4><ul className="os-acceptance">{detail.composition.strategies.map((strategy) => <li key={strategy.id}><strong>{strategy.name}</strong> — {strategy.feasible ? `${t('execution.feasible')} · ${strategy.score}` : `${t('execution.rejected')} · ${strategy.rejectionReason ?? t('execution.notExecutable')}`}</li>)}</ul></>}
                </details>
              )}

              {detail.planVersions && detail.planVersions.length > 0 && (
                <details className="os-handoffs">
                  <summary><GitBranch size={14} aria-hidden="true" /> {t('execution.planVersionsTitle')} ({detail.planVersions.length})</summary>
                  {detail.planVersions.map((version) => (
                    <div key={version.id} className="os-run">
                      <div className="os-run-head"><strong>v{version.version} · {version.strategy}</strong><span className="subtle">{version.reason}</span><small className="subtle">{new Date(version.createdAt).toLocaleString(lang)}</small></div>
                      <p className="subtle">{t('execution.estimatedCost')} {version.plan.metrics.totalCost} · {t('execution.maxRisk')} {version.plan.metrics.maxRisk} · {t('execution.criticalPath')} {version.plan.criticalPath.join(' → ')}</p>
                      <ul className="os-acceptance">
                        {version.plan.tasks.map((task) => <li key={task.index}><strong>{task.title}</strong> — {task.uncertainty.risk} · {task.preconditions.join(clauseSeparator)}</li>)}
                      </ul>
                    </div>
                  ))}
                </details>
              )}

              {detail.planVerification && (
                <details className="os-handoffs">
                  <summary><ShieldCheck size={14} aria-hidden="true" /> {t('execution.planVerificationTitle')} ({detail.planVerification.passed ? t('execution.valid') : t('execution.failed')})</summary>
                  <ul className="os-acceptance">
                    {detail.planVerification.checks.map((check) => <li key={check.id}><strong>{check.id}</strong>: {check.status} — {check.evidence}</li>)}
                  </ul>
                </details>
              )}

              <details className="os-handoffs">
                <summary><Network size={14} aria-hidden="true" /> {t('execution.workersTitle')} ({leases.length})</summary>
                {leases.length === 0 ? <p className="subtle">{t('execution.noWorker')}</p> : (
                  <ul className="os-acceptance">
                    {leases.map((lease) => <li key={lease.taskId}><code dir="ltr">{lease.ownerId}</code> · {t('execution.taskLabel')} {lease.taskId.slice(0, 8)}… · {t('execution.expiresAt')} {new Date(lease.expiresAt).toLocaleTimeString(lang)}</li>)}
                  </ul>
                )}
              </details>

              <details className="os-handoffs">
                <summary><ShieldCheck size={14} aria-hidden="true" /> {t('execution.verificationLogTitle')} ({verifications.length})</summary>
                {verifications.map((verification) => (
                  <div key={verification.id} className="os-run">
                    <div className="os-run-head"><strong>{verification.result} · {verification.independence}</strong><span className="subtle">{verification.verifier}</span><small className="subtle">{new Date(verification.createdAt).toLocaleString(lang)}</small></div>
                    {verification.failureReason && <p className="os-issues">{verification.failureReason}</p>}
                    <ul className="os-acceptance">
                      {verification.checks.map((check) => <li key={check.id}><strong>{check.id}</strong>: {check.status}{check.evidence ? ` — ${check.evidence}` : ''}</li>)}
                    </ul>
                  </div>
                ))}
              </details>

              <form className="os-memory-row" onSubmit={(event) => { event.preventDefault(); void replan(); }}>
                <input dir="auto" value={replanReason} onChange={(event) => setReplanReason(event.target.value)} placeholder={t('execution.replanPlaceholder')} maxLength={500} aria-label={t('execution.replanAria')} />
                <button type="submit" className="button small" disabled={busy || replanReason.trim().length < 3}>{t('execution.replanButton')}</button>
              </form>

              {detail.handoffs.length > 0 && (
                <details className="os-handoffs">
                  <summary><ScrollText size={14} aria-hidden="true" /> {t('execution.handoffsTitle')} ({detail.handoffs.length})</summary>
                  {detail.handoffs.map((handoff) => (
                    <pre key={handoff.id} className="os-pre">{JSON.stringify(handoff.contract, null, 2)}</pre>
                  ))}
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
