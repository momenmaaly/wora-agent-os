# WORA Planning Evaluation

**Date:** 2026-11-24  
**Command:** `cd api-server && npx tsx --test src/os/planning-evaluation.test.ts`  
**Result:** 4 tests, 4 passed, 0 failed.

This evaluation compares the existing deterministic planner and its two alternatives. It does not add a new planner.

## Measurements

| Problem class | Direct order | Risk-first order | Total cost | Depth | Preferred |
| --- | --- | --- | --- | --- | --- |
| 8 independent low-risk tasks | 0..7 | 0..7 | 8 | 1 | direct |
| Mixed-risk independent tasks | 0,1,2 | 1,2,0 | 7 | 1 | direct |
| 6-task chain | 0..5 | 0..5 | 6 | 6 | direct |
| 20 employees × 5 shifts | MIP solve | — | 480 | — | MIP |

The mixed-risk case changes order but not total risk-weighted cost. The chain is forced by dependencies. Independent tasks have critical-path depth 1 regardless of order. The current planner therefore exposes the useful structure without needing a search algorithm for these classes.

## Resource-constrained scheduling

The existing HiGHS MIP path solved the bundled 20×5 sample as feasible with total cost 480 in 95–211 ms across runs. The output is revalidated for demand, availability and workload before acceptance. This class is not delegated to the deterministic task planner; it uses the existing optimization solver.

## Decision

- **Do not add HTN** yet. The current plans are already grounded task graphs with explicit dependencies; an HTN method layer would need to generate different tasks, not merely reorder them, and no measured benefit was produced.
- **Do not add A*** yet. The state space is small and the critical path already exposes depth; no heuristic search improvement was measured.
- **Do not add a second constraint solver** yet. HiGHS already covers the tested LP/MIP scheduling class.
- **Do add a planner only with evidence.** Any future HTN, A* or CP implementation must ship with a named problem class, a reproducible fixture, a baseline comparison and a measured improvement in solution quality, latency or feasibility.

## Limitations

- Cost is a risk-weighted estimate, not money or wall-clock time.
- The evaluation uses deterministic local tools and a bundled sample roster.
- No claim is made that these results generalize to arbitrary planning domains.
