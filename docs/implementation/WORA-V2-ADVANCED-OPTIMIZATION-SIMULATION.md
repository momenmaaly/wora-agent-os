# WORA V2 — Advanced Optimization, Simulation & Decision Intelligence

**Branch:** `release/wora-v1`
**Scope:** extend the existing WORA OS. No second database, tool registry or intelligence engine was created.

## 1. What this slice adds

WORA can now select, formulate, execute and independently verify nine additional computational methods:

| Method | Tool | Exactness | Independent verification |
| --- | --- | --- | --- |
| Maximum flow | `graph.max_flow` | Exact (Dinic) | Conservation, capacity, source outflow, max-flow = min-cut |
| Minimum-cost flow | `graph.min_cost_flow` | Exact for the supplied demand | Exact demand, conservation, capacity, recomputed cost, no negative residual cycle |
| Bipartite matching | `graph.bipartite_matching` | Exact (augmenting paths) | Real edges used once, size consistency, no augmenting path |
| Traveling salesperson | `routing.tsp` | Exact Held-Karp up to `exactLimit`; labelled 2-opt heuristic above it | Permutation, start node, recomputed cost, brute-force cross-check for small `n`, approximate label |
| Multi-depot CVRP | `routing.vrp` | Heuristic (Clarke–Wright) | Customer coverage, vehicle capacity, recomputed distance, approximation label |
| Pareto frontier | `decision.pareto` | Exact over the supplied candidates | Frontier completeness, non-dominance, weighted ranking, trade-offs and weight sensitivity |
| Conjugate Bayesian update | `stats.bayes_update` | Exact conjugate posterior | Posterior formulas, credible interval contains mean, `P(θ>0.5)` recomputation, prior sensitivity |
| Discrete-event queue | `sim.queue` | Seeded simulation | All customers served, non-negative waits, utilization bounds, seed recorded |
| Scenario comparison | `sim.scenario_compare` | Seeded simulation | Quantile ordering, baseline delta recomputation, same-seed reproducibility, simulated label |

The implementation is provider-independent. It uses existing Zod validation, the existing tool registry, the existing mission orchestrator, the existing SQLite migration system and the existing Arabic-first UI.

## 2. Formulation and planning

`FormulationKind` now includes `max_flow`, `min_cost_flow`, `bipartite_matching`, `tsp`, `vrp`, `pareto_multi_objective`, `bayesian_inference`, `queue_simulation` and `scenario_comparison`. Each formulation records variables, inputs, objective, constraints, solver, verification criteria and missing inputs before any solver runs.

`buildPlan` detects structured JSON models in the mission objective and creates the existing two-step scientific plan:

1. `meta.formulate_scientific_problem` records the formulation and digest.
2. The real solver receives the formulation's `model` through the existing input binding.

If the model is incomplete, WORA creates a gap task and does not impute sample values. Mission planning order now prioritizes network flow, bipartite matching, routing, Pareto, Bayesian, queue and scenario models before the legacy shortest-path branch.

## 3. Selection and catalog

`ProblemFeatures` adds `hasNetworkFlow`, `hasMinCostFlow`, `hasBipartite`, `hasRouting`, `hasVehicles`, `hasPareto`, `hasBayes`, `hasQueue` and `hasScenarios`. Scientific requirements add `network_flow`, `routing`, `multi_objective`, `queueing` and `scenario`.

Selection precedence:

1. Explicit `kind`.
2. Structured features and explicit requirements.
3. Objective keywords.
4. `needs_input` when nothing applies.

Approximate results are never presented as optimal. TSP returns `status: approximate` and `exact: false` above the exact limit. VRP returns `status: feasible` and `exact: false`. The science catalog marks conjugate Bayesian inference, queue simulation and scenario comparison as implemented while keeping general Bayesian networks, MCMC, agent-based simulation and calibrated system dynamics as explicit gaps.

## 4. API additions

All routes execute through `runTool`, so they inherit input validation, permissions, timeouts, audit and authorization behavior:

```http
POST /api/os/network/max-flow
POST /api/os/network/min-cost-flow
POST /api/os/network/bipartite-matching
POST /api/os/routing/tsp
POST /api/os/routing/vrp
POST /api/os/decision/pareto
POST /api/os/stats/bayes
POST /api/os/simulate/queue
POST /api/os/simulate/scenarios
```

`POST /api/os/science/formulate` accepts all nine new kinds. `GET /api/os/algorithms` and `GET /api/os/science/domains` expose the updated catalog and implementation status.

## 5. UI

`client/src/components/IntelligenceHub.tsx` adds **التحسين المتقدم** (`advanced`):

- selector for the nine methods with real Arabic labels;
- editable JSON model per method;
- formulation preview before execution;
- real execution through the typed `osApi` client;
- independent verification checklist and failures;
- full result JSON in a disclosure panel;
- explicit limitations for heuristic and model-conditional results.

The existing RTL layout, tab behavior, loading states, error alert and verification styling are reused.

## 6. Database

Migration 19 (`advanced-optimization-routing-simulation-capabilities`) grants the new tools only to untouched operations-research seed/catalog agents. Narrowed or customized allow-lists are preserved. No new tables are required: existing mission, task, run, verification, audit and agent capability records already hold the evidence.

## 7. Security

- Every input is validated by Zod before execution.
- Negative capacities, invalid priors, malformed matrices and incomplete scenarios are rejected.
- No marketplace or plugin code is executed by this slice.
- No secrets are read, logged or returned.
- Solver output is treated as a claim until independent verification passes.
- Mission review fails a task when the tool status or verification is not acceptable.

## 8. Tests and evidence

`api-server/src/os/advanced-computational.test.ts` adds 27 tests covering:

- max flow, min-cut and tampered-flow rejection;
- min-cost flow optimality, infeasibility and tampered-cost rejection;
- bipartite matching maximality and invalid matching rejection;
- TSP exactness against brute force, approximate labelling, invalid input and tampered tour rejection;
- VRP coverage, capacity infeasibility and tampered load rejection;
- Pareto frontier, dominated candidates, weight sensitivity and tampered frontier rejection;
- Beta–Binomial and Normal–Normal posteriors, prior sensitivity, invalid priors and tampered posterior rejection;
- queue and scenario reproducibility;
- formulation and selection coverage;
- real tool registry execution;
- end-to-end missions for max flow, TSP, Pareto, Bayesian, queue and scenario comparison;
- real HTTP routes;
- shared Monte Carlo reproducibility after reusing `simulatePert`.

Exact commands and results are recorded in the final delivery report and in `docs/WORA_PROGRESS.md`.

## 9. Known limitations

- No nonlinear or global optimization.
- Max flow is single-commodity and has no lower bounds or gains.
- Min-cost flow has no general lower-bound circulation.
- Bipartite matching is unweighted one-to-one only.
- TSP is exact only below `exactLimit`; above it the result is a labelled heuristic.
- VRP is Clarke–Wright heuristic with no time windows or pickups/deliveries.
- Pareto analysis is exact only over the supplied candidate set; it does not generate a continuous frontier.
- Bayesian inference is limited to conjugate Beta–Binomial and Normal–Normal models.
- Queue simulation assumes exponential interarrival/service times, FCFS and no balking or reneging.
- Scenario comparison treats scenarios as independent PERT models; it is not a causal forecast.
- Production host validation for Docker, MongoDB, Redis and TLS remains outstanding and unchanged.

## 10. Manual configuration

None. The slice adds no new dependency, secret, external paid service or manual environment variable.
