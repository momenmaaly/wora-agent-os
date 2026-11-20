# Campus & Product Design Overhaul — implementation report

Date: 2026-11-19 · Branch: `arena/43222165-wora-agent-os` · PR: #6 (open)

This is an incremental upgrade of the committed Phase 1 baseline, not a rebuild. The exact approved `wora.photo.agen` image remains a design specification; it is not used as a runtime background, texture, screenshot, or static workspace.

## What was genuinely implemented

### 1. Workspace-first Campus

- Replaced the default workbench header/grid/rail composition with a full-height `campus-workbench` and `campus-stage`. On desktop the interactive office is the primary region of the available viewport; team and activity information now live in optional overlay drawers instead of occupying a permanent rail.
- Compact operational context: `CompanyStatusStrip` now shows connection mode, real agent count, and recorded task count only. The sidebar, topbar, Executive Command rail, global headings, buttons, fields, badges, and dialogs were reduced and aligned to a restrained design system.
- Preserved all routes, pages, dialogs, authentication/session behavior, backend communication, company/department/agent/workflow architecture, the Executive Command → Director Office route, and the SVG/floor-plan fallbacks.
- `Campus.tsx` keeps 3D/SVG/floor-plan switching, department picker, tour, focus/full-view, expansion, task board, chat, standup, and return-to-desks controls. A department click now opens the real team drawer and navigates into the existing room route.
- Added a grounded handoff tool with two preserved roster agents. It calls the existing `triggerHandoff` store command, records the action in `activityLog`, and produces the authorized corridor movement; it does not mutate or invent a task record.

### 2. Connected interactive 3D office

- The vanilla Three.js scene remains real WebGL with an orthographic camera and OrbitControls (zoom, pan, rotate, department/robot focus, reset). No static image or pre-rendered scene was introduced.
- Added a continuous central corridor spine, door-to-lobby dashed circulation routes, shared seating/plants, and a coherent slab-wide connection between the existing ten departments. Departments remain glass-walled rooms in one building rather than isolated floating boxes.
- Raycast selection now distinguishes robots, departments, workstations, workstation screens, and meeting spaces. Selection focuses the real 2D workstation spot where appropriate and opens an inspector using actual team/task/lifecycle records.
- Inspector actions perform real actions: open the department task board, show the team drawer, call a standup, open chat, or assign a task. Screens/workstations explicitly report `Not connected` for live device telemetry instead of inventing it. The non-interactive current-view indicator is no longer a dead button.
- WebGL fallback retains working SVG/floor-plan buttons and clearly states that no simulated company state was created.

### 3. Real event/location-driven movement and robot states

- `useOfficeSimulation.ts` movement markers now carry a `commandSeq`. Only markers produced by a recorded operator/backend/workspace command are allowed to drive a 3D robot. Automatic idle roaming remains available to the preserved SVG workspace but is explicitly rejected by the WebGL movement bridge.
- `office/motionBridge.ts` converts the existing 2D corridor path coordinates into 3D world positions. `Office3D.tsx` subscribes to motion without re-rendering React on every animation frame; it updates robot positions, movement state, and semantic location changes directly on the scene controller.
- A real `workspace:update` that changes a recorded task's `targetAgentId` now emits a handoff command, records the task title and new assignee, and routes the previous owner toward the new owner's department. Existing task assignment still dispatches the assignee to the recorded task zone. The manual handoff tool uses the same command path.
- `three/layout.ts` derives robot state from real lifecycle/status/task records plus authorized commands. `three/robot.ts` has distinct procedural working, thinking, walking, communicating, meeting, reviewing, idle, blocked, completed, waiting, and offline animation states. Reduced-motion and offline/error states are respected. No timer-based progress, synthetic productivity, or simulated execution was added.
- Preview mode is labeled explicitly as simulated replies with no provider connected.

### 4. Product-wide design system

- `index.css` introduces tighter enterprise tokens (`--panel-radius: 6px`, `--control-radius: 5px`, spacing scale, restrained teal/navy accent), consistent typography, smaller page headings, flat controls, and a flat agent avatar with a functional status edge instead of a gradient.
- Removed decorative radial gradients, backdrop-filter glass, decorative card gradients, and large dialog/surface radii from the audited stylesheets. The floor-plan grid remains a functional linear grid, not a glow.
- `company-frame.css` was rewritten with opaque panels, compact status/control surfaces, and consistent small controls. `shell.css`, `workbench.css`, `features.css`, `studio.css`, `floorplan.css`, and `campus.css` were aligned to the same visual language.
- Responsive rules define a desktop workspace-dominant layout and a mobile layout with a 62dvh minimum stage, compact toolbar, single-column handoff fields, and a bottom-sheet drawer.

## Validation performed

| Check | Result |
| --- | --- |
| Client `npm run typecheck` | Passed |
| Client `npm test` | **23/23 passed**, including DOM interaction and design-system tests |
| Client `npm run build` | Passed; `Office3D` 47.41 kB / 16.97 kB gzip, `three` 501.43 kB / 126.44 kB gzip, `Campus` 29.06 kB / 10.63 kB gzip |
| API server `npm run typecheck` | Passed |
| API server `npm test` | 24 passed, 1 MongoDB integration test skipped, 0 failed |
| `git diff --check` | Passed |
| Vite dev server | Running on `0.0.0.0:5173`; no compile errors in log tail |
| Local HTTP checks with preview origin | HTTP 200 for `/`, `Campus.tsx`, `Office3D.tsx`, `motionBridge.ts`, `useOfficeSimulation.ts`, `officeScene.ts`, `layout.ts`, and updated CSS; `Vary: Origin` present |

Interaction evidence, not screenshots:

- `client/tests/campusInteractions.test.mjs` renders `Campus.tsx` through Vite SSR in jsdom and clicks an SVG department, closes/reopens the team drawer, executes a validated handoff, verifies the store command and activity-log entry, opens the activity drawer, changes the department picker, and invokes assignment.
- `client/tests/office3d.test.mjs` verifies the ten-room layout, workstation bounds, grounded robot states, authorized walking/meeting states, and rejection of auto-roam markers by the WebGL motion bridge.
- `client/tests/designSystem.test.mjs` verifies restrained design tokens, absence of decorative gradients/glass/glow text, desktop Campus rules, and mobile breakpoint rules.
- Performance-oriented code paths were checked by review and build: adaptive WebGL quality, capped pixel ratio, code-split `three`, command-only 3D movement, and no React re-render per animation frame.

## Honest limitations and still-incomplete work

- No browser automation, real WebGL/GPU context, automated screenshot comparison, pixel-perfect visual comparison, mobile-device QA, load test, or measured frame-rate test was available in this sandbox. DOM interaction tests exercised the SVG fallback and real store actions; WebGL raycasting was type-checked, built, and served successfully but not clicked in a real browser.
- The responsive CSS is verified structurally, not visually on physical devices.
- The exact reference image remains a design specification only. The procedural robots preserve its rounded white shell, dark visor, cyan eyes, blue chest panel, and colored accents, but pixel-perfect fidelity is not claimed.
- Live workstation/screen telemetry is not connected; the inspector says so rather than displaying fake data.
- Backend zones (4) still differ from the client's ten rooms; the production seed roster remains smaller than the client roster; `api-server/src/scripts/preview-server.ts` remains explicitly simulated. These mismatches were preserved rather than hidden.
- No full GM workflow/approval engine, persistent company memory, true deliverables pipeline, provider/BYOK execution, universal integrations, subscription/admin center, production agent execution, or task-reassignment UI was added.
- PR #6 remains open. Earlier `gh pr checks` showed `Vercel Preview Comments` passing and `Vercel` pending; no later preview deployment success is claimed in this report.
