# WORA — Complete Product Experience Redesign

**Status:** review prototype + architecture. Browser smoke checks pass. Production UI is intentionally untouched.\
**Base:** `cf34d20617c0dbd6900761c937e28395131f0a0b` (integrated release candidate)\
**Branch:** `feat/wora-experience-redesign`\
**Worktree:** `/workspace/project/wora-experience-redesign`\
**Prototype:** `prototype/index.html` (static, recorded real data)\
**PR #9:** untouched. `main`: untouched.

---

## What this is

A complete UX architecture and high-fidelity browser prototype for a single WORA operating environment:

- one active mission as the center of gravity;
- a phase spine from understanding to delivery;
- persistent attention for approvals and blocked work;
- a contextual inspector that explains *why*;
- visible evidence and independent verification;
- capability resolution as part of the mission;
- runtime depth in the workspace;
- five zones instead of a page inventory;
- Arabic RTL and English LTR, light and dark, desktop and mobile.

It is **not** a production implementation and **not** a visual refresh of the current dashboard. It is the review artifact that must be accepted before the production UI is rebuilt.

---

## Review packet

| # | Deliverable | File |
|---|---|---|
| 1 | Product Experience Audit | `01-product-experience-audit.md` |
| 2 | Complete Information Architecture | `02-information-architecture.md` |
| 3 | Main Workspace interaction model | `03-main-workspace-interaction-model.md` |
| 4 | Desktop and mobile layout specifications | `04-desktop-and-mobile-layout-specifications.md` |
| 5 | Arabic RTL and English LTR behavior | `05-rtl-ltr-and-localization.md` |
| 6 | Component and interaction specifications | `06-component-and-interaction-specifications.md` |
| 7 | Capability and API mapping | `07-capability-and-api-mapping.md` |
| 8 | Technical gaps | `08-technical-gaps.md` |
| 9 | High-fidelity prototype | `prototype/` |
| 10 | Screenshots | `screenshots/` |
| 11 | Prototype verification | `09-prototype-verification.md` |

---

## Prototype data provenance

The prototype is driven by `prototype/data/snapshot.json`, recorded from the integrated API on 2026-11-25:

```text
source: http://127.0.0.1:4130
workspace: wora-preview
mission: msn_ba1e64fc6a6c403d
```

The data is real and intentionally not “cleaned up”:

- 18 agents;
- 20 packages (19 skills + 1 plugin);
- 1 built-in marketplace;
- 0 installations, 0 enabled, 0 MCP servers, 0 plugin tools;
- 1 mission `awaiting_approval`;
- 3/4 tasks completed, 1 blocked;
- 1 pending high-risk `host.exec` approval;
- 3 capability snapshots;
- 3 memory records;
- 1 artifact;
- 0 AI usage calls;
- runtime in `opt-in-worker` mode with durable store and SQLite serialization limitations.

The prototype labels itself **“Recorded live data”** and does not call mutation endpoints. Approval and launch controls are deliberately read-only; the review sheet states **“Prototype: decision not sent.”**

---

## Run the prototype

The prototype is a static app with no build step.

```bash
cd prototype
python3 -m http.server 12001
```

Then open:

```text
https://work-2-tyqfizjtcoefdleh.prod-runtime.all-hands.dev/
```

The work host maps port `12001` to that URL. If the local development server is already using the port, stop that process first; the prototype is unaffected by the production app.

---

## Prototype interactions

- Switch **Arabic / English** in the top bar.
- Switch **light / dark** in the top bar.
- Use the five zones in the rail (desktop) or bottom nav (mobile).
- In **Run**:
  - inspect the pending high-risk approval;
  - open the task ledger and select a task;
  - switch **Plan / Activity / Evidence / Artifact / Context**;
  - open the artifact;
  - inspect the capability snapshots and runtime limitations.
- In **Capabilities**:
  - select an agent to inspect its profile;
  - filter the skill/plugin inventory;
  - inspect a package’s permissions and trust;
  - see the real empty states for installed packages and MCP.
- In **Library**:
  - read the actual artifact and toggle its raw source;
  - inspect real memory records from completed tasks;
  - see the honest unavailable knowledge state and the route back to Capabilities.
- In **System**:
  - inspect runtime durability, limits, and limitations;
  - inspect the approval queue and its exact payload;
  - see the real zero usage report and its honest pricing caveat.
- Press `Ctrl/Cmd+K` for the command palette.
- Use `Tab`, `ArrowLeft`, `ArrowRight`, `Home`, and `End` on tab lists; `Escape` closes the palette and sheets.
- At mobile widths, open a task or approval to use the inspector bottom sheet.

---

## Screenshots

The review screenshots are generated from the prototype, not assembled by hand:

```bash
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/capture-screenshots.cjs
```

The set covers Arabic and English, light and dark, desktop and mobile, the run workspace, evidence, artifact, brief, library memory/knowledge, capability inventory and manifests, MCP empty state, runtime, approvals, usage, and the approval sheet. See `screenshots/README.md` and `09-prototype-verification.md`.

---

## Verification

The prototype is served as a static app and tested in Chromium:

```bash
cd prototype
python3 -m http.server 8123

# from the repository root
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/smoke.cjs
PLAYWRIGHT_PKG=/path/to/playwright node prototype/tests/responsive.cjs
```

Results from the recorded snapshot:

- `smoke.cjs`: **42/42** checks passed, failures **0**.
- `responsive.cjs`: **32/32** width checks passed, failures **0**.
- `node --check prototype/assets/app.js`: passed.
- Arabic and English scans found no raw `namespace.key` strings.

The smoke test asserts route identity, not just that a page rendered. It checks `location.hash`, the active rail zone, and the selected tab at 390px and 1440px, plus the palette, approval sheet, focus return, and keyboard tabs. The width sweep covers 1920, 1440, 1280, 1101, 1024, 900, 768, and 390px.

---

## Strict preservation

- The integrated branch `feat/wora-complete-integration` was not modified.
- PR #9 was not modified.
- `main` was not modified.
- No backend behavior, API contract, database schema, or migration was changed.
- No existing worktree was modified.
- The prototype is isolated in this design branch and worktree.
- No merge or deployment was performed.

---

## Known prototype limitations

- The prototype is read-only and uses a recorded snapshot; it is not connected to live mutation endpoints.
- Screenshot generation and browser tests need Playwright and Chromium; the production app has no new runtime dependency.
- A production implementation must reuse the existing `osApi` / `extensionsApi` clients and session flow.
- Some proposed surfaces are intentionally shown as gaps because the API does not expose them: global artifact listing, knowledge, cross-mission activity, per-run model routing, and permission-denial feeds.
- The prototype does not add a fake terminal or simulated agent activity.
- The current workspace has no installed skills/plugins/MCP, so the capability inventory honestly shows “available, not installed.”
