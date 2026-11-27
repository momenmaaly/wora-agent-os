# WORA Phase 7.1 — Reasoning Reliability & Generalization

**Status:** implemented and verified. This is a reliability correction, not a claim of general semantic understanding, calibrated probability or causal identification.

**Starting commit:** `1586bb4` on `feat/extensions-subsystem`
**Final commit:** the Phase 7.1 commit on `feat/extensions-subsystem` (`fix(os): generalize forecast intent and input readiness`).

## 1. Original failure

Input:

```text
Project monthly subscription revenue for the next six months from historical totals.
```

Expected interpretation:

- Problem class: forecasting.
- Target: monthly subscription revenue.
- Horizon: six monthly periods.
- Basis: historical totals.
- Required observations: at least eight chronological numeric observations.
- Execution: no forecast until those observations are supplied.

Actual Phase 7 interpretation:

- `problemType = business_operations`.
- `UnifiedProblem.domain = general`.
- `features.hasTimeSeries = false`.
- Algorithm selection `status = needs_input`, `problemKind = unknown`.
- Selected method: `Deterministic rule planner`.
- `sufficientToProceed = true`; no critical information need.
- Execution plan: two `text.extract_summary` tasks. No forecast tool was planned.

## 2. Root cause

The failure was not a single missing keyword. It was a structural gap:

1. **Intent inference was one lexical gate.** `problemTypeOf` only recognized `forecast`, `time series`, `trend` or a narrow `estimate ... revenue|sales|demand` pattern. `Project ... revenue` had a projection verb and a future horizon but did not match. It then fell through to the business rule because the sentence contained `revenue`.
2. **User wording was not represented as a problem structure.** There was no typed object carrying target, horizon, historical basis, observation count and readiness. The engine could not tell “forecast revenue” from “calculate average revenue” except through the same regex list.
3. **Method selection ignored input readiness.** The reasoning layer could select a forecast method without checking that a series and horizon existed.
4. **Planning had no forecasting path.** `buildPlan` had optimization, web-app, organization and research paths but no forecast path. Even a correct forecast classification would have produced the default summary pipeline.
5. **The evaluation harness was too weak.** It checked only that a selected method name contained “linear trend”. It did not check target, horizon, observations, readiness, missing inputs, the planned tool or execution outcome. The original held-out case therefore failed on one method-selection check while the deeper execution gap remained invisible.

## 3. Correction

### 3.1 Typed problem structure

`api-server/src/os/problem-structure.ts` now separates wording from mathematical structure:

- projection signals;
- future temporal signals;
- historical-basis signals;
- target-measure signals;
- negative signals for statistics, trend analysis, classification, simulation, optimization, decision, root-cause, formal verification and software construction;
- a typed `ForecastStructure` with target, horizon, observations, malformed/conflicting flags, requirements, missing inputs and `canExecute`.

It is deterministic and evidence-based. It does not execute anything and does not grant authority.

### 3.2 Forecast readiness

A forecast is executable only when:

- a target is identified;
- a horizon has a number of future periods (1–90);
- at least eight chronological numeric observations are supplied;
- the observations are not malformed;
- historical records do not conflict;
- the user has not simultaneously required that historical data not be used.

Missing inputs become critical information needs. No sample series is substituted.

### 3.3 Method selection

`linear-forecast` is selected only when the structure is executable. Otherwise the deterministic planner is selected to collect or report the gap; the forecasting method remains visible as applicable but not selected.

### 3.4 Planning and execution

`buildPlan` now has a forecast branch:

- valid inputs → `forecast.linear` with exactly the supplied series and horizon;
- missing inputs → a `FORECAST INPUT GAP` task that reports the gap and explicitly refuses to fabricate data.

Outcome verification marks input-gap missions as `partially_verified`, never `verified`. A verified forecast is a verified calculation from the supplied observations, not a claim that the future will match the projection.

The seed `data_analyst` specialization now has `forecast.linear`; migration 12 adds the tool to existing seed data-analyst agents without changing permissions.

### 3.5 Evaluation

Two layers now exist:

- `reasoning-evaluation.ts`: the broad Phase 7 suite, extended with forecast readiness checks.
- `forecasting-evaluation.ts`: a dedicated forecasting paraphrase suite with development, unseen held-out and negative cases.

Expected answers live only in evaluation modules; production reasoning does not import them.

## 4. Evaluation results

Baseline from commit `1586bb4`, reproduced in a detached worktree:

| Suite | Baseline |
| --- | --- |
| Phase 7 development | 20/20 (1.00) |
| Phase 7 held-out | 9/10 (0.90) |
| Failure | `held-subscription-revenue` |

Corrected implementation:

| Suite | Result |
| --- | --- |
| Phase 7 development (original 20 cases) | 20/20 (1.00) |
| Phase 7 development (with new ready-forecast case) | 21/21 (1.00) |
| Phase 7 held-out (new wording) | 10/10 (1.00) |
| Forecasting development paraphrases | 16/16 (1.00) |
| Forecasting held-out paraphrases | 12/12 (1.00) |
| Forecasting negative controls | 6/6 (1.00) |

The original failure is now a development regression case. The new held-out forecasting cases do not reuse its wording.

The 12/12 held-out result is a small sample. It is evidence of generalization across these formulations, not proof of general forecasting understanding.

## 5. Cross-domain regression

The corrected implementation was checked against the full Phase 7 suite and the full API suite. No material regression was observed in:

- problem understanding;
- hypothesis generation and rejection;
- causal restraint;
- information gathering;
- method selection and capability gaps;
- adaptive evidence updates;
- outcome verification;
- semantic contracts;
- authorization and secret protections.

The broad evaluation metrics are all 1.00 on the current suites. Baseline metric totals are not directly comparable because the corrected suite adds readiness checks and changes the forecasting expectations from “selected” to “honestly blocked until inputs exist”.

## 6. Tests added

`api-server/src/os/phase7_1.test.ts` covers:

- original failure interpreted as forecast with missing observations;
- separate development, held-out and negative evaluation results;
- valid forecast executes with exactly the supplied series;
- missing data produces an explicit gap and a non-verified outcome;
- insufficient, malformed, conflicting and contradictory inputs;
- misleading forecast-like wording remaining non-forecast;
- failing forecast tool not converted into success;
- malformed forecast output rejected by outcome verification;
- no cross-domain regression.

`forecasting-evaluation.ts` covers projection without the word “forecast”, sales/demand/workload/revenue paraphrases, future numeric values, change-over-time wording, incomplete data, no target, unclear horizon, malformed and short series, and negative statistics/trend/classification/simulation/optimization/software cases.

## 7. Verification commands and exact results

```bash
cd api-server && npx tsc --noEmit
cd api-server && npm test
cd api-server && npx tsx --test src/os/phase7.test.ts
cd api-server && npx tsx --test src/os/phase7_1.test.ts
cd api-server && npx tsx --test src/os/migrations.test.ts
cd api-server && npm run build
cd client && npx tsc --noEmit
cd client && npm test
cd client && npm run test:e2e
cd client && npm run build
```

Observed at delivery:

- API full suite: **343 tests, 342 passed, 1 skipped, 0 failed**
- Phase 7 suite: **16/16 passed**
- Phase 7.1 suite: **9/9 passed**
- Migration tests: **3/3 passed**
- API typecheck: pass
- API production build: pass
- Client unit suite: **50/50 passed**
- Browser E2E: **1/1 passed**
- Client typecheck: pass
- Client production build: pass

## 8. Remaining limitations and risks

- The structure layer is deterministic and lexical; it does not understand arbitrary language.
- The held-out sample is small.
- Causal identification is still not implemented.
- The linear trend is a baseline, not a domain forecaster.
- Conflicting records are detected and blocked, not reconciled.
- The forecast tool requires at least eight observations; shorter series are reported as insufficient.
- The model-provider path remains optional and fixture-tested only; no external provider benchmark is claimed.
- SQLite remains a single-writer store.
- Existing non-seed/custom data-analyst agents are not automatically granted the forecast tool by migration 12.

## 9. Manual configuration

No configuration is required for deterministic forecasting. No paid provider or external service is required.
