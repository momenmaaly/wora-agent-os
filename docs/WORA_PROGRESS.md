# WORA Progress and Verified Baseline

**Updated:** 2026-11-24 (production readiness phase)
**Branch:** `feat/extensions-subsystem`
**HEAD at audit:** `321d69b` — Production readiness and adversarial validation
**Latest committed units:** Phase 7.1 forecasting reliability and generalization; Phase 7 evidence-grounded reasoning and problem intelligence; `321d69b` production readiness, adversarial and browser validation; `883efd7` audit hardening, concurrent scheduler, formal planning, expanded verification, lesson lifecycle, expanded benchmarks and UI; `a221fec` class C tool-boundary guard; `1fe32e4` governance enforcement, durable runtime, problem understanding, independent verification, learning and benchmarks; `07d34f1` algorithm catalog; `6b5c483` verification records; `f965594` action classification
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

## 4r. Workstream 15 — security audit and dynamic team orchestration

- **Security audit:** `WORA_SECURITY_AUDIT_2026-11.md` records SEC-01..SEC-08. Fixed all-failed rotation false success (SEC-01), rotation read/write TOCTOU (SEC-02) and sealed-JSON silent fallback (SEC-03). Verified AES-GCM nonce/tag/AAD, approval replay/substitution boundaries, session revocation, migration idempotency and MCP resource-limit versus sandbox distinction.
- **Dynamic selection:** `os/selection.ts` derives capability requirements from real plan tasks, scores registry agents against verified evidence, workload, tools, permissions and relative cost/latency, and returns explainable alternatives. Additive migration 5 adds `os_team_plans`, `os_selection_decisions`, `os_agent_performance`.
- **Orchestration:** `createMission` persists the team and task assignments; `executeMission` prefers persisted eligible assignments, revalidates revocations, records one bounded reassignment on final failure, enriches handoffs with agent/state/failure category, and records verified performance.
- **APIs:** `POST /capabilities/analyze`, `GET /capabilities/performance`, `GET /missions/:id/team`; mission detail includes `teamPlan` and `selectionDecisions`.
- **Evidence:** full API suite 262 tests (261 passed, 1 skipped); selection scenarios 12/12; benchmark dynamic accuracy 1.0 vs static 0.0 and expected verified success 1.0 vs 0.0; extension suite 26/26; client 50/50.
- **Limitations:** no genuine sandbox; no auto-created specialists; no provider-specific model routing; performance evidence is workspace-scoped and starts cold.

## 4s. Workstream 16 — scientific intelligence and autonomous execution core

**Status:** implemented and tested vertical slice; not a claim of universal intelligence.

- **Scientific map:** `os/science.ts` is the single source for 12 domains and method-level implementation status (`implemented`, `partial`, `experimental`, `documented`, `not_implemented`). `benchmarks.ts` now re-exports this map instead of maintaining a second copy.
- **Method selection:** `os/algorithms.ts` accepts structured problem type/requirements, uncertainty, risk, precision, time limits and authorized tools. It explains assumptions and rejects unavailable or unimplemented methods with an explicit gap. Every algorithm entry declares domain, preconditions, failure conditions and assumptions.
- **Decision engine:** `os/decision.ts` scores direct/risk-first plans and implemented method alternatives on quality, feasibility, cost, time, resources, risk, uncertainty, reversibility, verification difficulty, specialist/tool availability. It recommends an execution shape and smallest capable team, persists `os_decision_records`, and exposes `assessReplan` with evidence/churn guards.
- **Execution integration:** mission creation stores the scientific profile, decision comparison and plan version; failure records a `failure-assessment`; a capability denial can trigger one qualified reassignment; explicit replans record a `replan` decision. Approval boundaries are unchanged.
- **Runtime:** additive migration 6 adds decision records. Opt-in `worker.ts` and `scripts/os-worker.ts` resume interrupted failed missions; `GET /runtime/status` reports honest single-process limits. The API does not auto-spawn the worker.
- **APIs:** `GET /science/domains`, `POST /science/select`, `POST /decisions/compare`, `POST /decisions/replan-check`, `GET /missions/:id/decisions`, `GET /runtime/status`; mission detail includes `decisions`.
- **Evidence:** new `science.test.ts` 7/7 and `scientific-e2e.test.ts` 8/8 (scenarios A–G). Structured method selection 1.00 vs keyword-only baseline 0.75 on four disambiguating fixtures. Full API suite after this workstream: **280 tests, 279 passed, 1 skipped, 0 failed**; extension suite 26/26. API typecheck and build pass.
- **Limits:** deterministic scoring, not calibrated probability; no semantic planner, causal inference, MDP/POMDP, MCTS/A*, CP-SAT, robust optimization or formal model checker; no genuine plugin sandbox; SQLite single writer and no distributed mission lease; no auto-created specialist; no UI changes in this workstream.

See `WORA_SCIENTIFIC_EXECUTION.md`, `WORA_DECISION_ENGINE.md`, `WORA_SCIENTIFIC_EVALUATION.md` and the updated scientific/algorithm/runtime docs.

## 4t. Workstream 17 — durable mission leases, crash recovery and multi-agent execution

**Status:** implemented and tested across real OS process boundaries.

- **Mission leases:** additive migration 7 adds `os_mission_leases`; `claimMissionLease`, `heartbeatMissionLease`, `releaseMissionLease`, `recoverExpiredMissionLeases` sit above task leases and prevent two API/worker processes from executing one mission. Workers use the workspace execution TTL for both claim and heartbeat.
- **Worker:** `scripts/os-worker.ts` marks itself `WORA_OS_ROLE=worker` before the database module loads; the API keeps its advisory singleton writer lease while workers are separate SQLite WAL write clients serialized by transactions and leases. Workers now pick queued `planning` missions and finalize them after execution.
- **Recovery:** a completed checkpoint is authoritative and recovered without rerunning the tool. A started checkpoint retries only when the tool is idempotent; non-idempotent tools become `side_effect_uncertain` and require manual review. Interrupted attempts are recorded as `interrupted`, not silently completed.
- **Idempotency:** `tools.ts` declares `idempotent` for core and plugin tools. Core read/analysis tools are retry-safe; plugin tools must opt in explicitly.
- **Reassignment:** a persisted team assignment is attempted first, then a denied capability triggers one audited reassignment; the new agent is persisted on the task. The capability snapshot still records the authorization boundary.
- **Adaptive replanning:** `adaptive-replan.ts` transitions assignment and scheduling methods to an equivalent implemented MIP only when it can prove input equivalence, records the prior failure and creates a new plan version. It never relaxes the objective or bypasses permissions. `POST /missions/:id/tasks/:taskId/replan` exposes a member-level manual transition.
- **Sandbox hardening:** `host.exec` now runs Node tests under `--permission` with workspace-only read/write, no child processes/addons, a scrubbed environment and optional `prlimit` limits. Network isolation is explicitly not claimed.
- **Evidence:** `process-recovery.test.ts` 1/1 (real API + worker SIGKILL mid-read, dependent task, interrupted and completed runs), `process-faults.test.ts` 5/5 (verification, handoff, start checkpoint, approval wait, two workers), `multi-agent.test.ts` 2/2 (three specialists, ordered handoffs, denied-specialist reassignment), `adaptive-replan.test.ts` 3/3, isolation regression in `security-adversarial.test.ts`. Full API suite **292 tests, 291 passed, 1 skipped, 0 failed**; typecheck and build pass.
- **Limits:** SQLite serializes writes and there is no cross-host consensus/queue; Node permissions do not restrict network; no user/network namespaces in this environment; non-idempotent crash recovery is manual; adaptive replanning only covers implemented equivalent methods.

## 4u. Workstream 18 — capability intelligence, skill context and plugin lifecycle integration

**Status:** implemented and tested vertical slice; no standalone marketplace claim.

- **Skill context:** `extensions/skill-intelligence.ts` selects only approved, auto-loadable, task-relevant skills from the resolved capability profile, scores relevance from capabilities/tags/category/tool matches, enforces a strict token budget (`WORA_SKILL_CONTEXT_TOKENS`, default 1200, max 4000), neutralizes context delimiters, and records selected/omitted skills with versions and instruction digests in additive migration 8 (`ext_skill_contexts`).
- **Execution influence:** the only executable influence is the bounded manifest `execution_policy` (`summary_sentences`, `require_evidence`); unknown policy keys are rejected. The orchestrator applies it to the real `text.extract_summary` input and records `appliedPolicy` plus a `skill-context-provenance` verification check. Skill text is explicitly labelled untrusted and cannot grant permissions, select tools, or bypass approvals.
- **Capability intelligence:** `extensions/capability-intelligence.ts` searches core tools, approved skills, installed plugin/MCP tools and specialists; evaluates trust, health, permissions, reliability and cost/latency; selects one executable capability or returns an explicit gap with search terms. Capability-guided missions persist the selected agent/tool assignment and execute it through the existing Tool Registry.
- **Lifecycle hardening:** multi-package installs roll back created rows on failure; blocked plugins remain inactive with no tools; revocation is re-evaluated on every task attempt; uninstall removes tools and capability paths immediately; skill context never contains secret values; malicious metadata remains untrusted.
- **APIs:** `POST /api/os/extensions/capabilities/match`, `GET /api/os/extensions/skill-contexts`; mission detail includes `skillContexts`. Mutations are RBAC-gated; reads are workspace-scoped and viewer-readable.
- **UI:** Extensions gains a bilingual `Capability intelligence` tab wired to the real matcher; install/uninstall and capability evaluation are exercised by the browser journey.
- **Evidence:** `skill-intelligence.test.ts` 8/8 (real Git marketplace, SQLite, seeded agents, MCP echo, skill-driven summary, gap, revocation, blocked install, malicious metadata, uninstall); extension API suite includes authenticated capability/provenance checks; full API suite **301 tests, 300 passed, 1 skipped, 0 failed**; client unit suite 50/50; browser E2E passes including extension install/uninstall and capability evaluation; API/client typecheck and production builds pass.
- **Limits:** relevance is deterministic keyword scoring, not semantic understanding; skill execution policy is intentionally limited to presentation/evidence hints; no real OS sandbox for native plugins; SQLite remains a single-writer store; no provider-specific model routing in this workstream.

## 4v. Workstream 19 — universal problem-solving and capability composition

**Status:** implemented and tested vertical slice; not a claim of universal intelligence.

- **Unified problem model:** `os/problem-model.ts` extends the existing deterministic problem profile into a canonical representation with objective, desired outcome, success criteria, stated facts, retrieved evidence, explicit assumptions, unknowns, constraints, dependencies, resources, limits, risk, reversibility, uncertainty, deterministic/stochastic precision, approvals, needs and selected/rejected methods. Every item carries provenance; retrieved memory is labelled and missing requirements stay missing.
- **Composition graph:** `os/capability-composition.ts` builds an executable graph only from the existing capability registry; it only creates a node when the deterministic input builder satisfies the tool's required schema, so statistics are never run on invented sample data: core tools, approved skills, installed plugin/MCP tools and eligible specialists. Nodes record role, tool, skill keys, agent, dependencies, inputs/outputs, preconditions/postconditions, permissions, risk, verification, compatible fallbacks and availability. A missing integration, statistics, simulation, decision or solver capability becomes an explicit gap, not a fabricated node.
- **Strategy synthesis:** `os/strategy-synthesis.ts` compares genuinely different executable subsets (minimal, analysis-plus-primary, layered core, full integration) using explicit deterministic weights for quality, feasibility, scientific validity, cost, time, resources, risk, uncertainty, reversibility, availability, permission readiness and verification complexity. Rejected strategies include the reason; the selected strategy is persisted.
- **Lifecycle integration:** `createMission({ track: 'composite' })` persists the unified model and composition, records a `composition-strategy` decision, and executes the selected real `PlanTask`s through the existing Tool Registry, agent authorization, governance, verification and audit path. Non-composite missions also persist the unified model.
- **Compatible fallback:** `os_tasks.fallback_tools` is additive. On final failure of a capability, the orchestrator may use only a registered, schema-identical, currently authorized alternative on the same agent; it persists the replacement and remaining fallbacks, records the original failure in a `capability-replacement` decision, and still runs independent verification. Different input contracts are refused.
- **APIs:** `POST /api/os/problems/analyze`, `POST /api/os/problems/compose`, `GET /api/os/missions/:id/problem-model`, `GET /api/os/missions/:id/composition`. Mission detail now includes `problemModel` and `composition`.
- **UI:** the launch form has a real `تركيب القدرات` toggle that sends `track: composite`; the mission detail in `ExecutionCenter` shows the unified problem (facts, assumptions, unknowns, methods), composition nodes, selected strategy, compared alternatives and real gaps. It is display-only; no fake controls.
- **Database:** additive migration 9 adds `os_problem_models`, `os_capability_compositions` and `os_tasks.fallback_tools`; the baseline schema includes the same entities for fresh databases. No existing data is deleted or rewritten.
- **Evidence:** `phase5.test.ts` 7/7 uses a real Git marketplace, real SQLite, a real local HTTP plugin server, real installation/sync/runtime/orchestrator/verification paths. It covers unified provenance, graph composition, skill loading, core+plugin execution, compatible replacement, missing-capability gap, revocation and uninstall cleanup. Full API suite **308 tests, 307 passed, 1 skipped, 0 failed**; client suite 50/50; API and client typecheck and production builds pass.
- **Scenario mapping:** existing verified scientific scenarios cover analytical/simulation (A), constrained optimization (B), software delivery (C), failure recovery (D), missing capability (E), protected action/approval (F) and interrupted runtime recovery (G); Phase 5 adds multi-capability composition, compatible replacement, unified provenance and revocation. Scenario A business creation and scenario B complex software delivery continue to use the existing organization/software tracks.
- **Limits:** deterministic policy scoring, not calibrated probability; composition does not invent missing tools or inputs; no semantic planner; fallback requires an already-installed compatible tool; no genuine OS sandbox for native plugins; SQLite remains single-writer; no provider-specific model routing; no auto-install of a marketplace package.

## 4w. Workstream 20 — Phase 6 autonomous intelligence validation and reliability

**Status:** implemented, exercised and hardened; not a claim of general intelligence.

- **Semantic contracts:** `os/semantic-contracts.ts` adds a versioned machine-readable contract for capability semantics (meaning, units, types, pre/postconditions, side effects, determinism, precision, permissions, verification and evidence confidence). `compareSemanticContracts` is the pure comparator; `evaluateSemanticCompatibility` resolves registered tool contracts. Composition and fallback selection now refuse lookalikes such as a currency converter for a descriptive-statistics step, an extra permission, a weaker precision claim or missing verification.
- **Independent outcome verification:** `os/outcome-verification.ts` inspects actual run output, task verification records, artifact digests, capability gaps and secret-safety checks, then persists `os_missions.outcome_status` and `outcome_evidence`. States are `verified`, `partially_verified`, `unverified`, `failed`, `blocked` and `requires_human_review`; missing checks are `not_run`, not success. Recovered tasks completed without retained evidence stay `unverified`.
- **Execution integration:** mission finalization runs outcome verification after the deliverable artifact is created; terminal missions clear task and mission leases before publishing their terminal status. Input bindings are resolved from real upstream output for outcome checks. Capability gaps downgrade a mission to `partially_verified` with the exact missing capability.
- **Reliability fixes found by evaluation/fault tests:** reset the fallback index after a compatible replacement so a second fallback can run; compare plugin output against the resolved upstream binding rather than the sealed original input; recognize MCP `content[].text` output; avoid publishing `completed` while a mission lease remains; reject empty `{}` outcome evidence at the API boundary and render outcome panels defensively.
- **Evaluation framework:** `os/evaluation-framework.ts` contains 13 development scenarios and 4 held-out scenarios. Scenarios supply only objective/facts/constraints/resources; WORA constructs the model and composition. The framework measures domain classification, provenance separation, approved-only capabilities, dependency ordering, honest gaps, semantic fallbacks and estimated cost/latency. Development 13/13; held-out 4/4 (reported as held-out, not used to change the implementation).
- **Real end-to-end coverage:** `phase6.test.ts` 10/10 runs real SQLite, a local Git marketplace, local HTTP plugins, the Tool Registry, authorization, orchestrator, verification and outcome persistence: summary → plugin → statistics with real input binding; failed plugin → compatible fallback; missing SMT capability → honest gap; protected `host.exec` → approval then completion; employee schedule → feasible solver + verified outcome; incompatible lookalike → refused replacement gap; missing upstream output → blocked dependent task.
- **UI/API:** `GET /api/os/missions/:id/outcome`; mission detail carries `outcomeStatus` and `outcomeVerification`; Execution Center shows an Arabic-first independent verification panel with checks and reasons.
- **Verification:** full API suite **318 tests, 317 passed, 1 skipped, 0 failed**; Phase 6 **10/10**; extension **27/27**; client unit **50/50**; browser E2E **1/1**; API/client typecheck and production builds pass; `git diff --check` clean.
- **Limits:** deterministic rules rather than semantic understanding; four held-out scenarios are a small anti-overfitting check; generic plugin outputs without a tool-specific invariant are partial; business plans verify internal feasibility but not external market success; native plugin isolation is process/HTTP/MCP-boundary isolation, not a full OS sandbox; SQLite remains single-writer; no provider-specific routing/billing in this phase.

See `WORA_PHASE6_VALIDATION.md`.

## 4x. Workstream 21 — Phase 7 semantic reasoning and problem intelligence

**Status:** implemented and tested vertical slice; not a claim of general intelligence, calibrated probability or causal identification.

- **Reasoning model:** `os/reasoning-types.ts` and `os/reasoning-engine.ts` extend the existing `UnifiedProblem` with claims, provenance, assumptions, unknowns, contradictions, hypotheses, causal edges, information needs, method assessments, confidence kind and append-only change records. A model proposal is `model-proposal` provenance and can never become a verified fact.
- **Understanding:** deterministic problem-type classification covers business/operations, software, data, optimization, forecasting, decision, root-cause, causal, formal verification and research. It extracts the intended outcome separately from the stated problem and reports explicit missing information. This is lexical/structured, not universal semantic understanding.
- **Hypotheses:** generated only for root-cause/causal or explicitly uncertain-cause problems. Each records supporting/contradicting evidence, assumptions, distinguishing tests, rejection reason and `heuristic-uncalibrated` score. Contradictory clauses can reject an explanation while preserving it in history.
- **Causal reasoning:** observational, assumed and experimental evidence are distinct. Only experimental evidence with no declared confounders can set `identified: true`; observational correlation is never promoted to causation. `causal-inference` is reported as a capability gap.
- **Information gathering:** information needs carry materiality, expected gain, cost, reversibility, self-gather feasibility and a recommended action. Generic missing acceptance criteria do not trigger questions; explicit decision-critical unknowns and contradictions do.
- **Method selection:** assessments reuse the existing scientific catalog and algorithm catalog, record applicability/reasons/inputs/assumptions/outputs/limitations/evidence requirements, and report unimplemented methods as explicit gaps (model checking, SMT, nonlinear optimization, Bayesian inference, learned classification, causal identification).
- **Optional provider:** `os/reasoning-provider.ts` is disabled by default and configured only through `WORA_REASONING_*` environment variables. It has a bounded context, strict JSON schema, timeout, retry limit, cancellation and usage recording. Provider proposals remain unverified and cannot authorize tools, approvals or permissions. No external provider was activated or benchmarked; a local fixture tests the adapter contract only.
- **Adaptive persistence:** additive migration 11 adds append-only `os_reasoning_models`. New evidence creates a new version, can invalidate assumptions, updates hypotheses and information needs, and recommends affected non-completed task ids and replanning. Completed task outputs/checkpoints are never rewritten; automatic partial replanning is not claimed.
- **Integration:** mission creation persists reasoning; mission detail and `UnifiedProblem` carry the model/summary; mission finalization records independent outcome evidence as a new reasoning version. `POST /api/os/problems/reason`, `GET /api/os/missions/:id/reasoning`, `GET .../reasoning/versions` and `POST .../reasoning/evidence` use existing session/workspace authorization. User evidence is forced unverified; users cannot self-declare observed or verified evidence.
- **UI:** Execution Center adds an Arabic-first reasoning panel with mode, outcome, sufficiency, facts, assumptions, unknowns, hypotheses, causal labels, information needs, methods/gaps, contradictions, changes and limitations. It is display-only and uses real API data.
- **Evaluation:** `os/reasoning-evaluation.ts` has 20 development and 10 held-out scenarios. Development **20/20**; held-out **9/10**. The held-out failure is `held-subscription-revenue`, a forecasting paraphrase classified as `business_operations`; it was not tuned away after the held-out run. Provider benchmark is explicitly `not-run`.
- **Verification:** API full suite **334 tests, 333 passed, 1 skipped, 0 failed**; Phase 7 **16/16**; client unit **50/50**; browser E2E **1/1**; API/client typecheck and production builds pass.
- **Limits:** lexical understanding and contradiction detection; heuristic-uncalibrated hypothesis scores; no causal identification; no Bayesian/model-checking/SMT/nonlinear/learned-classifier implementation; no automatic external information collection; provider adapter not benchmarked against a real model; no automatic partial replan; SQLite single-writer; no distributed consensus.

See `WORA_PHASE7_REASONING.md`.

## 4y. Workstream 22 — Phase 7.1 reasoning reliability and generalization

**Status:** implemented and verified; this is a reliability correction, not a claim of general semantic understanding.

- **Root cause:** the original held-out forecasting paraphrase (`Project monthly subscription revenue for the next six months from historical totals.`) was classified as `business_operations` because forecast intent was a narrow keyword gate and the word `revenue` matched the business rule. `UnifiedProblem.features.hasTimeSeries` was false, algorithm selection returned `needs_input`, the reasoning layer selected only the deterministic planner and reported `sufficientToProceed=true`, and `buildPlan` had no forecasting path, so it would have run two summary tasks. The evaluation checked only selected-method wording, not target/horizon/observations/readiness or execution.
- **Structure layer:** `os/problem-structure.ts` separates projection, temporal, historical-basis, target and negative signals into a typed structure with target, horizon, observations, malformed/conflicting flags, requirements, missing inputs and `canExecute`. It is deterministic and does not execute anything.
- **Forecast readiness:** target, 1–90 period horizon and at least eight chronological observations are required; malformed/conflicting/contradictory inputs block execution. Missing inputs become critical information needs and no sample series is substituted.
- **Planning and verification:** `buildPlan` now executes `forecast.linear` only with exactly the supplied series and horizon; otherwise it creates a `FORECAST INPUT GAP` task. Outcome verification marks gaps `partially_verified`, never `verified`. A verified forecast means the calculation was independently checked, not that the future is guaranteed.
- **Capability seed:** `data_analyst` seed agents gain `forecast.linear`; additive migration 12 updates existing seed agents without changing permissions.
- **Evaluation:** broad Phase 7 development **21/21**, held-out **10/10**; dedicated forecasting paraphrases development **16/16**, held-out **12/12**, negative controls **6/6**. Baseline from `1586bb4` reproduced as development **20/20**, held-out **9/10** with `held-subscription-revenue` failing. The original failure is now a development regression case; held-out wording is different.
- **Tests:** `phase7_1.test.ts` 9/9 covers the original failure, valid execution, missing data, malformed/insufficient/conflicting inputs, misleading wording, tool failure, malformed output and cross-domain regression.
- **Verification:** API full suite **343 tests, 342 passed, 1 skipped, 0 failed**; Phase 7 **16/16**; Phase 7.1 **9/9**; migrations **3/3**; client unit **50/50**; browser E2E **1/1**; API/client typecheck and production builds pass.
- **Limits:** deterministic lexical structure rather than general understanding; 12 held-out forecast paraphrases are a small sample; conflicting records are blocked, not reconciled; linear trend is a baseline; no causal identification or external provider benchmark; SQLite single-writer; custom/non-seed data-analyst agents are not auto-granted the forecast tool.

See `WORA_PHASE7_1_REASONING_RELIABILITY.md`.

## 4z. Workstream 23 — advanced optimization, simulation and decision intelligence

**Status:** implemented and verified vertical slice. This adds real solvers and simulators; it does not claim universal optimality or causal forecasting.

- **New real methods:** Dinic maximum flow with min-cut certificate (`graph.max_flow`), successive-shortest-path min-cost flow (`graph.min_cost_flow`), maximum bipartite matching (`graph.bipartite_matching`), Held-Karp/2-opt TSP (`routing.tsp`), multi-depot Clarke–Wright VRP (`routing.vrp`), Pareto frontier with weight sensitivity (`decision.pareto`), conjugate Beta–Binomial/Normal–Normal Bayesian updates (`stats.bayes_update`), seeded FCFS discrete-event queue (`sim.queue`) and same-seed scenario comparison (`sim.scenario_compare`).
- **Formulation:** `scientific-formulation.ts` now covers all nine kinds and refuses incomplete models. `buildPlan` detects the matching structured JSON and creates the existing two-step formulation → solver plan; no sample values are imputed.
- **Selection:** `ProblemFeatures` adds network-flow, routing, vehicle, bipartite, Pareto, Bayesian, queue and scenario signals. Structured signals outrank keywords. TSP above its exact limit and VRP are labelled approximate/feasible, never optimal.
- **Catalog:** `algorithms.ts` and `science.ts` advertise the new tools and mark conjugate Bayesian inference, queue simulation and scenario comparison as implemented. General Bayesian networks, MCMC, agent-based simulation and calibrated system dynamics remain explicit gaps.
- **Tools and API:** all nine tools are registered with Zod validation, timeouts and audit. Routes: `/network/max-flow`, `/network/min-cost-flow`, `/network/bipartite-matching`, `/routing/tsp`, `/routing/vrp`, `/decision/pareto`, `/stats/bayes`, `/simulate/queue`, `/simulate/scenarios`. `/science/formulate` accepts the new kinds.
- **Orchestration:** review rejects non-optimal, unverified or mislabelled results; deliverables report max flow/min-cut, routing status, Pareto frontier, posterior interval, queue metrics and scenario ranking from real output.
- **UI:** Intelligence Hub adds **التحسين المتقدم** with method selection, editable JSON model, formulation preview, real execution, independent verification checklist and full result JSON. The existing Arabic-first RTL layout and states are reused.
- **Database:** migration 19 grants the new tools only to untouched operations-research seed/catalog agents; customized allow-lists are preserved. No new tables were needed.
- **Tests:** new `advanced-computational.test.ts` **27/27** covers exact flow, min-cut, matching, TSP brute-force cross-check, approximate labelling, VRP capacity, Pareto dominance, Bayesian posteriors, tampered-result rejection, reproducibility, real tools, six end-to-end missions and HTTP routes. Migration tests **10/10**, algorithm tests **9/9**, science/problem tests **21/21**.
- **Verification:** API full suite **470 tests, 466 passed, 4 skipped, 0 failed**; client unit **70/70**; browser E2E **1/1** including the new advanced tab journey; API and client typecheck and production builds pass.
- **Limits:** no nonlinear/global optimization; single-commodity flow without lower bounds; unweighted one-to-one matching; TSP exact only below the configured limit; VRP heuristic without time windows; Pareto exact only over supplied candidates; conjugate Bayesian models only; exponential FCFS queue; independent scenarios rather than causal forecasts; SQLite single-writer unchanged.

See `implementation/WORA-V2-ADVANCED-OPTIMIZATION-SIMULATION.md`.
