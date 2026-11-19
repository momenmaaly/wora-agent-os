# WORA Campus — Fixed Architectural 3D Environment

**Date:** 2026-11-19  
**Branch:** `arena/43222165-wora-agent-os`  
**PR:** #6 — open / mergeable  
**Status:** source implementation and structural validation complete; browser/GPU visual acceptance is **not** claimed.

## What was implemented

### Fixed, grounded architectural camera

- Removed `OrbitControls` and every mouse/touch free-camera path: no orbit, pan, free zoom, whole-office dragging, or keyboard camera controls.
- Added `client/src/three/architecture.ts` with one fixed elevated architectural angle (`ARCHITECTURAL_OFFSET = (18, 27, 20)`), a tightly computed orthographic frame, fixed-angle projection helpers, and viewport overlap checks.
- Camera navigation now tweens **only the target and orthographic zoom**; the offset, angle, and rotation stay fixed. `focusRoom`, `focusAgent`, `focusSpot`, and `resetCamera` all use that same angle.
- Replaced the floating slab, outdoor ground, perimeter glass, floor edge, and detached miniature cues with a continuous grounded floor, rear/left structural walls, and a workspace-filling 3D office. In 3D mode the Campus stage border/radius is removed so the office is part of the main workspace, not a decorative card.
- Added real wall boundaries, low solid wall bases with glass above, framed glass partitions and door openings, a continuous corridor floor, door thresholds, reception/shared furniture, desks, chairs, monitors, computers, shelves, meeting furniture, lighting, and shadows. Dashed game-like routes were removed.
- Glass/outer walls and transparent selection overlays are marked non-pickable so they do not intercept clicks intended for robots, desks, or room floors.

### Click navigation and return

- Ten visible room/department nameplates are real HTML buttons. Clicking a nameplate, a room floor, a robot, a workstation, a screen, or a meeting object opens the preserved inspector and uses a smooth fixed-angle transition.
- Room focus uses a detailed `roomZoom`; agent and workstation/screen focus use tighter fixed-angle zooms. Reduced-motion users get immediate transitions.
- An obvious **“Return to full office”** control appears whenever the camera is in a room, agent, or spot view. It restores the full fixed frame, clears the agent selection/inspection, and calls the Campus null-room path. Closing an inspector also returns to the full office.
- The drag/zoom hint was replaced with “Fixed architectural view · Click a labelled room, robot, desk or meeting space to inspect it”. The old Reset control and `RotateCcw` import were removed.

### Sharp real-text labels

- Removed `makeSignTexture`, `makeLogoTexture`, `signMaterial`, and `logoMaterial`; room names are no longer baked into CanvasTextures.
- Each department has a sharp DOM `<button>` with English and Arabic text, an accessible label, a 150–160 px projected width, high-contrast dark teal/white styling, 12 px primary and 9 px secondary typography, focus/hover/selected states, and no gradients, glow, or backdrop blur.
- Labels are projected above the corridor-facing glass line, clear of furniture and robots. Runtime collision detection hides the lobby nameplate if it would overlap a department label.
- Structural tests confirm no label-to-label overlap and safe viewport bounds at **1440×900, 1280×720, and 1024×768** desktop sizes; the projected office footprint fills at least 65% of the width and 75% of the height in those viewports.

### Robot clarity and rendering quality

- Preserved the approved `wora.photo.agen` robot design as a design specification only; the exact image is not a runtime background, texture, screenshot, or static scene.
- Increased the physical robot scale to `1.38`, preserved state-specific motion, raised rounded-box/sphere/cylinder/torus segment counts for sharper silhouettes, and kept robots at real workstation/room spots rather than isolated cards or platforms.
- Robot activities remain derived from real lifecycle/status and recorded tasks; command-authorized movement/meeting states and the motion bridge were not replaced with simulated data.
- High-DPI settings: device pixel ratio up to 2 for high quality, antialiasing, ACES tone mapping, PCF soft shadows, 2048 shadow maps, 8× texture anisotropy, and doubled canvas resolution for non-text material/screen textures.

### Preserved functionality

The existing SVG office and floor-plan fallbacks, room/agent/object inspectors, recorded activity/tasks, command-driven motion bridge, handoffs, auth, routes, Director/Executive Command paths, and backend architecture remain intact. No fake operational data, charts, progress, productivity, telemetry, or simulated company state was introduced.

## Validation performed

- `client/npm run typecheck` — passed.
- `client/npm test` — **27/27 passed**, including the new `architecturalOffice.test.mjs` structural tests for fixed camera, real DOM labels, no drag hint, return control, high-DPI assumptions, robot scale, desktop projection, and label non-overlap.
- `client/npm run build` — passed. Notable final chunks: `Office3D` 49.72 kB / 17.83 kB gzip, `Campus` 29.10 kB / 10.66 kB gzip, `three` 480.78 kB / 121.58 kB gzip.
- `api-server/npm run typecheck` — passed; `api-server/npm test` — **24 passed, 1 skipped, 0 failed** (the pre-existing MongoDB integration skip).
- `git diff --check` — passed.
- Existing Vite dev server remained running on `0.0.0.0:5173`; HMR logs showed no compile errors. Local HTTP requests with the preview `Origin` returned `200` for `/`, the changed React modules, all changed Three.js modules, and the changed CSS.
- GitHub checks on the existing PR commit showed `Vercel` and `Vercel Preview Comments` passing at the time of inspection. This was not a visual QA result and does not establish a post-push deployment of these new changes.

## Honest limitations / not validated

- No real browser, GPU/WebGL interaction, screenshot, pixel comparison, measured FPS, load test, or mobile-device QA was performed; browser binaries and Playwright/Puppeteer are unavailable in this sandbox.
- The desktop viewport checks are **structural projection/typography tests**, not screenshots from a rendered WebGL frame. The user-facing acceptance criterion — that layout, main room names, and robots are clearly recognizable/readable at the default Campus view without zooming — is implemented and structurally checked, but has **not** been visually confirmed in an actual desktop browser.
- No claim of pixel-perfect fidelity to the approved robot image is made. The exact reference remains a specification only.
- No claim of PR preview deployment success for the new commit is made until checks are observed after the push.
- Existing product limitations remain: backend zones/seed roster are smaller than the client’s ten-room presentation, one MongoDB integration test is skipped, and later roadmap phases (dynamic departments, full GM orchestration, approvals, provider/BYOK usage, universal integrations, memory/reporting, subscriptions/admin, and production hardening) are not implemented here.
