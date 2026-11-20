# Exact `wora.photo.agen` visual reconstruction specification

**Date:** 2026-11-19
**Source:** exact Google Drive file `wora.photo.agen`
**Drive ID:** `1i9MX-rD7smv1zizi76nooaQRYEF4iqG7`
**MIME/size:** `image/png`, 2,695,320 bytes
**Dimensions:** 1672 × 941
**SHA-256:** `6f91ff3d27f1d69d7189b6d1a599088086bb50048d1c0b492e3ebcdb718036a1`
**Local comparison copy:** `docs/design/wora.photo.agen.png`
**Purpose:** visual blueprint only. The image must never be used as a runtime background, texture, screenshot, static scene, or substitute for real 3D.

This specification supersedes the older `REFERENCE_IMAGE_SPEC.md` implementation rules where they conflict with the current exact-reconstruction directive. In particular, the camera is fixed and must not expose free pan/rotate/zoom/dragging.

## 1. Full-screen composition

The reference is a **dark, LTR, enterprise dashboard shell surrounding a single large three-quarter 3D office view**. The 3D view is not inside a decorative card; it fills the workspace behind the chrome.

Approximate pixel regions at 1672 × 941:

| Element | Region | Visual treatment |
| --- | --- | --- |
| Left navigation | x 0–232, full height | Deep navy `#101A2A`-like panel, subtle rounded modules, WORA cyan logo, company switcher, nav list, upgrade card at bottom |
| Top search | x 565–1120, y 10–65 | Centered dark rounded search field with magnifier and placeholder “Search across your company...” |
| Company status strip | x 550–1140, y 65–120 | Dark horizontal pill: building icon / “My Company / Operational”, AI Employees, Working, Waiting, Blocked with colored status dots. Values must come from real state, not be hard-coded to reference numbers |
| Live Activity | x 1420–1650, y 80–345 | Floating dark rounded panel with green dot, “Live Activity”, real recorded activity rows, and “View All” |
| Executive Command | x 480–1330, y 825–925 | Large dark bottom command capsule with robot avatar, label, natural-language input, cyan send button |
| View controls | x 1365–1650, y 850–925 | Bottom-right dark group: active teal “3D View”, plus “Floor Plan” and “Live View”. No Reset Camera control |
| 3D office | full background, visually x ~230–1672 / y 0–941 | Bright polished office under dark chrome; open-ceiling architectural cutaway, no card border/radius around it |

The existing product’s routes, auth, backend, drawers, SVG/floor-plan fallbacks, recorded activity, tasks, and Executive Command behavior must remain functional. The UI chrome is a visual reconstruction target; operational values remain real.

## 2. Camera, framing and perspective

- Fixed high three-quarter / elevated isometric view from the front-right, looking down toward the central WORA medallion.
- Mild perspective depth: nearer lower rooms are larger; vertical glass mullions and room edges converge subtly. A perspective camera with a roughly 35–40° FOV and an offset close to `(18, 24, 20)` is the starting target; exact values must be tuned by screenshot comparison.
- Central medallion is near `(900, 500)` in the 1672 × 941 reference. Executive Office sits above it at top center; Marketing and Engineering flank it at upper left/right; Creative Studio and Management sit mid-left/right; Research and QA & Testing sit lower left/right.
- The floor plate extends beyond the visible viewport edges. There is no detached floating slab, isolated island, or empty margin around a small model.
- No free mouse camera movement, orbit, pan, arbitrary zoom, or whole-office dragging. Clicking rooms/robots may transition camera target/zoom smoothly while preserving the same fixed angle and architectural environment.
- At the default view, the obvious return control must be hidden so the bottom-right composition matches the reference. Return appears only after entering a room/agent/object view.

## 3. Exact room layout and labels

There are **seven visibly labelled glass-partitioned rooms**, arranged around one central circular lobby—not ten rooms and not a corridor-grid.

| Visual room | Approximate region | Plaque | Icon | Interior identity |
| --- | --- | --- | --- | --- |
| Marketing | upper-left, x 260–590 / y 150–390 | “Marketing” | cyan megaphone | Two paired desk rows, six-ish seated robots, large analytics wall screens, wood shelving, plants |
| Executive Office | top-center, x 650–1050 / y 120–320 | “Executive Office” | gold crown | Wood-slat back wall, symmetrical shelves, large executive desk, GM robot behind desk, rug, two lounge chairs |
| Engineering | upper-right, x 1050–1370 / y 140–390 | “Engineering” | cyan `</>` code brackets | Two paired desk rows with code monitors, large code wall display, plants, corridor robots with tablets |
| Creative Studio | middle-left, x 250–620 / y 410–640 | “Creative Studio” | cyan/white palette | Creative color wall display, paired desks, whiteboards, shelving, plants |
| Research | lower-left, x 520–830 / y 540–790 | “Research” | cyan flask | World-map display, paired desks, bookcase wall, glass display wall, plants |
| Management | middle-right, x 1320–1620 / y 400–660 | “Management” | cyan bar chart | One long rectangular meeting table with six chairs/robots, analytics wall display, whiteboard, plants |
| QA & Testing | lower-right/center, x 950–1300 / y 550–790 | “QA & Testing” | cyan shield | Server racks, blue checkmark display, paired desks with QA screens, plants |

All plaques are **dark navy, horizontally elongated rounded pills** with a thin blue-gray rim, bold white sans-serif text, and a colored icon inside the pill at the leading side. They sit above the room’s glass/back wall, facing the camera, with subtle perspective. They must be real DOM/CSS text and SVG icons, not CanvasTexture text and not blurry baked labels.

Room boundaries are **low transparent glass partitions with dark blue-gray metal frames**, visible top rails, vertical mullions, and door openings. Back walls are warm wood slats, display walls, shelves, or glass; there are no tall opaque white walls surrounding every cubicle. Warm white LED strips run along room floor edges and rail bases.

## 4. Central lobby and circulation

The center is a continuous polished marble floor, not a raised platform. It includes:

- A large circular WORA floor medallion: warm white glowing ring, cyan/blue WORA link mark above bold black “WORA” lettering.
- A circular silver/stone planter with a broad green tree and low ground planting, positioned above/behind the medallion in perspective.
- Curved brown/charcoal sectional lounge sofas around the planter, including a dark circular/oval bench at the lower-left.
- Low glass-and-metal railing around the central lounge edge, with warm LED strip at its base.
- Several robots: seated on lounge furniture, standing/walking with glowing cyan tablets, and positioned around the open circulation paths.
- Marble floor with irregular white/gray veins and soft specular reflections.

Corridors are the broad open marble paths between glass rooms and the central lobby. They must not be represented by dashed game-like paths or a central vertical spine.

## 5. Furniture and accessories

Use real 3D geometry for every visible class of object:

- Warm natural oak desks with chamfered edges; white/metal drawer pedestals.
- Dark gray ergonomic office chairs with five-wheel bases, armrests, and tall backs.
- Dual/triple dark-bezel monitors with blue code/analytics/creative/QA/world-map abstract screens; keyboards, mice, papers, desk lamps, mugs, small devices.
- Large wall displays: analytics bars in Marketing, code in Engineering, creative color art in Creative Studio, world map in Research, dashboard in Management, shield/checkmark and server-rack columns in QA & Testing.
- Wood bookcases/shelves with books, decor, and small plants; executive shelves are symmetrical around a wood-slat wall.
- Potted broadleaf plants in white/gray planters at room corners and around the exterior.
- Glass exterior walls with dark mullions and glimpses of greenery/daylight beyond; no static outdoor image.

Avoid inventing new decorative elements such as a reception desk, WORA DOM nameplate on a desk, circular raised platform, extra signs, extra labels, or generic lounge objects not visible in the reference.

## 6. Robot family and placement

One compact humanoid robot family, preserved exactly in visual identity:

- Large rounded white cuboid head; black/navy glossy face visor; two bright cyan-blue circular/oval eyes; subtle smile on some.
- Small antenna/side-ear accents; some side-ear orange/red accents; blue neck/collar and chest panel.
- Compact white torso, dark navy/purple mechanical shoulders/joints, white arms and legs, dark feet/hands.
- Robots are small relative to desks but clearly recognizable: head, face, torso, arms, legs, and posture are readable at default view.
- Some seated robots work at desks; the General Manager sits behind the executive desk; lounge robots sit on curved sofas/bench; corridor robots stand/walk holding glowing cyan tablets/documents.
- Robot animations must correspond to real lifecycle/task/handoff state. Do not invent productivity or fake operational activity.
- Robots must be clickable and open actual agent information. No isolated robot cards or separate platforms.

## 7. Materials, color and lighting

Dominant sampled palette from the exact image:

| Surface | Target color character |
| --- | --- |
| Dark UI chrome / plaques | `#141A27`, `#161E2A`, `#2A364B`, `#2C3650` |
| Marble floor | warm gray/rose `#A4979D`, `#C8B2AF`, `#D2C9CE`, with white/gray veins |
| Glass frames / rails | blue-gray metal `#36465E`, `#6F899F` |
| Warm wood | `#8C6335`, `#A18873`, `#935935` |
| Sign text | near-white `#FCFEFD` |
| Cyan accents | `#21C3D8`, `#49A0C3`; bright blue screens `#0846C7` |
| Greenery | deep natural greens around `#404642` with lighter highlights |
| Warm LEDs | soft ivory/amber, not saturated orange |

Lighting:

- Bright neutral daylight from an open top and glass perimeter.
- Warm amber/ivory strip lighting along floor edges, shelves, and rail bases.
- Cool cyan emission from screens, WORA mark, robot eyes, and tablets.
- Soft contact shadows below desks, chairs, robots, planters, and glass frames.
- Specular highlights on glass, polished marble, white robot shells, and screens.
- Balanced contrast: bright office against deep navy UI panels.

## 8. Interaction without changing the default composition

- Default view must match the reference framing and chrome.
- Clicking a labelled room or its floor smoothly zooms into that room at the same fixed angle, preserving all surrounding architecture; clicking a robot opens its real agent details.
- Robots may animate/walk only when real task or handoff records require it.
- A clearly visible return control appears only in focused views; returning restores the exact default architectural composition.
- No camera dragging, orbit, pan, wheel zoom, or arbitrary rotation.
- Existing SVG/floor-plan fallbacks, inspectors, task/activity drawers, command bar, auth, routes, and backend functionality remain intact.

## 9. Verification protocol

1. Capture implementation screenshots at **1672 × 941** and comparable desktop sizes, at the default fixed angle.
2. Compare against `docs/design/wora.photo.agen.png` at full-frame and with the same crop regions used during inspection: Marketing, Executive Office, Engineering, Creative Studio, lobby, Management, Research, QA & Testing, and robot close-ups.
3. Check, in order: framing/camera, room count and positions, central medallion/planter/sofas, glass partition geometry, labels/icons/typography, furniture density, robot family/scale/positions, floor/material colors, lighting/shadows, and UI chrome.
4. Correct differences and repeat screenshot comparison until the closest technically achievable match is reached.
5. Report honestly if browser/GPU/screenshot tooling is unavailable; structural tests and a successful build alone do not prove visual fidelity.
