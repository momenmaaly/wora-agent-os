# WORA Production Readiness — Adversarial Validation Phase

**Date:** 2026-11-24  
**Branch:** `feat/extensions-subsystem`  
**Base before this phase:** `adc2022`  
**Scope:** security, scheduler stress, end-to-end missions, planning evaluation and browser E2E.  
**Rule:** only measured results and inspected behavior are listed. No deployment or external marketplace was contacted.

---

## 1. Verified capabilities

| Area | Evidence | Result |
| --- | --- | --- |
| Approval binding | payload digest, scope, action class, mission/task and expiry checks | pass |
| Approval single use | two simultaneous consumption attempts | exactly one success |
| Budget enforcement | amount checked at creation and again at consumption | pass |
| Workspace isolation | missions, plans, leases, verifications, lessons, approvals | pass |
| Durable leases | atomic claim, heartbeat fencing, expired-lease recovery | pass |
| Duplicate side effects | started checkpoint blocks re-execution | pass |
| Cancellation | cancel during a running tool rejects the result | pass |
| Retry exhaustion | configured attempts recorded; final failure honest | pass |
| Failed dependencies | dependents blocked while independent tasks complete | pass |
| Parallel scheduling | 2, 4 and 8 workers; no duplicate runs | pass |
| Secret redaction | mission views, run evidence, verifications, artifacts, audit, approvals | pass |
| Mission lifecycle | six scenarios: build, diagnose/validate, schedule, uncertainty, recovery, approval | pass |
| Planning evaluation | direct vs risk-first vs existing MIP | pass |
| Browser journeys | real Chromium against preview API + Vite | pass |

The extensions subsystem (Git marketplaces, manifests, plugin tools, MCP, capability profiles) remains in the full API suite. This phase did not add a second registry or duplicate that subsystem.

---

## 2. Defects confirmed and fixed

### D1 — Cancellation could be overwritten by mission finalization

A mission cancelled while a tool was running reached `afterMission()` after the tool returned. `finalizeMission()` then recomputed the status from task rows and wrote `failed`, erasing the operator's cancellation.

Fix: `finalizeMission()` returns immediately for `cancelled`, `paused` and `completed` missions. Regression: `scheduler-stress.test.ts` “cancellation during a running tool…”.

### D2 — Secrets could persist in audit records, evidence and artifacts

A token placed in a mission objective appeared in `os_audit.detail` via `mission.create`. Tool output was also persisted in run evidence and verification records without redaction.

Fix: new `os/secrets.ts` with high-confidence credential signatures and secret-named environment values. Redaction is applied to:

- audit writes and audit reads;
- run evidence, issues and output snapshots;
- verification records and legacy verification reads;
- artifact content and artifact API reads;
- mission list/detail views;
- approval views (the stored digest still binds the original payload).

Regression: `secrets.test.ts` and `security-adversarial.test.ts` “secret-shaped output is redacted…”.

**Remaining limitation:** raw task `tool_input`, mission objective and approval `tool_input` remain in SQLite because execution and digest verification need them. The API redacts them, but at-rest encryption is not implemented.

### D3 — Paused missions were not representable in the client

The client `MissionSummary` type omitted `paused`, `STATUS_LABEL` had no label, and the resume button did not appear for paused missions. A user could pause a mission and then have no working resume control.

Fix: added `paused` to the client contract, Arabic label `متوقفة مؤقتًا`, resume visibility, and pause availability for approval-blocked missions. Regression: browser E2E pause/resume/cancel journey.

### D4 — Rate limits shared one bucket across unrelated mutations

All mutating OS routes consumed the same per-workspace bucket. A sequence of mission, approval, lesson-evaluate and lesson-promote calls could make a later lesson revoke return `429` even though that endpoint had its own limit. This was observed in the browser E2E as `revoke response 429`.

Fix: rate-limit buckets are now scoped by workspace and normalized route path, so one endpoint's quota does not exhaust another's. Regression: browser E2E lesson evaluate → promote → revoke.

---

## 3. Security test results

Command:

```bash
cd api-server
npx tsx --test src/os/security-adversarial.test.ts
```

Result:

```text
6 tests, 6 passed, 0 failed
```

Covered:

- two simultaneous approval consumption attempts;
- payload substitution, scope widening and cross-workspace lookup;
- workspace isolation for missions, plans, leases, verifications and lessons;
- admin-only lesson promotion/revocation at the HTTP boundary;
- revocation state safety;
- secret redaction across persisted and returned data.

The existing governance suite also covers expired approvals, lowered budgets after approval, autopilot bypass attempts and direct high-risk tool calls.

---

## 4. Scheduler stress results

Command:

```bash
npx tsx --test src/os/scheduler-stress.test.ts
```

Measured on this container:

| Scenario | Result |
| --- | --- |
| 8 independent tasks, 2 workers | 98–130 ms |
| 8 independent tasks, 4 workers | 54–108 ms |
| 8 independent tasks, 8 workers | 46–91 ms |
| 12-task dependency chain, 4 workers | 86–141 ms, correct order |
| expired lease recovery | recovered, task blocked, mission resumable |
| retry exhaustion, 2 attempts | two runs, final failure, no success claim |
| failed dependency | independent task completed; dependent blocked |
| cancellation during a 1.2 s tool | run cancelled, no accepted completion |

These timings are short-task measurements, not a throughput claim for long real workloads. The test asserts correctness and duplicate prevention, not a speedup ratio. All scheduler execution is in-process; SQLite remains the single-writer boundary. No multi-process or distributed scheduler is claimed.

---

## 5. End-to-end mission results

Command:

```bash
npx tsx --test src/os/mission-e2e.test.ts
```

```text
6 tests, 6 passed, 0 failed
```

Scenarios:

1. Generate a project, scan it, run its tests under an approval gate.
2. Build a small application from an idea.
3. Plan and solve a resource-constrained employee/shift schedule.
4. Surface missing information and uncertainty for a forecast objective.
5. Recover after an interrupted execution.
6. Require explicit approval before a high-risk command.

Each scenario checked the persisted problem profile, plan version, task dependencies, execution, handoff, independent verification, artifact and final status where applicable.

**Honest limitation:** scenario 1 generates, scans and tests a project; it does not implement a general code-repair engine. A mission that asks to repair an arbitrary existing codebase is not supported by a dedicated planner track.

---

## 6. Planning evaluation

Command:

```bash
npx tsx --test src/os/planning-evaluation.test.ts
```

Measured:

| Class | Result | Decision |
| --- | --- | --- |
| 8 independent tasks | direct and risk-first total cost 8; depth 1; direct preferred | no reordering benefit |
| mixed-risk independent tasks | risk-first changes order, total cost unchanged (7); direct preferred | no A*/HTN benefit shown |
| 6-task chain | order forced; depth 6 | critical path is sufficient |
| 20×5 employee schedule | MIP feasible, cost 480, 95–211 ms | existing MIP solver is justified |

No HTN, A*, constraint-programming or new optimization solver was added. The existing MIP solver is retained for resource-constrained scheduling because it produces a validated feasible optimum on the tested class. Adding a search planner without a reproducible improvement would be unjustified.

Full analysis: `WORA_PLANNING_EVALUATION.md`.

---

## 7. Browser E2E results

Command:

```bash
cd client
npm run test:e2e
```

Result:

```text
1 test, 1 passed, 0 failed
duration ≈ 10.6–11.5 s
```

The test starts the real preview API and Vite dev server, launches Chromium, and exercises:

- create a mission;
- inspect problem profile and plan verification;
- open independent verification evidence and worker section;
- pause, resume and cancel;
- inspect an approval digest, approve it, and wait for completion;
- evaluate, promote and revoke a lesson;
- run the benchmark suite and see `14/14` passed.

The browser test uses the development preview workspace, not a production signed-session deployment.

---

## 8. Full suite and build results

API:

```text
npm test
210 tests
209 passed
1 skipped (MongoDB opt-in integration)
0 failed
duration ≈ 8.6 s
```

Client:

```text
npm test
49 tests
49 passed
0 failed
duration ≈ 11.1 s
```

Builds:

```text
api-server: npm run build → exit 0
client: npm run build (tsc + API contract check + vite build) → exit 0
api-server: npx tsc --noEmit → exit 0
client: npx tsc --noEmit → exit 0
```

---

## 9. Remaining security risks

1. **Single-writer SQLite.** The runtime lease prevents two API processes from writing the same database, but this is availability-limited, not a distributed database.
2. **Secrets at rest.** Redaction protects logs, evidence and API views. Raw task inputs, objectives and approval payloads remain in SQLite; database encryption or a secret vault is not implemented.
3. **Redaction is heuristic.** Known signatures and secret-named environment values are covered. A custom secret with no recognizable format can still pass through.
4. **Approval display vs binding.** The approval view redacts the payload, while the digest binds the original. A human approving a payload containing a secret may not see the exact secret in the UI.
5. **stdio MCP containment.** stdio MCP remains a host-process integration and is disabled by default; there is no OS-level sandbox for plugin code.
6. **Preview auth.** Browser E2E runs in preview mode. Production signed-session behavior is covered by API tests, not by the browser suite.
7. **No CSRF/Origin hardening test** for cookie-less bearer sessions; the current API uses bearer tokens and CORS `origin: true`.

---

## 10. Recovery and performance limitations

- An expired lease marks the task `blocked` and requires a safe retry; it does not automatically replay an uncertain side effect.
- A `started` checkpoint without completion requires manual review.
- The scheduler is in-process. There is no cross-process work-stealing, distributed queue or broker.
- Timings above are for deterministic local tools and short tasks. They are not production capacity numbers.
- SQLite contention is bounded by one writer; high concurrency serializes at the database boundary.
- The browser E2E suite is one Chromium version on one host; it is not a cross-browser matrix.

---

## 11. Missing capabilities

- General code-repair planner and patch-verification workflow.
- HTN/A*/CP planners for problem classes where a measured benefit is demonstrated.
- At-rest secret encryption/vault integration.
- Distributed scheduler and external queue.
- Production SSO/multi-tenant organization sharing.
- CI workflow, OpenTelemetry traces and migration versioning.
- Full RTL/LTR browser matrix and accessibility audit with automated axe checks.
- Skill/plugin auto-load injection into model context beyond the existing capability profile.

---

## 12. Deployment blockers

1. Production requires a single API replica for the shared SQLite volume; horizontal scaling needs a PostgreSQL adapter and a distributed queue.
2. Secrets in SQLite need encryption or external secret storage before regulated deployment.
3. stdio MCP and generated test execution need OS-level containment for untrusted plugins.
4. CI must run the API suite, client suite, browser E2E and builds before release.
5. Production session/auth configuration (`AUTH_SECRET`, signed sessions) must be verified in the target environment; preview mode is not production.

---

## 13. Prioritized roadmap

1. **P0 — Secret at rest:** encrypt sensitive columns or move secrets to a vault; add migration and key-rotation tests.
2. **P0 — Production E2E auth:** run browser journeys against signed sessions and a production-like API; add CSRF/Origin checks.
3. **P1 — Sandboxed plugin/MCP execution:** container or process isolation with resource limits and network policy.
4. **P1 — Distributed scheduler:** PostgreSQL queue with the existing lease semantics, cross-process claim tests and failover measurements.
5. **P1 — Code-repair workflow:** repository diagnosis, patch generation, test verification and rollback with explicit approval.
6. **P2 — Planning research:** add HTN/A*/CP only behind a benchmark that shows a reproducible improvement on a named class.
7. **P2 — Observability:** OpenTelemetry spans, migration versioning, CI and alerting.
8. **P2 — Accessibility and i18n:** axe checks, keyboard-only browser journeys, full Arabic/English route coverage.
