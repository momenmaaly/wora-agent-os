# WORA V2 — Universal Intelligence Core map

This map is repository-grounded. It records what already exists, how a mission actually flows, and where the new clarification integration sits. It does not claim unimplemented methods.

## Existing execution path

`createMission` (`api-server/src/os/orchestrator.ts`) currently performs:

1. **Understand / research** — `modelProblem` (`problem-model.ts`) extends `understandProblem` (`problem.ts`) with memory retrieval, provenance, assumptions and unknowns.
2. **Model** — `UnifiedProblem` (`problem-model.ts`) plus `inferProblemStructure` (`problem-structure.ts`).
3. **Reason** — `buildDeterministicReasoning` (`reasoning-engine.ts`) produces claims, hypotheses, information needs, contradictions, method assessments and a clarification question.
4. **Select methods** — `selectAlgorithm` (`algorithms.ts`) and `describeScientificSelection` (`science.ts`).
5. **Plan** — `buildPlan` (`orchestrator.ts`), `comparePlans` (`planning.ts`), `compareSolutionStrategies` (`decision.ts`), optional `composeMissionPlan` (`capability-composition.ts`).
6. **Assign** — `persistTeamPlan` / `resolveTaskAgent` (`selection.ts`), with extension capability resolution (`extensions/capabilities.ts`).
7. **Execute** — `executeMission` (`orchestrator.ts`) with leases/checkpoints (`task-queue.ts`), governance (`governance.ts`), tool registry (`tools.ts`) and extension tools (`extensions/runtime.ts`).
8. **Verify** — `reviewRun` + `verifyIndependently` (`independent-verification.ts`), `verifyMissionOutcome` (`outcome-verification.ts`) and semantic contracts (`semantic-contracts.ts`).
9. **Learn** — `afterMission` → `collectCandidateLessons` (`lessons.ts`), playbook distillation (`playbooks.ts`), reasoning outcome evidence (`reasoning-store.ts`).

## Capability map

| Capability | Existing implementation | Integration point | Tests | Missing |
| --- | --- | --- | --- | --- |
| Mission understanding and planning | `problem.ts`, `problem-model.ts`, `problem-structure.ts`, `orchestrator.ts` (`buildPlan`) | `createMission` | `problem.test.ts`, `planning.test.ts`, `mission-e2e.test.ts` | No general semantic planner; deterministic rules only |
| Research and advanced reasoning | `research.ts`, `reasoning-engine.ts`, `tools.ts` (`web.fetch_read`), `reasoning-store.ts` | `createMission`, `executeMission`, preflight | `research.test.ts`, `experience-modes.test.mjs` | No general web-search provider; stance/freshness are heuristic |
| Agent Brain / orchestration | `orchestrator.ts`, `worker.ts`, `task-queue.ts`, `recovery.ts` | `executeMission` | `worker.test.ts`, `recovery.test.ts`, `process-recovery.test.ts`, `task-queue.test.ts` | No autonomous goal redefinition |
| Agent selection / capability resolution | `registry.ts`, `selection.ts`, `extensions/capabilities.ts` | `resolveTaskAgent`, `resolveAndSnapshot` | `selection.test.ts`, `selection-benchmark.test.ts`, extension tests | No learned routing model |
| Skills / Plugins / MCP / tools | `extensions/*`, `tools.ts` | tool registry and capability profile | `extensions.test.ts`, `phase5/6/7` tests | Remote package publishing is `501` |
| Operations research / optimization | `ortools.ts` (HiGHS LP/MIP, Hungarian, employee scheduling), `graph.ts` (Dijkstra/A*), `scientific-verification.ts`, `scientific-formulation.ts`, `algorithms.ts` | `or.*` tools and planner branches | `os.test.ts`, `scientific-e2e.test.ts` | No nonlinear solver; shortest path implemented, other graph problems absent |
| Simulation / forecasting | `tools.ts` (`sim.monte_carlo`, `forecast.linear`), `twins.ts`, `forecasting-evaluation.ts` | `buildPlan`, forecast structure | `scientific-e2e.test.ts`, `phase7_1.test.ts` | No discrete-event/agent-based simulation engine; PERT Monte Carlo and formulation are implemented |
| Decision intelligence | `decision.ts`, `decision.weighted_matrix` | plan comparison and decision records | `scientific-e2e.test.ts`, `planning-evaluation.test.ts` | No full causal decision model |
| Memory / retrieval | `memory.ts`, `problem-model.ts` | `searchMemories`, provenance | `phase8_1.test.ts`, `phase8_1_1.test.ts` | No semantic knowledge graph |
| Verification / evidence | `verification.ts`, `independent-verification.ts`, `outcome-verification.ts`, `semantic-contracts.ts` | task review and mission finalization | `verification.test.ts`, `independent-verification.test.ts`, `scientific-e2e.test.ts` | No formal proof checker |
| Learning / controlled improvement | `lessons.ts`, `playbooks.ts`, `benchmarks.ts`, `code-repair.ts` | `afterMission`, validated playbooks | `lessons.test.ts`, `benchmarks.test.ts`, `code-repair.test.ts` | No autonomous code self-modification or method auto-registration |

## New integration in this slice

The reasoning engine already produced `informationNeeds` and `clarificationQuestion`, but they were only shown after mission creation. The new slice connects that existing intelligence to the intake path:

- `api-server/src/os/clarification.ts` converts existing reasoning needs, method-catalog gaps and real planner data gaps into structured questions.
- `POST /api/os/capabilities/analyze` now returns those questions for preflight.
- `POST /api/os/problems/clarify` exposes the same plan directly.
- `POST /api/os/missions` accepts `clarifications`; `createMission` records answers as user evidence in the reasoning model and passes them into the planner objective.
- The Brief UI shows the questions in Guided/Advanced and sends answered questions with the launch.
- No answer invents data. If the user skips a critical question, the existing gap/assumption behavior remains explicit.

## Current honest gaps

- A* / graph search, nonlinear optimization, causal identification, formal model checking, Bayesian inference and MCTS are not implemented; `science.ts` marks them as gaps.
- The scientific engine does not yet develop and register a new method automatically after benchmarking.
- Research is memory + explicit web tools + capability matching, not a unified autonomous literature/research planner.
- SQLite remains the execution store; no distributed scheduler.
