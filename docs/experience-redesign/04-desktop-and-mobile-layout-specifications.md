# 04 — Desktop and Mobile Layout Specifications

**Design language:** Burgundy technical ledger. Warm paper in light mode, charcoal ink in dark mode, precise hairlines, compact rows, monospace metadata, almost-square corners.

The intent is not minimal decoration. It is **operational calm**: high density, strong alignment, visible structure, no dashboard ornament.

---

## 1. Design tokens

### Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f2eee6` | `#11100f` | App background |
| `--surface` | `#fbf8f1` | `#191715` | Raised surface / rail |
| `--surface-2` | `#e9e2d7` | `#211e1b` | Selected rows, hovers |
| `--ink` | `#211d1a` | `#eee7dc` | Primary text |
| `--muted` | `#72695f` | `#a99e91` | Secondary text |
| `--faint` | `#9a9084` | `#776d62` | Tertiary metadata |
| `--line` | `#d8cfc3` | `#332e29` | Dividers |
| `--line-strong` | `#b9aa9a` | `#514941` | Emphasized borders |
| `--burgundy` | `#722f43` | `#c97993` | Brand, action, current phase |
| `--burgundy-deep` | `#4b1d2b` | `#8d415b` | Pressed / emphasis |
| `--signal` | `#9a5b22` | `#dfa463` | Blocked / approval |
| `--success` | `#3d6649` | `#8fbd99` | Verified / complete |
| `--danger` | `#8b3735` | `#df8177` | Failed / denied |
| `--terminal` | `#171412` | `#0e0d0c` | Code / technical stream |
| `--terminal-ink` | `#e9dfd1` | `#dcd2c4` | Code text |

Rules:

- Burgundy is a signal, not a background wash. Use it for primary actions, current phase, brand, and selected state.
- Amber is reserved for attention and blocked state.
- Green is reserved for verified or completed state, not for general success chrome.
- No purple, blue, gradients, glow, or glassmorphism.
- No drop shadows in the main surface. Overlays may use a single ink-tinted shadow.

### Typography

| Role | Family | Size / line | Weight |
|---|---|---|---|
| UI | `IBM Plex Sans Arabic` | 14 / 1.6 | 400 |
| UI compact | `IBM Plex Sans Arabic` | 13 / 1.5 | 400/500 |
| Section label | `IBM Plex Sans Arabic` | 11 / 1.3 | 600, no tracking in RTL |
| Mission title | `IBM Plex Sans Arabic` | 26 / 1.35 desktop; 20 / 1.4 mobile | 600 |
| Zone title | `IBM Plex Sans Arabic` | 34 / 1.15 desktop; 26 / 1.2 mobile | 600 |
| Data / metadata | `IBM Plex Mono` | 11–12 / 1.5 | 400/500 |
| Code | `IBM Plex Mono` | 12 / 1.65 | 400 |
| Numerals | tabular | — | — |

- Load `IBM Plex Sans Arabic` and `IBM Plex Mono` with `font-display: swap`.
- Use `font-variant-numeric: tabular-nums` on metrics and task indices.
- Use `text-wrap: balance` on mission titles where supported.
- Do not letter-space Arabic text. In LTR only, micro-labels may use `0.08em` tracking.

### Spacing

Base unit: **4 px**.

```text
2  8  12  16  20  24  32  40  56  72
```

- Desktop gutter: 24 px.
- Panel internal padding: 20–24 px.
- Row height: 48–56 px.
- Dense metadata row: 32–36 px.
- Section gap: 32–40 px.
- No arbitrary 7/9/13 px gaps.

### Shape and line

- Default radius: **2 px**.
- Interactive controls: 3 px.
- Sheets: 8 px top corners on mobile only.
- Borders: 1 px solid `--line`.
- Separators: 1 px, not shadows.
- Selected row: 2 px left/right accent in reading direction, plus `--surface-2`.
- Buttons: 2 px radius, 38–40 px height, 14 px text. Primary has burgundy fill; secondary has transparent fill with line; destructive is outlined danger, not filled, until confirmation.

### Motion

- State transitions: 140–180 ms ease-out.
- Sheet: 220 ms cubic-bezier(0.2, 0.8, 0.2, 1).
- No infinite pulse except a small running indicator.
- `prefers-reduced-motion: reduce` removes transforms and nonessential transitions.

---

## 2. Desktop layout

### Grid

At **≥ 1280 px**:

```css
.app {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr) 372px;
  grid-template-rows: 60px minmax(0, 1fr) 34px;
}
```

- Column 1: rail.
- Column 2: workspace.
- Column 3: inspector.
- Row 1: top bar spanning all columns.
- Row 3: runtime strip spanning all columns.

The center and inspector scroll independently. The top bar and runtime strip are fixed.

At **1024–1279 px**:

- Rail collapses to 72 px icon rail with accessible labels on hover/focus.
- Inspector becomes 320 px.
- Hide the inspector by default below 1100 px and open it as a side sheet.

At **900–1023 px**:

- Rail becomes a drawer.
- Inspector becomes an overlay sheet.
- Center uses full width.

### Desktop dimensions

| Region | Size |
|---|---|
| Top bar | 60 px high |
| Rail | 216 px wide; 72 px collapsed |
| Center content max | 940 px, fluid |
| Inspector | 372 px wide; 320 px compact |
| Runtime strip | 34 px high |
| Mission header | 172–208 px depending on attention |
| Phase spine | 72 px |
| Tab strip | 44 px |
| Task row | 56 px |
| Ledger header | 36 px |

### Center column composition

```text
sticky mission header
  eyebrow: MISSION / ID
  objective
  status + progress + strategy + time
  phase spine
  attention banner
  next action
sticky tab strip
scrollable content
  Plan: ledger
  Activity: timeline
  Evidence: verification chain
  Artifact: document reader
  Context: problem/reasoning/capability/runtime
```

### Inspector composition

```text
sticky inspector header: "Inspector" + selected object + close/collapse
scrollable:
  identity
  state
  evidence
  authority
  raw disclosure
```

### Desktop visual example

```text
┌──────┬──────────────────────────────────────────────┬───────────────┐
│ WORA │  MISSION  msn_ba1e…        [Awaiting]  3/4  │ INSPECTOR     │
│      │  Build a production-ready web app…          │ Verify tests  │
│ Brief│  ● Understand ─ ● Plan ─ ● Assign ─ ◉ Exec…│ QA Engineer   │
│ Run  │  ┌ ATTENTION ─────────────────────────────┐ │ blocked       │
│ Lib  │  │ High-risk host.exec is waiting          │ │ host.exec     │
│ Cap  │  │ Approve or reject Node test execution   │ │ [evidence]    │
│ Sys  │  └────────────────────────────────────────┘ │ [authority]   │
│      │  Plan  Activity  Evidence  Artifact  Context│               │
│      │  01 Define scope…         completed         │               │
│      │  02 Generate app…        completed         │               │
│      │  03 Security scan…       completed         │               │
│      │  04 Verify tests…        blocked           │               │
└──────┴──────────────────────────────────────────────┴───────────────┘
 durable store · 0 active leases · 1 checkpoint · opt-in worker · 4 max tasks
```

---

## 3. Mobile layout

Target **390 × 844** as the reference; support 320–430 px.

### Structure

```text
56 px  top bar: brand · attention badge · menu
auto   mission header: objective, status, progress, phase
44 px  tab strip
1fr    scrollable content
64 px  bottom nav
```

No sidebar. No persistent inspector. No composer above the run.

### Mobile run header

- Eyebrow: `MISSION · msn_…` in mono, 11 px, truncated.
- Objective: 20 px, max 3 lines, expandable.
- Status row: status pill, `3/4`, updated time.
- Phase: horizontally scrollable strip with snap-to-current; six phases, 72 px each, current centered on first paint.
- Attention: a full-width amber-bordered block above the tab strip if action is needed.
- Next action: one line, 13 px, with “Review” action.

### Mobile tabs

`Plan`, `Activity`, `Evidence`, `Artifact`, `Context`.

- 44 px height.
- Horizontal scroll if needed.
- Sticky under the phase.
- Underline indicator, not pills.

### Mobile task ledger

Use a **row list**, not cards:

```text
01  Define scope…             completed
    Product Manager · text.extract_summary
02  Generate the app…        completed
    Frontend Engineer · scaffold.webapp
03  Security scan…            completed
    Security Engineer · security.scan
04  Verify tests…             blocked      Review
    QA Engineer · host.exec
```

Tap opens a bottom sheet with the inspector; the task row remains visible behind the scrim.

### Mobile bottom navigation

Five items:

```text
Brief   Run   Library   Capabilities   System
```

- 64 px height, safe-area padding.
- Active item: burgundy icon and 2 px top rule.
- Attention badge on `System` only when there are pending approvals; the persistent attention block stays on Run.

### Mobile sheets

- Bottom sheet max height 88vh.
- 8 px top radius.
- Drag handle 36 × 4 px.
- Header contains title and close button.
- Content scrolls inside the sheet.
- `Esc` and backdrop close.
- Focus is trapped and returned to the trigger.

### Mobile composer

Reached from `Brief` or the compose action in the top bar. It is a full screen sheet or dedicated Brief page, not an inline block on Run.

### Mobile empty states

- Full-width text, no large illustration.
- One primary action.
- A secondary “learn what WORA will do” expandable.

---

## 4. Responsive breakpoints

| Breakpoint | Layout |
|---|---|
| `< 640` | Mobile; bottom nav; sheets |
| `640–899` | Compact tablet; bottom nav or rail drawer; single column; inspector sheet |
| `900–1099` | Icon rail; inspector overlay |
| `1100–1279` | Full rail; inspector 320 |
| `≥ 1280` | Full rail; inspector 372; three columns |

No horizontal page scroll at any width.

---

## 5. Accessibility specification

- Contrast: primary text ≥ 7:1 on surfaces; secondary ≥ 4.5:1; status text ≥ 4.5:1.
- Focus ring: 2 px burgundy/ink offset ring, visible on all interactive elements.
- Every icon-only control has an accessible name.
- Status is icon + text + color.
- Tables/ledgers use semantic `table` or `list`/`listitem`, not div soup where a table is appropriate.
- Tabs implement `role=tablist`, `role=tab`, `aria-selected`, arrow-key navigation.
- Sheets implement `role=dialog`, `aria-modal`, focus trap, labelled by title.
- Live status regions use `aria-live="polite"` for approvals and `assertive` only for critical failures.
- Touch targets ≥ 44 × 44 px on mobile.
- Reduced motion respected.
- Direction switches do not change reading order semantics; use logical CSS properties.

---

## 6. Visual anti-patterns to avoid

- Hero metrics row at the top of the product.
- “Welcome back” or marketing copy in the operational surface.
- Equal-weight cards for composer, mission, inspector, and log.
- Decorative terminal, fake shell prompt, fake streaming text.
- Rounded 16 px cards with soft shadows.
- Purple/blue gradients, glow, neon.
- Robot/brain/sparkle illustrations.
- Empty card grids presented as “catalog.”
- A second navigation system inside a page.
- Hiding the blocked state below the fold.
