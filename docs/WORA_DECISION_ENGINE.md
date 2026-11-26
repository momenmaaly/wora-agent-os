# WORA Decision Engine

**Status:** implemented deterministic baseline; no learned outcome model is claimed.
**Source:** `api-server/src/os/decision.ts`, `api-server/src/os/planning.ts`, `api-server/src/os/problem.ts`.
**Evidence:** `src/os/science.test.ts`, `src/os/scientific-e2e.test.ts`, `src/os/planning.test.ts`.

## 1. What is compared

The engine compares executable candidates, not hypothetical capabilities:

- **Plans:** `direct` and `risk-first` plans over the same real task graph from `comparePlans`.
- **Methods:** the selected scientific method plus any implemented alternatives from the algorithm catalog.

Each candidate exposes:

- expected quality;
- feasibility;
- relative cost;
- relative execution time;
- resource load;
- risk;
- uncertainty;
- reversibility;
- verification difficulty;
- specialist availability;
- tool availability.

The score is a deterministic weighted sum. Weights are explicit in `WEIGHTS`; they are a policy baseline, not measured probabilities.

## 2. Candidate eligibility

A method candidate is eligible only when:

- its tool exists in the real tool registry;
- the problem profile has no unresolved required inputs;
- an active specialist is known to hold the tool (or the tool is internal and needs no specialist).

A plan candidate is eligible only when every task tool exists and an active agent covers each specialization. An ineligible candidate remains visible with its rejection reason.

## 3. Execution shape

The comparison also recommends the smallest execution shape it can justify:

- `direct_tool` — one task with a real tool;
- `single_specialist` — one specialist task without a tool;
- `mathematical_solver` — one task backed by `or.*`;
- `simulation` — one task backed by `sim.monte_carlo`;
- `multi_agent_team` — multiple tasks with no selected algorithm;
- `combined` — multiple tasks plus a selected algorithm.

`smallestCapableTeam` counts distinct specializations in the plan. It is not a promise that no additional specialist will be needed; the dynamic selector can return a gap.

## 4. Persistence

- Initial mission creation stores the comparison inside plan version 1 and writes an `os_decision_records` row with kind `initial`.
- A failure that reaches the retry/reassignment boundary writes kind `failure-assessment`.
- An authorization denial with a qualified alternate agent writes kind `authorization-reassignment`.
- `POST /api/os/missions/:id/replan` writes kind `replan` with the new plan version.
- `GET /api/os/missions/:id/decisions` returns the workspace-scoped history.

## 5. Replan assessment

`assessReplan` is a policy function, not an automatic plan mutator:

| Signal | Action |
| --- | --- |
| Tool/specialist unavailable with an alternative | `replan` |
| Tool/specialist unavailable without an alternative | `stop` |
| Cost/resource budget exceeded | `replan` |
| Assumption invalidated by evidence | `replan` |
| Method failed and an implemented alternative exists | `replan` |
| Authorization failure | `reassign` |
| Timeout/solver failure with alternative | `replan` |
| No changed evidence | `retry` |
| Two replans already, no new evidence | `stop` |

The last rule prevents plan churn. Replanning remains a proposal until an operator or a later bounded orchestration step applies it.

## 6. API

```http
POST /api/os/decisions/compare
{ "objective": "...", "track": "optimization" }
```

Returns the problem profile, the deterministic plan and the full comparison.

```http
POST /api/os/decisions/replan-check
{ "methodFailed": true, "alternativesAvailable": true }
```

Returns `{ shouldReplan, action, reason, requiredEvidence }`.

```http
GET /api/os/missions/:id/decisions
```

Returns persisted decision records for a mission in the caller's workspace.

## 7. Limits

- Scores are deterministic policy judgments, not calibrated probabilities.
- Plan alternatives only reorder the same real task graph.
- A method alternative does not automatically rewrite the task tool; it is a recommendation that may require replanning.
- No multi-objective Pareto solver or Bayesian decision model is implemented.
- The engine never claims that an ineligible or unimplemented method was executed.
