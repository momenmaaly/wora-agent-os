# WORA Governance Enforcement

**Status:** enforced in the orchestrator and at the tool boundary.
**Source:** `api-server/src/os/governance.ts`, `actions.ts`, `orchestrator.ts`, `tools.ts`, `router.ts`.

## 1. What is enforced

High-risk actions cannot run merely because an agent has a permission. The execution path is:

1. The orchestrator classifies the action as A, B or C.
2. High-risk and class C actions require an approval record.
3. The approval is bound to the exact canonical payload, mission, task, tool, action class and expiry.
4. A human decision is required; the requester cannot approve their own request.
5. The orchestrator consumes the approval once before execution.
6. `runTool` re-validates the approval for high-risk tools at the registry boundary.
7. The approval is single-use; replay and payload substitution fail closed.

## 2. Approval record

`os_approvals` now carries:

- `action_class` (`A`, `B`, `C`).
- `scope` (mission/task/tool binding).
- `payload_digest` (SHA-256 over canonical JSON).
- `expires_at`.
- `amount_usd`.
- `consumed_at`, `consumed_by`.

Existing databases are migrated additively with `ALTER TABLE`; no data is dropped.

## 3. Budgets

`GET /api/os/settings/action-budget` and `POST /api/os/settings/action-budget` manage a workspace policy:

- `maxAmountUsd` (default **0**, so financial actions are blocked until explicitly configured).
- `maxApprovalsPerMission` (default 10).
- `approvalTtlMinutes` (default 60, maximum 10,080).

`createApproval` rejects an amount above the budget or a mission that has reached its class C approval budget.

## 4. Bypass defenses

- `POST /api/os/tools/:id/execute` refuses high-risk tools.
- `executeForAgent` refuses high-risk tools and audits the denial.
- `runTool` refuses a high-risk tool, or any action the orchestrator classified as class C, without a real, approved, payload-matched approval, even for internal callers.
- Autopilot no longer bypasses high-risk approval; it remains an explicit preference but cannot bypass class C.
- Expired approvals cannot be approved, denied or consumed.

## 5. Tests

`api-server/src/os/governance-enforcement.test.ts` (9 tests) covers:

- class, digest, scope and expiry binding;
- payload substitution, scope widening and cross-mission replay;
- single-use consumption and replay rejection;
- expired approvals;
- default-zero and raised budgets, plus per-mission approval limits;
- autopilot cannot bypass high risk;
- direct tool execution without approval is refused, including a class C classification on a low-risk tool;
- a valid approval reaches the tool boundary, while a substituted payload is refused.

Existing mission tests still cover approval, denial and automatic resume.

## 6. Limits

- Class B is enforced through the existing permission/tool allowlist and capability profile; there is no separate class B policy editor yet.
- The approval UI already shows the payload; it does not yet render every new field (digest, expiry, amount) as a dedicated review panel.
- The amount budget applies when a numeric `amountUsd`, `amount`, `budgetUsd` or `costUsd` field is present in the action payload.
- There is no multi-approver quorum or approval delegation yet.

## 2026-11-24 update — complete-path enforcement

The scientific end-to-end suite adds execution-path evidence for the A/B/C policy:

- Class A low-risk tools execute automatically inside granted permissions (analytical and optimization scenarios).
- Class B medium-risk tools pass the policy/scope path (software scan scenario).
- Class C high-risk `host.exec` produces no run before approval and consumes a payload-bound approval once (restricted-operation scenario).
- Dynamically selected agents and plugin tools go through the same capability profile, tool allowlist, permission check, action classification and approval consumption. A missing capability produces `capability_gap`; it does not widen permissions.
- A capability denial can trigger one qualified reassignment, recorded as a decision; it cannot bypass authorization.
