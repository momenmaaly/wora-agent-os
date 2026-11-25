import { Activity, Bot, CheckCircle2, ListTree, LoaderCircle, Package, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext.js';
import type { MissionDetail, TaskLease, VerificationRecord } from '../os/api.js';
import { missionStatusLabel, missionTone, outcomeStatusLabel, riskLabel, taskStatusLabel, taskTone, verificationStatusLabel } from '../os/labels.js';
import { StatusBadge } from './ui.js';

export function ExecutionInspector({ detail, leases, verifications, onOpenApprovals, onOpenArtifacts }: {
  detail: MissionDetail | null;
  leases: TaskLease[];
  verifications: VerificationRecord[];
  onOpenApprovals?: () => void;
  onOpenArtifacts?: () => void;
}) {
  const { t } = useI18n();
  const tasks = detail?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'assigned' || task.status === 'reviewing');
  const agents = [...new Set(tasks.flatMap((task) => task.agent?.name ? [task.agent.name] : []))];
  const pending = (detail?.approvals ?? []).filter((approval) => approval.status === 'pending');
  const verification = verifications[0] ?? detail?.verifications?.[0] ?? null;
  const artifacts = detail?.artifacts ?? [];

  return <aside className="tech-inspector" aria-labelledby="tech-inspector-title">
    <div className="tech-panel-head">
      <div>
        <h2 id="tech-inspector-title"><Activity size={15} aria-hidden="true" /> {t('workspace.inspectorTitle')}</h2>
        {detail && <p dir="auto">{detail.objective}</p>}
      </div>
      {detail && <StatusBadge tone={missionTone(detail.status)} dot>{missionStatusLabel(t, detail.status)}</StatusBadge>}
    </div>

    {!detail ? <div className="tech-inspector-empty"><ListTree size={20} aria-hidden="true" /><p>{t('workspace.inspectorEmpty')}</p></div> : <>
      <dl className="tech-inspector-metrics">
        <div><dt>{t('workspace.inspectorTasks')}</dt><dd>{completed}/{tasks.length}</dd></div>
        <div><dt>{t('workspace.inspectorAgents')}</dt><dd>{agents.length}</dd></div>
        <div><dt>{t('workspace.inspectorApprovals')}</dt><dd>{pending.length}</dd></div>
        <div><dt>{t('workspace.inspectorVerification')}</dt><dd>{verification ? verificationStatusLabel(t, verification.result) : '—'}</dd></div>
      </dl>

      <section className="tech-inspector-section">
        <h3>{t('workspace.activeTasks')}</h3>
        {active.length === 0 ? <p className="tech-muted">{t('workspace.noActiveTasks')}</p> : <ul className="tech-inspector-list">
          {active.slice(0, 5).map((task) => <li key={task.id}>
            <span className="tech-inspector-icon">{task.status === 'running' ? <LoaderCircle size={14} className="os-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}</span>
            <span><strong dir="auto">{task.title}</strong><small>{task.agent?.name ?? t('workspace.unassigned')} · {taskStatusLabel(t, task.status)}</small></span>
          </li>)}
        </ul>}
        {leases.length > 0 && <p className="tech-muted"><Bot size={13} aria-hidden="true" /> {leases.length} · {t('execution.workersTitle')}</p>}
      </section>

      <section className="tech-inspector-section">
        <div className="tech-inspector-section-head">
          <h3>{t('workspace.inspectorApprovals')}</h3>
          {onOpenApprovals && <button type="button" className="tech-text-link" onClick={onOpenApprovals}>{t('workspace.openApprovals')}</button>}
        </div>
        {pending.length === 0 ? <p className="tech-muted">{t('workspace.inspectorNoApprovals')}</p> : <ul className="tech-inspector-list">
          {pending.slice(0, 3).map((approval) => <li key={approval.id}>
            <span className="tech-inspector-icon"><ShieldAlert size={14} aria-hidden="true" /></span>
            <span><strong dir="auto">{approval.actionSummary}</strong><small>{approval.toolId ?? approval.kind} · {riskLabel(t, approval.risk)}</small></span>
          </li>)}
        </ul>}
      </section>

      <section className="tech-inspector-section">
        <h3>{t('workspace.inspectorVerification')}</h3>
        {verification ? <div className="tech-verification">
          <StatusBadge tone={verification.result === 'passed' ? 'success' : 'danger'} dot>{verificationStatusLabel(t, verification.result)}</StatusBadge>
          <small>{verification.verifier} · {verification.independence}</small>
        </div> : detail.outcomeVerification ? <div className="tech-verification">
          <StatusBadge tone={detail.outcomeVerification.status === 'verified' ? 'success' : detail.outcomeVerification.status === 'failed' ? 'danger' : 'warning'} dot>{outcomeStatusLabel(t, detail.outcomeStatus ?? detail.outcomeVerification.status)}</StatusBadge>
          <small>{detail.outcomeVerification.reasons[0] ?? t('workspace.inspectorNoVerification')}</small>
        </div> : <p className="tech-muted">{t('workspace.inspectorNoVerification')}</p>}
      </section>

      <section className="tech-inspector-section">
        <div className="tech-inspector-section-head">
          <h3>{t('workspace.inspectorArtifacts')}</h3>
          {onOpenArtifacts && <button type="button" className="tech-text-link" onClick={onOpenArtifacts}>{t('workspace.openArtifacts')}</button>}
        </div>
        {artifacts.length === 0 ? <p className="tech-muted">{t('workspace.inspectorNoArtifacts')}</p> : <ul className="tech-inspector-list">
          {artifacts.slice(0, 4).map((artifact) => <li key={artifact.id}>
            <span className="tech-inspector-icon"><Package size={14} aria-hidden="true" /></span>
            <span><strong dir="auto">{artifact.name}</strong><small>{artifact.kind}</small></span>
          </li>)}
        </ul>}
      </section>

      <p className="tech-inspector-foot"><ShieldCheck size={13} aria-hidden="true" /> {t('workspace.logReadOnly')}</p>
    </>}
  </aside>;
}
