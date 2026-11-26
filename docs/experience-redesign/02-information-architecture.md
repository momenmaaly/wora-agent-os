# 02 — Complete Information Architecture

**Principle:** one operating environment, five operational zones, two persistent layers.

- **Zones** change the user’s job: brief, run, library, capabilities, system.
- **Layers** remain available across zones: Attention and Inspector.
- **Objects** have one canonical home and many contextual links. The same mission does not get a second “execution page.”

---

## 1. Top-level structure

```text
WORA
├── Brief                  Compose intent, see readiness, resume recent missions
├── Run                    The active mission as an operational document
│   ├── Plan               Task ledger, dependencies, assignments
│   ├── Activity           Runs, handoffs, approvals, verification, delivery
│   ├── Evidence           Evidence chain, independent checks, outcome verdict
│   ├── Artifact           The deliverable, rendered and inspectable
│   └── Context            Problem model, reasoning, capability snapshot, runtime
├── Library                 Deliverables, memory, knowledge
├── Capabilities            Agents, skills, plugins, tools, MCP, integrations
└── System                  Runtime, approvals policy, activity, security, usage
```

Persistent:

```text
Attention layer  → pending approvals, blocked tasks, expired leases, degraded systems
Inspector layer  → details for whatever is selected: task, run, evidence, agent, package, artifact
```

The **Run** zone is the default whenever an active mission exists. The **Brief** zone is the default only when no mission exists.

---

## 2. Zone responsibilities

| Zone | User question | Canonical objects | Not responsible for |
|---|---|---|---|
| Brief | “What should WORA do next?” | Intent draft, recent missions, readiness | Live execution detail |
| Run | “What is happening and what do I need to decide?” | Mission, phase, task, run, evidence, approval, artifact | Catalog browsing |
| Library | “What did WORA produce and remember?” | Artifacts, memory, knowledge | Live task control |
| Capabilities | “What can WORA use, and who can use it?” | Agent, skill, plugin, tool, MCP, assignment, permission | Per-mission execution |
| System | “Is the system healthy, governed, and auditable?” | Runtime, policy, audit, usage, security | Composing work |

---

## 3. Mapping the current product into the new IA

| Current route | New home | Treatment |
|---|---|---|
| `home` | Run / Brief | Composer becomes persistent intent line; active mission becomes the workspace |
| `execution` | Run | Merged into the mission workspace; no duplicate mission center |
| `workflows` | Run → Plan | Plan is a tab of the run, not a separate product |
| `terminal` | Run → Activity / Evidence | Technical event stream is an inspectable layer, not a page |
| `artifacts` | Library → Artifacts | Canonical artifact library; artifact also appears in Run → Artifact |
| `knowledge` | Library → Knowledge | Knowledge is part of the library, with provenance |
| `approvals` | Attention + System → Approvals | Pending approvals interrupt the run; historical approvals remain in System |
| `activity` | Run → Activity / System → Activity | Mission activity stays with the mission; system activity is governance |
| `history` | System → Missions / Activity | Cross-mission history lives in System; current mission identity stays in Run |
| `agents` | Capabilities → Agents | Agent registry, profiles, assignment, permissions |
| `extensions` | Capabilities → Skills / Plugins / MCP | Catalog and installations are one capability inventory |
| `integrations` | Capabilities → Connected systems | Connections and MCP credentials |
| `security` | System → Security | Policy, secret isolation, denials, audits |
| `settings` | System → Settings | Workspace settings |
| `models` | System → Models | Provider routing and usage, separate from capability installation |
| `system` | System → Runtime | Runtime, recovery, limits, checkpoints |
| `pricing` | System → Plan | Commercial surface, not part of operation |
| `organizations` | System → Organizations | Tenant/organization administration |
| `projects` | Capabilities → Projects or System → Projects | Project-scoped capability and mission filters |
| `campus`, `director`, `studio` | Optional “Spatial” mode | Preserve but do not present as primary navigation |
| `workspaces` | System → Workspaces | Workspace administration |
| `intelligence` | Run → Context | Reasoning/problem model belongs to the mission |

The optional spatial mode is accessed from the avatar menu or a secondary “Explore spatial mode” link, not from the primary rail.

---

## 4. Object model

```text
Workspace
├── Mission
│   ├── Phase             understand → plan → assign → execute → verify → deliver
│   ├── Task              status, agent, specialization, tool, dependencies, acceptance
│   │   ├── Run           attempt, start/end, status, summary
│   │   │   └── Evidence  tool output, independent checks, digest
│   │   ├── Verification  expected vs actual, independence, verifier, result
│   │   └── CapabilitySnapshot  resolved agent, tools, skills, plugins, permissions
│   ├── Handoff           contract between specialists
│   ├── Approval          risk, action summary, exact payload, decision
│   ├── Outcome           verdict, checks, reasons
│   └── Artifact          deliverable
├── Agent
│   └── CapabilityProfile tools, skills, plugins, permissions, limits
├── Package
│   ├── Skill
│   └── Plugin
│       ├── Tool
│       └── MCPServer
└── System
    ├── Runtime
    ├── Policy
    ├── Audit
    └── Usage
```

### Ownership rules

1. A **mission** owns its plan, tasks, runs, approvals, verification, outcome, and artifact links.
2. An **agent** owns its identity and default capability profile; a mission can resolve a narrower snapshot.
3. A **package** owns its manifest, versions, permissions, tools, and installation records.
4. An **approval** is always attached to a mission/task when it comes from a mission action; the global approval queue is an index, not a second copy.
5. An **artifact** is produced by a mission/task and appears in the Library; opening it from the mission preserves mission context.

---

## 5. Navigation rules

### Desktop

- A 216 px rail with the five zones and a compact active-mission switcher.
- The rail is not a page index. It is a **mode selector**.
- The top bar contains: brand, mission switcher, global command trigger, attention count, runtime state, language, theme.
- Secondary navigation is inside the zone, not in the rail.
- The inspector is a persistent right-hand surface. It can be collapsed; it never becomes a modal on desktop.

### Mobile

- A 56 px top bar: brand, attention, menu.
- A sticky mission header with status and phase.
- A 44 px tab strip for Run sections.
- A 64 px bottom nav with five zones.
- The inspector is a bottom sheet with a drag handle and a close action.
- The composer is reached from the bottom nav “Brief” or the persistent compose action, never inserted above the active run.

### Deep links

Use stable, inspectable URLs:

```text
#/brief
#/run/<missionId>
#/run/<missionId>/plan
#/run/<missionId>/activity
#/run/<missionId>/evidence
#/run/<missionId>/artifact
#/run/<missionId>/context
#/library/artifacts
#/library/artifacts/<artifactId>
#/library/memory
#/library/knowledge
#/capabilities/agents
#/capabilities/agents/<agentId>
#/capabilities/skills
#/capabilities/skills/<packageId>
#/capabilities/plugins
#/capabilities/mcp
#/capabilities/integrations
#/system/runtime
#/system/approvals
#/system/activity
#/system/security
#/system/usage
#/system/settings
```

The existing hash router can support this without changing the backend. The current query/fetch layer can be reused.

---

## 6. Cross-zone continuity

The interface must preserve context when the user moves:

| From | To | Preserved |
|---|---|---|
| Run → Library → Artifact | Artifact reader | Mission title, mission status, back-to-run |
| Run → Evidence → task | Inspector | Same mission, selected task |
| Attention → Approval review | Approval sheet | Exact mission, blocked task, payload |
| Capabilities → Agent | Agent inspector | Agent identity, tools, permissions, assigned packages |
| Capabilities → Skill | Package inspector | Version, trust, permissions, install status |
| System → Runtime | Runtime detail | Runtime health, active leases, known limitations |
| Brief → Run | New/existing mission | Draft objective, context chips, selected project |

No zone should feel like a new application.

---

## 7. Hierarchy and density rules

The interface uses four levels only:

1. **Zone** — rail or bottom nav.
2. **Mission context** — persistent header and phase spine.
3. **Surface** — tabbed content inside the zone.
4. **Inspector** — selected-object detail.

No more than three visible nesting levels at once. Cards are allowed only for genuinely discrete objects (an artifact, an agent, a package); they are not the default container for sections.

### Operational hierarchy on the Run surface

```text
1. Attention         pending approval / blocked task (if any)
2. Mission identity  objective, status, progress, next action
3. Phase             understand → plan → assign → execute → verify → deliver
4. Ledger            tasks and events
5. Inspector         why this item is in its current state
```

The composer is not in the top four.

---

## 8. Progressive disclosure

- **Always visible:** mission status, progress, blocked/approval state, task ledger.
- **One click:** evidence, exact payload, verification checks, artifact content, runtime details.
- **Two clicks:** raw JSON, full agent profile, package manifest, audit detail.
- **Never visible by default:** secrets, full environment variables, raw provider credentials, full tool payloads with high sensitivity.

The interface must feel deep, not crowded.

---

## 9. Empty and degraded states

Every zone needs explicit states:

| State | Presentation |
|---|---|
| No mission | Brief is primary; Run shows “No active mission” with recent missions |
| Mission loading | Phase skeleton + “resolving capabilities” labels, not a spinner-only screen |
| No installed skills/plugins | Capability inventory shows available catalog and explains “available, not installed” |
| No MCP servers | “No MCP connections; core tools only” with a setup action |
| Approval pending | Persistent attention banner; mission status becomes `awaiting_approval` |
| Blocked task | Inline blocker with cause and required decision |
| Verification failed | Outcome verdict becomes `requires_human_review`; evidence chain highlights the failure |
| Runtime degraded | Global status strip changes; system details show limitation and recovery action |
| Permission denied | Inline denial with policy, actor, and next step; never a generic error toast |

---

## 10. What is intentionally not top-level

- **Terminal:** a technical stream, not a destination.
- **History:** a property of missions and system activity, not a primary workspace.
- **Approvals:** an interruption and a governance queue, not a daily page.
- **Models:** provider routing is infrastructure, not a mission surface.
- **Pricing:** commercial, not operational.
- **Campus/Director/Studio:** optional spatial exploration, not the operating system.
