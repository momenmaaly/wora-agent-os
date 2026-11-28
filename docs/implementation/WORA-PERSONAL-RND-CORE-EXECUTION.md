# WORA Personal — Autonomous R&D Core Execution Plan

Status: implementation plan for `feat/wora-personal-rnd-core`
Base: `release/wora-v1`

## Product boundary

WORA Personal is the private research-and-development evolution of the existing WORA repository. It is not a second application and must not introduce a parallel mission orchestrator or duplicate reasoning store.

The current mission lifecycle remains the execution backbone:
- `createMission` / `executeMission` in `api-server/src/os/orchestrator.ts`
- existing task assignment, agent registry, leases, checkpoints, verification and audit
- existing reasoning model and versioned JSON persistence in `os_reasoning_models`

WORA Public is a later stable product distribution produced by Personal. Public runtime telemetry, failures and user needs may be ingested as research inputs, but public data must be explicitly scoped, minimized and provenance-tagged.

## Accepted research policy

- Research objective: scientific and engineering research (both).
- Autonomy: evolving autonomy; the system may choose research questions, methods, tools and experiments within its execution envelope.
- Model development: hybrid (use existing external models and develop/train models where evidence and compute justify it).
- Runtime: hybrid cloud and local workers.
- Research policy: controlled experiments with reproducibility, evidence, evaluation and promotion gates. This is not a requirement to ask the user before every non-financial operation.

Financial actions and actions that spend or transfer money remain approval-gated. Ordinary research, coding, testing and internal iteration are not classified as financial actions.

## Existing capabilities to reuse

- Mission orchestration and agent handoffs.
- Problem formulation and deterministic/model-assisted reasoning.
- Research planning, retrieval through already-authorized tools, provenance, synthesis and conflict recording.
- Scientific problem formulation and algorithm/method catalog.
- Independent verification and outcome verification.
- Cloud computer/browser runtime and isolated execution boundaries.
- Audit events, task leases, checkpoints and existing test suites.

## Verified gaps to close

1. No general web-search provider is connected to the research planner; current research relies on explicit URLs or already-authorized retrieval tools.
2. Research source publication dates are not parsed and source freshness is not scored.
3. Conflicts are recorded, but the research workflow does not autonomously create a follow-up plan to resolve them.
4. Research state is stored in versioned reasoning JSON; there is no dedicated queryable research-artifact/evaluation index.
5. There is no complete experiment registry with reproducible datasets, configurations, seeds, metrics and artifacts.
6. There is no integrated model lab for dataset governance, training/fine-tuning jobs, model evaluation and model registry.
7. There is no end-to-end self-improvement promotion/rollback loop for code, methods or models.
8. The V1 deployment contract is not evidence of a live production environment; production readiness must be established with real `/health` and `/ready` checks.

## Target layers

1. **Research Director** — prioritizes goals and decomposes research programs into missions using the existing orchestrator.
2. **Research Teams** — specialized agents for literature review, mathematics, software, data, model research and independent review; agents exchange structured handoff contracts.
3. **Research Acquisition** — general web and academic search adapters, retrieval, provenance, publication-date extraction, freshness and source-quality signals.
4. **Reasoning and Hypothesis Engine** — extends the existing reasoning model; tracks hypotheses, assumptions, unknowns, contradictions and follow-up questions.
5. **Experiment Lab** — isolated Python/compute workers, experiment specifications, datasets, seeds, metrics and immutable artifacts.
6. **Model Lab** — model/provider adapters, dataset preparation, fine-tuning/training, evaluation and model registry; training is scheduled only when data, compute and expected value justify it.
7. **Engineering Lab** — isolated repository workspaces, code generation, tests, security checks and review.
8. **Knowledge and Artifact Store** — searchable research documents, evidence, experiment results, model artifacts and provenance, while retaining existing mission/reasoning persistence until a migration is justified.
9. **Evolution Controller** — compares candidate changes with baselines, runs regression and benchmark suites, promotes only passing versions and supports rollback.
10. **WORA Public Factory** — builds a stable public distribution from a promoted Personal release, with a feedback channel back to Personal.

## Implementation sequence

### Phase 0 — repository and runtime baseline
- Map current mission, agent, tool, research, verification, storage and runtime contracts.
- Record which tests run in CI and which require MongoDB, Redis, Docker/DinD, Chromium or external credentials.
- Do not describe deployment prerequisites as already provisioned.
- Preserve the current V1 runtime contract until a tested replacement exists.

### Phase 1 — R&D program core
- Add a durable research-program abstraction that references existing mission IDs rather than replacing missions.
- Add program goals, workstreams, dependencies, status, evidence requirements and structured deliverables.
- Add a director that schedules existing missions and accepts their verified outputs.
- Add explicit pause/resume/cancel and recovery behavior using existing leases/checkpoints.
- Keep the first slice provider-neutral and avoid new paid services.

### Phase 2 — research acquisition
- Define provider-neutral search result and source contracts.
- Add general web and academic search adapters behind existing tool permissions and audit.
- Parse publication/updated dates where available; store retrieval time separately.
- Add source freshness and provenance signals without presenting heuristics as truth.
- Add tests for missing dates, stale sources, duplicates, hostile URLs, timeouts and provider failures.

### Phase 3 — teams and evidence resolution
- Add specialist team definitions and structured handoffs.
- Let the director create follow-up missions for material conflicts or unanswered critical questions.
- Require independent review for high-impact conclusions.
- Never convert a failed retrieval or model proposal into verified evidence.

### Phase 4 — experiment and model labs
- Introduce reproducible experiment specifications and immutable result artifacts.
- Add Python workers only inside isolated, resource-limited execution environments.
- Add model training/fine-tuning adapters only after dataset provenance, licensing, privacy, compute budgets and evaluation criteria are explicit.
- Track baseline comparisons, seeds, resource usage and model/data versions.

### Phase 5 — controlled self-evolution
- Run candidate code/method/model changes in isolated branches and environments.
- Require unit, integration, security, regression and task-specific benchmark results.
- Promote only when the candidate beats or safely matches its baseline under declared criteria.
- Keep automatic rollback and retain the last known-good version.
- Never merge into the release branch or deploy without explicit user approval.

### Phase 6 — Public factory and feedback
- Produce public releases from tagged, verified Personal versions.
- Keep Personal-only research tools, credentials and private artifacts out of public builds.
- Feed privacy-minimized operational metrics and failure categories back into Personal research.

## Initial acceptance criteria

The R&D core is not complete until it can:
- create and persist a research program;
- decompose it into linked missions using the existing orchestrator;
- assign work to specialist agents with explicit handoff contracts;
- collect only real, provenance-bearing outputs;
- schedule follow-up work for unresolved material questions;
- resume safely after worker interruption;
- expose program progress and evidence status;
- run deterministic tests without requiring paid model APIs;
- preserve the existing mission, verification and governance test suites.

## Non-goals for the first implementation slice

- No rewrite of the existing orchestrator.
- No second reasoning engine or parallel agent registry.
- No database migration before a demonstrated query/scale need and a tested backup/restore plan.
- No mandatory paid model/search provider.
- No automatic production deployment.
- No financial action without approval.
