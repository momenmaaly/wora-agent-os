# WORA V2 — Scientific Intelligence & Computational Problem-Solving Engine

**Branch:** `release/wora-v1`  
**Scope:** extend the existing WORA OS. No new application, registry, database or parallel intelligence engine was created.

## 1. What this slice adds

WORA can now formulate a computational problem explicitly before solving it. The formulation records decision variables, supplied inputs, objective, constraints, assumptions, feasibility conditions, uncertainty, solver, expected outputs, verification criteria and missing inputs. A mission only executes a solver when the formulation is executable.

Supported structured problem classes:

| Class | Real tool | Verification |
| --- | --- | --- |
| Linear programming | `or.solve_lp` (HiGHS) | status, recomputed objective, every constraint, bounds |
| Mixed-integer programming | `or.solve_lp` (HiGHS) | status, objective, constraints, bounds, integrality |
| Shortest path | `graph.shortest_path` (Dijkstra / A*) | endpoints, edge continuity, recomputed cost, independent Dijkstra baseline for A* |
| Assignment | `or.assignment` (Hungarian) | unique rows/columns, indices, recomputed total |
| Employee scheduling | `or.employee_schedule` (HiGHS MIP) | demand, availability, workload caps, recomputed labor cost |
| Monte Carlo simulation | `sim.monte_carlo` (seeded PERT) | ordered quantiles, seed/trials recorded, `simulated: true` |
| Forecasting | `forecast.linear` | chronological holdout, MAE, R², residual bands |
| Multi-criteria decision | `decision.weighted_matrix` | ranking, ±25% weight robustness, recomputed scores |

## 2. Mission lifecycle

`buildPlan` detects an explicit structured model in the objective (JSON) and creates two connected tasks:

1. `meta.formulate_scientific_problem` — records the formulation and returns its digest.
2. The real solver — receives the formulation's `model` through `inputBindings`, executes, and is reviewed by `reviewRun`.

If the model is missing or incomplete, WORA creates a single `business_analyst` gap task with `SCIENTIFIC INPUT GAP`. It does not insert sample values, run a solver, or claim a result.

`reviewRun` checks the solver's own verification and the tool-specific status. A non-optimal or unverified result fails the task rather than being presented as success. `summarizeDeliverables` reports the real solver output, verification state and limitations.

## 3. Independent verification

- LP/MIP: `scientific-verification.ts` recomputes the objective, every constraint (including slacks) and every bound; binary variables must be 0 or 1 within tolerance.
- Assignment: verifies count, unique rows/columns, index range and recomputed total.
- Scheduling: verifies demand coverage, availability, workload caps and cost.
- Graph: verifies path endpoints, real edges, cost, edge trace and A* optimality against an independent Dijkstra run. An inadmissible heuristic returns `not_verified`.
- Simulation: checks quantile ordering and the simulated label.
- Forecast: checks projections and holdout metrics.
- Decision: checks ranking and robustness output.

## 4. API additions

- `POST /api/os/science/formulate` — explicit formulation preview; returns `executable`, `missingInputs`, solver and digest.
- `POST /api/os/optimize/shortest-path` — Dijkstra/A* with independent verification.
- `POST /api/os/optimize/lp` — existing LP/MIP endpoint now returns `verification`.
- Existing `/api/os/optimize/employee-schedule`, `/api/os/simulate/monte-carlo`, `/api/os/decision/matrix` and `/api/os/forecast` remain compatible.
- Tools now accept either direct fields or a formulation-bound `model` object for assignment, scheduling, simulation, forecast and decision.

## 5. UI

`client/src/components/IntelligenceHub.tsx` adds a **المسار الأمثل** tab:

- editable weighted graph JSON, start, goal, algorithm and optional heuristic;
- calls `/science/formulate` first, then `/optimize/shortest-path`;
- shows formulation digest, objective, solver, variables and constraints;
- shows path, cost, expanded nodes, independent Dijkstra baseline and every verification check;
- shows explicit errors for invalid JSON, incomplete data, negative weights and failed verification.

The existing Arabic-first RTL layout and compact management style are preserved.

## 6. Database

Migration 18 (`scientific-graph-and-formulation-capabilities`) adds the new tools to untouched operations-research seed agents. It preserves narrowed or customized tool lists. No new tables were required: existing mission, task, run, verification, audit and agent capability records already hold the execution and verification evidence.

## 7. Security

- All numeric inputs are validated by Zod before execution.
- Negative graph weights are rejected.
- No sample values are imputed into missing scientific inputs.
- No external code or marketplace content is executed by this slice.
- Secrets are not read, logged or included in tool output.
- Solver outputs are treated as claims until independent verification passes.

## 8. Verification

- API typecheck: `npm run typecheck` passes.
- API suite: 443 tests, 439 pass, 4 skipped (Docker/Mongo integration when unavailable), 0 fail.
- Client typecheck: `npm run typecheck` passes.
- Client suite: 70 tests, 70 pass.
- New API tests: 19 tests in `scientific-computational.test.ts`, all pass, including real graph, LP, simulation, forecast and decision missions.

## 9. Known limitations

- Linear and mixed-integer models only; no nonlinear or global optimizer.
- Graph support is shortest path; no max-flow, vehicle routing, TSP or min-cost flow yet.
- Forecasting is a linear trend baseline; no seasonality, ARIMA or exogenous variables.
- Simulation is independent triangular PERT; no discrete-event or agent-based engine, and no correlation modeling.
- Multi-criteria decisions are weighted additive; no Pareto frontier or interactive trade-off exploration.
- Verification is numerical and contract-based, not a formal proof checker.
- The Intelligence Hub remains Arabic-first in its existing tabs; the new graph tab follows the same established layout.
- No automatic method discovery or benchmark-driven method registration.
- Production host validation for Docker/Mongo/Redis/TLS remains outstanding and unchanged.

## 10. Manual configuration

None for the new capability. HiGHS is already a dependency; no new secrets or external paid services are required.
