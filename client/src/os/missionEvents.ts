import type { MissionDetail } from './api.js';

export type MissionEventSeverity = 'info' | 'success' | 'warning' | 'error';
export type MissionEventSource = 'task' | 'run' | 'handoff' | 'approval' | 'verification' | 'outcome';

export interface MissionEvent {
  id: string;
  at: string;
  severity: MissionEventSeverity;
  source: MissionEventSource;
  title: string;
  detail?: string;
}

type Translate = (path: string) => string;

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function statusLabel(t: Translate, status: string): string {
  if (status === 'verified') return t('execution.outcomeVerified');
  if (status === 'partially_verified') return t('execution.outcomePartiallyVerified');
  if (status === 'failed') return t('execution.outcomeFailed');
  if (status === 'unverified') return t('execution.outcomeUnverified');
  if (status === 'requires_human_review') return t('execution.outcomeRequiresReview');
  if (status === 'pending') return t('execution.outcomePending');
  if (status === 'blocked') return t('execution.outcomeBlocked');
  return status || t('execution.outcomeUnknown');
}

function verificationLabel(t: Translate, result: string): string {
  if (result === 'passed') return t('execution.verificationPassed');
  if (result === 'failed') return t('execution.verificationFailed');
  if (result === 'inconclusive') return t('execution.verificationInconclusive');
  return result || t('execution.verificationUnknown');
}

function approvalLabel(t: Translate, status: string): string {
  if (status === 'approved') return t('execution.approvalApproved');
  if (status === 'denied') return t('execution.approvalDenied');
  if (status === 'expired') return t('execution.approvalExpired');
  return t('execution.approvalPending');
}

/** Converts persisted mission records into a read-only execution event stream. */
export function buildMissionEvents(detail: MissionDetail, t: Translate): MissionEvent[] {
  const events: MissionEvent[] = [];
  for (const task of detail.tasks) {
    events.push({
      id: `task-${task.id}`,
      at: task.createdAt,
      severity: 'info',
      source: 'task',
      title: fill(t('workspace.eventTaskPlanned'), { title: task.title }),
      detail: `${task.specialization.replace(/_/g, ' ')}${task.agent ? ` · ${task.agent.name}` : ''}${task.dependsOn.length ? ` · ${fill(t('workspace.dependenciesCount'), { n: task.dependsOn.length })}` : ''}`,
    });
    for (const run of task.runs) {
      events.push({
        id: `run-${run.id}`,
        at: run.finishedAt ?? run.startedAt,
        severity: run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'info',
        source: 'run',
        title: fill(t('workspace.eventAttempt'), { n: run.attempt, summary: run.summary || task.title }),
        detail: fill(t('workspace.eventEvidence'), { n: run.evidence.length, tool: task.tool ?? t('workspace.noTool') }),
      });
    }
  }
  for (const handoff of detail.handoffs) {
    events.push({
      id: `handoff-${handoff.id}`,
      at: handoff.createdAt,
      severity: 'info',
      source: 'handoff',
      title: fill(t('workspace.eventHandoffTitle'), { from: handoff.from, to: handoff.to }),
      detail: t('execution.handoffContract'),
    });
  }
  for (const approval of detail.approvals) {
    events.push({
      id: `approval-${approval.id}`,
      at: approval.decidedAt ?? approval.createdAt,
      severity: approval.status === 'approved' ? 'success' : approval.status === 'denied' ? 'error' : 'warning',
      source: 'approval',
      title: fill(t('workspace.eventApprovalTitle'), { summary: approval.actionSummary }),
      detail: `${approval.toolId ?? approval.kind} · ${approvalLabel(t, approval.status)}`,
    });
  }
  for (const verification of detail.verifications ?? []) {
    events.push({
      id: `verification-${verification.id}`,
      at: verification.createdAt,
      severity: verification.result === 'passed' ? 'success' : 'error',
      source: 'verification',
      title: fill(t('workspace.eventVerificationTitle'), { result: verificationLabel(t, verification.result) }),
      detail: `${verification.verifier} · ${verification.independence}`,
    });
  }
  if (detail.outcomeVerification) {
    events.push({
      id: 'outcome',
      at: detail.outcomeVerification.generatedAt,
      severity: detail.outcomeVerification.status === 'verified' ? 'success' : detail.outcomeVerification.status === 'failed' ? 'error' : 'warning',
      source: 'outcome',
      title: fill(t('workspace.eventOutcomeTitle'), { status: statusLabel(t, detail.outcomeStatus ?? detail.outcomeVerification.status) }),
      detail: detail.outcomeVerification.reasons.slice(0, 2).join(' · ') || t('execution.activityFinal'),
    });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}
