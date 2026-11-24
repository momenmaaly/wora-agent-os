# WORA Scientific Benchmarks

**Status:** first reproducible suite implemented; it measures only the fixtures it runs.
**Source:** `api-server/src/os/benchmarks.ts`, `benchmarks.test.ts`.

## 1. Twelve-domain map

`GET /api/os/benchmarks/domains` returns 12 scientific domains with three honest lists:

- implemented capabilities;
- partial capabilities;
- missing capabilities.

The map is the product-facing companion to `WORA_SCIENTIFIC_FOUNDATION.md`; it does not turn research directions into claims.

## 2. Reproducible fixtures

`POST /api/os/benchmarks/run` runs real tools through the tool registry:

1. 4×4 assignment against brute-force optimum.
2. Small employee schedule against demand coverage and solver validation.
3. Two-variable LP against analytic optimum 4.
4. Seeded PERT simulation, repeated with the same seed, plus quantile ordering.
5. Exact linear trend against analytic continuation 11, 12, 13.
6. Weighted decision matrix against hand-computed winner.
7. Descriptive statistics against direct mean 5.5.

Each result records correctness, quality where meaningful, time, tool calls, reference, alternatives and limitations. The run is persisted in `os_benchmark_runs` and exposed at `GET /api/os/benchmarks/runs`.

## 3. Measured sample

Command: `npx tsx -e "import('./src/os/benchmarks.ts').then(...)"` on the development container.

| Fixture | Tool | Result | Measured time |
| --- | --- | --- | --- |
| 4×4 assignment | `or.assignment` | PASS | 15.993 ms |
| Small employee schedule | `or.employee_schedule` | PASS | 61.689 ms |
| Two-variable LP | `or.solve_lp` | PASS | 15.084 ms |
| Seeded PERT simulation | `sim.monte_carlo` | PASS | 9.825 ms |
| Exact linear trend | `forecast.linear` | PASS | 4.042 ms |
| Weighted decision | `decision.weighted_matrix` | PASS | 4.505 ms |
| Descriptive statistics | `stats.describe` | PASS | 4.237 ms |

Summary for that run: **7 total, 7 passed, 0 failed, 115.375 ms**. Timing is environment-specific and is not a service-level guarantee.

## 4. What is compared

The suite compares each tested method with an independent reference or repeatability check where one exists. It does **not** compare against unimplemented alternative libraries, and it does not claim that a small fixture predicts production performance.

## 5. Limits

- Fixtures are small and synthetic.
- No CP-SAT, min-cost flow, robust optimization or external solver comparison is implemented.
- Timings are single-run measurements on one container.
- Quality is null where the domain has no meaningful scalar quality (for example, a simulated distribution).
