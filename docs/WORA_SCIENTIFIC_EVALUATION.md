# WORA Scientific Intelligence Evaluation

**Status:** reproducible local fixtures; not a production benchmark.
**Source:** `api-server/src/os/scientific-e2e.test.ts`, `science.test.ts`, `algorithms.test.ts`, `benchmarks.ts`.

## 1. Dataset and environment

The evaluation uses deterministic synthetic fixtures on one Node.js 22 container:

- no network dependency;
- no external paid service;
- SQLite `:memory:` for each test process;
- temporary workspace directories;
- fixed seeds and fixed inputs.

The fixtures are intentionally small. They test the execution path and contract, not capacity or real-world predictive quality.

## 2. Scenarios

| Scenario | Fixture | What is executed | Assertions |
| --- | --- | --- | --- |
| A — analytical | uncertain delivery estimate | `sim.monte_carlo` through mission execution | selected method is Monte Carlo; quantiles ordered; `simulated` label; verification passed |
| B — optimization | 20 employees × 5 shifts | `or.employee_schedule` through mission execution | feasible; non-negative cost; every shift meets demand; verification passed |
| C — software project | generated web app | `scaffold.webapp`, `security.scan`, `host.exec` | scaffold/scan/test tasks completed; multi-agent team; no unnecessary team member; handoff and artifact |
| D — failure recovery | missing workspace file | `fs.workspace_read` fails, input repaired, mission re-executed | failure assessment recorded; retry succeeds; verification passed |
| E — missing capability | unavailable specialization and causal method | dynamic selection + scientific selector | `capability_gap` task failure; no run fabricated; causal gap is explicit |
| F — restricted operation | `host.exec` test command | approval-gated execution | no run before approval; class C approval; consumed after execution |
| G — runtime recovery | two-task mission interrupted | `markInterruptedMissions` + `runWorkerOnce` | mission completes; completed task is not re-executed; interrupted task completes; artifact persisted |

## 3. Metrics

Measured by the tests:

- scientific method selection accuracy on structured fixtures;
- keyword-only baseline accuracy;
- algorithm execution correctness from the existing 14-fixture benchmark;
- feasibility (employee schedule);
- verified mission success;
- planning quality via formal plan metrics;
- agent selection quality via team plan and assignment evidence;
- unnecessary agent count (`team.length - distinct assigned agents`);
- recovery correctness (no duplicate completed work);
- approval enforcement (no pre-approval run);
- runtime durability (interrupted mission resumable through the opt-in worker);
- latency from the deterministic benchmark where recorded.

## 4. Current results

- Structured method selection: **1.00** on four disambiguating fixtures.
- Keyword-only baseline: **0.75** on the same fixtures.
- Scenario suite: **8/8 passed** (`scientific-e2e.test.ts`).
- Scientific catalog/decision/API suite: **7/7 passed** (`science.test.ts`).
- Existing benchmark suite: **14/14 passed** (`benchmarks.test.ts`).
- Full API suite at delivery: see `WORA_PROGRESS.md`.

The keyword baseline is a real simple selector (`selectAlgorithm` without structured features), not a fabricated zero-score straw man. It ties on unambiguous fixtures and loses on disambiguating features, which is the intended comparison.

## 5. Limitations

- Synthetic fixtures do not measure real-world forecast accuracy or optimization quality.
- The benchmark's `quality` field is null where no meaningful scalar reference exists.
- Timings are single-container observations and are not SLOs.
- The software scenario generates a small template application, not an arbitrary project.
- Failure recovery is a repaired-input retry; it is not a benchmark of every failure class.
- Missing capability is tested with an unavailable specialization and a causal-method gap; it does not enumerate every scientific method.
- No comparison against external solver libraries or commercial services was performed.
