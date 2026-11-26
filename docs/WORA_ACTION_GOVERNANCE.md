# WORA Action Governance

**Status:** classification and enforcement implemented for the current tool/action surface. See `WORA_GOVERNANCE_ENFORCEMENT.md` for binding, budgets and bypass defenses.
**Source:** `api-server/src/os/actions.ts`, `api-server/src/os/tools.ts`, `api-server/src/os/router.ts`.

## 1. Classes

| Class | Meaning | Automatic? | Binding |
| --- | --- | --- | --- |
| A | Low-risk, reversible, within granted scope | Yes | Declared scope |
| B | Controlled; policy/scope check required | No, until the check passes | Declared scope |
| C | High-risk, financial, external/legal, sensitive disclosure or irreversible | No; explicit approval | Exact action payload |

Classification is not authority. A class A result does not bypass an existing permission, tool allowlist or workspace role.

## 2. Escalation rules

The classifier escalates to C when any of these is true:

- risk is `high`;
- the action spends money;
- it creates an external or legal commitment;
- sensitive data is disclosed and risk is not low.

It escalates to B when:

- risk is `medium`;
- the action is not reversible;
- sensitive data is involved at low risk;
- an authorization expiry is already in the past.

Otherwise it returns A with the reasons and conditions.

## 3. API and tool

```http
POST /api/os/actions/classify
Content-Type: application/json

{
  "action": "Pay an invoice",
  "risk": "medium",
  "spendsMoney": true,
  "amountUsd": 250,
  "scope": "project:finance"
}
```

Returns class, approval requirement, automatic/policy-check flags, payload binding, scope, expiry, reasons and conditions.

The same decision is available to agents as the low-risk core tool `meta.classify_action`.

## 4. What is enforced today

- The classifier validates action text, risk, amount bounds and ISO expiry.
- It fails closed on invalid expiry or negative/oversized amounts.
- High-risk and class C actions require an approval bound to the exact canonical payload, mission, task, tool, class and expiry.
- Approvals are single-use; payload substitution, scope widening, cross-mission replay, expiry and self-approval fail closed.
- Workspace budgets default to zero spend, 10 class C approvals per mission and a 60-minute TTL.
- The orchestrator classifies each tool-backed task and consumes the approval before execution.
- `runTool` refuses a high-risk tool without a valid approval; the direct tool API and extension executor refuse high-risk tools as well.
- Autopilot cannot bypass class C.
- Tool execution continues to require the existing permission, agent allowlist and capability profile.

## 5. What is not yet enforced

- Class B is represented by the existing permission/allowlist policy check; there is no separate class B policy editor or durable policy decision record.
- There is no multi-approver quorum, approval delegation or automatic expiry sweeper.
- The amount budget applies when the payload contains a numeric `amountUsd`, `amount`, `budgetUsd` or `costUsd` field.
- The UI does not yet render the digest, expiry and amount as a dedicated approval review panel.

These are follow-up items and must not be described as complete.

## 6. Acceptance evidence

`api-server/src/os/actions.test.ts` covers:

- A/B/C escalation;
- financial, external-commitment and sensitive-data escalation;
- expired authorization handling;
- invalid expiry and negative amount rejection;
- deterministic tool execution;
- the real HTTP route.
