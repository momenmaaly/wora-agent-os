# WORA Scientific Benchmarks

**Status:** reproducible suite version 1.1.0; it measures only the fixtures it runs.
**Source:** `api-server/src/os/benchmarks.ts`, `benchmarks.test.ts`.

## 1. Twelve-domain map

`GET /api/os/benchmarks/domains` returns 12 scientific domains with three honest lists:

- implemented capabilities;
- partial capabilities;
- missing capabilities.

The map is the product-facing companion to `WORA_SCIENTIFIC_FOUNDATION.md`; it does not turn research directions into claims.

## 2. Reproducible fixtures

`POST /api/os/benchmarks/run` runs real tools and deterministic planning/verification functions:

1. 4×4 assignment against brute-force optimum.
2. Small employee schedule against demand coverage, solver validation and expected shift count.
3. Two-variable LP against analytic optimum 4.
4. Seeded PERT simulation, repeated with the same seed, plus quantile ordering.
5. Exact linear trend against analytic continuation 11, 12, 13.
6. Weighted decision matrix against hand-computed winner.
7. Descriptive statistics against direct mean 5.5.
8. Four structured problem-understanding fixtures against expected domains.
9. Formal plan graph and critical path against the deterministic planner.
10. Four algorithm-selection fixtures against the implemented catalog.
11. Dependency and failure-propagation verification fixtures.
12. Independent verification accuracy: clean output passes, credential leak fails.
13. Human-intervention classification: high irreversible action is class C; low reversible is not.
14. Multi-agent handoff graph: specialist assignments and dependency structure.

Each result records correctness, quality where meaningful, measured time, tool calls, reference, alternatives and limitations. The run is persisted in `os_benchmark_runs` and exposed at `GET /api/os/benchmarks/runs`.

## 3. Measured sample

Command: `npx tsx -e "import('./src/os/benchmarks.ts').then(...)"` on the development container.

| Fixture | Tool/function | Result | Measured time |
| --- | --- | --- | --- |
| 4×4 assignment | `or.assignment` | PASS | 59.966 ms |
| Small employee schedule | `or.employee_schedule` | PASS | 70.087 ms |
| Two-variable LP | `or.solve_lp` | PASS | 16.470 ms |
| Seeded PERT simulation | `sim.monte_carlo` | PASS | 11.256 ms |
| Exact linear trend | `forecast.linear` | PASS | 4.312 ms |
| Weighted decision | `decision.weighted_matrix` | PASS | 5.101 ms |
| Descriptive statistics | `stats.describe` | PASS | 4.364 ms |
| Problem understanding | `meta.understand_problem` | PASS | 2.269 ms |
| Formal planning | `planning.comparePlans` | PASS | 1.261 ms |
| Algorithm selection | `meta.algorithm_select` | PASS | 0.086 ms |
| Dependency/failure verification | `planning.verifyPlanExecution` | PASS | 0.106 ms |
| Independent verification | `wora.verifier/independent` | PASS | 0.551 ms |
| Human intervention | `meta.action_classify` | PASS | 0.144 ms |
| Multi-agent handoff graph | `planning.verifyPlanExecution` | PASS | 0.323 ms |

Summary for that run: **14 total, 14 passed, 0 failed, 176.296 ms**. Timing is environment-specific and is not a service-level guarantee.

## 4. What is compared

The suite compares each tested method with an independent reference, a deterministic structural check or a repeatability check where one exists. It does **not** compare against unimplemented alternative libraries, and it does not claim that a small fixture predicts production performance.

## 5. Limits

- Fixtures are small and synthetic.
- No CP-SAT, min-cost flow, robust optimization or external solver comparison is implemented.
- Timings are single-run measurements on one container.
- Quality is null where the domain has no meaningful scalar quality.
- Planning and multi-agent fixtures measure plan structure, not executed multi-agent coordination quality.
- Human-intervention rate is computed over two illustrative actions, not a production workload.

## 6. Scientific intelligence evaluation (2026-11-24)

A separate deterministic evaluation now covers the end-to-end path:

- analytical uncertainty selection and execution (`sim.monte_carlo`);
- constrained optimization (`or.employee_schedule`);
- software project with scaffold, security scan and approval-gated tests;
- failure diagnosis and repaired-input retry;
- missing capability/gap reporting;
- class C approval enforcement;
- runtime interruption and opt-in worker recovery;
- structured selection accuracy vs a real keyword-only baseline.

Current measured result: structured **1.00**, keyword baseline **0.75** on four disambiguating fixtures; scenarios **8/8 passed**. See `WORA_SCIENTIFIC_EVALUATION.md` for dataset, assumptions and limitations. The original 14-fixture suite remains unchanged and passing.
