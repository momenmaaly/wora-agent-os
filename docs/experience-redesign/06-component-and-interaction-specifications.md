# 06 — Component and Interaction Specifications

Every component below maps to a real data source. A component that cannot be backed by current data is marked **prototype-only** or **future/not exposed**.

---

## 1. AppFrame

**Purpose:** one operational shell.

**Regions:** rail, top bar, workspace, inspector, runtime strip.

**Behavior:**
- Rail is fixed; workspace and inspector scroll independently.
- At <1100 px the inspector becomes a sheet.
- At <900 px the rail becomes a drawer and bottom navigation appears.
- The shell never horizontally scrolls.

**States:** default, inspector-collapsed, mobile, focus-mode.

---

## 2. BrandRail

**Purpose:** mode selector, not a page index.

**Items:** Brief, Run, Library, Capabilities, System.

**Each item shows:** icon, label, optional count badge. Run shows the active mission status dot.

**Behavior:**
- Click switches zone and preserves the selected mission.
- Keyboard: roving tabindex; Up/Down moves; Enter activates.
- Selected item uses a 2 px burgundy marker and a subtle surface change.

**Data:** no API. Counts: pending approvals (`state.approvals.pending`), installed capabilities (`extensions.installed`), artifacts (`state.artifacts`).

---

## 3. TopBar

**Purpose:** global context and commands.

**Contents:**
- brand mark + “WORA” + “Operating system for intelligent work”;
- mission switcher (active mission only when in Run);
- command trigger (`⌘K`);
- attention count;
- runtime state (`opt-in worker`, durable, degraded);
- language switch;
- theme switch.

**Behavior:**
- Mission switcher opens a compact list with status and progress.
- Runtime state opens System → Runtime.
- Attention opens the attention queue.
- Command trigger opens the palette.
- No duplicate “launch mission” button.

---

## 4. MissionHeader

**Purpose:** identity, state, progress, and next action for the active mission.

**Content:**
- eyebrow: `MISSION · <id>` in mono LTR-isolated;
- objective (`dir=auto`, 2 lines, expandable);
- status badge, completed/total, plan strategy, updated time;
- progress bar with accessible value;
- phase spine;
- attention banner;
- next-action line.

**Data:**
- mission `status`, `objective`, `summary`, `createdAt`, `updatedAt`;
- tasks for progress;
- `planVersions` / `composition` for strategy;
- approvals for attention.

**States:** loading skeleton, no mission, active, awaiting approval, blocked, completed, failed, cancelled, stale.

**Interaction:**
- Objective click expands/collapses.
- Mission ID copies to clipboard.
- Status opens a status explanation popover.
- Progress opens the task ledger filtered to incomplete tasks.

---

## 5. PhaseSpine

**Purpose:** explain where the mission is in the operating lifecycle.

**Phases:** Understand, Plan, Assign, Execute, Verify, Deliver.

**Derivation rules:**

| Phase | Evidence |
|---|---|
| Understand | `problemProfile` or `reasoning` exists |
| Plan | `planVersions` or `composition` exists |
| Assign | tasks have `agent` or `specialization` |
| Execute | any task in running/completed/failed/blocked |
| Verify | `verifications` or `outcomeVerification` exists |
| Deliver | `artifactId` or artifacts exist |

**States:** complete, current, next, blocked, skipped, not exposed.

**Interaction:** selecting a phase scrolls/filters the ledger to relevant tasks. Hover/focus shows the evidence used to derive the phase.

**Accessibility:** `ol` with `aria-current="step"`; text labels always visible.

---

## 6. AttentionBanner

**Purpose:** make a human decision impossible to miss.

**Triggers:**
- pending approval;
- blocked task without approval;
- failed verification;
- `requires_human_review` outcome;
- runtime recovery issue.

**Layout:**
- amber 1 px border and a tinted surface;
- icon + short title;
- task and tool;
- one-sentence consequence;
- primary “Review” and secondary “Inspect task”.

**Data:** mission approvals, tasks, outcomeVerification, runtime.

**Interaction:** opens `ApprovalReviewSheet` or focuses the blocked task in the inspector.

**Empty state:** not rendered. A healthy mission should not show a green “all clear” banner; the mission header already communicates health.

---

## 7. IntentComposer

**Purpose:** start a new outcome without displacing the active run.

**Fields:**
- objective textarea (`dir=auto`, 1,200 max);
- context chips: project, capability profile, composition mode;
- examples;
- submit.

**Behavior:**
- `Ctrl/Cmd+Enter` submits.
- Submit calls the real `POST /api/os/missions` in production.
- In the prototype, submit is disabled with an explicit “Prototype: no backend mutation” note; the user can still edit and preview the intent line.
- Launch errors are inline, not toasts.

**Data:** agents, tools, extensions summary, state.

**States:** empty, dirty, invalid, submitting, error, success.

---

## 8. MissionSwitcher

**Purpose:** change mission without leaving the operating shell.

**Content:** status dot, objective truncation, progress, updated time.

**Behavior:** keyboard-navigable list; selecting updates the URL and all zones.

**Data:** `GET /api/os/missions`.

**Empty state:** “No missions yet” with a link to Brief.

---

## 9. PlanLedger

**Purpose:** make the plan inspectable as an operational object.

**Header:** `PLAN`, number of tasks, strategy, version.

**Rows:** index, title, agent/specialization, tool, status, dependencies.

**Expanded row:**
- objective;
- acceptance criteria;
- tool input (bounded);
- runs and evidence;
- capability snapshot;
- “Open in inspector”.

**Behavior:**
- Clicking a row selects the task and opens the inspector; it does not navigate.
- Keyboard: Up/Down selects; Enter expands; `I` opens inspector.
- Completed rows can be collapsed by default; blocked/current rows expand automatically.
- Dependency lines are shown only when `dependsOn` is non-empty; no invented graph edges.

**States:** empty, loading, filtered, blocked, completed.

---

## 10. ActivityTimeline

**Purpose:** answer “what happened, in order?”

**Events:** task created/assigned, run started/completed/failed, handoff, approval requested/decided, verification, outcome, artifact.

**Visual:** vertical rule, 12 px marker, monospace timestamp, short title, contextual detail.

**Behavior:**
- Filters: all, execution, handoffs, governance, verification.
- “Technical” toggle reveals raw event metadata.
- Selecting an event selects the related task/approval in the inspector.
- No fake streaming or typing animation.

**Data:** mission tasks/runs/handoffs/approvals/verifications/outcome.

---

## 11. EvidenceChain

**Purpose:** make the verification claim credible.

**Sections:**
- **Outcome verdict:** `requires_human_review`, reasons, generated time.
- **Checks:** pass/fail/not run with description and evidence.
- **Task evidence:** task, status, verification, outcome.
- **Digests:** truncated, copyable, LTR-isolated.

**Behavior:**
- Failed checks are expanded; passed checks are compact.
- Selecting a check opens the related task/run.
- “Raw” disclosure exposes bounded JSON.

**Data:** `outcomeVerification`, `verifications`, task runs.

---

## 12. ArtifactReader

**Purpose:** show what was delivered.

**Header:** artifact name, kind, mission, created time, download/copy.

**Body:** rendered markdown with headings, lists, and code blocks; raw toggle.

**Behavior:** scrolls inside the center column; inspector remains available.

**Data:** `GET /api/os/artifacts/:id`.

**Empty state:** “No artifact has been produced yet” with the reason if the mission outcome is failed/blocked.

---

## 13. ContextPanel

**Purpose:** explain what WORA understood and how it resolved capabilities.

**Sections:**
- Problem model: domain, confidence, success criteria, missing information, ambiguity.
- Reasoning: mode, provider status, sufficiency, unknowns, limitations.
- Capability snapshot: per-task agent, tools, skills, plugins, permissions, digest, resolved time.
- Runtime: durable store, leases, checkpoints, limits, limitations.

**Behavior:** disclosure sections; copy digests; link to Capabilities/System.

**Data:** mission detail, capability snapshots, runtime.

---

## 14. Inspector

**Purpose:** explain the selected object without navigating away.

**Header:** object type, title, status, close/collapse.

**Sections:**

1. **Summary** — what it is.
2. **State** — status, time, attempt, dependencies.
3. **Evidence** — tool output, independent checks, artifacts.
4. **Authority** — capability profile, permissions, limits.
5. **Raw** — bounded JSON.

**Behavior:**
- Desktop: persistent column.
- Mobile: bottom sheet.
- Selection is global; opening an artifact from Library can temporarily show artifact detail in the center, not in the inspector.
- Never displays secrets; only names and configured state.

**States:** empty, loading, error, selected task, selected approval, selected agent, selected package, selected artifact.

---

## 15. ApprovalReviewSheet

**Purpose:** review a consequential action without losing the mission.

**Content:**
- action summary;
- target;
- consequences;
- resource impact;
- risk and action class;
- exact payload;
- payload/review digest;
- requested by, created, expires;
- approve / reject.

**Behavior:**
- Opens from AttentionBanner, Activity, or System approvals.
- Desktop: side sheet 460 px; mobile: bottom sheet.
- Approve/reject requires a confirmation step for high risk.
- In the prototype, the buttons are disabled and the sheet explicitly says “Prototype: decision not sent.” No mutation is simulated.
- On production decision, optimistic state is not assumed; wait for the API response and refetch the mission.

**Data:** `GET /api/os/approvals`, `POST /api/os/approvals/:id/decide`.

---

## 16. AgentProfile

**Purpose:** show an agent as an accountable specialist, not a chat persona.

**Content:** name, specialization, status, role, model, limits, tools, skills, permissions, current mission involvement, capability profile.

**Behavior:** select from Capabilities → Agents; inspect without leaving the zone.

**Data:** `GET /api/os/agents`, `GET /api/os/agents/:id`, mission task agents, `capabilitySnapshots`.

---

## 17. PackageRow / PackageInspector

**Purpose:** present skills and plugins as governed capabilities.

**Row:** name, kind, version, type, trust, permissions, installed/enabled status.

**Inspector:**
- description, author, marketplace, trust;
- versions and checksum;
- compatibility and dependencies;
- permissions with sensitivity;
- secrets;
- execution model;
- tools;
- security review;
- installation status and scope.

**Behavior:**
- Install opens a plan preview (production).
- The prototype shows the real snapshot: 20 available packages, 0 installed, 0 enabled.
- Disabled/revoked packages show why they cannot be used.
- Auto-load is shown as a property, not an implicit permission.

**Data:** `extensions/packages`, `extensions/packages/:id`, `extensions/installations`.

---

## 18. MCPServerList / IntegrationList

**Purpose:** connect external capability without a disconnected subsystem.

**MCP row:** name, transport, command/URL, health, last check, discovered tools, assigned plugin, enabled.

**Integration row:** provider, connection state, scope, last check.

**Behavior:** zero-state is explicit; no “Add server” button unless a real endpoint exists.

**Data:** `extensions/mcp`, integrations API.

---

## 19. RuntimeStrip

**Purpose:** show that WORA is a durable execution system.

**Content:** mode, durable store, active mission/task leases, checkpoints, limits, degraded state.

**Behavior:** click opens System → Runtime; tooltip explains each value in plain language.

**Data:** `GET /api/os/runtime/status`, `/api/os/state`.

---

## 20. CommandPalette

**Purpose:** make the operating system keyboard-first.

**Commands:** navigate zones, switch mission, open attention, inspect blocked task, open artifact, toggle language/theme, focus composer.

**Behavior:**
- `Ctrl/Cmd+K`.
- Fuzzy search.
- Arrow keys + Enter.
- Commands that would mutate the backend require a confirmation surface.
- Esc closes and returns focus.

---

## 21. EmptyState

**Purpose:** explain absence.

**Required fields:** title, cause, primary next action, optional secondary explanation.

**Examples:**

```text
No active mission
WORA has no mission to monitor right now.
[Compose an outcome]

No installed skills
20 skills are available from WORA Official, but none are installed.
[Browse capabilities]

No MCP connections
Core tools are available. No external MCP servers are connected.
[View core tools]
```

No decorative illustration is required. Use a single line icon and a hairline rule.

---

## 22. Toast / Inline Notice

Use inline notices for operational errors. Use a short toast only for non-critical copy/save confirmations.

Never use a toast for:
- approval outcomes;
- permission denials;
- mission launch failure;
- verification failure;
- destructive action confirmation.

Those belong in the context where they happened.

---

## 23. Status vocabulary

| Domain | Values |
|---|---|
| Mission | planning, running, paused, awaiting approval, completed, failed, cancelled |
| Task | created, planned, assigned, running, reviewing, completed, failed, blocked, cancelled |
| Run | running, completed, failed |
| Approval | pending, approved, denied |
| Outcome | verified, partially verified, unverified, failed, blocked, requires human review |
| Runtime | healthy, opt-in worker, degraded, recovering |
| Package | available, installed, enabled, disabled, update available, revoked |
| MCP | connected, degraded, disconnected, disabled |

Labels are localized; raw values remain available in the inspector.
