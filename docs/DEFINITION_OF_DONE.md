# WORA — Definition of Done Report
**Branch:** `arena/3a146077-wora-agent-os` · **Date:** 2026-11-23 · **Scope:** WORA OS — build & execution mandate (supersedes and extends the `arena/fc43198a-wora-agent-os` report, whose content merged to `main` in PR #7, merge commit `922098d`)

This report separates **implemented & verified** from **partial / designed / simulated / blocked**, with the actual commands and outputs run on this branch. Nothing below is aspirational; every "verified" claim names the check that proved it.

---

## 1. Executive summary

WORA is a genuinely working execution platform, not a prototype. Since the last report, this branch added and **verified**: a durable, workspace-scoped **Project OS board on the server** (`os_boards`, cross-device, demo data labeled + clearable); **RBAC v1** (owner/admin/member/viewer, enforced in the OS router, verified over HTTP including the viewer→403 path); **memory ACLs** (workspace/owner visibility + TTL) with **version snapshots**; **agent version snapshots** on every edit; **digital twins** with seeded what-if simulations (labeled simulated); **playbook auto-injection into the planner** (validated playbook preferred over the sample roster, reuse counted). All gates remain green: api-server 57 tests (56 pass / 1 opt-in skip), client 27/27, both typechecks clean, both production builds green, and every new endpoint exercised over real HTTP against real SQLite (via a standalone `createOsRouter` harness — see §6.5 for why the full Wora boot was not used).

**Not done (unchanged blockers):** visual/browser verification (no browser binary), Docker image build (no daemon), Playwright automation, pgvector-class retrieval, custom RBAC permission catalogs, field-level board merge (last-write-wins today), provider failover, live LLM planning. Listed with exact reasons in §6 — none are disguised.

---

## 2. Priority map (mandate priorities 1 → 5)

| # | Priority (mandate) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | Executive Command + Execution Center — type objective, run it, see it | **Verified** | Executive Command bar → `POST /api/os/missions` → live lifecycle in مركز التنفيذ (`#execution`), polling, evidence per run, handoff contracts, artifact download |
| 2 | Agents & organizations are real, persistent, reusable entities | **Verified** | 18 seeded specializations in `os_agents`; create/pause/archive/delete over REST + UI; **agent edits now snapshot the prior definition** (`os_agent_versions`, cap 20) — verified over HTTP (`GET /agents/:id/versions` shows version 1 snapshot with `changedBy`) |
| 3 | Intelligence that is actually computed | **Verified** | HiGHS MIP (employee-schedule 20×5 → total cost 480), Hungarian assignment, seeded Monte Carlo PERT, decision matrix with ±25 % robustness check, **digital-twin what-if scenarios** (Monte Carlo over adjusted PERT drivers, `simulated: true`) |
| 4 | Control plane — approvals, revocation, audit, autonomy | **Verified** | high-risk `host.exec` pauses at `awaiting_approval`; approve → auto-resume → completed; deny → task fails loudly; autonomy policy; device pairing lifecycle; **RBAC v1 enforcement** (viewer 403 on mutations, self-role-change refused) — all verified over HTTP |
| 5 | Deployment & hardening | **Verified (build/boot/auth)** / **Blocked (image)** | Production boot rejects missing config; OS router verified standalone; Dockerfile/static review only — **no Docker daemon in this sandbox** |

---

## 3. Mandate journeys — executed, not described

| Journey | Result | How verified |
|---------|--------|--------------|
| J1 — "Inspect my computer…" | Completes; real host signals as evidence; scope stated | api-server test + live HTTP run |
| J2 — "Create a software testing agent" | Persistent qa_engineer agent | api-server test + curl smoke |
| J3 — "Build an organization … online marketplace" | 8 departments, 9 agents, managing-director spine, project + kickoff mission | api-server test |
| J4 — "Build a working web application" | scope → scaffold (`node --test` green) → security scan (0 criticals) → QA re-run; balanced autonomy **waits for human approval**; approving resumes to `completed` 4/4 | api-server test + HTTP approve→resume→completed |
| J5 — 20 employees × 5 shifts | HiGHS MIP; feasible; cost 480; independent re-validation; labeled SAMPLE everywhere | api-server test + REST + UI |

---

## 4. Six worlds + Command Center — status

| World | Route | Status | Notes |
|-------|-------|--------|-------|
| Company | `#campus` + `#director` | Working | Live 3D HQ; interface explicitly reads "Recorded workspace events only" — no invented activity |
| Projects | `#projects` | **Working — now server-durable** | Kanban board; zustand optimistic + localStorage; **server sync via `os_boards`** (pull on boot, server wins; debounced push; 512 KB cap; audited). Demo seed labeled `بيانات تجريبية · Demo` with one-click clear (empties local + server). `os_projects` written by org builder |
| Agents | `#agents` | **Real** | Registry CRUD, specializations, org builder, **version history per agent** |
| Execution | `#execution` | **Real** | Mission launch, lifecycle pills, evidence, handoff contracts, approvals inline, resume |
| Intelligence | `#intelligence` | **Real** | Employee-shift MIP, Monte Carlo, decision matrix, tool registry, **Playbooks tab with reuse counts**, **التوائم الرقمية (Digital Twins)** — create twins with PERT drivers, record observations, run what-if scenarios |
| System | `#system` | **Real** | Runtime counts, governance, **RBAC roles tab** (my role, member list, grant/change/remove with server-enforced rules), memory browser with **visibility/TTL chips + per-item version history**, capability honesty matrix, audit log |
| Command Center | bottom bar (all screens) | **Wired** | Direct instruction → real mission → navigates to مركز التنفيذ |

Theme aligned to the reference image (`docs/design/wora.photo.agen.png`): deep-navy `#070d1a` default. Composition is the existing campus implementation; no redesign.

---

## 5. Quality gates — actual results on this branch

```
$ npm --prefix api-server run typecheck   → clean
$ npm --prefix api-server test            → # tests 58 · # pass 57 · # fail 0 · # skipped 1 (Mongo, opt-in)
$ npm --prefix api-server run build       → ⚡ Done (esbuild)
$ npm --prefix client run typecheck       → clean
$ npm --prefix client test                → # tests 30 · # pass 30 · # fail 0
$ npm --prefix client run build           → ✓ built (~4s)
```

New-code verification (standalone `createOsRouter` HTTP harness on ephemeral port, real SQLite at `/tmp/osverify`, dev-mode preview workspace — not the production server, see §6.5):

- `GET /api/os/roles` → `{ me: { userId: 'preview', role: 'owner' }, members: […] }` after bootstrap.
- `POST /roles` grant member/admin as owner → 200; **self-demotion** `preview→viewer` → 403 `"You cannot change your own role"`.
- Viewer (forced via direct SQL): `POST /memory` → **403** `"Viewer role is read-only"`, `PUT /board` → **403**, `GET /memory` → **200**. Owner restored after check.
- `POST /memory {visibility:'owner'}` → persisted; `GET /memory/:id/versions` → `create` snapshot listed; other-actor list/search hides owner records (unit tests).
- `PUT /board` → `{updatedAt, sizeBytes}`; `GET /board` round-trips the document; oversized payload → 413 (unit test: 600 KB rejected); `DELETE /board` → 204.
- `POST /twins` (store "فرع المعادي", driver المبيعات 80/120/160) → 201; `POST /twins/:id/scenario {mul 1.25, trials 500, seed 11}` → baseline mean 118.48 → scenario mean 148.1 (**+25 % Δmean**), `simulated: true`; event log records the scenario.
- `PATCH /agents/:id` → `GET /agents/:id/versions` shows version 1 snapshot with previous instructions and `changedBy: 'preview'`.

---

## 6. Honest ledger

### 6.1 Implemented & verified (this branch)
Everything in the prior report (execution engine, agent registry + specializations, handoff contracts, review-before-handoff, retry/reassign/block, memory with scoped TF-IDF retrieval, HiGHS LP/MIP + Hungarian + PERT Monte Carlo + decision matrix, security scanner, sandboxed scaffold→test→scan→QA mission, organization builder, approvals + autonomy policy + audit, device pairing lifecycle + reference agent, restart recovery, self-building playbooks, usage ledger char/4 estimates, deep-navy default theme, JSON error contracts, rate limiting, workspace isolation) **plus**:
- RBAC v1: `roles.ts` ranked owner/admin/member/viewer; router-enforced (viewer read-only; settings-class mutations require admin+; owner-only role administration; self-change refused); `/api/os/roles` endpoints; System → الصلاحيات UI.
- Memory ACLs: `visibility workspace|owner`, `owner_id`, `expires_at` (TTL); actor-scoped list/search/get/delete; `os_memory_versions` snapshots on create/delete (cap 20); memory UI chips + version history.
- Agent versioning: `os_agent_versions` snapshots on every `updateAgent` (cap 20) + `GET /api/os/agents/:id/versions`.
- Durable Project OS board: `os_boards` (one JSON doc per workspace, 512 KB cap, audited last-write-wins); client `boardSync.ts` (boot pull server-wins, 800 ms debounced push, `isDemo` flag, one-click demo clear); `بيانات تجريبية · Demo` badge + sync status chip in مركز المشاريع.
- Digital twins: `os/twins.ts` (drivers/KPIs/event log cap 200) + seeded Monte Carlo what-if with baseline deltas; REST endpoints; Intelligence → التوائم الرقمية tab.
- Playbook planner reuse: OR planner prefers a Jaccard≥0.5 validated playbook over the SAMPLE roster; reuse counted and surfaced in the Playbooks tab.
- Predictive baseline: `forecast.linear` (least-squares trend + honest 80/20 holdout backtest — R², holdout MAE, residual-stddev bands; labeled as a baseline, never as a guaranteed forecast). Listed in the tool registry with a test.
- DB migrations: guarded idempotent `migrate()` (ALTER…ADD COLUMN for pre-existing DBs) + 5 new tables.

### 6.2 Implemented but **partial** (works, scoped honestly)
- Board sync is **last-write-wins** at document granularity — no CRDT/field-level merge; concurrent device edits race (documented future work).
- Memory retrieval remains deterministic TF-IDF, not vector search (swap point isolated in `os/memory.ts`).
- RBAC v1 = four fixed roles; **no custom per-workspace permission catalogs**.
- AI usage ledger = char/4 estimates; not billing-grade; no provider task-routing/failover.
- Restart recovery = boot-time marking + manual resume (missions never auto-execute on boot).
- Company world = campus/director worlds; no separate Company OS console.
- Twin what-if = simulated PERT re-run; **no live telemetry ingestion** (no source exists for it — none is faked).

### 6.3 Designed but **not implemented**
Per-tool custom permission matrices per workspace; Playwright browser automation (contract exists, no runner); BullMQ-backed multi-instance mission scheduling; provider circuit-breaker router; reusable specialization marketplace; pgvector path (see 6.5).

### 6.4 **Simulated / sample** (clearly labeled)
Employee roster (20×5) in `#intelligence` and J5 — payloads carry `sample: true` + Arabic SAMPLE note; twin scenarios carry `simulated: true` and PERT disclaimers; `wora-preview` shared sandbox.

### 6.5 **Blocked / awaiting credentials or environment**
- **Full Wora boot** — the production server requires Mongo + Redis; neither exists in this sandbox, so end-to-end verification used a standalone OS-router harness (all routes, real HTTP, real SQLite). Boot-time config validation fail-closed behavior unchanged from the prior report.
- **Visual browser verification & responsive QA** — no browser binary reachable (Playwright downloads off-allowlist). All OS screens are build-verified + HTTP-verified; pixel parity with the reference image is **not** visually confirmed.
- **Docker image build** — no Docker daemon; Dockerfile statically reviewed only.
- **Live LLM provider flows** — no `STUDIO_PROVIDER`/keys configured; never called.
- **pgvector / real vector search** — no Postgres available.
- **Redis/BullMQ** — same reason.

---

## 7. Exact remaining blockers (to call this "done")
1. Browser-capable machine/CI — closes visual/responsive QA (§6.5).
2. `docker build` capability — closes image row.
3. Provider credentials + `STUDIO_PROVIDER` — closes live LLM row.
4. Postgres + `pgvector` — closes semantic memory row.
5. Mongo + Redis in the target environment — closes full-boot verification row.
6. Product decisions: custom RBAC catalogs; field-level board merge; Company-world dedicated console vs formal acceptance of campus-as-Company; whether twin scenarios should accept external data feeds.

---

## 8. How to verify everything (commands)
```bash
npm --prefix api-server run typecheck && npm --prefix api-server test && npm --prefix api-server run build
npm --prefix client run typecheck && npm --prefix client test && npm --prefix client run build
```
New surface walkthrough: `#system → الصلاحيات` (see your role, members, grant/change/remove); `#system → الذاكرة` (save with `لي فقط`/TTL, open «الإصدارات»); `#projects` (badge + sync chip; clear demo); `#intelligence → التوائم الرقمية` (create twin, record observation, run what-if); `#intelligence → Playbooks` (reuse counter); `#agents` (edit an agent, then `GET /api/os/agents/:id/versions`).
Journey walkthrough (unchanged): `#execution` → «ابنِ تطبيق ويب يعمل» → approve at `awaiting_approval` → completes; `#intelligence → Playbooks`; `#system → الحوكمة والأجهزة`.
