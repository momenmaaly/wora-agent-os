# WORA Progress and Verified Baseline

**Updated:** 2026-11-24 (production readiness phase)
**Branch:** `feat/extensions-subsystem`
**HEAD at audit:** `321d69b` — Production readiness and adversarial validation
**Latest committed units:** `321d69b` production readiness, adversarial and browser validation; `883efd7` audit hardening, concurrent scheduler, formal planning, expanded verification, lesson lifecycle, expanded benchmarks and UI; `a221fec` class C tool-boundary guard; `1fe32e4` governance enforcement, durable runtime, problem understanding, independent verification, learning and benchmarks; `07d34f1` algorithm catalog; `6b5c483` verification records; `f965594` action classification
**Working tree:** clean after the production-readiness commit
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
10. **No CI, no migration versioning and no OpenTelemetry.** Browser E2E now exists (`client/tests/browser-e2e.test.mjs`) but runs against the preview API, not production signed sessions.
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

**Status:** implemented, tested and committed as `f965594`.

Added `api-server/src/os/verification.ts` and `os_verifications`:

- One durable record per run attempt with objective, acceptance criteria, expected output, actual output, evidence, structured checks, result, independence, failure reason, verifier and timestamp.
- Orchestrator writes a passed/failed record after every run review and a blocked record on capability denial.
- Mission detail includes verification records; `GET /api/os/missions/:id/verifications` and `GET /api/os/verifications/:id` expose them.
- Workspace isolation is enforced in every query.

Evidence: `api-server/src/os/verification.test.ts` (4 tests: passed mission, explicit failure, workspace isolation, HTTP API). API suite after this unit: **124 tests, 123 passed, 1 skipped, 0 failed**.

Limitations: deterministic review only, not external audit; no signed artifact binding; no property-based/performance/API-contract check families yet.

## 4c. Third implementation unit — action classification

**Status:** implemented, tested and committed as `f965594`.

Added `api-server/src/os/actions.ts`:

- A/B/C classification for safe, controlled and high-risk actions.
- Escalation for high risk, money, external/legal commitment, sensitive disclosure and irreversibility.
- Expired authorizations are downgraded to B and cannot run automatically.
- Invalid expiry and negative/oversized amounts fail closed.
- `meta.classify_action` tool and `POST /api/os/actions/classify`.

Evidence: `api-server/src/os/actions.test.ts` (8 tests). API suite after this unit: **132 tests, 131 passed, 1 skipped, 0 failed**.

Enforcement completed in workstream 1: payload-digest, scope, expiry, single-use consumption, budgets and tool-boundary guards are now live. See sections 4d–4i.

## 4d. Workstream 1 — governance enforcement

**Status:** implemented, tested and integrated.

- `os_approvals` now stores action class, scope, canonical payload digest, expiry, amount, consumption and consumer.
- High-risk actions always require approval; autopilot cannot bypass class C.
- Approvals are single-use; payload substitution, scope widening, cross-mission replay and expired approvals fail closed.
- `runTool` re-validates a high-risk approval at the registry boundary; direct API and extension execution paths refuse high-risk tools.
- Workspace action budgets default to zero spend, 10 class C approvals per mission and a 60-minute approval TTL; `GET/POST /api/os/settings/action-budget`.
- Evidence: `governance-enforcement.test.ts` (8 adversarial tests) plus the existing approval/denial mission tests.

## 4e. Workstream 2 — durable autonomous runtime

**Status:** first slice implemented, tested and integrated.

- `os_task_leases`: atomic claim, owner, heartbeat, expiry; one active owner per task.
- `os_task_checkpoints`: started/completed/failed/blocked per run, with output/evidence digests.
- Orchestrator claims before execution, heartbeats during execution and releases in `finally`.
- Pause, resume and cancel are persisted and exposed as real endpoints; cancel clears leases.
- Restart recovery clears stale leases and leaves completed tasks intact.
- A started-but-unfinished checkpoint blocks a duplicate side effect as `side_effect_uncertain`.
- Evidence: `task-queue.test.ts` (8 tests), including expiry recovery, pause/resume, cancellation, restart and duplicate-side-effect protection.
- Limit: the mission executor is still sequential; the claim layer supports multiple workers, but a fully concurrent mission scheduler is not implemented.

## 4f. Workstream 3 — structured problem understanding

**Status:** first slice implemented and persisted with missions.

- `os/problem.ts` extracts domain, constraints, dependencies, resources, uncertainty, success criteria, missing information and ambiguity.
- Structured features feed the real algorithm selector; unsupported nonlinear problems stay unsupported.
- Profiles are stored in `os_problem_profiles` and returned with mission detail; `GET /api/os/missions/:id/problem`, `POST /api/os/problems/understand` and `meta.understand_problem`.
- Deterministic fallback is explicit; no semantic-model claim.
- Evidence: `problem.test.ts` (5 tests).

## 4g. Workstream 4 — independent verification

**Status:** implemented and integrated with the orchestrator.

- API-contract, deterministic property, secret-leak and artifact-digest checks run after the executor.
- The acceptance review and independent checks must both pass; failures cause a retry or an honest failed result.
- Verification records now name `wora.verifier/independent` and include the independent checks and digest.
- Evidence: `independent-verification.test.ts` (4 tests) plus the existing verification suite.

## 4h. Workstream 5 — memory and experience learning

**Status:** first slice implemented and tested.

- Completed verified missions collect candidate lessons only.
- Evaluation is explicit; promotion is an authorized action that writes semantic memory with provenance; rejection is explicit.
- No candidate is auto-promoted.
- Evidence: `lessons.test.ts` (4 tests).

## 4i. Workstream 6 — scientific benchmarks

**Status:** first reproducible suite implemented and measured.

- 12-domain capability map with implemented/partial/missing lists.
- Seven real fixtures: assignment, employee schedule, LP, seeded Monte Carlo, linear forecast, weighted decision and descriptive statistics.
- Independent references/repeatability checks, measured time, limitations and persisted runs.
- Sample run: 7/7 passed, 115.375 ms total on the development container (timing is environment-specific).
- APIs: `GET /api/os/benchmarks/domains`, `POST /api/os/benchmarks/run`, `GET /api/os/benchmarks/runs`.
- Evidence: `benchmarks.test.ts` (4 tests).

## 6. Current evidence and limitations

After the algorithm unit: **API 120 tests: 119 passed, 1 skipped, 0 failed**. After the verification unit: **API 124 tests: 123 passed, 1 skipped, 0 failed**. After workstreams 1–6: **API 168 tests: 167 passed, 1 skipped, 0 failed**. After workstreams 7–12: **API 183 tests: 182 passed, 1 skipped, 0 failed**. After the production-readiness phase: **API 210 tests: 209 passed, 1 skipped, 0 failed; client 49/49; browser E2E 1/1**. API typecheck and build pass.

- The first unit is locally tested; it is not yet exercised by a live external marketplace or a model-driven planner.
- The selector is deterministic and intentionally conservative. It does not claim semantic understanding of arbitrary natural language.
- Keyword selection can misclassify ambiguous objectives; structured features or an explicit kind are preferred.
- No comparative benchmark against alternative algorithms has been run yet.
- No production deployment, merge or push was performed.


## 4j. Workstream 7 — adversarial audit and hardening

**Status:** implemented, tested and committed as `883efd7`.

Confirmed defects fixed:

- Approval consumption was a check-then-update race and could be replayed at the tool boundary. Consumption is now a single `BEGIN IMMEDIATE` transaction with a conditional `UPDATE ... WHERE consumed_at IS NULL`; `runTool` consumes the approval itself after schema validation and before execution.
- The orchestrator previously consumed an approval before claiming the task, losing it if another worker won the claim. Consumption now happens only at the claimed execution boundary.
- Expired or malformed approval timestamps fail closed; an explicit expiry cannot exceed the workspace approval TTL; a lowered amount budget blocks an already-approved amount at consumption.
- Checkpoints are validated against their task's workspace and mission and cannot downgrade a completed or failed checkpoint.
- Lease heartbeats use a conditional update and cannot revive an expired lease; expired-lease recovery does not rewrite completed or cancelled tasks.
- Checkpoint and plan ownership are workspace-scoped.
- Lesson evaluation re-reads the real verification record and requires both acceptance-review and artifact-integrity checks; fake evidence is rejected.
- Lesson promotion is transactional and cannot double-promote.
- Cancellation observed during a tool run records the run as cancelled and does not accept its result or write a handoff.
- Orphaned task assignments with no active lease are finalized as blocked instead of leaving the mission running forever.
- Benchmark schedule correctness now requires the expected shift count and a finite non-negative cost.
- The independent verifier scans evidence as well as output and rejects successful but empty output.

Evidence: expanded `governance-enforcement.test.ts` (11 tests), `task-queue.test.ts` (11 tests), `lessons.test.ts` (6 tests), `independent-verification.test.ts` (5 tests), production-readiness suites (`security-adversarial.test.ts` 6, `scheduler-stress.test.ts` 8, `mission-e2e.test.ts` 6, `planning-evaluation.test.ts` 4) and full suite **210 tests: 209 passed, 1 skipped**.

## 4k. Workstream 8 — concurrent mission scheduler

**Status:** implemented on the existing lease layer.

- `executeMission` accepts `concurrency` (1–8) and a per-workspace `execution_limits` setting (`maxConcurrentTasks`, `leaseTtlMs`, `maxAttempts`).
- Independent tasks run through multiple real workers; each task is claimed atomically and heartbeated.
- Dependencies are checked against live database state, so a dependent task cannot run before its predecessor completes.
- Failed dependencies block dependents; independent tasks continue.
- Lease expiry recovery and orphaned-assignment finalization prevent stuck missions.
- Cancellation propagates into a running task result.
- `POST /api/os/missions/:id/execute` accepts `{concurrency}`; `GET/POST /api/os/settings/execution-limits` expose the limits.
- Evidence: `task-queue.test.ts` now covers independent parallel tasks, dependency ordering, expired-lease recovery, checkpoint integrity and completed-task protection.

Limitations: workers run in one API process; SQLite remains the single-writer boundary. No cross-process scheduler daemon is claimed.

## 4l. Workstream 9 — formal planning

**Status:** implemented and persisted.

- `os/planning.ts` formalizes deterministic tasks into goals, subgoals, preconditions, effects, constraints, resources, uncertainty and risk-weighted cost.
- Two deterministic alternatives are compared: direct order and risk-first order over the same real task graph. No unimplemented capability is proposed.
- Critical path and metrics are computed; dependency cycles are rejected.
- `os_plan_versions` stores every initial and replanned version with reason and actor.
- `replanMission` proposes a plan from remaining work without mutating the task graph.
- APIs: `GET /api/os/missions/:id/plans`, `POST /api/os/missions/:id/replan`; mission detail includes plan versions and structural verification.
- Evidence: `planning.test.ts` (6 tests), including cycle rejection and workspace isolation.

Limitations: costs are risk-weighted planning estimates, not money or wall-clock time; the planner remains deterministic and template-based.

## 4m. Workstream 10 — verification expansion

- New checks: output quality, dependency satisfaction, lease ownership and checkpoint continuity.
- `verifyPlanExecution` independently checks missing dependencies, premature completion and failure propagation.
- Mission detail exposes `planVerification`.
- Evidence: `planning.test.ts`, `independent-verification.test.ts`, `verification.test.ts`.

Limitations: structural verification is not a formal proof; it complements, but does not replace, runtime evidence.

## 4n. Workstream 11 — lesson lifecycle

- Added promotion history (`os_lesson_events`), observed effectiveness, outcome recording, revocation and memory deletion.
- Statuses: candidate, tested, promoted, rejected, revoked.
- Revocation is admin-gated at the API and removes the promoted semantic memory while preserving history.
- No automatic promotion.
- APIs: history, outcomes and revoke endpoints.
- Evidence: `lessons.test.ts` (6 tests).

## 4o. Workstream 12 — benchmark expansion and UI

- Suite version 1.1.0 now has **14 fixtures**, including problem understanding, planning comparison, algorithm selection, dependency/failure verification, independent verification accuracy, human-intervention classification and multi-agent plan structure.
- All 14 pass; sample run: **14/14, 0 failed, 176.296 ms** on the development container. Timing is environment-specific.
- UI: execution center now exposes pause/cancel/concurrency, problem profile, plan versions, plan verification, leases and independent verification history; System Console exposes execution limits; Intelligence Hub adds lesson lifecycle and benchmark tabs. All controls call real APIs.
- Evidence: client **49/49** (including browser E2E), typecheck and production build green.

## 4p. Workstream 13 — production readiness and adversarial validation

**Status:** implemented and measured. Full report: `WORA_PRODUCTION_READINESS.md`; planning analysis: `WORA_PLANNING_EVALUATION.md`.

- **Security:** `security-adversarial.test.ts` 6/6 covers approval replay, payload substitution, scope widening, cross-workspace lookup, workspace isolation, admin-only lesson lifecycle and secret redaction. Cancellation now wins over finalization; `paused` missions are preserved.
- **Secrets:** `os/secrets.ts` redacts known credential signatures and secret-named environment values from audit writes/reads, run evidence, verification records, artifacts and mission/approval views. Raw execution inputs remain in SQLite; at-rest encryption is not implemented.
- **Scheduler:** `scheduler-stress.test.ts` 8/8 covers 2/4/8 workers, dependency chains, expired leases, retry exhaustion, failed dependencies and cancellation during a running tool. Timings are short-task measurements, not capacity claims.
- **Missions:** `mission-e2e.test.ts` 6/6 covers application build, generate/scan/test under approval, resource scheduling, missing-information disclosure, interrupted recovery and explicit approval. General code repair is not implemented.
- **Planning:** `planning-evaluation.test.ts` 4/4 shows risk-first reorders without reducing total cost; the 6-task chain is forced; the existing MIP solves 20×5 at cost 480 in 95–211 ms. No HTN/A*/CP was added.
- **Browser:** `client/tests/browser-e2e.test.mjs` starts the real preview API and Vite server, then drives Chromium through mission creation, problem profile, plan verification, pause/resume/cancel, approval digest, evidence, lesson evaluate/promote/revoke and benchmarks (`14/14`).
- **Defects fixed:** cancelled missions overwritten by `finalizeMission`; missing `paused` client contract/label/resume; shared rate-limit bucket causing cross-endpoint `429`.

Limitations: preview auth only in browser E2E; one Chromium version; SQLite single writer; heuristic redaction; no OS-level plugin sandbox; no at-rest secret encryption; no CI/OTel.

## 5. Next eligible tasks

1. Inject approved skill instructions into planner/model context with provenance and token budgets.
2. Add cross-process scheduler supervision and a real multi-process contention harness.
3. Add approval quorum/delegation and an expiry sweeper.
4. Add lesson post-promotion regression monitoring tied to later failed missions.
5. Add signed artifact verification and an external verifier adapter.


## 4q. Workstream 14 — security architecture and autonomous engineering

**Status:** implemented and measured. Full design and threat model: `WORA_SECURITY_ARCHITECTURE.md`.

- **Secret keyring:** deployment-supplied 32-byte keys with key ids; AES-256-GCM field encryption with AAD; explicit dry-run migration and rotation; legacy rows remain readable and fail closed when a key is missing.
- **Approval integrity:** generated target/consequences/resource-impact review, review digest, encrypted approval payload, integrity checks at consumption, and UI display of the review.
- **Sessions:** durable session registry with revocation; API and Socket.IO reject revoked sessions; cross-site mutations rejected in addition to the origin allowlist.
- **Plugin isolation:** stdio MCP launched through `prlimit` resource limits; health exposes enforced limits and states that filesystem/network isolation is not provided.
- **Code repair:** test-first, bounded, temporary-copy workflow with protected branch/path checks, targeted and regression tests, independent diff verification, and guaranteed rollback by discard.
- **Migrations:** versioned, transactional, idempotent registry; additive rollback strategy is documented as backup restore, not data deletion.
- **Recovery:** workspace-scoped report and recovery operation for interrupted missions, expired leases, started checkpoints and pending approvals.
- **Observability:** correlation ids, tool counters/timings, admin-only JSON/Prometheus metrics, log redaction.
- **CI:** GitHub Actions workflow runs API typecheck/tests/build and client typecheck/tests/build. Browser E2E still requires a Chromium host.
- **Evidence:** full API suite **246 tests, 245 passed, 1 skipped, 0 failed**; extension suite 26/26; client unit suite 50/50; new security tests 36/36 across ten files. Client typecheck and production build pass.
- **Defects fixed:** `migrate` was unversioned; approval payloads and task inputs were plaintext; extension secret rotation did not exist; session revocation did not exist; stdio MCP had no OS resource ceiling; no code-repair path existed.

Limitations: no user namespaces/real sandbox in this environment; additive migrations require backup rollback; legacy sid-less tokens cannot be revoked; metrics are in-process; code repair produces a patch but does not apply it to the source.
