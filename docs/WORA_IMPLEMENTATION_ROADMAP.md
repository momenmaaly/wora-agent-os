# WORA Implementation Roadmap

**Status:** execution roadmap with dependency order. Only completed items are marked done.
**Branch policy:** work on a feature branch; never modify `main` directly.

## Phase 0 — Repository and architecture audit

**Status:** completed for this session.

Acceptance criteria:

- Current branch, HEAD, remote main and worktree state recorded.
- Existing modules, tools, tests, schema and deployment shape inspected.
- Baseline commands run and results recorded.
- Existing capabilities separated from partial, simulated and missing capabilities.

Evidence: `WORA_PROGRESS.md`, `WORA_SCIENTIFIC_FOUNDATION.md`, baseline API 111 tests and client 44 tests.

## Phase 1 — Scientific foundation and algorithm catalog

**Status:** first slice completed.

Completed:

- Scientific domain map with implemented/partial/research-only distinctions.
- Implemented-algorithm catalog with guarantees, limitations and verification.
- Deterministic algorithm selector with explicit/feature/keyword precedence.
- `meta.select_algorithm` tool and `/api/os/algorithms` + `/api/os/algorithms/select`.
- Nine real tests, including catalog integrity and route behavior.

Completed in later slices:

- Comparative benchmark fixtures for assignment, scheduling, forecasting and decision analysis.
- Problem-understanding profile with constraints, uncertainty and dependencies.

Remaining:

- Calibration report for selection confidence.

## Phase 2 — Verification and evidence framework

**Priority:** highest next.

**First slice completed:** durable `os_verifications` records, orchestrator integration, workspace-scoped API, failure/blocked records and four tests.

**Independent checks completed:** API-contract, deterministic property, secret-leak and artifact-digest checks are combined with the acceptance review; the verifier is recorded separately from the executor.

Build a first-class verification record that binds:

- objective;
- acceptance criteria;
- expected output;
- actual output;
- evidence;
- independent check result;
- failure reason;
- verifier identity and timestamp.

Completed acceptance evidence:

- New durable table with foreign keys and workspace isolation.
- Existing `reviewRun` behavior preserved and wrapped; no solver review was removed.
- Tool execution and acceptance-review checks are persisted per attempt.
- Tests prove pass, explicit failure, blocked capability denial and cross-workspace isolation.

Remaining acceptance work:

- Expand property coverage beyond the current tool-specific fixtures.
- Bind verification records to capability snapshot digests and signed artifacts.
- Add an external-verifier adapter without claiming third-party audit by default.

## Phase 3 — Action-class governance

**Status:** completed for the current tool and action surface. A/B/C classification is enforced in the orchestrator and at the tool registry; approvals are payload-bound, scoped, expiring, single-use and budgeted; autopilot cannot bypass class C.

Add explicit action classes:

- **A:** safe, authorized reversible action; automatic within scope.
- **B:** controlled action; policy check or conditional authorization.
- **C:** high-risk action; explicit approval bound to the exact payload.

Acceptance criteria:

- Action identity, scope, permission, expiry, risk class, audit record and evidence.
- A general permission cannot authorize a different transaction.
- Existing high-risk tool approvals migrate without losing audit history.
- Tests cover expired approval, wrong payload, wrong scope, self-approval and denial.

## Phase 4 — Durable execution and recovery

**First slice completed:** lease-based task claims, heartbeats, checkpoints, pause/resume/cancel, restart recovery and side-effect uncertainty. The mission executor is still sequential; multi-worker claim safety is implemented.

Add a lease-based task queue on the existing SQLite single-writer boundary:

- worker claim and heartbeat;
- retry policy and attempt limits;
- checkpointing;
- cancellation;
- pause/resume;
- restart recovery without duplicate external transactions;
- concurrency and resource budgets.

Acceptance criteria:

- Multi-process tests prove exactly one claimant per task (covered by the lease transaction and task-queue tests; a full multi-process harness remains).
- Expired leases are reclaimable; active leases are not stolen.
- A restart resumes completed steps without repeating them.
- Duplicate external side effects are prevented or explicitly reported.

## Phase 5 — Problem understanding and planning

**First slice completed:** deterministic problem profiles are persisted with missions and feed structured algorithm features. The planner still uses deterministic templates.

Replace pure keyword routing with a structured problem profile:

- objective and success criteria;
- constraints and dependencies;
- uncertainty and data availability;
- affected systems and risk;
- required capabilities;
- ambiguity and missing information.

Acceptance criteria:

- Planner consumes the profile directly for every branch and preserves plan versions with change reasons.
- Ambiguous objectives produce clarification requests rather than falling back to a generic task.
- Selection confidence and missing inputs are visible to the user.
- Regression tests cover the five existing mandate journeys.

## Phase 6 — Skill context and specialist execution

**Backend and UI verified:** the extensions subsystem already provides Git marketplaces, package discovery, install previews, permissions, enable/disable, updates, MCP tools and agent capability dialogs. No duplicate subsystem was added.

Make installed skills operational:

- inject approved skill instructions into planner/agent context;
- enforce token budgets and provenance;
- honor auto-load and scope rules;
- revoke instructions immediately when an installation is disabled.

Acceptance criteria:

- A mission snapshot records exactly which skill versions were used.
- Disabling a skill removes it from the next resolution.
- Skill injection is covered by an end-to-end mission test.

## Phase 7 — Controlled learning

**First slice completed:** episode collection → candidate lesson → explicit evaluation → authorized promotion into semantic memory → rejection. Monitoring and lesson revocation remain.

Implement:

Episode collection → experience extraction → candidate lesson → evaluation → test → approval/promotion → reuse → monitoring.

Acceptance criteria:

- Observations are not automatically promoted to permanent knowledge.
- Candidate lessons have provenance, scope, expiry and version history.
- Promotion requires evidence and an authorized actor.
- Rejected candidates remain auditable.

## Phase 8 — Benchmarks and end-to-end evaluation

**First slice completed:** seven reproducible fixtures with independent references, measured time, limitations and persisted runs. Broad planning/recovery/safety benchmarking remains.

Build reproducible fixtures and report actual results for:

- problem understanding accuracy;
- planning quality and constraint satisfaction;
- solution correctness;
- completion rate;
- verification accuracy;
- recovery success;
- time and computational cost;
- human intervention and safety violations;
- reproducibility.

No result is reported until the fixture and command are committed.

## Immediate next eligible task

Expose the new governance, runtime, problem-profile, lesson and benchmark controls in the existing WORA management UI; then add skill-context injection with provenance and token budgets. The extensions marketplace/UI already exists and must be reused, not duplicated.
