/**
 * WORA OS — action classification.
 *
 * This is the first slice of the governance model. It classifies an action
 * before execution:
 *
 *   A — safe, reversible, within granted scope; may run automatically.
 *   B — controlled; needs a policy/scope check and audit.
 *   C — high-risk; needs explicit approval bound to the exact payload.
 *
 * The classifier does not grant authority and does not execute anything. It
 * produces a reviewable decision that the governance layer can enforce.
 */
export const ACTION_SCHEMA_VERSION = '1.0';
export const ACTION_CLASSES = ['A', 'B', 'C'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];
export type ActionRisk = 'low' | 'medium' | 'high';

export interface ActionClassificationInput {
  action: string;
  risk: ActionRisk;
  reversible?: boolean;
  externalCommitment?: boolean;
  spendsMoney?: boolean;
  amountUsd?: number;
  sensitiveData?: boolean;
  scope?: string;
  expiresAt?: string;
}

export interface ActionClassification {
  schemaVersion: typeof ACTION_SCHEMA_VERSION;
  action: string;
  class: ActionClass;
  risk: ActionRisk;
  requiresApproval: boolean;
  allowedAutomatically: boolean;
  allowedAfterPolicyCheck: boolean;
  payloadBinding: 'exact' | 'scope';
  amountUsd: number | null;
  scope: string;
  expiresAt: string | null;
  reasons: string[];
  conditions: string[];
}

const MAX_AMOUNT_USD = 100_000_000;

export function classifyAction(input: ActionClassificationInput): ActionClassification {
  const action = input.action.trim();
  if (!action) throw new Error('Action description is required');
  if (input.amountUsd !== undefined && (!Number.isFinite(input.amountUsd) || input.amountUsd < 0 || input.amountUsd > MAX_AMOUNT_USD)) {
    throw new Error('amountUsd must be a finite non-negative amount below the safety cap');
  }

  const reversible = input.reversible ?? true;
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) throw new Error('expiresAt must be a valid ISO timestamp');

  const reasons: string[] = [];
  let cls: ActionClass = 'A';
  const escalate = (next: ActionClass, reason: string) => {
    if (next === 'C' || (next === 'B' && cls === 'A')) cls = next;
    reasons.push(reason);
  };

  if (input.risk === 'high') escalate('C', 'Risk is classified high.');
  if (input.spendsMoney === true) escalate('C', 'The action spends money or creates a financial commitment.');
  if (input.externalCommitment === true) escalate('C', 'The action creates an external or legal commitment.');
  if (input.sensitiveData === true && input.risk !== 'low') escalate('C', 'Sensitive data disclosure requires explicit approval.');
  if (reversible === false) escalate('B', 'The action is not reversible.');
  if (input.risk === 'medium') escalate('B', 'Risk is classified medium.');
  if (input.sensitiveData === true && input.risk === 'low') escalate('B', 'Sensitive data is involved and needs a policy check.');
  if (reasons.length === 0) reasons.push('Low-risk, reversible action within the declared scope.');

  if (expiresAt !== null && Date.parse(expiresAt) <= Date.now()) {
    reasons.push('The authorization expiry is already in the past; a new authorization is required.');
    if (cls === 'A') cls = 'B';
  }

  const actionClass = cls as ActionClass;
  const requiresApproval = actionClass === 'C';
  const conditions = actionClass === 'C'
    ? [
        'Explicit approval by an authorized approver who is not the requester.',
        'Approval is bound to the exact action payload, scope and expiry.',
        'The approval record and execution evidence are audited.',
      ]
    : actionClass === 'B'
      ? [
          'A policy or scope check must pass before execution.',
          'The action and its scope are audited.',
          'The action must not be widened beyond the declared scope.',
        ]
      : [
          'Execute only within the granted scope.',
          'Record the action and result in the audit log.',
        ];

  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    action,
    class: actionClass,
    risk: input.risk,
    requiresApproval,
    allowedAutomatically: actionClass === 'A',
    allowedAfterPolicyCheck: actionClass === 'B',
    payloadBinding: actionClass === 'C' ? 'exact' : 'scope',
    amountUsd: input.amountUsd ?? null,
    scope: (input.scope ?? 'workspace').slice(0, 200),
    expiresAt,
    reasons,
    conditions,
  };
}
