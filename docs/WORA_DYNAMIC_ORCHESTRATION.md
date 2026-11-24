# WORA Dynamic Agent Selection & Team Orchestration

**Status:** implemented and tested on `feat/extensions-subsystem`.
**Schema:** `SELECTION_SCHEMA_VERSION = "1.0"`.

## Architecture map

The engine extends existing infrastructure; it does not create a second registry or orchestrator.

```
problem.ts -> orchestrator.buildPlan -> selection.requirementsForPlan
                                           |
                 registry.listAgents ------+----- extensions.resolveCapabilities
                 os_verifications / os_agent_performance --+
                                           |
                                           v
                                  buildTeamPlan / persistTeamPlan
                                           |
                           os_team_plans, os_selection_decisions
                                           |
orchestrator.executeMission -> resolveTaskAgent -> task-queue leases -> tools.runTool
                                           |                              |
                                           v                              v
                              verification.ts / independent-verification.ts
                                           |
                                  os_handoffs + os_agent_performance
```

- Agent identity, skills, tools, permissions and model settings: `os/registry.ts`.
- Installed Skills/Plugins and permission/tool resolution: `extensions/capabilities.ts`.
- Problem understanding and deterministic planning: `os/problem.ts`, `orchestrator.buildPlan`.
- Leases, checkpoints, retries, pause/resume/cancel and recovery: existing orchestrator and `task-queue.ts`.
- Verification: `os/verification.ts`, `os/independent-verification.ts`.
- Learning: `os_agent_performance`, populated only from verified outcomes; lesson promotion remains governed by `os/lessons.ts`.

## Capability taxonomy

| Concept | Meaning | Stored in |
|---|---|---|
| Agent | Independent execution identity | `os_agents` |
| Skill | Reusable knowledge/procedure loaded into an agent | extension installation, resolved into `CapabilityProfile.skills` |
| Tool | Executable operation or integration | core `tools.ts` or registered plugin tool |
| Capability | Requirement a task needs, delivered by an agent + skills + tools | `os_team_plans.requirements`, `os_selection_decisions` |

A requirement contains capability ID, label, description, task index/title, specialization, required skills/tools/permissions, expected output, acceptance criteria, dependencies, risk and minimum suitability.

Unknown capability IDs are not treated as "any generalist can do it". If the specialization is unknown and no skill/tool evidence matches, the result is an explicit capability gap.

## Selection scoring

For every candidate:

- `capabilityMatch`: exact specialization = 1.0; otherwise `0.60*skillCoverage + 0.25*toolCoverage + 0.15*permissionCoverage`; unknown capability = 0.
- `performance`: `0.5 + (verifiedSuccessRate - 0.5)*confidence - recentFailureRate*0.15`, clamped to 0..1. Cold start is 0.5 with low confidence.
- `availability`: 1 for active, 0 otherwise.
- `workload`: `1 / (1 + assigned/running/reviewing tasks)`.
- `cost`: `1 / modelTierCost` (general 1, analysis 1.2, coding 1.5, planning 1.8 relative units).
- `latency`: `1 / (1 + workload*0.25 + planningPenalty)`.

Final score:

```
0.45*capabilityMatch + 0.25*performance + 0.10*availability
+ 0.08*workload + 0.06*cost + 0.06*latency
```

Eligibility is a hard gate: active, capability threshold met, all required tools present, all required permissions present. Ineligible agents appear in explanations but cannot be selected.

Confidence is `0.35 + 0.35*capabilityMatch + 0.30*evidenceConfidence`, capped. Evidence confidence grows with samples to 0.95. Cold-start agents remain selectable only when qualified, with the risk recorded.

Each decision stores the selected agent, confidence, matched capabilities/skills/tools, alternatives with scores and rejection reasons, expected cost/latency units, unresolved risks and a human-readable summary.

## Team formation

- Requirements are evaluated against the same agent list.
- The team is the set of unique selected agents; similar tasks the same agent can handle do not create extra agents.
- `parallelGroups` is a deterministic topological layering of the real dependency graph.
- Strategy is `single_agent`, `multi_agent` or `capability_gap`.
- A gap produces no fabricated assignment and no team member for that task.

## Orchestration lifecycle

1. `createMission` understands the problem, builds the deterministic plan, saves the plan version, persists the team plan and assigns task agents.
2. `executeMission` resolves each task agent dynamically, preferring the persisted assignment while it remains eligible.
3. If a persisted capability was revoked, the persisted active agent is retained only to record an authorization-denial audit; execution still re-resolves the profile and refuses the tool.
4. Tasks run under existing durable leases, heartbeats and checkpoints.
5. Completion requires the existing deterministic acceptance review and independent verification.
6. On final failure, the engine attempts one reassignment to another eligible agent, records the decision/audit and revalidates dependents.
7. Handoffs include from-agent, task state, failure category, reassignment count, input context, work performed, deliverables, evidence, acceptance criteria, capabilities, dependencies and next action.
8. Verified success/failure updates `os_agent_performance` for future selection.

## Database (migration 5)

- `os_team_plans`: one persisted team plan per mission (requirements, decisions, team, graph, gaps, explanation).
- `os_selection_decisions`: per-task selected agent, candidate evaluations, explanation, confidence.
- `os_agent_performance`: verified attempts, successes, failures, duration, last failure by workspace/agent/category.

All additive and workspace-scoped; no existing table or row is deleted.

## APIs

- `POST /api/os/capabilities/analyze` — objective/track -> problem, plan, requirements and team preview; no mission created.
- `GET /api/os/capabilities/performance?agentId=` — verified performance report.
- `GET /api/os/missions/:id/team` — persisted team plan and selection decisions.
- `GET /api/os/missions/:id` — now includes `teamPlan` and `selectionDecisions`.

Authorization follows the existing router: authenticated workspace, viewer read-only, member mutations, admin-only sensitive routes.

## Tests and benchmark

`selection.test.ts` covers 12 scenarios: single agent, multi-specialty team, parallel layers, sequential dependency, missing specialist, replacement, workload/performance, authorization rejection, unverified output, restart recovery, approval requirement and performance learning.

`selection-benchmark.test.ts` compares dynamic selection with a static first-agent baseline using real agents, real evidence and real workload.

Sample benchmark (25 runs, in-memory SQLite, development container; timings are environment-specific):

```json
{
  "runs": 25,
  "selectionLatencyMs": 91.11,
  "baseline": {"accuracy": 0, "expectedVerifiedSuccessRate": 0, "teamSize": 1, "reassignmentAvailable": false},
  "dynamic": {"accuracy": 1, "expectedVerifiedSuccessRate": 1, "teamSize": 1, "reassignmentAvailable": true, "selectedAgent": "Evidence Analyst"},
  "unnecessaryAgents": 0
}
```

## Limitations

- Deterministic evidence-based selection, not semantic inference. It cannot infer capabilities absent from the registry.
- Model compatibility is represented by specialization model tier for cost/latency; provider-specific routing is out of scope.
- Task difficulty is represented indirectly by risk, acceptance criteria and verified history; no separate calibration.
- Reassignment is bounded to one alternative agent per task.
- High-risk actions still require payload-bound human approval; selection never bypasses it.
- No agent is auto-created for a gap; creating a specialist remains an explicit user/admin action in the existing registry.
- Performance learning is per workspace/agent/category and starts cold; one success does not create a permanent global ranking.
