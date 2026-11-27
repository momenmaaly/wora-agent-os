import type { ApprovalRecord, MissionDetail, OsTask, VerificationRecord } from '../os/api.js';

export type Translate = (path: string) => string;

export function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function formatDate(value: string | null | undefined, lang: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(lang);
}

export function missionProgress(detail: MissionDetail | null): { done: number; total: number; percent: number } {
  const tasks = detail?.tasks ?? [];
  const done = tasks.filter((task) => task.status === 'completed').length;
  return { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

export type PhaseState = 'complete' | 'current' | 'next' | 'blocked' | 'skipped';

export interface PhaseItem { id: string; label: string; state: PhaseState; detail: string }

export function derivePhases(detail: MissionDetail | null, t: Translate): PhaseItem[] {
  if (!detail) return [];
  const hasApproval = detail.approvals.some((approval) => approval.status === 'pending');
  const hasBlocked = detail.tasks.some((task) => task.status === 'blocked');
  const understand = Boolean(detail.problemProfile || detail.reasoning);
  const plan = Boolean(detail.composition || (detail.planVersions?.length ?? 0) > 0 || detail.tasks.length > 0);
  const assign = detail.tasks.some((task) => Boolean(task.agentId));
  const execute = detail.tasks.some((task) => ['running', 'reviewing', 'completed', 'failed', 'blocked'].includes(task.status));
  const verify = Boolean((detail.verifications?.length ?? 0) > 0 || detail.outcomeVerification);
  const deliver = Boolean(detail.artifactId || detail.artifacts.length > 0);
  const progress = missionProgress(detail);
  const values: Array<[string, boolean, string]> = [
    ['phaseUnderstand', understand, detail.problemProfile?.domain ?? ''],
    ['phasePlan', plan, detail.composition?.selectedStrategy ?? detail.planVersions?.[0]?.strategy ?? ''],
    ['phaseAssign', assign, detail.tasks.find((task) => task.agent)?.agent?.name ?? ''],
    ['phaseExecute', execute, fill(t('op.run.progress'), { done: progress.done, total: progress.total })],
    ['phaseVerify', verify, detail.outcomeStatus ?? ''],
    ['phaseDeliver', deliver, detail.artifacts[0]?.name ?? ''],
  ];
  const currentIndex = values.findIndex(([, done]) => !done);
  return values.map(([key, done, info], index) => {
    let state: PhaseState = done ? 'complete' : index === currentIndex ? 'current' : 'next';
    if (!done && index === currentIndex && (hasBlocked || hasApproval)) state = 'blocked';
    return { id: key, label: t(`op.run.${key}`), state, detail: info };
  });
}

export function nextAction(detail: MissionDetail | null, t: Translate): string {
  if (!detail) return t('op.run.nextCompose');
  if (detail.approvals.some((approval) => approval.status === 'pending')) return t('op.run.nextApproval');
  if (detail.tasks.some((task) => task.status === 'blocked')) return t('op.run.nextBlocked');
  if (detail.status === 'running' || detail.status === 'planning') return t('op.run.nextRunning');
  if (detail.status === 'failed' || detail.status === 'cancelled') return t('op.run.nextBlocked');
  return t('op.run.nextReview');
}

export interface AttentionItem {
  id: string;
  kind: 'approval' | 'blocked' | 'outcome';
  title: string;
  detail: string;
  tone: 'warning' | 'danger';
  approval?: ApprovalRecord;
  task?: OsTask;
}

export function attentionItems(detail: MissionDetail | null, t: Translate): AttentionItem[] {
  if (!detail) return [];
  const items: AttentionItem[] = [];
  for (const approval of detail.approvals.filter((entry) => entry.status === 'pending')) {
    items.push({
      id: `approval-${approval.id}`,
      kind: 'approval',
      title: t('op.run.approvalNeeded'),
      detail: approval.actionSummary,
      tone: approval.risk === 'high' ? 'danger' : 'warning',
      approval,
    });
  }
  for (const task of detail.tasks.filter((entry) => entry.status === 'blocked')) {
    items.push({
      id: `blocked-${task.id}`,
      kind: 'blocked',
      title: task.title,
      detail: task.detail || t('op.run.nextBlocked'),
      tone: 'warning',
      task,
    });
  }
  if (detail.outcomeStatus === 'requires_human_review' || detail.outcomeStatus === 'failed') {
    items.push({
      id: 'outcome',
      kind: 'outcome',
      title: t('op.run.outcome'),
      detail: detail.outcomeVerification?.reasons.slice(0, 2).join(' · ') || t('op.run.nextReview'),
      tone: detail.outcomeStatus === 'failed' ? 'danger' : 'warning',
    });
  }
  return items;
}

export interface ActivityEvent { id: string; at: string; title: string; detail: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }

export function missionActivity(detail: MissionDetail, t: Translate): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const task of detail.tasks) {
    events.push({ id: `task-${task.id}`, at: task.createdAt, title: task.title, detail: `${task.specialization}${task.agent ? ` · ${task.agent.name}` : ''}`, tone: 'neutral' });
    for (const run of task.runs) {
      events.push({
        id: `run-${run.id}`,
        at: run.finishedAt ?? run.startedAt,
        title: fill(t('op.run.runs'), { n: run.attempt }),
        detail: `${run.summary}${run.evidence.length ? ` · ${run.evidence.length} evidence` : ''}`,
        tone: run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'brand',
      });
    }
  }
  for (const handoff of detail.handoffs) {
    events.push({ id: `handoff-${handoff.id}`, at: handoff.createdAt, title: `${handoff.from} → ${handoff.to}`, detail: t('op.run.dependencies'), tone: 'brand' });
  }
  for (const approval of detail.approvals) {
    events.push({
      id: `approval-${approval.id}`,
      at: approval.decidedAt ?? approval.createdAt,
      title: approval.actionSummary,
      detail: `${approval.risk} · ${approval.status}`,
      tone: approval.status === 'approved' ? 'success' : approval.status === 'denied' ? 'danger' : 'warning',
    });
  }
  for (const verification of detail.verifications ?? []) {
    events.push({
      id: `verification-${verification.id}`,
      at: verification.createdAt,
      title: t('op.run.verification'),
      detail: `${verification.verifier} · ${verification.result}`,
      tone: verification.result === 'passed' ? 'success' : 'danger',
    });
  }
  if (detail.outcomeVerification) {
    events.push({
      id: 'outcome',
      at: detail.outcomeVerification.generatedAt,
      title: t('op.run.outcome'),
      detail: detail.outcomeVerification.status,
      tone: detail.outcomeVerification.status === 'verified' ? 'success' : detail.outcomeVerification.status === 'failed' ? 'danger' : 'warning',
    });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function taskVerification(detail: MissionDetail, taskId: string): VerificationRecord[] {
  return (detail.verifications ?? []).filter((record) => record.taskId === taskId);
}
