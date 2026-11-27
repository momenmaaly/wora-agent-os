# 03 — Main Workspace Interaction Model

**Thesis:** The user should never have to leave the mission to understand the mission.

The main workspace is a **mission document with a live spine**, not a dashboard. It combines an operational header, a phase model, a task/event ledger, a contextual inspector, and a persistent attention layer.

---

## 1. Primary loop

```text
BRIEF
  ↓ submit objective
UNDERSTAND
  WORA resolves the problem, constraints, and missing input
  ↓
PLAN
  WORA selects a strategy and composes a task graph
  ↓
ASSIGN
  Specialists and capability profiles are resolved
  ↓
EXECUTE
  Tasks run; handoffs and evidence accumulate
  ↓
VERIFY
  Independent checks evaluate task outcomes and the final outcome
  ↓
DELIVER
  An artifact is produced and linked to the mission
```

At any point:

- an **approval** can interrupt execution;
- a **failure** can create a blocked task;
- a **handoff** can transfer work between specialists;
- the user can **pause**, **resume**, **replan**, or **cancel**;
- a running mission can be inspected without stopping it.

---

## 2. Entry behavior

### If there is an active mission

Open `Run` for that mission. The current state is the product’s first screen.

The user sees, in order:

1. What needs attention (if anything).
2. The mission identity and status.
3. The phase and progress.
4. The next action, if human action is required.
5. The task/event ledger.
6. The inspector for the selected task.

The composer is available from the persistent intent line, but it does not displace the mission.

### If there is no active mission

Open `Brief`.

The user sees:

- an intent composer with examples and context;
- a readiness line: agents, tools, capabilities, runtime;
- recent missions and their outcomes;
- a short explanation of the execution model, not a marketing hero.

---

## 3. Run surface anatomy

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Top bar: brand · mission switcher · command · attention · runtime    │
├───────────────┬─────────────────────────────────────┬───────────────┤
│ Rail          │ Mission header                      │ Inspector     │
│ Brief         │ objective · status · progress       │ selection     │
│ Run           │ phase spine                          │ why           │
│ Library       │ attention banner (if any)            │ evidence      │
│ Capabilities  │ tabs: Plan Activity Evidence ...     │ raw           │
│ System        │ ledger / content                    │               │
│               │                                     │               │
├───────────────┴─────────────────────────────────────┴───────────────┤
│ Runtime strip: durable store · leases · checkpoints · limits        │
└─────────────────────────────────────────────────────────────────────┘
```

### Header

- **Objective:** one line, `dir="auto"`, max two lines; expands on click.
- **Mission ID:** monospace, LTR-isolated, copyable.
- **Status:** `Awaiting approval`, `Running`, `Paused`, `Completed`, `Failed`, `Cancelled`.
- **Progress:** completed tasks / total tasks, with an accessible progress bar.
- **Strategy:** plan version and selected strategy, if present.
- **Time:** created / updated in locale-aware format.
- **Actions:** inspect, pause/resume, replan, cancel. Destructive actions require confirmation. Prototype exposes read-only inspection.

### Phase spine

Six phases: Understand, Plan, Assign, Execute, Verify, Deliver.

Each phase has one of:

- `complete` — green mark, no pulse;
- `current` — burgundy marker, one-line description;
- `next` — neutral;
- `blocked` — amber marker plus reason;
- `skipped` — muted strike, with reason.

The phase is derived from actual data; it is not a fake stepper.

```text
understand = problemProfile/reasoning available
plan       = planVersions or composition available
assign     = tasks have agents/specializations
execute    = any task running/completed/failed/blocked
verify     = verifications or outcomeVerification available
deliver    = artifactId/artifacts available
```

If the API does not expose enough detail, the phase shows `Not exposed` rather than pretending.

### Attention layer

The attention layer is the highest-priority surface in the workspace.

It appears when:

- an approval is `pending`;
- a task is `blocked`;
- a verification is failed;
- an outcome is `requires_human_review`;
- the runtime reports interrupted missions or expired leases.

It contains:

- **What is blocked:** task title, risk, tool, and one-line consequence.
- **Why it matters:** the exact action and affected evidence.
- **What happens next:** “Approve to execute”, “Reject and replan”, “Inspect evidence”.
- **Context:** the mission and task are preserved when opened.

A single attention item should be reviewable without navigating away. Multiple items collapse into a queue with counts.

### Next action

A compact line below the attention layer:

```text
Next: Approve the Node test execution so QA can verify the suite.
```

If no human action is needed:

```text
Next: WORA is executing 2 tasks. No action required.
```

The next action is computed from status, pending approvals, blocked tasks, and outcome verdict. It is not a static label.

### Tabs

| Tab | Purpose | Default content |
|---|---|---|
| Plan | Execution graph and task ledger | Ordered tasks, dependencies, agents, status |
| Activity | What happened, in time order | Runs, handoffs, approvals, verification, delivery |
| Evidence | Why the result is credible | Verification checks, task evidence, digests |
| Artifact | What was delivered | Rendered report + raw/download |
| Context | What WORA understood | Problem model, reasoning, capability snapshot, runtime |

The selected tab is part of the URL. Switching tabs does not lose the selected task.

### Task ledger

A task is a row, not a card:

```text
01  Define scope and acceptance criteria           Product Manager    completed
02  Generate the working application               Frontend Engineer  completed
03  Security scan of the generated code            Security Engineer  completed
04  Verify the test suite independently            QA Engineer        blocked
```

Each row expands into:

- objective, specialization, agent;
- dependencies;
- acceptance criteria;
- tool and tool input;
- runs with attempts and evidence;
- capability snapshot;
- “Inspect” action that opens the inspector.

Row status is conveyed by icon + label + color, never color alone.

### Inspector

The inspector answers **why** for the selected object.

Default selection: the attention item if present; otherwise the active task; otherwise the mission.

Inspector sections:

1. **Summary** — title, status, agent, specialization, tool.
2. **State** — current status, duration, attempt, dependencies.
3. **Evidence** — run evidence, independent checks, digest.
4. **Authority** — capability profile, permissions, tools, limits.
5. **Raw** — bounded JSON view with copy action.

The inspector never shows secrets. It shows key names and configured/not configured state.

### Event stream

The terminal is not a page. It is an **Activity** layer with:

- chronological events;
- filters (runs, handoffs, approvals, verification, system);
- a “technical” toggle for raw event detail;
- no fake typing or animated shell.

The stream is read-only in the prototype. A production version can add a real command console only if the backend exposes an interactive execution channel. The current backend does not.

---

## 4. Attention and approval interaction

```text
Mission status: awaiting_approval
  ↓
Attention banner: high-risk host.exec
  ↓ Review
Approval sheet:
  - exact action: node --test test/app.test.mjs
  - target: workspace path
  - consequences
  - risk class / payload digest
  - approve / reject
```

The approval sheet is a **side sheet on desktop** and a **bottom sheet on mobile**. It preserves the mission header and phase behind it.

After a decision:

- the task leaves `blocked`;
- the mission status changes to `running` or `failed` according to the API;
- the attention layer updates;
- the event stream records the decision;
- the outcome is still `requires_human_review` until verification completes.

The prototype displays the review surface with a clear **“Prototype: decision not sent”** state. It does not claim a mutation occurred.

---

## 5. Capability resolution interaction

The user must be able to answer:

- Which agent is responsible?
- Which tools can it use?
- Which skills/plugins are assigned?
- Which permissions are granted?
- Which capability snapshot governed this run?

The mission context exposes a **Capability snapshot** card:

```text
Task 03 · Security Engineer
Tools        security.scan, fs.workspace_read
Skills       none assigned
Plugins      none assigned
Permissions  workspace:read
Digest       b745…
Resolved     22:14:55
```

“None assigned” is a first-class result, not an omission. It explains why the mission used core tools rather than installed skills.

---

## 6. Library interaction

### Artifacts

- List: name, kind, mission, created time, status.
- Selected: rendered markdown/report + raw/download.
- The artifact remains linked to its mission.
- Empty state distinguishes “no artifact yet” from “artifact failed to generate.”

### Memory

- List: memory content, source task, mission, time.
- Selected: full text, provenance, linked mission/task.
- The API currently exposes content and timestamps, not a typed title/kind; the UI must not invent metadata.

### Knowledge

- Available only if a knowledge endpoint exists. If not, show “Knowledge surface not exposed by the current API” rather than a fake library.

---

## 7. Capabilities interaction

### Agents

- List with status, specialization, tool count, skill count, permissions.
- Selected: identity, capabilities, limits, current mission involvement.
- Assignment is a production action; the prototype shows the existing profile and assignment state.

### Skills and plugins

- One inventory, two kinds.
- Filters: kind, trust, category, installed, enabled, scope.
- Each row: name, version, type, trust, permissions, install status.
- Selected: manifest, permissions, dependencies, versions, security review, installation status.
- Install action is shown only when the API plan says it is possible.
- The prototype must reflect the real snapshot: 20 available packages, 0 installations, 0 enabled, 1 built-in marketplace, 0 MCP servers.

### MCP and integrations

- MCP servers: transport, health, last check, discovered tools, assigned plugins.
- Integrations: provider connection state and scope.
- Zero-state is explicit.

---

## 8. System interaction

- **Runtime:** mode, durable store, leases, checkpoints, limits, limitations, recovery.
- **Approvals:** historical queue plus current attention.
- **Activity:** cross-mission audit and system events.
- **Security:** policies, permission denials, secret isolation.
- **Usage:** calls, tokens, cost with the API’s own “not billing-grade” caveat.
- **Settings/Models/Organizations:** administrative surfaces, not mixed into the run.

---

## 9. Keyboard and command model

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + K` | Open command palette |
| `G` then `B/R/L/C/S` | Go to Brief / Run / Library / Capabilities / System |
| `J` / `K` | Next / previous task or event |
| `Enter` | Open selected item |
| `Esc` | Close sheet / palette |
| `?` | Shortcut help |

Command palette actions:

- Go to zone;
- switch mission;
- open pending approval;
- inspect blocked task;
- open artifact;
- toggle theme;
- switch language;
- focus composer.

No command should perform a destructive or mutating backend action without a confirmation surface.

---

## 10. State model

```text
Global state
  zone
  selectedMissionId
  selectedTaskId
  selectedTab
  selectedInspectorObject
  attentionOpen
  locale
  theme
  commandPaletteOpen

Mission state
  summary
  detail
  tasks
  approvals
  verifications
  outcome
  artifact
  capabilitySnapshots
  runtime
```

Rules:

- Selecting a mission updates the global selected ID and the URL.
- Selecting a task updates the inspector but not the mission.
- Opening an artifact from Library preserves the originating mission as a breadcrumb.
- A revoked capability or disabled plugin must invalidate the relevant capability-dependent UI immediately, even while a mission is running. The UI should show “capability revoked” on affected tasks and offer a replan.
