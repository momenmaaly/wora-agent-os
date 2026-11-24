# WORA Scientific Execution Lifecycle

**Status:** implemented vertical path through understanding, method selection, decision, planning, capability resolution, execution, verification and recovery.
**Source:** `problem.ts`, `science.ts`, `algorithms.ts`, `decision.ts`, `planning.ts`, `selection.ts`, `orchestrator.ts`, `governance.ts`, `task-queue.ts`, `worker.ts`.

## 1. Pipeline

```
Problem understanding
  -> scientific method selection
  -> strategy comparison
  -> deterministic plan + plan version
  -> capability requirements
  -> dynamic agent selection / team formation
  -> task leases + governance classification
  -> tool execution
  -> independent verification + acceptance review
  -> handoff contract
  -> learning / lessons
  -> complete, await approval, or fail with a gap
```

Every stage persists a record:

| Stage | Input | Output | Persisted state | Failure behavior |
| --- | --- | --- | --- | --- |
| Understanding | objective, optional track | structured profile, constraints, missing information | `os_problem_profiles` | Explicit `needs_input` or `unsupported`; no fabricated plan |
| Method selection | structured features/kind/objective | method, domain, assumptions, rejected alternatives, gap | profile `scientific` | `needs_input`, `unsupported`, or explicit missing tool/input |
| Strategy comparison | plan, profile, registry | plan/method scores, execution shape | `os_decision_records`, plan version `comparison` | Ineligible candidates stay visible with reasons |
| Planning | tasks, dependencies, tools | formal plan, critical path, versions | `os_plan_versions` | Dependency cycles are rejected |
| Capability selection | plan tasks, registry, extension profiles | assignments, parallel groups, gaps | `os_team_plans`, `os_selection_decisions` | `capability_gap` task failure; no silent substitute |
| Execution | task, agent profile, tool input | run result, evidence, verification | `os_runs`, `os_verifications`, `os_task_checkpoints` | Bounded retry, one reassignment, blocked side-effect uncertainty |
| Governance | action, risk, scope, amount | A/B/C classification and approval boundary | `os_approvals`, audit | Class C stops before execution |
| Handoff | verified or failed output | contract with capabilities/evidence | `os_handoffs` | Dependents are blocked after failure |
| Learning | completed mission | candidate lessons/playbooks | memory, lessons | No automatic promotion |
| Recovery | interrupted mission/leases | resumable state | leases, checkpoints, mission status | `markInterruptedMissions`, opt-in worker |

## 2. Method and plan consistency

`understandProblem` derives both legacy features and structured scientific requirements (`requires`, `problemType`, uncertainty, risk, deterministic/stochastic). `selectAlgorithm` prioritizes:

1. explicit `kind`;
2. structured `problemType` / `requires`;
3. legacy structured features;
4. keyword fallback (low confidence).

The planner branch and the selected method can still differ when a template is narrow. The mission detail exposes both; the decision record explains the method, and the task detail names the tool actually executed. A mismatch must be treated as a planning defect, not hidden.

## 3. Failure adaptation

On a failed task the orchestrator:

1. records the run, verification checks, evidence and failure category;
2. retries within the configured attempt budget;
3. selects a replacement specialist once when eligible;
4. reassigns after an authorization denial when a qualified alternate exists;
5. records a `failure-assessment` decision when no replacement exists;
6. never retries indefinitely without a changed condition.

`assessReplan` requires evidence or a changed condition before recommending a new plan. Replanning is persisted as a new plan version and does not silently rewrite a running graph.

## 4. Approval boundaries

- **A:** low-risk, reversible, authorized; executes automatically and is audited.
- **B:** controlled; policy/scope check and audit before execution.
- **C:** explicit approval bound to the exact payload, scope, mission, task and expiry; the tool boundary consumes it once.

Dynamically selected agents and plugin tools go through the same tool allowlist, permission check, action classification and approval consumption. No plugin or specialist can widen its own permissions.

## 5. Runtime behavior

- Task leases prevent duplicate execution.
- Checkpoints make a started-but-unfinished side effect explicit.
- `markInterruptedMissions` marks in-flight work honestly after a restart.
- `runWorkerOnce` / `startWorker` provide an opt-in worker for resumable failed missions.
- The API process does not automatically spawn a worker.
- SQLite remains a single-writer store; multi-process deployment requires a shared writer strategy or a future PostgreSQL adapter.

## 6. Known gaps

- No genuine OS sandbox for untrusted plugin code.
- No automatic specialist creation for a capability gap.
- No general semantic planner, causal inference, MDP/POMDP, MCTS, A*, CP-SAT or formal model checker.
- The worker has no distributed mission lease; task leases are the current duplicate-side-effect boundary.
- The decision score is a deterministic policy baseline, not a learned predictor.
