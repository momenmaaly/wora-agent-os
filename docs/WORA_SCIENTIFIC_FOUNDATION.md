# WORA Scientific Foundation Map

**Status:** research and architecture map, not a claim that every discipline is implemented.
**Audit basis:** source inspection of `api-server/src/os`, the extension subsystem and the existing test suite.

## 1. Purpose

WORA should select methods because they are appropriate and verifiable, not because they are fashionable. This map records:

- the scientific principle relevant to WORA;
- the methods already implemented;
- the methods that are only research directions;
- limitations that must remain visible in product claims;
- the verification evidence required before a method is trusted.

## 2. Domain map

| Domain | WORA relevance | Implemented now | Partial / next | Not implemented | Verification requirement |
| --- | --- | --- | --- | --- | --- |
| Artificial intelligence and cognitive architectures | Problem interpretation, planning, specialist coordination | Deterministic planner, extractive summary, agent registry, specialist handoffs | Problem-understanding model; model routing; skill context injection | General semantic planner, meta-reasoning controller, inference-time scaling | Task-level benchmark with held-out objectives; no claim from a UI label |
| Mathematics and computational foundations | Models, constraints, uncertainty | Linear algebra in least squares; probability in Monte Carlo; discrete optimization; statistics | Numerical stability policy; confidence calibration | General symbolic reasoning, information-theoretic planning | Reproducible numeric tests with tolerances |
| Automated planning and search | Decomposition and execution order | Deterministic rule planning; dependency-blocked task execution | HTN-style plan templates; state-space search | A*, MCTS, beam search, PDDL planner | Plan validity and constraint-satisfaction tests |
| Decision science and causal intelligence | Decisions under uncertainty | Weighted decision matrix; Monte Carlo; descriptive statistics | Bayesian updating; explicit uncertainty models | POMDP, Bayesian networks, causal graphs, causal inference | Calibration and sensitivity tests; causal claims require interventional evidence |
| Operations research and optimization | Allocation, scheduling, cost | HiGHS LP/MIP, Hungarian assignment, employee scheduling, decision matrix | CP-SAT evaluation; multi-objective optimization; robust/stochastic optimization | General constraint programming, min-cost flow, advanced scheduling | Solver status, independent constraint revalidation and objective recomputation |
| Multi-agent systems and distributed intelligence | Specialist coordination | Persistent agents, assignments, handoffs, review gates, blocking | Durable worker leases; consensus and distributed scheduling | Game-theoretic allocation, distributed consensus protocol | Multi-process and failure-injection tests |
| Control theory and autonomous systems | Execution control and recovery | Retry/reassignment, approval pause/resume, restart marking | Feedback controller; checkpointing; adaptive retry policy | MPC, adaptive control, autonomous recovery controller | Recovery success and duplicate-transaction tests |
| Simulation and predictive intelligence | Scenario and forecast support | Seeded PERT Monte Carlo, digital twins, linear-trend baseline | Sensitivity analysis; system dynamics; scenario comparison | Causal forecasting, digital-twin calibration against real telemetry | Seed reproducibility, holdout error, explicit `simulated` labels |
| Knowledge and information systems | Memory and retrieval | Scoped SQLite memory, deterministic term-frequency retrieval, provenance, TTL, versions | Embeddings/vector retrieval; knowledge graph | pgvector, semantic knowledge graph, data pipelines | Retrieval precision/recall tests and access-control tests |
| Autonomous engineering and program synthesis | Building and testing software | Generated zero-dependency web app, static security scan, `node --test` verification | Patch-based repair; broader static analysis | General program synthesis, automated debugging at scale | Generated artifact must pass an independent test run |
| Formal verification, safety and reliability | Correctness and risk control | Zod contracts, TypeScript checks, unit/integration tests, deterministic acceptance checks | Property-based testing; model checking; formal verification | SAT/SMT integration, full model checking | Each property needs a failing counterexample test and a passing fix |
| Robotics and cyber-physical intelligence | Physical execution | Device pairing/revocation foundation | Local device command channel with explicit authorization | Navigation, motion planning, sensor fusion, human-robot interaction | Hardware-in-the-loop evidence; not simulated claims |

## 3. Algorithm-to-capability mapping

The executable mapping lives in `api-server/src/os/algorithms.ts` and is documented in `WORA_ALGORITHM_CATALOG.md`.

| Problem class | Selected method | Why | What must be verified |
| --- | --- | --- | --- |
| Assignment with a cost matrix | Hungarian algorithm | Exact minimum-cost matching for the stated model | Total cost, unique assignments, dummy count |
| Employee/shift scheduling | HiGHS MIP | Demand, availability and workload constraints | Demand, availability, max workload, cost |
| General LP/MIP | HiGHS | Exact optimal status for a linear model | Solver status, constraints, objective |
| Cost/duration uncertainty | PERT Monte Carlo | Seeded distribution from three-point estimates | Seed, percentile ordering, `simulated` label |
| Trend forecasting | Least-squares with holdout | Transparent baseline with error reporting | Chronological holdout, R², MAE, non-causal wording |
| Multi-criteria choice | Weighted matrix | Deterministic additive ranking | Recompute scores, robustness under weight perturbation |
| Numeric description | Descriptive statistics | Fast, deterministic summary | Recompute mean/quartiles; outliers are screening only |
| Text reduction | Extractive summary | Reproducible selection without generation | Sentences exist in source and preserve order |

## 4. Principles that constrain implementation

1. **No algorithm theatre.** A method is listed only if a real tool and tests exist.
2. **No fabricated benchmark.** Performance claims require reproducible fixtures and measured results.
3. **No false certainty.** Optimization guarantees apply only to the supplied model. Forecasts are not causal. Simulations are not observations.
4. **No silent approximation.** Nonlinear problems are marked unsupported rather than being forced into a linear model without disclosure.
5. **Independent verification.** A solver's own output is rechecked where the domain permits it.
6. **Uncertainty is explicit.** Confidence, missing inputs, warnings and limitations travel with the selection.
7. **Human approval for high-impact actions.** Scientific correctness does not grant authority to purchase, disclose or make irreversible changes.

## 5. Research-only directions

The following are legitimate research directions but are **not implemented** in WORA today:

- MCTS, A*, beam search and PDDL planning.
- POMDP and Bayesian-network decision models.
- Causal inference and causal graphs.
- CP-SAT, min-cost flow, robust and stochastic optimization.
- Model predictive and adaptive control.
- Formal model checking, SAT/SMT solving and property-based testing at scale.
- Robotics, navigation, motion planning and sensor fusion.
- General program synthesis and automated debugging.

They must not appear in the product as live capabilities until implemented behind a tool, tested and documented with limitations.

## 6. Current implementation status (2026-11-24 update)

The machine-readable domain map now lives in `api-server/src/os/science.ts` and is exposed at `GET /api/os/science/domains`. Every method carries one of:

- `implemented` — backed by a real tool and tests;
- `partial` — useful but narrower than the name implies;
- `experimental` — not currently used in this delivery;
- `documented` — a design direction, not executable;
- `not_implemented` — explicitly unavailable.

The map is also consumed by `benchmarks.ts` so there is one domain source of truth. A domain entry never implies that all of its methods are implemented. The full lifecycle is documented in `WORA_SCIENTIFIC_EXECUTION.md`; method scoring is in `WORA_DECISION_ENGINE.md`.

Newly verified in this update:

- structured problem features (`problemType`, `requires`, uncertainty, risk, deterministic/stochastic, available tools);
- method-selection explanations with assumptions, rejected alternatives and explicit gaps;
- deterministic plan/method scoring and persisted decision records;
- end-to-end scenarios A–G in `src/os/scientific-e2e.test.ts`;
- opt-in durable worker in `src/os/worker.ts` and `src/scripts/os-worker.ts`.

Still absent: general semantic planning, causal inference, POMDP/MDP planning, MCTS/A*, CP-SAT, robust/stochastic optimization, model checking, SAT/SMT, robotics control and general program synthesis.
