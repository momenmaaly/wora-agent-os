# WORA Action Governance

**Status:** first classification slice implemented and locally tested. Enforcement of every class is not complete.  
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
- High-risk tools in the orchestrator still use the existing human approval gate; class C classification is consistent with that gate.
- Tool execution continues to require the existing permission, agent allowlist and capability profile.

## 5. What is not yet enforced

- Class B policy checks are not yet a first-class durable record.
- Class C approvals are not yet bound to a stored action payload digest, scope and expiry in the approval table; the existing approval stores the tool input but not a general action contract.
- There is no action budget ledger, approval delegation, or automatic expiry sweeper.
- The classifier is not yet called for every orchestrator action; it is currently available through the API and tool.

These are the remaining Phase 3 items and must not be described as complete.

## 6. Acceptance evidence

`api-server/src/os/actions.test.ts` covers:

- A/B/C escalation;
- financial, external-commitment and sensitive-data escalation;
- expired authorization handling;
- invalid expiry and negative amount rejection;
- deterministic tool execution;
- the real HTTP route.
