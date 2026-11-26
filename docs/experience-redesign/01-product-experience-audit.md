# 01 — Product Experience Audit

**Scope:** integrated release-candidate at `cf34d20617c0dbd6900761c937e28395131f0a0b`\
**Method:** route/component inspection, live API inspection, review of the existing screenshots in `docs/reviews/complete-integration/`, and a real mission run (`msn_ba1e64fc6a6c403d`).\
**Status of existing product:** functional core, fragmented product experience.

---

## Executive finding

The current product contains the right operational material, but it presents that material as **a collection of destinations** rather than as **one operating environment**.

The strongest evidence is that a single mission already appears in at least six different places:

| Surface | What it shows | Problem |
|---|---|---|
| `#home` / `TechnicalWorkspace` | Composer, current mission, plan, inspector, log | The current operation is below a large empty composer |
| `#execution` / `ExecutionCenter` | Mission list, tasks, runs, approvals | A second mission surface with different hierarchy |
| `#workflows` / `WorkflowsPage` | Plans and workflow views | Plan knowledge is separated from execution |
| `#terminal` / `TerminalPage` | Execution log | Technical truth is separated from the mission |
| `#approvals` / `ApprovalsPage` | Approval queue | The blocking decision is detached from the blocked task |
| `#history` / `HistoryPage` | Mission/audit history | History is detached from the live run |
| `#artifacts` / `ArtifactsPage` | Deliverables | The finished artifact is not part of the delivery moment |

The user therefore has to know **where WORA put something** before they can understand **what WORA is doing**.

That is the central UX failure. It is not a styling problem.

---

## What already works and must be preserved

These are real capabilities and should remain the backbone of the redesign:

1. **A real mission lifecycle.** `planning → running → awaiting_approval → completed/failed/cancelled`, with tasks in `created/planned/assigned/running/reviewing/completed/failed/blocked/cancelled`.
2. **Real task assignment and specialist identity.** Tasks carry an agent, specialization, tool, dependencies, acceptance criteria, and task detail.
3. **Real execution evidence.** Runs include tool, status, duration, evidence output, independent checks, and artifact digests.
4. **Real independent verification.** Verification records carry expected/actual output, independence, verifier, and result; the outcome verification aggregates checks and reasons.
5. **Real approvals.** A pending high-risk `host.exec` approval contains action summary, target, consequences, exact payload, risk, and an approval digest.
6. **Real durable runtime.** The runtime reports opt-in worker mode, durable store, mission/task leases, checkpoints, limits, recovery state, and explicit limitations.
7. **Real artifacts and memory.** The mission has an artifact report and three memory records produced from completed tasks.
8. **Real extension infrastructure.** The API exposes marketplaces, package catalog, install plans, installations, permission review, MCP servers, plugin tools, capability snapshots, and audit data.
9. **Working RTL/theme infrastructure.** Arabic-first layout, English switch, light/dark themes, logical direction support, and accessible controls already exist.
10. **Honest runtime limitations.** The runtime endpoint explicitly says SQLite serializes writes, there is no distributed queue, and side-effecting tools require manual review. The redesign must show this, not hide it.

The redesign should **recompose** these capabilities, not replace them.

---

## Current route and surface inventory

There are **24 routable page IDs** and **18 visible navigation items** across five navigation groups.

```text
Visible navigation
  workspace: home, execution, agents, workflows
  build:     projects, terminal, artifacts
  systems:   integrations, extensions, knowledge
  governance: approvals, activity, history
  settings:  settings, security, models, system, pricing

Legacy/offscreen routes
  organizations, intelligence, workspaces, campus, director, studio
```

The presence of `campus`, `director`, and `studio` creates a second mental model: a spatial office simulation alongside a technical operating system. That may be a useful optional mode, but it cannot be the primary navigation promise if WORA is to read as one operating system.

### Evidence from the current screen

The current home screen at desktop width:

- devotes the first and largest panel to a mostly empty four-line composer;
- shows the current mission second, in a competing card;
- places the execution inspector in a narrow right column;
- reduces the pending high-risk approval to a small “open approvals” row;
- separates the plan from the log below the fold;
- uses soft, equal-weight cards that make the composer, mission, inspector, and log look like peers.

The current mobile home screen:

- opens with a large title and a full composer;
- puts the active mission below the composer;
- clips the mission selector text;
- has no persistent zone navigation;
- treats the inspector as another long section rather than a deliberate mobile surface.

The current extensions screen:

- leads with five large count cards;
- presents the package catalog as a card grid;
- does not connect a package to an agent, mission, or permission decision;
- shows `installed: 0` and `enabled: 0` but does not explain what that means for current work.

The current execution inspector:

- shows four equal stats (`4 agents`, `3/4`, `1 approval`, `verified`);
- collapses the mission into an accordion;
- does not show the causal chain from task → run → evidence → verification → outcome.

---

## Failure analysis

### P0 — The active operation is not the center of gravity

**Symptom:** The current mission is a card below the composer; the composer occupies the visual lead even when work is already running.

**Why it matters:** WORA’s promise is continuous execution. When a mission is active, the user’s first question is not “what should I type?” but “what is happening, what is blocked, and what do I need to decide?”

**Required change:** Make the active mission the primary workspace. The composer becomes a persistent intent line, not the hero of the screen.

### P0 — Attention is not authoritative

**Symptom:** A pending high-risk approval is rendered as a small row inside a narrow inspector card and is also available on a separate approvals page.

**Why it matters:** The system is waiting on a human decision. That is the single most consequential state in the product. It must be visible across the workspace, associated with the blocked task, and reviewable without losing the mission context.

**Required change:** Add a persistent Attention layer with the blocked task, risk, exact action, and a review surface. Approval is an interruption of the run, not a destination.

### P0 — The user cannot see the causal chain

**Symptom:** Task status, run evidence, verification, and outcome are split across accordions, inspector sections, and pages.

**Why it matters:** WORA claims to verify outcomes independently. That claim is only credible if the chain is legible:

```text
objective → plan → assignment → run → evidence → independent verification → outcome → artifact
```

**Required change:** Make the chain a first-class visual object: task ledger, run evidence, verification chain, outcome verdict, artifact.

### P1 — The information architecture is an inventory of features

**Symptom:** 18 visible nav items, 24 routes, multiple synonyms (`execution`, `workflows`, `terminal`, `history`, `activity`).

**Why it matters:** Users must learn the product’s internal decomposition. The OS metaphor should reduce that burden, not add to it.

**Required change:** Five operational zones, with contextual surfaces inside them. Remove duplicate mission destinations.

### P1 — Capabilities are ambient and invisible

**Symptom:** The mission shows specialist chips but not the resolved capability profile. Extensions are a separate catalog. The runtime shows `installed: 0`, `enabled: 0`, `mcpServers: 0`, but the mission still executes core tools.

**Why it matters:** The user cannot answer “which agent, skill, plugin, and permission produced this result?” That is essential for trust, governance, and debugging.

**Required change:** Surface the resolved capability snapshot next to each task and in the mission context; show installed vs available vs assigned capabilities.

### P1 — Runtime depth is hidden under “System”

**Symptom:** Durable store, leases, checkpoints, recovery, limits, and limitations are available but sit in an auxiliary console.

**Why it matters:** WORA’s differentiator is durable, resumable execution. Hiding it makes the product look like a chat wrapper.

**Required change:** Put runtime health, lease/checkpoint status, and known limitations in the mission workspace and the global status strip.

### P1 — The visual language is dashboard-like, not operational

**Symptom:** Large soft cards, equal-weight panels, rounded stat blocks, few structural lines, lots of empty surface, decorative iconography.

**Why it matters:** A dashboard summarizes; an operating system coordinates. The interface should feel like a ledger/workbench: dense, aligned, calm, and inspectable.

**Required change:** Replace card stacking with a ledger + rail + inspector composition; use hairlines, tabular numerals, monospace metadata, and a phase spine.

### P1 — Mobile is a compressed desktop

**Symptom:** Long vertical stack; composer before run state; no bottom navigation; inspector buried.

**Why it matters:** The most important mobile jobs are: check what is happening, approve/reject, read an artifact, and start or redirect work. The mobile layout should be organized around those jobs.

**Required change:** A dedicated mobile run surface with persistent attention, phase strip, tabbed detail, and bottom sheet inspector.

### P2 — Duplicate entry points create ambiguous state

**Symptom:** The global command bar launches a mission on every page except home; home has its own composer.

**Why it matters:** The same action has two different interaction models and no single source of current mission state.

**Required change:** One persistent command line; no duplicate launcher.

### P2 — Localization is mixed in places

**Symptom:** The interface is Arabic-first, but some labels and data strings remain English or LTR; technical IDs and timestamps need direction isolation.

**Why it matters:** Mixed direction makes dense operational data harder to scan.

**Required change:** Define explicit RTL/LTR rules; use `dir="auto"` for user/agent text, LTR isolation for IDs, code, and timestamps; mirror only directional icons.

### P2 — Empty and disabled states are visually weak

**Symptom:** `0 installed`, `0 MCP`, `0 plugin tools` are presented as neutral counters rather than as actionable system state.

**Why it matters:** The user cannot tell whether zero is healthy, expected, or a blocker.

**Required change:** Give every empty state a cause and a next action; distinguish “available but not installed” from “unavailable” and “disabled by policy.”

---

## What the redesign must not do

- Do not add another dashboard page.
- Do not create one page per object type.
- Do not replace real API data with invented activity.
- Do not imply that an installed skill or plugin exists when the API reports zero installations.
- Do not show an approval decision as executed when the prototype cannot perform the mutation.
- Do not hide the runtime’s real limitations.
- Do not remove the existing Campus/Director experience; isolate it as an optional spatial mode.

---

## Audit conclusion

WORA does not need more features to feel like an operating system. It needs a **single operational surface** that makes the existing mission, capability, evidence, governance, and runtime systems legible in one place.

The proposed experience does that by introducing:

1. Five operational zones instead of an inventory of pages.
2. A mission-centric Run workspace with a phase spine.
3. A persistent attention layer for approvals and blocked work.
4. A contextual inspector that explains the selected object.
5. A capability/authority layer that shows what is assigned vs available.
6. A runtime/evidence chain that makes independent verification visible.
7. A mobile-first run experience built around monitoring and decisions.
