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

Remaining:

- Comparative benchmark fixtures for assignment, scheduling, forecasting and decision analysis.
- Problem-understanding profile with constraints, uncertainty and dependencies.
- Calibration report for selection confidence.

## Phase 2 — Verification and evidence framework

**Priority:** highest next.

Build a first-class verification record that binds:

- objective;
- acceptance criteria;
- expected output;
- actual output;
- evidence;
- independent check result;
- failure reason;
- verifier identity and timestamp.

Acceptance criteria:

- New durable table with foreign keys and workspace isolation.
- Existing `reviewRun` behavior preserved or wrapped, not silently changed.
- At least one real independent recheck per tool class (solver, generated test, fetch, static scan).
- Tests prove pass, fail, missing-evidence and cross-workspace isolation.

## Phase 3 — Action-class governance

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

Add a lease-based task queue on the existing SQLite single-writer boundary:

- worker claim and heartbeat;
- retry policy and attempt limits;
- checkpointing;
- cancellation;
- pause/resume;
- restart recovery without duplicate external transactions;
- concurrency and resource budgets.

Acceptance criteria:

- Multi-process tests prove exactly one claimant per task.
- Expired leases are reclaimable; active leases are not stolen.
- A restart resumes completed steps without repeating them.
- Duplicate external side effects are prevented or explicitly reported.

## Phase 5 — Problem understanding and planning

Replace pure keyword routing with a structured problem profile:

- objective and success criteria;
- constraints and dependencies;
- uncertainty and data availability;
- affected systems and risk;
- required capabilities;
- ambiguity and missing information.

Acceptance criteria:

- Planner consumes the profile and preserves plan versions with change reasons.
- Ambiguous objectives produce clarification requests rather than invented assumptions.
- Selection confidence and missing inputs are visible to the user.
- Regression tests cover the five existing mandate journeys.

## Phase 6 — Skill context and specialist execution

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

Implement:

Episode collection → experience extraction → candidate lesson → evaluation → test → approval/promotion → reuse → monitoring.

Acceptance criteria:

- Observations are not automatically promoted to permanent knowledge.
- Candidate lessons have provenance, scope, expiry and version history.
- Promotion requires evidence and an authorized actor.
- Rejected candidates remain auditable.

## Phase 8 — Benchmarks and end-to-end evaluation

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

Implement the verification record in Phase 2. It is the dependency for trustworthy learning, action governance evidence and benchmark scoring, and it can be added without replacing the existing orchestrator.
