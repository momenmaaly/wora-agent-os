# WORA Progress and Verified Baseline

**Updated:** 2026-11-24
**Branch:** `feat/extensions-subsystem`
**HEAD at audit:** `a5a4e0a` — Remediate Phase 1 security findings F1–F13
**Latest committed units:** `07d34f1` algorithm catalog; `6b5c483` verification records
**Working tree:** action-classification unit implemented, pending final commit
**Remote main at audit:** `a1ca08c`
**Rule:** this file records only work verified by source inspection, commands, tests or live HTTP probes. It is not a marketing status page.

## 1. Verified repository baseline

The repository is a monorepo with an Express 5 + TypeScript API (`api-server/`), a React 18 + Vite client (`client/`), a zero-dependency device reference agent, shared types, Nginx/Compose deployment files and documentation.

Verified on this branch before the first implementation unit:

| Check | Result |
| --- | --- |
| API tests (baseline before first unit) | 111 tests: 110 passed, 1 skipped (MongoDB opt-in), 0 failed |
| API typecheck | Pass |
| API build | Pass |
| Client tests | 44 passed, 0 failed |
| Client typecheck | Pass |
| Client build | Pass |
| Git worktree | Clean before the implementation unit |

The local branch is based on `main` through `a1ca08c → e7f9939 → b488832 → a5a4e0a`. The reviewed remote main is `a1ca08c`; the local branch is not yet pushed because the available GitHub token has read-only repository access (documented in the prior delivery).

## 2. Existing capability inventory

These capabilities were found in source and tests, not inferred from UI labels:

- Persistent SQLite OS core with missions, tasks, runs, handoffs, artifacts, approvals, memory, roles, boards, twins and audit records.
- Deterministic mission planner with five verified journeys and a generic fallback.
- Persistent agent registry with 18 seeded specializations and version snapshots.
- Permissioned tool registry with JSON-schema inputs, risk tiers, timeouts, allowlists and audit rows.
- Real HiGHS LP/MIP solving, Hungarian assignment, employee/shift MIP, PERT Monte Carlo, weighted decision matrix, descriptive statistics and linear-trend forecasting with holdout backtest.
- Scoped memory with ownership/visibility, TTL and version snapshots.
- RBAC v1 (`viewer < member < admin < owner`) enforced server-side.
- Extensions subsystem: Git marketplaces, manifest validation, dependency plans, install/update/rollback/uninstall, agent capability profiles, secrets, plugin tools, MCP and audit.
- Durable board JSON, digital twins, playbooks, organization builder, device pairing/revocation.
- High-risk tool approval gate and single-writer SQLite lease with epoch fencing.
- Real host diagnostics and workspace-confined file tools.

## 3. Missing capability inventory

The following gaps remain after inspection. They are ordered by risk and dependency value:

1. **General problem understanding is deterministic and keyword/track based.** There is no probabilistic classifier, ambiguity handling or structured problem model with confidence.
2. **No durable multi-worker execution queue.** Missions run in-process; restart recovery marks interrupted work but there is no lease-based worker queue, retry policy, checkpointing or cancellation API.
3. **Governance is tool-risk-centric.** There are no first-class action classes A/B/C, transaction-specific approval scopes, expiry, budgets or per-action permission review.
4. **Verification is tool-specific.** `reviewRun` has deterministic checks per tool, but there is no general verification record that binds objective, acceptance criteria, expected output, evidence, independent result and failure reason.
5. **Learning lifecycle is incomplete.** Playbooks and memory exist; candidate lessons are not collected, evaluated, tested and promoted through a controlled lifecycle.
6. **Model routing and cost controls are partial.** Usage records exist, but there is no provider-independent routing, fallback/circuit-breaker policy or hard budget enforcement for OS missions.
7. **End-to-end product creation is not a reusable workflow.** Organization/scaffold pieces exist; market validation, product definition, launch readiness and post-launch monitoring are not integrated.
8. **Sandboxing is incomplete.** Generated tests and stdio MCP remain host processes; stdio MCP is disabled by default as containment.
9. **Tenancy and identity are incomplete.** Sessions are HMAC tokens; organizations/projects cannot be shared across users.
10. **No CI, no migration versioning, no OpenTelemetry and no browser E2E suite.**
11. **Skills are not injected into planner/model context; auto-load is still a flag.**
12. **The client still has substantial hardcoded Arabic in older OS pages.**

## 4. First implementation unit — algorithm selection

**Status:** implemented and tested locally. Not a claim of general intelligence.

Added `api-server/src/os/algorithms.ts`, a deterministic, explainable selector over algorithms that already exist in WORA:

- Explicit `kind` is highest-confidence.
- Structured features (`hasCostMatrix`, `hasEmployees`, `hasShifts`, `hasUncertainty`, `hasTimeSeries`, `hasCriteria`, `hasAlternatives`, `integerVariables`, `nonlinear`) outrank text.
- Objective keywords are a lower-confidence fallback.
- Unknown problems return `needs_input`; nonlinear problems return `unsupported`; no solver is invented.
- Every choice returns required inputs, guarantees, verification checks, limitations, cost class and alternatives.

Integration:

- `meta.select_algorithm` is registered as a low-risk, permission-free core tool.
- `GET /api/os/algorithms` exposes the catalog.
- `POST /api/os/algorithms/select` returns a selection.
- The optimization planner records the selected algorithm and guarantee in its task detail.

Acceptance evidence:

- `api-server/src/os/algorithms.test.ts`: 9 tests, all passing.
- Catalog integrity test proves every advertised `toolId` resolves in the real tool registry.
- Route test proves the HTTP API returns the catalog and a real selection.
- Unsupported/nonlinear and unknown problems fail closed.

## 4b. Second implementation unit — verification records

**Status:** implemented and locally tested. Pending final commit.

Added `api-server/src/os/verification.ts` and `os_verifications`:

- One durable record per run attempt with objective, acceptance criteria, expected output, actual output, evidence, structured checks, result, independence, failure reason, verifier and timestamp.
- Orchestrator writes a passed/failed record after every run review and a blocked record on capability denial.
- Mission detail includes verification records; `GET /api/os/missions/:id/verifications` and `GET /api/os/verifications/:id` expose them.
- Workspace isolation is enforced in every query.

Evidence: `api-server/src/os/verification.test.ts` (4 tests: passed mission, explicit failure, workspace isolation, HTTP API). API suite after this unit: **124 tests, 123 passed, 1 skipped, 0 failed**.

Limitations: deterministic review only, not external audit; no signed artifact binding; no property-based/performance/API-contract check families yet.

## 4c. Third implementation unit — action classification

**Status:** implemented and locally tested. Pending final commit.

Added `api-server/src/os/actions.ts`:

- A/B/C classification for safe, controlled and high-risk actions.
- Escalation for high risk, money, external/legal commitment, sensitive disclosure and irreversibility.
- Expired authorizations are downgraded to B and cannot run automatically.
- Invalid expiry and negative/oversized amounts fail closed.
- `meta.classify_action` tool and `POST /api/os/actions/classify`.

Evidence: `api-server/src/os/actions.test.ts` (8 tests). API suite after this unit: **132 tests, 131 passed, 1 skipped, 0 failed**.

Limitation: the classifier is available to agents and the API but is not yet enforced for every orchestrator action. Class C approvals still use the existing high-risk tool gate; payload-digest, scope and expiry binding in the approval table is not yet implemented.

## 5. Next eligible tasks

In dependency order:

1. **Complete action-class governance**: persist action contracts with payload digest, scope and expiry; enforce B/C before every side effect; add budget ledger and expiry sweeper.
2. **Durable execution queue**: lease-based worker claim, heartbeat, retry policy, cancellation and restart recovery; keep SQLite single-writer semantics.
3. **Problem-understanding model**: structured problem profile with constraints, uncertainty, dependencies and confidence; feed the algorithm selector.
4. **Skill context injection**: load assigned skill instructions into the planner/agent context with provenance and token budgets.
5. **Benchmark suite**: reproducible task fixtures for assignment, scheduling, forecasting, decision analysis and verification; no fabricated results.

## 6. Current evidence and limitations

After the algorithm unit: **API 120 tests: 119 passed, 1 skipped, 0 failed**. After the verification unit: **API 124 tests: 123 passed, 1 skipped, 0 failed**. After the action-classification unit: **API 132 tests: 131 passed, 1 skipped, 0 failed**. API typecheck and build pass.

- The first unit is locally tested; it is not yet exercised by a live external marketplace or a model-driven planner.
- The selector is deterministic and intentionally conservative. It does not claim semantic understanding of arbitrary natural language.
- Keyword selection can misclassify ambiguous objectives; structured features or an explicit kind are preferred.
- No comparative benchmark against alternative algorithms has been run yet.
- No production deployment, merge or push was performed.
