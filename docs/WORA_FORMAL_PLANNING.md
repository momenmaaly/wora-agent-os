# WORA Formal Planning and Replanning

**Status:** implemented and persisted.
**Source:** `api-server/src/os/planning.ts`, `planning.test.ts`.

## Representation

Each deterministic planner task is formalized with:

- goal and subgoals (acceptance criteria);
- preconditions (dependencies, specialization, tool, extracted constraints);
- effects (task completion, evidence, handoff);
- constraints;
- resources (tool, permissions, specialization);
- uncertainty (risk and note);
- deterministic risk-weighted cost;
- dependencies.

The plan records task order, critical path, total cost, maximum risk, uncertainty count, task count and depth.

## Alternatives

Two alternatives are generated from the **same real task graph**:

1. `direct` — original order.
2. `risk-first` — topological order that prefers higher-risk ready tasks.

No unimplemented capability or fake task is introduced. If the estimates tie, the direct plan is preferred and the reason says no reordering benefit was demonstrated.

## Versions and replanning

- `os_plan_versions` stores version, strategy, full plan, comparison, reason, actor and timestamp.
- Initial mission creation stores version 1.
- `POST /api/os/missions/:id/replan` builds a new proposal from remaining tasks and records a new version. It does not mutate the running task graph.
- `GET /api/os/missions/:id/plans` returns versions; mission detail includes them.
- Dependency cycles are rejected.

## Verification

`verifyPlanExecution` independently checks:

- every declared dependency exists;
- no completed task ran before a dependency;
- no task runs on a failed, blocked or cancelled dependency.

The result is exposed as `planVerification` in mission detail.

## Limits

- Cost is a planning estimate, not money or measured wall-clock time.
- The planner remains deterministic and template-based; HTN, A*, MDP/POMDP and constraint solvers are not claimed as implemented.
- Replanning is a proposal. It does not silently rewrite tasks or restart execution.
