# WORA — Product Audit & Reset Plan
**Date:** 2026-11-23 · **Branch:** `arena/3a146077-wora-agent-os` · **Method:** full route/component/API read-through on this branch (no assumptions from prior reports)

## 1. Page-by-page audit (current → verdict → required work)

| Route | Purpose today | Actually functional? | Problems | Required |
|---|---|---|---|---|
| `#campus` (default) | 3D HQ office (Three.js) | Yes — renders, clickable rooms; task records/activity are real workspace events; nothing is simulated work | Forced first screen; deep-navy/neon theme; framing is "workspace", not "give an agent a task"; English "Live Activity" inside Arabic UI | Keep the world (working), move out of the default path, expose as an Organizations visualization; re-theme to brand |
| `#director` | Director's Office composer | Yes — composes a delegation into the office | English/Arabic mix; duplicates Command Bar intent | Keep route; fold into Organization/delegation flows later; remove from primary chrome |
| `#projects` | Project OS board (kanban) | Yes — now server-durable (`os_boards`) with demo labeling | Custom colors from old accent; copy hardcoded Arabic | Re-theme; i18n (later pass) |
| `#agents` | Agent registry + org builder (tabs) | Yes — real CRUD, real org build over `/api/os` | Two jobs (agents vs orgs) under one nav label; org builder buried in a tab | Split: agents stay; **organizations become `#organizations`** |
| `#execution` | مركز التنفيذ — mission launch/lifecycle | Yes — real missions, evidence, approvals, resume | Label is fine but shell/identity inconsistent; mixed languages in sublabels | Re-theme; i18n (later pass) |
| `#intelligence` | Solvers + twins + playbooks + tools | Yes — HiGHS/MIP, Monte Carlo, decision matrix, twins, forecast.linear | Tab list mixes Arabic/English; header framing "الذكاء التشغيلي" | Re-theme; i18n (later pass) |
| `#system` | State/governance/memory/audit/roles/usage | Yes — all wired | Hardcoded Arabic; verbose marketing-ish capability copy | Re-theme; i18n (later pass) |
| `#studio` | Product Studio (AI product packs) | Partial — works only when STUDIO_PROVIDER + keys set; otherwise demo drafts | Presented as if fully operational | Keep, label "requires provider keys" honestly (already partially the case); out of redesigned IA docs except as secondary |
| `#settings` (+ models/integrations/pricing) | WorkspaceSettings / ModelHub / IntegrationsHub / PricingPlans | Models/integrations = config UIs (real toggles via sockets/stores); **Billing = localStorage flag only, no payment gateway** | PricingPlans presents paid tiers without a real gateway | **Mark billing unavailable/planned** in UI; do not enforce fake subscription value |
| Overlays: QuickSearch, Help, Menu | Real navigation/search | Yes | English kbd labels mixed in RTL | i18n in shell pass |
| CompanyStatusStrip | Header status | Partially real (connection state) but styled as decorative KPI | Remove or reduce to a single real connection indicator | **Simplified to real socket state** |
| ExecutiveCommandBar | Persistent mission launcher | Yes — real `POST /missions` | Wordmark "Executive Command" in English; competes visually with brand accent (cyan) | Rebrand: near-black bar, lime accent, localized labels |

### Cross-cutting problems (confirmed by inspection, all being addressed in this reset)
1. Two themes, both "generic AI dark": purple-navy gradients glow (`--accent #3ee0f0` cyan on `#070d1a`). → **New identity: white/near-black/lime.**
2. Arabic/English mixed at random (`Live Activity`, `Playbooks`, `Executive Command`, `Demo`, kbd `Ctrl K`). → **i18n system with `ar`/`en` + `dir` switching.**
3. Hardcoded strings everywhere; no persistence of language choice. → **`wora:lang` persisted; `<html lang dir>` driven from it (pre-paint + provider).**
4. Nav implies "workspace-first" product (ساحة العمل as mandatory before any task). → **IA: Home/Command Center first; workspace optional.**
5. Three competing entry points with no hierarchy (Command bar + Director composer + agents page). → **One Home hero input = the Execute path; Create/Build are first-class sections.**
6. Billing simulation presented as real. → **Marked unavailable/planned.**
7. Status strip = decorative. → **One real socket indicator.**

## 2. Final information architecture (three entry paths, one product)

**Home / Command Center (`#home`, default)** — start & manage work:
hero task input (natural language → real mission), three entry paths, live missions needing attention, recent executions, registered agents (real data only; meaningful empty states).

1. Home (`#home`) — Command Center
2. المهام والتنفيذ / Tasks & Executions (`#execution`)
3. الوكلاء / Agents (`#agents`) — registry + create + versions
4. المشاريع / Projects (`#projects`)
5. المنظمات / Organizations (`#organizations`) — org builder + built orgs; links to the 3D office (`#campus`, kept as a visualization, out of primary nav)
6. الذكاء / Intelligence (`#intelligence`) — verified capabilities only: MIP scheduling, Monte Carlo/PERT, decision matrix, forecast.linear (holdout-backtested), digital twins (simulated, labeled), playbooks
7. المساحات / Workspaces (`#workspaces`) — optional; explains single-workspace reality, per-user production binding, plan gates marked planned
8. النظام / System (`#system`) — governance, roles, memory, audit, usage, capability honesty matrix
Bottom: الإعدادات / Settings (`#settings`) + الإعدادات الفرعية (نماذج/Integrations/الخطة).

Legacy routes (`#campus`, `#director`, `#studio`) remain reachable and functional, are documented, and are deliberately absent from primary nav.

## 3. Brand identity (tokens)

- Surfaces: `--bg #F7F7F5` (warm off-white), `--panel #FFFFFF`, dark mode: `#0E120C`/`#151B12`.
- Ink: near-black `#14181B` (light) / `#F2F5EC` (dark).
- Brand accent: lime `#A3E635` (primary action/active), near-black ink on it (contrast ≈ 11 : 1); deep lime `#4D7C0F` for accent *text* on white (≥ 5.9 : 1); lime never used as filler decoration.
- Neutral grays for borders/secondary text (`#E2E4DF`, `#5A6259`).
- No gradients, no glows, no glassmorphism; radius 8/5 px; one shadow (overlays only).
- Typography: Inter Variable + IBM Plex Sans Arabic (unchanged, Arabic-first capable).
- Status: success = lime-700 text on lime wash; warning = amber; danger = `#B42318`; info = neutral.

## 4. RTL/LTR contract

- `<html lang="ar" dir="rtl">` pre-paint from `wora:lang` (default `ar`); provider syncs on change; `dir` drives layout via logical CSS properties (already used across shell) — new code uses logical properties only.
- Language switcher in header + Settings; persisted; reload-safe.
- Shell (sidebar/header/command bar/help/search/skip-link), Home, Organizations, Workspaces, Command Center bar: **converted to i18n now**. Remaining legacy pages: Arabic copy is valid Arabic but not yet key-driven — listed as Phase-4 continuation in §6 of this doc and in the PR description. (Honesty requirement: localization is *not* claimed complete.)

## 5. What ships in this change

Audit (this doc) · token rebrand (single `:root` rewrite — every screen inherits) · i18n infrastructure + shell conversion + language switcher + persistence · new IA + nav · **`#home` Command Center** (mission input, 3 paths, live missions from API, recent agents, real empty states) · **`#organizations`** (extracted org builder, real API) · **`#workspaces`** (honest optional-workspace page) · billing marked unavailable (no fake checkout) · decorative status strip → real connection indicator · ExecutiveCommandBar rebranded · default route `#home`.

## 6. Known gaps (explicitly not in this change; tracked, not faked)
- Legacy pages (projects/execution/intelligence/system/settings/studio…) still contain hardcoded Arabic — they render correctly in RTL but are not yet key-driven; English mode will show Arabic there until the conversion pass.
- English copy for those pages comes with the full i18n migration.
- Browser-based RTL/LTR pixel QA is blocked in this sandbox (no browser binary); verified via build + unit tests + HTTP smoke only.
- Studio page still depends on external provider keys; unchanged behavior, clearly marked.
- Billing: no payment gateway; plans are labeled as such.

## 7. Feature honesty ledger (this build)

| Feature | Class | Evidence / dependency |
|---|---|---|
| Task execution missions (understand→plan→route→execute→review) | **Implemented + verified** | Live `POST /api/os/missions` → `msn_a48595579fbd406f` (2026-11-23, via :4173 proxy); status transitions + evidence persisted; api-server tests 57/57 (58 incl. opt-in Mongo skip) |
| Agent registry (CRUD, pause/activate, delete, seeded specialists) | **Implemented + verified** | Real REST over `/api/os/agents`; 30 client tests; interaction code-reviewed |
| Organization builder (departments, managers, teams, kickoff mission) | **Implemented + verified (API)** | `POST /api/os/organizations` creates real agents/project/kickoff mission; UI moved to `#organizations` |
| Project board (kanban, server-durable via `os_boards`, LWW merge) | **Implemented + verified** | Durable store + sync debounce contract-tested; board survives reload with API reachable |
| Command Center (home) | **Implemented, build-verified** | Live API wiring; render smoke = build only — no browser available in this sandbox |
| Roles & RBAC (owner/admin/operator/viewer) | **Implemented, unit-verified** | Enforcement tests; viewer/admin rejection paths unit-tested (not exercisable anonymously against live server) |
| Memory ACLs / namespace isolation | **Implemented, unit-verified** | Server-side ACL filter tests |
| Versioning (agent/org draft→publish) | **Implemented, API-verified** | Version routes + tests |
| Forecast (forecast.linear) | **Implemented + unit-verified** | Holdout backtest (`holdoutMae`), R², disclaimer; 8-point minimum |
| MIP scheduling / Monte Carlo / decision matrix | **Implemented, unit-verified** | HiGHS/MIP tests; simulation outputs labeled `simulated: true` where applicable |
| Digital twins | **Demo-simulated, labeled** | Deterministic mock telemetry; UI must keep the "simulated" badge |
| 3D office + floorplan | **Implemented (client), build-verified** | Three.js scene; room visit/assign real paths; not browser-verified here |
| Studio (AI product packs) | **Implemented-not-verified** | Requires `STUDIO_PROVIDER` + provider keys; without them drafts are local/demo — labeled |
| Billing / plans | **Not implemented (presentation removed)** | No payment gateway; PricingPlans shows local/demo notice; plans not enforced anywhere |
| Multi-workspace / teams / enterprise governance UI | **Not implemented (honestly disabled)** | Workspaces page states this explicitly; no fake limits |
| English mode on legacy pages | **Not implemented (known gap)** | See §4/§6 — nav/shell/home/orgs/workspaces/command bar are key-driven; legacy page bodies are hardcoded Arabic |
| Browser/visual QA + screenshots | **Blocked by infrastructure** | No browser binary in sandbox; Playwright browser download not permitted to assume; must run on a machine with Chromium |

## 8. What this reset does NOT claim

- It does not claim complete localization of the product. Arabic-first is complete for shell + new pages; English is wired for the same surfaces; the legacy pages still contain Arabic strings.
- It does not claim plan gating, payments, or enterprise governance.
- It does not claim screenshot-verified visual QA.
- It preserves all prior work (PR #8): no force-push, no history rewrite, no merge.
