# WORA OS Core — what was built and how it behaves

This document is the engineering record for the OS core added to this branch. It lists what
is **real and verified**, what is **real but awaiting external configuration**, and what is
**not implemented yet**. Nothing here is aspirational.

## What this is

An in-process execution platform behind the product surface:

- **Execution engine** (`api-server/src/os/orchestrator.ts`): objective → understand → decompose →
  assign → execute → review → deliver. Every mission/task/run/handoff is persisted in SQLite.
- **Durable task runtime** (`os/task-queue.ts`): atomic task claims, expiring worker leases, heartbeats,
  per-run checkpoints, pause/resume/cancel, restart recovery and conservative side-effect uncertainty.
- **Structured problem understanding** (`os/problem.ts`): persisted domain, constraints, dependencies,
  resources, uncertainty, success criteria, missing information and algorithm features. Deterministic rules,
  not a semantic-model claim.
- **Persistent agent registry** (`os/registry.ts`): 18 seeded specializations plus user-created and
  organization-created agents. Agents carry identity, role, skills, tools, permissions, model config,
  limits, instructions, status and evaluation criteria. They are executable entities, not profile cards.
- **Unified tool registry** (`os/tools.ts`, `os/scaffold.ts`, `os/ortools.ts`): 20 tools, each with a
  JSON-schema contract, risk tier, required permission, environment and timeout; audited on every call.
  `meta.select_algorithm` exposes the deterministic algorithm selector over the real solvers;
  `meta.classify_action` classifies actions into A/B/C before execution;
  `meta.understand_problem` extracts structured constraints, uncertainty and algorithm features.
- **Algorithm selection** (`os/algorithms.ts`): a versioned catalog of implemented algorithms plus a
  deterministic selector (`meta.select_algorithm`, `GET /api/os/algorithms`, `POST /api/os/algorithms/select`).
  It returns required inputs, guarantees, verification checks, limitations and alternatives, and fails closed
  for unknown or nonlinear problems instead of inventing a solver.
- **Operations Research** (`os/ortools.ts`): HiGHS (WASM LP/MIP solver) behind `or.solve_lp` and
  `or.employee_schedule`; Hungarian algorithm behind `or.assignment`; seeded triangular PERT Monte
  Carlo behind `sim.monte_carlo`; `forecast.linear` (least-squares trend with an 80/20 holdout
  backtest reporting R², holdout MAE and residual-stddev projection bands — a labeled baseline, never
  presented as a causal forecast). Solver output is **independently revalidated in code** (demand,
  availability, max-workload) before it is accepted.
- **Memory & knowledge** (`os/memory.ts`): scoped records (user/workspace/project/agent/organization/
  execution/episodic/semantic) with provenance, deterministic TF-IDF-ish retrieval, audited write/delete,
  **ownership/visibility ACL** (`workspace` vs `owner`), **TTL expiry** (`expires_at`), and **version
  snapshots** (`os_memory_versions`) on create/delete — owner-scoped records are invisible to other actors
  in list/search/get and cannot be deleted by them.
- **Virtual organizations** (`os/orgs.ts`): objective → template (commerce-marketplace / software-product /
  general-business) → departments, leadership spine, persistent agents, reporting lines, one project and a
  kickoff mission that starts real work.
- **Workspace roles / RBAC v1** (`os/roles.ts`): ranked roles `viewer < member < admin < owner`. Viewer is
  read-only (mutations return 403); member runs day-to-day OS work; admin adds settings-class mutations
  (autonomy policy, device pair/revoke, agent & playbook deletion, board/twin deletion) and manages
  member/viewer roles; owner manages everything including admin. Bootstrap: a workspace with no role rows
  grants its first actor `owner`; unknown actors in a roled workspace default to `viewer`. Self role changes
  are refused (ask another owner). Enforced in the OS router, not the UI.
- **Agent versioning** (`os/registry.ts`): every `updateAgent` snapshots the previous definition into
  `os_agent_versions` (cap 20) and bumps `os_agents.version`; `GET /agents/:id/versions` lists history.
- **Durable Project OS board** (`os/boards.ts` + `client/src/store/boardSync.ts`): the zustand Project OS
  store syncs to `os_boards` (one JSON document per workspace, 512 KB cap, audited). Server wins on boot;
  mutations push debounced (800 ms). Demo seed is labeled `بيانات تجريبية · Demo` in the UI with a
  one-click clear that empties local + server state.
- **Digital twins** (`os/twins.ts`): persistent workspace-scoped operational models (store, warehouse,
  pipeline, service, custom) with PERT three-point drivers, KPI definitions, an append-only event log
  (observations + scenario runs, cap 200) and what-if scenarios that re-run the seeded Monte Carlo
  simulator with adjusted drivers — baseline-vs-scenario p10/p50/p90/mean deltas, always labeled
  `simulated: true`. Intelligence → التوائم الرقمية wires the full flow.
- **Experience learning** (`os/lessons.ts`): completed verified episodes produce candidate lessons;
  evaluation is explicit; promotion is an authorized action that writes semantic memory with provenance.
  Nothing is auto-promoted.
- **Scientific benchmarks** (`os/benchmarks.ts`): 12-domain capability map and seven reproducible fixtures
  with independent references, measured time, limitations and persisted runs.
- **Playbook planner preference** (`os/playbooks.ts` + planner): the OR planner checks validated playbooks
  (Jaccard ≥ 0.5 on tokens) before falling back to the bundled SAMPLE roster; reuses are counted
  (`reuse_count`) and surfaced in the Intelligence playbooks tab.
- **Verification records** (`os/verification.ts` + `os_verifications`): every run attempt persists objective, acceptance criteria, expected/actual output, evidence, structured checks, result, failure reason and verifier identity. Independent checks (`os/independent-verification.ts`) add API-contract, deterministic property, secret-leak and artifact-digest checks; mission detail and `GET /api/os/missions/:id/verifications` expose them.
- **Action classification and enforcement** (`os/actions.ts`, `os/governance.ts`): A/B/C classification, payload-bound approvals, scope, expiry, single-use consumption, budgets and a tool-registry guard. High-risk tools cannot bypass approval through autopilot, the direct tool API or the extension executor. `POST /api/os/actions/classify`, `meta.classify_action`, `POST /api/os/settings/action-budget`.
- **Governance** (`os/governance.ts`): payload-digest-bound, expiring, single-use approvals for high-risk
  tools; the requester cannot self-approve; autopilot cannot bypass class C; per-workspace amount and
  approval budgets; revocable device connections (one-time hashed pairing codes, single-use redeem,
  terminal revoke, full audit trail).
- **Artifact generation** (`os/scaffold.ts`): `scaffold.webapp` writes a complete zero-dependency web app
  (kanban UI + Node http JSON API + `node --test` suite) into the sandboxed workspace and **runs the suite**;
  `host.exec` re-runs exactly `node --test` as an allowlisted verification step. The QA gate requires a green
  suite — the app is generated *and* proven, not proposed.
- **System console** (`client/src/components/SystemConsole.tsx`): real `/api/os/state` counts, memory manager,
  audit trail, and an explicit capability matrix (what is live vs. awaiting config vs. not built).

## Screens (new)

| World | Route | Purpose |
| ----- | ----- | ------- |
| مركز التنفيذ / Execution | `#execution` | Launch objectives in natural language; live lifecycle, evidence, handoff contracts, artifact download |
| الوكلاء / Agents & Orgs | `#agents` | Registry: create/pause/delete persistent agents; build a virtual organization from one objective |
| الذكاء التشغيلي / Intelligence | `#intelligence` | Employee-shift MIP (20×5 sample, editable), Monte Carlo, weighted decision matrix with ±25% robustness check, tool registry, playbooks (with reuse counts), digital twins |
| النظام / System | `#system` | Runtime counts, governance (autonomy policy, pending approvals, device pairing/revoke), RBAC roles & members, memory browser with visibility/TTL/version history, capability honesty matrix, audit log |

The **Executive Command bar** at the bottom of every screen now launches a real mission
(`POST /api/os/missions`) and opens مركز التنفيذ — it no longer just routes to the Director composer.

## Architecture decisions (and why)

1. **SQLite via `node:sqlite`** for OS state. The repo already ships a Mongo/Redis production path for
   chat/catalog; the OS core needs relational, transactional durability with zero external services so the
   product *works* offline and in preview. Access is isolated in `os/db.ts`; a PostgreSQL adapter can replace
   it without touching callers. Set `WORA_OS_DB` (default `./data/wora-os.db`; `:memory:` in tests).
2. **HiGHS (WASM)** instead of Google OR-Tools: no Python/runtime sidecar, runs identically in Docker,
   CI and preview; real LP/MIP (presolve, branch-and-bound), not heuristics. Hungarian algorithm for the
   balanced assignment case; PERT Monte Carlo with `mulberry32` seeding for reproducibility.
3. **In-process orchestration, durable via SQLite** instead of Temporal: a single modular monolith with
   persisted mission/task/run state survives restarts (state is re-read from disk; no in-flight promise is
   required). Temporal/NATS would add operational weight with no user-visible benefit at this scale.
4. **No new microservices.** Everything ships in `api-server` and the existing client.
5. **Permissioned tools, not ambient authority.** Agents only receive tools in their specialization set;
   `runTool` enforces the per-tool permission, zod-validates input, applies a timeout, and writes an audit
   entry. High-risk tools (`host.exec`) are not callable through the REST tool endpoint — only inside the
   orchestrator under agent permissions, and only `node --test` inside the sandboxed workspace.
6. **Approvals gate execution, not just documentation.** `host.exec` (the only high-risk tool) pauses the
   mission at `awaiting_approval` with an approval row carrying the exact tool input; a human approves or
   denies; approving auto-resumes via `executeMission`; denial fails the task loudly. The balanced policy is
   the default for every workspace; `autopilot` must be opted into explicitly and is audited.
7. **Honest scope everywhere.** Diagnostics checks the machine running the API runtime and says so; sample
   rosters are labeled SAMPLE both in API output and UI; generated-app QA relies on `node --test` exit codes,
   never on agent self-report. If a review fails twice, the task fails and dependents block — loudly.

## The five mandate journeys — verified end-to-end on this branch

| Journey | Result |
| ------- | ------ |
| 1. "Inspect my computer and identify potential problems" | Mission completes; real `os.cpus`/memory/load/uptime/disk-path signals attached as evidence; scope of inspection stated |
| 2. "Create a software testing agent" | `Software Testing Agent` (qa_engineer specialization) persisted in the registry, reusable immediately |
| 3. "Build an organization … online marketplace" | 8 departments, 9 agents created, reporting lines to a Managing Director, project persisted, kickoff mission executed to completion |
| 4. "Build a working web application" | 4 tasks: scope → scaffold (6 files, `node --test` green) → security scan (0 criticals) → QA re-run. With default `balanced` autonomy the QA step **pauses for human approval** (`awaiting_approval`); approving resumes and completes the mission (verified over HTTP against the built client, and by the api-server test suite). App runs: `node server.mjs` → `GET /` HTML, `POST /api/tasks` works |
| 5. Employee/shift optimization | HiGHS MIP, total cost 480, demand met per shift, availability respected, independent re-validation printed — via UI (Intelligence) and via mission |

## Security & control

- Workspace scoping mirrors the existing API: production requires a signed session → `wora-{userId}`;
  preview lands in `wora-preview`; admin key bypass available server-side.
- Rate limits: per-workspace and per-normalized-route buckets (default 60/min, 30/min missions, 10/min org builds/lesson promotion/revocation). Separate endpoints no longer exhaust each other's quota.
- All tool executions audited (`os_audit`); memory writes/deletes audited; agent create/update/delete audited.
- No secrets in the client; OS core never sees provider keys. `/api/os/tools/:id/execute` refuses high-risk tools.
- Sandboxed writes: generated apps and reports live under `WORA_WORKSPACE/<workspaceId>`; path traversal rejected.
- Human approvals: high-risk tool executions require explicit approval in every autonomy mode; approvals carry the exact canonical payload, scope and expiry, are single-use and are rechecked at the tool boundary; decisions and consumption are audited; denials fail the task.
- Device connections: pairing codes are single-use and stored hashed (SHA-256); revocation is terminal; both are audited. No device is ever marked inspected unless it redeemed a code.

## Test results (this branch)

- `api-server`: full suite **406 tests: 402 pass, 4 skipped** (Mongo integration plus Docker integration when disabled), 0 failed —
  `npm test`. Coverage includes solvers, tools, memory isolation + ACL + TTL + version snapshots, registry
  and agent versions, orchestrator journeys 1–5 + failure/approval/denial paths, autonomy policy, device
  pairing, RBAC, boards, digital twins, playbook reuse, SQLite lease fencing, extensions, and the new
  algorithm catalog/selector (catalog integrity, explicit/feature/keyword precedence, fail-closed
  nonlinear/unknown handling, tool execution and HTTP routes), and verification records (passed,
  explicit failure, blocked capability denial, workspace isolation and HTTP routes), action
  classification and enforcement (binding, replay, expiry, budgets, bypass attempts), durable task
  leases/checkpoints, structured problem understanding, independent verification, lesson promotion
  controls, reproducible benchmarks, adversarial approval/workspace tests, scheduler stress, end-to-end missions, planning evaluation and real Docker/browser isolation. With `WORA_DOCKER_INTEGRATION=1`, the Docker suite is 3/3 (`runtime-docker.test.ts`).
- `client`: 66/66 pass — `npm test` (includes the browser and runtime E2E journeys); typecheck + production build green.
- Browser/runtime E2E: **2/2 pass** against the real preview API and Vite dev server (`client/tests/browser-e2e.test.mjs`, `client/tests/runtime-workspace.test.mjs`).
- Production bundle builds: client `npm run build`, api-server `npm run build`.

## Six worlds — mapping (honest)

| World | Surface | Status |
| ----- | ------- | ------ |
| Company | `#campus` (the HQ floor, live Three.js world with agents at desks) + `#director` (Director's Office) | Visual/operating world; OS orchestration runs behind it via مركز التنفيذ |
| Projects | `#projects` (KANBAN-style board with custom columns and persistence) | Real — localStorage for offline speed + server sync via `os_boards` (cross-device durable, demo data labeled and clearable); OS org builder records land in `os_projects` |
| Agents | `#agents` | Real — registry, create/pause/archive/delete, specializations, org builder |
| Execution | `#execution` | Real — mission lifecycle, evidence, handoffs, approvals, resume |
| Intelligence | `#intelligence` | Real — HiGHS MIP, Monte Carlo, decision matrix, tool registry |
| System | `#system` | Real — state, governance, memory, audit, device pairing UI, live capability honesty matrix |

The persistent **Executive Command** bar (bottom of every screen) launches `POST /api/os/missions` and opens مركز التنفيذ.

## What is NOT implemented (explicitly)

- **Local Device Agent** (interact with *your* computer): foundation ships and is verified end-to-end —
  one-time hashed pairing codes, single-use redeem, fingerprint-scoped heartbeats, terminal revoke, full
  audit trail, and a working zero-dependency reference agent (`device-agent/wora-device-agent.mjs`): it
  redeems, collects **local-only** diagnostics (never uploaded), heartbeats, and exits permanently on revoke.
  There is intentionally **no remote command channel** yet — nothing can run anything on your machine.
  `system.diagnostics` inside missions always reports the machine running the API runtime, never your device.
- **Playwright browser automation**: implemented with open/inspect/click/type/select/scroll/wait/screenshot/research/close tools, persisted PNG and Markdown artifacts, session cleanup, expiry, audit events and a management panel on `#brief`, `#run`, `#library` and `#system`. Production runs Chromium in a read-only Docker container with dropped capabilities, resource limits, only the session workspace mounted, an internal network and a connection-time validating proxy that rejects private/metadata destinations and revalidates redirects/connections. Chromium's own sandbox is required by default and the runtime fails closed when unavailable. Financial click/type/select actions are class C and require a payload- and session-bound single-use approval. The process provider is development-only and refused when `NODE_ENV=production`.
- **pgvector / semantic retrieval**: memory uses deterministic TF-IDF scoring; vector retrieval is a drop-in
  replacement inside `os/memory.ts` when a Postgres deployment is provisioned.
- **Approvals beyond high-risk tools**: medium-risk tools (e.g. `agents.create`, `org.build`) execute
  autonomously by design (they are the product's core actions); there is no per-action approval matrix.
- **Temporal, BullMQ-backed mission execution**: missions execute in-process; queue-based execution is the
  documented scale-out path, not a current claim.
- **Live LLM planning**: plan generation is deterministic (capability matchers). When `STUDIO_PROVIDER` +
  key are set, the existing Studio path can enrich, but the orchestrator does not require any provider.
- **Multi-tenant production authZ beyond the four roles**: signed-session workspace isolation exists and
  RBAC v1 enforces owner/admin/member/viewer, but custom role definitions and per-tool permission matrices
  per workspace are not implemented.
- **Project board conflict resolution**: the board sync is last-write-wins at document granularity
  (`os_boards`), not CRDT/field-level merging. Concurrent edits on two devices race; the last PUT wins and
  both clients converge on next boot/save. Field-level merge is future work.
- **Custom per-workspace permission catalogs**: RBAC v1 ships four ranked roles; arbitrary permission
  matrices per workspace are not implemented.
