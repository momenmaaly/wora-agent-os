# Exact `wora.photo.agen` reconstruction — implementation and verification report

**Date:** 2026-11-19
**Branch:** `arena/43222165-wora-agent-os`
**Pull request:** #6
**Reference:** exact Google Drive file `wora.photo.agen`, Drive ID `1i9MX-rD7smv1zizi76nooaQRYEF4iqG7`, 1672 × 941 PNG, SHA-256 `6f91ff3d27f1d69d7189b6d1a599088086bb50048d1c0b492e3ebcdb718036a1`.

> **Status:** this is the closest technically achievable **procedural real-time 3D** reconstruction completed in this checkout. It is **not** a pixel-exact or photoreal acceptance of the reference render. The side-by-side comparison makes the remaining material, lighting, geometry-density, and robot/furniture fidelity gaps explicit.

## Deliverables

- `docs/design/EXACT_REFERENCE_RECONSTRUCTION_SPEC.md` — authoritative visual blueprint derived from the exact Drive image. It supersedes conflicting camera-control rules in `REFERENCE_IMAGE_SPEC.md`.
- `docs/audits/exact-reference-final-implementation.png` — final 1672 × 941 WebGL capture.
- `docs/audits/exact-reference-final-comparison.png` — 50%-scale side-by-side: exact reference on the left, final implementation on the right.
- `client/src/three/referenceLayout.ts` — fixed-camera projection, seven visible rooms, ten-logical-to-seven-visual mapping, screen-space feature/desk/display/robot/plant/rail points.
- Rewritten `client/src/three/officeScene.ts`, `materials.ts`, `robot.ts`, `Office3D.tsx`, and scoped `company-frame.css` — real-time scene and exact-reference dark LTR chrome.
- Rewritten `client/tests/architecturalOffice.test.mjs` — seven-room composition, fixed camera, DOM plaques, no baked signs/free controls, high-quality materials, furniture/robot markers, and plaque projection checks.

The exact PNG remains a **design/specification artifact only**. It is never used as a runtime background, texture, static scene, or screenshot substitute.

## Implemented composition

- Fixed high three-quarter perspective camera targeting the central WORA medallion; no OrbitControls, drag, pan, wheel zoom, or arbitrary rotation.
- Full-bleed bright office behind a dark LTR enterprise shell: left navigation, centered search, company status card, profile/bell, Live Activity, Executive Command, and 3D/Floor Plan/Live View controls.
- Seven visible labelled glass-partitioned rooms: Marketing, Executive Office, Engineering, Creative Studio, Management, Research, and QA & Testing. All plaques are real DOM buttons with SVG icons and perspective rotations.
- Ten logical business rooms/routes remain intact and map onto the seven visual rooms; SVG/floor-plan fallbacks, inspectors, motion bridge, recorded tasks/handoffs, auth, backend routes, and Director/Executive Command behavior remain wired.
- Real 3D geometry for marble/wood floors, glass walls, mullions, warm LED rails, desks, chairs, monitors, wall displays, shelves, racks, conference/executive furniture, plants, sofas, lobby tree, planter, medallion, and robots.
- Robot family with white rounded head, dark visor, cyan eyes, blue collar/chest, compact limbs, and state-driven lifecycle animation. Robot selection opens real agent records.
- Status counts and Live Activity totals come from real workspace state. The final local-state capture shows 12 agents, 0 working, 0 waiting, 0 blocked, 0 recorded tasks, and 0 activity events; no fake activity rows, productivity, progress, telemetry, or completions were added.

## Verification performed

| Check | Result |
| --- | --- |
| Exact Drive retrieval and integrity | 2,695,320 bytes; byte-identical to `docs/design/wora.photo.agen.png`; SHA-256 and dimensions verified. |
| Full-frame visual comparison | 1672 × 941 reference and final implementation compared side-by-side; see `exact-reference-final-comparison.png`. |
| Crop comparison | Same 11 inspection regions reviewed: Marketing, Executive Office, Engineering, Creative Studio, lobby, Management, Research, QA & Testing, GM robot, lobby robot, and Marketing robot. |
| Comparable desktop captures | 1440 × 900 and 1280 × 720 WebGL captures reviewed. Responsive plaque scaling/clamping keeps all seven names legible and avoids top-status/command-bar/control overlaps. |
| Browser render JSON | At all three desktop sizes: `canvases=1`, `roomLabels=7`, `webgl=true`, expected Vite/React DevTools messages, no `pageerror`. Expected `socket.io` handshake errors occur because the local capture did not run the backend socket. |
| Click QA | Engineering plaque → `#campus/zone-engineering` and real department inspector (`Team records 2`, `Recorded tasks 0`); return → `#campus`, inspector closed, seven labels restored; robot click → real Nova agent profile with model/state/task fields; no page errors. |
| Client typecheck | Passed. |
| Client tests | 27/27 passed. |
| Client production build | Passed. `Office3D` 64.02 kB / gzip 22.35 kB; `Campus` 29.10 kB / gzip 10.65 kB; `three` 480.85 kB / gzip 121.62 kB. |
| API server typecheck/tests | Typecheck passed; 24 passed, 1 skipped (MongoDB integration), 0 failed. |
| `git diff --check` | Passed. |
| Preview-host module checks | Preview origin returned HTTP 200 for `/`, `Office3D.tsx`, and `officeScene.ts`. |

Screenshots were produced with headless Chromium/SwiftShader at `reducedMotion: 'reduce'`, animations disabled, and the same `#campus` default route. They prove a WebGL frame and DOM/interaction behavior in that software-rendered browser, not native GPU behavior.

## Honest visual-fidelity assessment

The final implementation now matches the reference's **overall composition**: fixed camera, seven room positions, rotated dark plaques, dark LTR chrome, central WORA medallion/tree/lounge, transparent room boundaries, warm edge lighting, and full-bleed office framing. The full-frame and crop comparisons also show clear remaining differences:

- The reference is a high-fidelity architectural render with realistic global illumination, reflections, soft shadows, detailed materials, and dense photoreal props. The implementation is visibly procedural/low-poly.
- Robots, desks, chairs, plants, tree foliage, shelves, and glass/back walls are simplified geometric representations; robot heads and furniture proportions still differ from the reference.
- Wall displays and back walls are more graphic and angular; lighting is flatter and less warm; marble veining and specular reflections are less realistic.
- At 1280 × 720, the Live Activity panel still overlays part of the upper-right room area, as the reference's floating panel does; labels were scaled/clamped to remain readable.
- No claim is made of photoreal acceptance, exact rendered-frame equivalence, native GPU/WebGL behavioral QA, mobile-device QA, measured FPS, load testing, production/browser visual validation, or Vercel deployment success.

## Explicitly preserved constraints

- No reference-image background, texture, baked sign text, or static scene.
- No fake operational data, simulated progress, invented activity, or fabricated task completions.
- No free camera controls; focused room/agent views use fixed-angle tweens and a return control only after focus.
- Existing product routes, auth, backend, recorded activity/tasks, motion bridge, handoffs, SVG/floor-plan fallbacks, and Executive Command remain functional.
- Phases 2–8 (department CRUD, deeper object inspection, production execution-event synchronization, full GM orchestration, approvals, provider/BYOK usage, universal integrations, knowledge/memory, reporting, subscriptions/admin, security/performance/mobile hardening, and production readiness) remain outside this visual-reconstruction change.
