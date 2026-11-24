# WORA Phase 7 — Semantic Reasoning & Problem Intelligence

**Status:** implemented and tested vertical slice. This is not a claim of general intelligence, calibrated probability, causal identification, or a model-provider benchmark. Phase 7.1 corrects forecasting paraphrase/readiness behavior; see `WORA_PHASE7_1_REASONING_RELIABILITY.md`.

**Starting commit:** `e91540b` on `feat/extensions-subsystem`
**Final commit:** the Phase 7 commit on `feat/extensions-subsystem` (`feat(os): add evidence-grounded reasoning and problem intelligence`).

## 1. What Phase 7 adds

Phase 7 extends the existing `UnifiedProblem` and mission lifecycle with an evidence-grounded reasoning layer:

- Claims with explicit provenance: user facts, observed facts, retrieved evidence, assumptions, hypotheses, unknowns, contradictions, constraints, causal relations and conclusions.
- Deterministic problem-type understanding across business/operations, software, data, optimization, forecasting, decision, root-cause, causal, formal-verification and research problems.
- Hypothesis generation only when a problem is genuinely uncertain, with evidence for/against, assumptions, distinguishing tests, heuristic-uncalibrated scores and preserved rejection reasons.
- A limited causal graph that distinguishes observational, assumed and experimental evidence. Only experimental evidence without declared confounders can set `identified: true`.
- Materiality- and cost-aware information needs with a focused clarification question when critical information is missing.
- Scientific method assessment against the real scientific catalog, including explicit capability gaps for unimplemented methods.
- An optional, provider-independent reasoning provider behind a bounded, schema-validated contract. Provider proposals remain unverified and cannot authorize tools, grant permissions, approve actions, or mark conclusions verified.
- Append-only reasoning versions with invalidation tracking and affected-task recommendations. Completed task outputs are never rewritten by reasoning updates.

## 2. Data flow

```text
objective + optional evidence
        |
        v
modelProblem()  (existing UnifiedProblem)
        |
        v
buildDeterministicReasoning()
  claims/provenance -> contradiction scan -> hypotheses
  -> causal graph -> information needs -> method assessment
        |
        +--> optional provider proposal (validated, unverified)
        |
        v
ReasoningModel version N
        |
        +--> os_reasoning_models (append-only)
        +--> mission detail / API / Execution Center
        +--> new evidence -> version N+1, invalidated assumptions,
             affected task ids, replanRecommended=true
```

The execution authority path is unchanged: Tool Registry authorization, approvals, task leases, the orchestrator, independent verification and outcome persistence remain authoritative. Reasoning has no direct tool execution path.

## 3. Claim and provenance model

`api-server/src/os/reasoning-types.ts` defines the versioned contracts.

Every claim carries:

- `kind`: `user-fact`, `observed-fact`, `retrieved-evidence`, `assumption`, `hypothesis`, `unknown`, `contradiction`, `constraint`, `causal-relation`, `conclusion`.
- `provenance`: kind, source id, source, trust, observed time and a SHA-256 digest.
- confidence and confidence kind (`deterministic`, `heuristic`, `uncalibrated`, `calibrated`, `none`).
- evidence ids, supports, contradicts and active state.

A model proposal is stored with `provenance.trust = "model-proposal"`. It is never stored as a verified fact. User-submitted evidence through the API is forced to `unverified` unless it comes from an internal `verification:`, `tool:` or `system:` source.

## 4. Deterministic problem understanding

`reasoning-engine.ts` classifies the problem from structured features and explicit text cues. The classification is lexical and deterministic; it is not universal semantic understanding. Examples:

| Objective | Detected type | Behavior |
| --- | --- | --- |
| `Reduce checkout failures by 20% so that customers can complete purchases reliably` | `root_cause_analysis` | outcome extracted after `so that`; hypotheses; causal gap |
| `Build a multi-tenant SaaS API with role-based access` | `software_engineering` | no forced hypotheses; deterministic planner/typescript checks |
| `Schedule 12 nurses across 5 shifts...` | `optimization` | employee scheduling MIP selected; implemented |
| `Forecast next quarter demand...` | `forecasting` | intent recognized; linear baseline is selected only when observations and horizon are present |
| `Prove ... with a model checker and SMT` | `formal_verification` | model-checking and SAT/SMT reported as gaps |
| `Ice cream sales are associated with drowning...` | `causal_analysis` | observational association, not identified causation |

## 5. Hypotheses

Hypotheses are generated only for root-cause/causal or explicitly uncertain-cause problems. Candidate families include resource exhaustion, configuration drift, dependency/network failure, data quality, permissions, concurrency, measurement artifacts, security compromise, process/human workflow and external market behavior.

Scores are explicitly `heuristic-uncalibrated`. They are lexical evidence-overlap scores, not probabilities. Contradicting clauses can reject a hypothesis while preserving the reason; a supported hypothesis remains unverified.

## 6. Causal reasoning

The causal graph records:

- `observational`: association/correlation only; `identified=false`.
- `assumed`: the user or model asserted a direction; `identified=false`.
- `experimental`: an explicitly experimental evidence item; `identified=true` only when no confounders are declared.

Limitations are stored on each edge. A correlation is never promoted to causation. The catalog reports `causal-inference` as not implemented; WORA does not claim an identification strategy, propensity scoring, instrumental variables or a causal discovery algorithm.

## 7. Information gathering

Information needs are derived from explicit and catalog unknowns. Materiality is `critical`, `high`, `medium` or `low`. Each need records expected information gain, cost (time, money, risk, reversibility), whether WORA can gather it itself, and a recommended action:

- `ask-user` for critical, non-self-gatherable information.
- `gather-self` for critical, self-gatherable information (recommendation only; no hidden execution).
- `proceed-with-assumption` for non-critical information.
- `stop` is reserved for future policy use.

Generic missing acceptance criteria do not trigger a question. A focused question is emitted only when the unknown is explicit and decision-critical, or a contradiction must be resolved.

## 8. Scientific method selection

Method assessment reuses `listScientificDomains()` and the existing algorithm catalog. Each assessment records applicability, reason, required inputs, assumptions, expected outputs, limitations, evidence requirements, implementation status, external capability need and gap text.

Unimplemented methods are never marked executable. Examples:

- Formal verification: `model-checking` and `sat-smt` are gaps; `zod-contracts` is implemented but is not a proof.
- Causal analysis: `causal-inference` is a gap; the graph is explanatory only.
- Nonlinear optimization: `nonlinear-optimization` is a gap.
- Bayesian inference: `bayesian-inference` is a gap.
- Learned classification: `classification` is a gap.

## 9. Optional reasoning provider

The provider is disabled by default. No paid provider is activated and no key is committed.

Configuration:

```bash
WORA_REASONING_PROVIDER=openai-compatible
WORA_REASONING_BASE_URL=https://provider.example/v1
WORA_REASONING_MODEL=<model-id>
WORA_REASONING_API_KEY=<secret>          # optional; never logged or returned
WORA_REASONING_TIMEOUT_MS=12000
WORA_REASONING_MAX_ATTEMPTS=2
WORA_REASONING_MAX_TOKENS=1200
```

The adapter:

- sends a bounded context (facts, assumptions, unknowns, evidence, methods);
- uses a strict JSON proposal schema;
- enforces timeout, retry limits, max tokens and cancellation;
- records estimated usage through the existing AI usage ledger;
- treats all proposals as unverified;
- falls back to deterministic reasoning on timeout, malformed JSON, HTTP error or invalid schema.

The local fixture in `phase7.test.ts` proves the adapter contract, not an external model's quality. No provider benchmark is claimed.

## 10. Adaptive updates and persistence

Additive migration 11 creates `os_reasoning_models`:

```sql
CREATE TABLE os_reasoning_models (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES os_missions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, mission_id, version)
);
```

`reasoning-store.ts` appends a version on every update. The latest version is the current model; old versions remain readable. New evidence can:

1. validate provenance (user evidence stays unverified);
2. add claims;
3. detect new contradictions;
4. invalidate assumption claims;
5. re-rank/update hypotheses;
6. recompute information needs;
7. set `replanRecommended` and affected non-completed task ids.

It does **not** automatically rewrite the plan or rerun tasks. Completed task outputs and checkpoints are preserved. An operator or the existing replan endpoint applies the plan change through the normal governance path.

## 11. API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/os/reasoning/status` | Provider configured/disabled status; no key |
| `POST` | `/api/os/problems/reason` | Build a reasoning model for an objective; optional user evidence |
| `GET` | `/api/os/missions/:id/reasoning` | Current reasoning model |
| `GET` | `/api/os/missions/:id/reasoning/versions` | Version history (bounded) |
| `POST` | `/api/os/missions/:id/reasoning/evidence` | Add user evidence; creates a new version |

All routes use the existing workspace/session authorization. User evidence cannot self-declare `observed-fact` or `verified`; the API accepts only `user-fact` or `assumption` and forces unverified provenance.

Mission detail now includes `reasoning`, and `UnifiedProblem` includes a compact `reasoning` summary.

## 12. UI

The Execution Center adds an Arabic-first, RTL-safe panel:

- deterministic / model-assisted / fallback mode;
- desired outcome, problem type, version and heuristic confidence;
- sufficiency and the focused clarification question;
- user facts, assumptions and unknowns;
- ranked hypotheses, statuses and uncalibrated score labels;
- causal edges with observational/assumed/experimental labels and identification state;
- information needs with materiality, action and expected gain;
- selected method and explicit gaps;
- contradictions, recent reasoning changes and limitations.

No decorative controls were added. The panel is display-only; evidence changes go through the real API and produce new versions.

## 13. Evaluation

`reasoning-evaluation.ts` keeps 20 development scenarios and 10 held-out scenarios separate. Expectations live only in the evaluation file.

| Suite | Result |
| --- | --- |
| Development | **20/20 passed** |
| Held-out | **9/10 passed** |
| Understanding | 27/28 checks |
| Hypothesis quality | 8/8 |
| Causal reasoning | 6/6 |
| Information gathering | 28/28 |
| Method selection | 27/27 |
| Reliability/provenance | 4/4 |

The held-out failure is reported honestly: `held-subscription-revenue` (`Project monthly subscription revenue for the next six months from historical totals.`) is classified as `business_operations` instead of `forecasting`. It was not tuned away after the held-out run. This is a real lexical-classification limitation, not a hidden pass.

Baseline comparison: the Phase 6 baseline has no separate desired-outcome field, no hypothesis/causal/information layer and no semantic method assessment. Its outcome score is reported as 0 rather than inflating it from objective text.

No external model-provider benchmark was run. The evaluation output sets `providerBenchmark: "not-run"` and states this explicitly.

## 14. Adversarial and safety tests

`phase7.test.ts` covers:

- prompt injection in the objective and evidence;
- model proposals attempting to become facts, permissions or verified conclusions;
- user attempts to self-declare verified evidence through the API and internal store;
- malformed provider JSON;
- provider timeout;
- bounded provider context and absence of the API key from the request body;
- contradictory evidence;
- observational correlation not promoted to causation;
- unsupported methods reported as gaps;
- reasoning version history and invalidation without touching completed tasks.

## 15. Verification commands and exact results

```bash
cd api-server && npx tsc --noEmit
cd api-server && npm test
cd api-server && npx tsx --test src/os/phase7.test.ts
cd api-server && npm run build
cd client && npx tsc --noEmit
cd client && npm test
cd client && npm run test:e2e
cd client && npm run build
```

Observed results at delivery:

- API full suite: **334 tests, 333 passed, 1 skipped, 0 failed**
- Phase 7 suite: **16/16 passed**
- API typecheck: pass
- API production build: pass
- Client unit suite: **50/50 passed**
- Browser E2E: **1/1 passed**
- Client typecheck: pass
- Client production build: pass

## 16. Feature classification

**Implemented and tested**

- Claim/provenance separation; deterministic problem type; outcome extraction.
- Hypothesis generation/ranking/rejection and evidence updates.
- Observational/assumed/experimental causal graph with limitations.
- Information-needs and focused clarification behavior.
- Method assessment with implemented/gap status.
- Optional provider adapter contract, timeout, malformed-output fallback and proposal boundary.
- Append-only reasoning versions, assumption invalidation and affected-task recommendation.
- Mission integration, API authorization and Execution Center panel.
- Development and held-out evaluation; adversarial tests.

**Implemented but partially tested**

- Adaptive impact mapping: affected task ids are computed lexically from invalidated assumptions; automatic partial replanning is not executed.
- Provider integration: the adapter is tested against a local fixture; no real external provider was configured or quality-benchmarked.
- Causal reasoning: graph extraction and evidence labels are implemented; causal identification is not.

**Partially implemented**

- Semantic understanding: deterministic lexical cues and structured features, not general language understanding.
- Information gathering: recommendations are implemented; autonomous external collection is not wired to a tool.
- Contradiction detection: lexical overlap plus negation; not full logical consistency.

**Not implemented**

- Causal identification (propensity scores, instrumental variables, causal discovery).
- Bayesian posterior inference, model checking, SMT solving, nonlinear optimization, learned classifiers.
- Automatic provider activation, paid services, or model-driven execution authority.
- Full OS sandbox for native plugins; distributed consensus; cross-host queue.
- Universal semantic planner or general intelligence.

## 17. Manual configuration

- No configuration is required for deterministic reasoning.
- To enable an optional provider, set the six `WORA_REASONING_*` variables above. This is not required for tests or for Phase 7 functionality.
- No API key is stored in the repository, database, UI response or provider request body.
- External provider quality, pricing and availability are deployment concerns and were not tested here.
