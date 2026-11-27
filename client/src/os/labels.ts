import type { MissionSummary, OsTask, OutcomeStatus } from './api.js';

type Translate = (path: string) => string;
type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const MISSION_STATUS: Record<MissionSummary['status'], string> = {
  planning: 'statusPlanning', running: 'statusRunning', paused: 'statusPaused', awaiting_approval: 'statusAwaitingApproval',
  completed: 'statusCompleted', failed: 'statusFailed', cancelled: 'statusCancelled',
};

const TASK_STATUS: Record<OsTask['status'], string> = {
  created: 'taskCreated', planned: 'taskPlanned', assigned: 'taskAssigned', running: 'taskRunning', reviewing: 'taskReviewing',
  completed: 'taskCompleted', failed: 'taskFailed', blocked: 'taskBlocked', cancelled: 'taskCancelled',
};

export function missionStatusLabel(t: Translate, status: MissionSummary['status']): string {
  return t(`execution.${MISSION_STATUS[status]}`);
}

export function taskStatusLabel(t: Translate, status: OsTask['status']): string {
  return t(`execution.${TASK_STATUS[status]}`);
}

export function outcomeStatusLabel(t: Translate, status: OutcomeStatus | string): string {
  if (status === 'verified') return t('execution.outcomeVerified');
  if (status === 'partially_verified') return t('execution.outcomePartiallyVerified');
  if (status === 'failed') return t('execution.outcomeFailed');
  if (status === 'unverified') return t('execution.outcomeUnverified');
  if (status === 'requires_human_review') return t('execution.outcomeRequiresReview');
  if (status === 'pending') return t('execution.outcomePending');
  if (status === 'blocked') return t('execution.outcomeBlocked');
  return status || t('execution.outcomeUnknown');
}

export function verificationStatusLabel(t: Translate, result: string): string {
  if (result === 'passed') return t('execution.verificationPassed');
  if (result === 'failed') return t('execution.verificationFailed');
  if (result === 'inconclusive') return t('execution.verificationInconclusive');
  return result || t('execution.verificationUnknown');
}

export function riskLabel(t: Translate, risk: string): string {
  if (risk === 'high') return t('execution.riskHigh');
  if (risk === 'medium') return t('execution.riskMedium');
  if (risk === 'low') return t('execution.riskLow');
  return risk;
}

export function missionTone(status: MissionSummary['status']): Tone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'awaiting_approval' || status === 'paused') return 'warning';
  if (status === 'running' || status === 'planning') return 'brand';
  return 'neutral';
}

export function taskTone(status: OsTask['status']): Tone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'blocked') return 'warning';
  if (status === 'running' || status === 'reviewing') return 'brand';
  return 'neutral';
}
