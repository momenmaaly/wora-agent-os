# WORA Algorithm Catalog and Selection Layer

**Catalog version:** `2026-11-24.1`
**Source of truth:** `api-server/src/os/algorithms.ts`
**Rule:** only algorithms implemented and tested in this repository are advertised. Research candidates are not listed as production capabilities.

## 1. What the layer does

The selector turns a problem description into an explainable algorithm choice. It is deterministic and conservative:

1. Explicit `kind` wins.
2. Structured features win over text.
3. Objective keywords are a low-confidence fallback.
4. Unknown problems return `needs_input`.
5. Nonlinear problems return `unsupported` because WORA has no nonlinear solver.
6. Every selected algorithm reports required inputs, guarantees, verification checks, limitations, cost class and alternatives.

It does **not** claim that keyword matching is semantic understanding. It does not execute a solver; it selects one and states what evidence would validate the result.

## 2. Implemented catalog

| Algorithm | Tool | Problem class | Guarantee | Important limitation |
| --- | --- | --- | --- | --- |
| Hungarian Assignment | `or.assignment` | assignment | Optimal matching for the supplied linear cost matrix, including rectangular matrices via dummy columns | Linear one-to-one costs; no side constraints or precedence |
| Employee Shift Scheduling MIP | `or.employee_schedule` | employee scheduling | Optimal feasible schedule for supplied employees/shifts or explicit infeasibility | Single-period shifts; no breaks, consecutive-day rules or fairness objective |
| HiGHS LP / MIP | `or.solve_lp` | linear and integer programming | Optimal result when HiGHS reports `Optimal` | Linear models only; result validity depends on the caller's model |
| PERT Monte Carlo | `sim.monte_carlo` | simulation | Reproducible simulated distribution from seeded triangular estimates | Independent item assumption; simulated, not observed |
| Linear Trend Forecast | `forecast.linear` | forecasting | Transparent baseline with R², holdout MAE and residual bands | Linear trend only; not causal; seasonality and regime changes are not modeled |
| Weighted Decision Matrix | `decision.weighted_matrix` | multi-criteria decision | Deterministic ranking with ±25% weight-robustness check | Additive scoring; weights are judgments, not facts |
| Descriptive Statistics | `stats.describe` | descriptive statistics | Deterministic summary of the supplied series | Descriptive only; no hypothesis test or causal inference |
| Frequency-Based Extractive Summary | `text.extract_summary` | summarization | Reproducible extractive selection in source order | Extractive only; no synthesis or fact checking |

All entries are `tested` or `tested-baseline`. The catalog integrity test fails if a `toolId` is not present in the real tool registry.

## 3. Selection contract

```http
GET /api/os/algorithms
```

Returns the catalog version and implemented entries.

```http
POST /api/os/algorithms/select
Content-Type: application/json

{
  "kind": "assignment",
  "features": { "hasCostMatrix": true, "matrixRows": 3, "matrixCols": 3 }
}
```

Returns:

```json
{
  "schemaVersion": "1.0",
  "catalogVersion": "2026-11-24.1",
  "status": "selected",
  "problemKind": "assignment",
  "confidence": 0.9,
  "rationale": ["Structured feature: cost matrix dimensions present."],
  "missingInformation": [],
  "warnings": [],
  "primary": {
    "algorithmId": "hungarian-assignment",
    "toolId": "or.assignment",
    "guarantee": "Optimal assignment for the supplied linear cost matrix...",
    "requiredInputs": ["costMatrix (rows × columns)", "optional rowLabels", "optional colLabels"],
    "verification": ["Recompute totalCost from the returned assignments."],
    "limitations": ["Linear additive costs only..."],
    "costClass": "low"
  },
  "alternatives": []
}
```

The same selector is available to agents as the low-risk core tool `meta.select_algorithm`.

## 4. Verification expectations by class

- **Assignment:** recompute total cost; check unique row/column use; count dummy assignments.
- **Employee scheduling:** revalidate demand, availability, max assignments and total labor cost.
- **LP/MIP:** require `Optimal`; check constraints within tolerance; recompute objective.
- **Monte Carlo:** record seed/trials; verify percentile ordering; label as simulated.
- **Forecast:** verify chronological holdout, R² and MAE are present; never claim causality.
- **Decision matrix:** recompute weighted scores; report robustness or instability.
- **Statistics:** recompute count, mean and quartiles; treat outliers as screening signals.
- **Summary:** verify selected sentences exist in source and preserve order.

## 5. Benchmark status

There is **no fabricated benchmark table** here. Current evidence is:

- Unit and route tests in `api-server/src/os/algorithms.test.ts` (9 tests).
- Existing solver tests in `api-server/src/os/os.test.ts` for Hungarian, HiGHS, employee scheduling and forecast.
- A comparative benchmark against external libraries has not been run. The internal 14-fixture correctness suite and the structured-vs-keyword evaluation are documented in `WORA_BENCHMARKS.md` and `WORA_SCIENTIFIC_EVALUATION.md`.

## 6. Extension rules

To add an algorithm:

1. Implement it behind a real tool with a validated input contract and timeout.
2. Add deterministic tests for correctness, infeasibility/error behavior and verification.
3. Add a catalog entry with a real `toolId`, guarantee, complexity, inputs, outputs, verification and limitations.
4. Do not mark a research method as implemented until it has a reproducible test.
5. Update the catalog version and this document.

## 7. Scientific selection extension (2026-11-24)

`ProblemFeatures` now accepts structured fields beyond the original keyword features:

- `problemType`: prediction, optimization, planning, causal_analysis, simulation, formal_verification, decision, allocation, scheduling or classification;
- `requires`: explicit scientific requirements such as assignment, scheduling, optimization, simulation, forecasting, statistics, decision, causal_analysis, formal_verification, reinforcement_learning, deep_learning, bayesian_inference or mcts;
- `uncertaintyLevel`, `constraintsCount`, `variableCount`, `dependencyCount`, `precision`, `timeLimitMs`, `riskLevel`, `deterministic`, `stochastic` and `availableTools`.

Selection order is explicit `kind` → structured `problemType`/`requires` → legacy structured features → keyword fallback. Unsupported requirements and unavailable tools return `unsupported` with a gap; they are never mapped to an unrelated solver.

Every catalog entry now also declares a scientific `domain`, `preconditions`, `failureConditions` and `assumptions`. `AlgorithmChoice` carries a suitability score and the selected domain.

`describeScientificSelection` / `selectScientificMethod` add:

- the scientific domain and method status;
- required inputs, outputs, guarantees, limitations and verification;
- assumptions and rejected alternatives;
- an explicit `gap` when no valid method exists.

APIs:

```http
GET  /api/os/science/domains
POST /api/os/science/select
POST /api/os/algorithms/select   # same structured input schema
```

The tool registry exposes the same behavior as `meta.select_scientific_method` (low risk, no permission).

The older statement that no comparative benchmark exists is superseded by `WORA_SCIENTIFIC_EVALUATION.md`; the original 14-fixture benchmark remains the correctness suite.
