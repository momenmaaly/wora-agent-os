# Exact-reference reconstruction report — correction pass

**Date:** 2026-11-19
**Branch:** `arena/43222165-wora-agent-os`
**Authoritative reference:** Google Drive `wora.photo.agen`
(`1i9MX-rD7smv1zizi76nooaQRYEF4iqG7`, 1672×941, SHA-256
`6f91ff3d27f1d69d7189b6d1a599088086bb50048d1c0b492e3ebcdb718036a1`)
**Comparison copy:** `docs/design/wora.photo.agen.png` (design spec only, never a runtime asset)

This report supersedes the previous exact-reference report. The previous
implementation (commit `6580bdf`) was rejected in review: the office was too
distant, robots were tiny and pixelated, rooms read as an open floor with
partial partitions, department names were floating DOM/SVG tags, and rendering
was blurry. This pass rebuilds those areas against the original Drive image
at full resolution.

## What changed

### 1. Office scale and camera
- The fixed reference camera angle is preserved (no orbit/pan/zoom/drag), but
  all furniture, robots, walls, screens and plants were re-scaled to readable
  reference-pixel sizes: robots 74→112 px tall, desks 76→108 px wide, walls
  104→132 px high, wall displays 124×70→152×88 px, plants 46→62 px.
- The reference-to-viewport mapping now letterbox-fits the 1672×941
  composition, so portrait/mobile viewports preserve architectural
  proportions instead of anisotropically stretching the office.
- A perimeter glass curtain wall with mullions, distant exterior building
  blocks, exterior trees and a building slab edge now fill the frame edges
  the way the reference does, instead of an empty floor extending to the
  horizon.

### 2. Robot quality
- Robot geometry was rebuilt larger and more detailed: 0.72×0.62×0.58 rounded
  head, glossy visor, flattened oval emissive eyes (32×24 segments), antenna
  with orange tip, ear discs with cyan rings, blue collar torus, chest panel
  with light bar, backpack, shoulder/elbow/hip joints, hands and feet.
- Faces, bodies, limbs and seated/standing postures are clearly recognizable
  at the default view. Robots remain clickable and open real agent records.

### 3. Room architecture
- Glass partitions now have taller frames, top/bottom rails, mullion posts,
  door gaps and warm LED base strips; back walls use wood slat (Executive),
  display walls, shelving and glass per room. The central lobby keeps the
  WORA medallion, circular planter with tree, curved sofas and railing.
- No new layout was invented: the seven reference rooms, desk/display/robot/
  plant/rail points and rotations are unchanged from the transcribed spec.

### 4. Room labels — real 3D text
- DOM/SVG floating plaques were removed entirely. Each room now has a real
  extruded 3D plaque (`TextGeometry` + helvetiker bold typeface) mounted above
  its glass room: dark navy rounded plaque, white extruded lettering
  auto-fitted to the plaque width, and a small 3D accent icon (megaphone,
  crown, code brackets, palette, flask, bars, shield).
- The floor medallion "WORA" lettering and link mark are also extruded 3D
  geometry lying on the marble.
- Plaques are raycast-clickable: clicking a plaque focuses that exact room
  and opens its real department inspector. No text is baked into canvas
  textures.

### 5. Rendering and detail
- `RoomEnvironment` PMREM environment map for glass/robot/screen reflections,
  sky-blue background with distance fog, ACES tone mapping, PCF soft shadows,
  antialiased renderer at up to 2× device pixel ratio.
- Marble floor veins strengthened and tinted neutral warm gray (previous pink
  wash removed); foliage darkened to natural greens; curtain glass made
  subtler.

### 6. Workspace integration and mobile
- The Campus 3D view remains full-bleed behind the reference chrome
  (sidebar, search, status strip, Live Activity, Executive Command, view
  controls) exactly as in the reference composition.
- On mobile (≤860 px) the sidebar, profile, status strip and Live Activity
  panel are hidden, the Live Activity panel defaults closed, and the
  inspector becomes a bottom sheet — the office keeps the maximum practical
  viewport with only search, command bar and compact controls visible.
- Verified at 390×844: proportions preserved, no panel covers the office.

### 7. Navigation (unchanged rules, verified)
- Fixed architectural environment: no free mouse dragging, no arbitrary
  camera rotation, no wheel zoom. Clicking a room/plaque tweens to that room
  at the same fixed angle; clicking a robot opens its actual agent
  information; a Return control appears only in focused views.

## Verification (against the original Drive reference, not the rejected screenshot)

- Full-resolution inspection of `docs/design/wora.photo.agen.png` (1672×941)
  and its crops; byte/SHA-256 integrity re-verified before work.
- Desktop capture at 1672×941 (`implementation-final2.png`): seven 3D plaques
  readable, robots large with visible faces, glass rooms with desks/monitors/
  plants, medallion, perimeter glass and trees.
- Mobile capture at 390×844 (`implementation-mobile2.png`): letterboxed
  proportions, no sidebar/panel occlusion.
- Interaction QA (Playwright/SwiftShader): canvas click at Engineering plaque
  (1310,215) → `#campus/zone-engineering` department inspector + return
  button; return → `#campus`, inspector closed; robot click (1070,478) →
  Nova agent profile (model/state/no recorded task/activity). `errors=[]`.
- `npx tsc --noEmit` clean; client tests 27/27 pass; `npm run build` passes;
  api-server tests 24 pass / 1 skip / 0 fail; `git diff --check` clean;
  preview host returns 200 for `/` and `officeScene.ts`.

## Honest limitations

This is the closest technically achievable **procedural real-time 3D**
reconstruction in the browser. It is **not** a pixel-exact or photoreal
reproduction of the AI-generated reference image: trees, marble veining,
screen content and furniture are stylized low-poly/procedural geometry, some
furniture still overlaps in dense rooms (Research/QA), plaques are larger and
more tilted than the reference's compact pills, and the Executive wood-slat
back wall is less prominent than in the image. Screenshot tooling is
SwiftShader (software WebGL), so hardware-GPU rendering, FPS and
production-browser visual QA were not validated. No fake operational data was
introduced: all counts, tasks and activity come from real workspace state.
