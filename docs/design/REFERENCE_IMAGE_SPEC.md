# WORA approved 3D workspace reference

## Source of truth

The exact Google Drive file named `wora.photo.agen` was located and retrieved through the authorized Google Drive connection. No substitute image was used.

| Property | Value |
| --- | --- |
| Exact Drive filename | `wora.photo.agen` |
| Drive file ID | `1i9MX-rD7smv1zizi76nooaQRYEF4iqG7` |
| MIME type | `image/png` |
| Original bytes | 2,695,320 |
| Dimensions | 1672 × 941 |
| SHA-256 of retrieved original | `6f91ff3d27f1d69d7189b6d1a599088086bb50048d1c0b492e3ebcdb718036a1` |
| Local design-spec copy | `docs/design/wora.photo.agen.png` |

This file is a **design specification**, not a runtime background or texture. The implemented workspace must be composed of interactive Three.js/WebGL objects only. The local copy is retained for visual regression review and design documentation.

## Complete-image analysis

### Camera and composition

- A high, three-quarter **isometric overhead camera** looks into an open-ceiling architectural cutaway.
- The office is arranged as a miniature corporate campus: a central circular lobby with a WORA floor medallion, a tree planter, curved lounge seating, and glass railings.
- Seven visible department offices surround the lobby in a balanced radial/cross composition, with the Executive Office at the top center.
- The office environment occupies most of the screen. Dark UI chrome frames it rather than covering it.
- Perspective is shallow enough to keep department labels legible, but still shows desk depth, wall thickness, chair silhouettes, and robot volume.
- The visual center is the illuminated WORA medallion; secondary anchors are the department signs and large wall displays.
- Warm perimeter daylight and outdoor greenery appear beyond the glass exterior walls.

### Office architecture

- Open-plan, open-top floor plate with no ceiling.
- Polished light stone/marble floors with fine veining and warm reflected highlights.
- Low glass partitions with dark blue-gray metal frames and visible door openings/thresholds.
- Glass exterior walls and upper-level walkway/railing details.
- Wood slat back walls, shelving, cabinets, and executive bookcases.
- Department signs are floating dark rounded plaques with white text and a colored/crown/icon accent.
- Large department wall displays show analytics, code, maps, creative work, and QA checkmarks.
- Light strips and under-rail LEDs create warm architectural outlines.
- Plants appear in pots, corner clusters, and a central circular planter.

### Workstations and furniture

- Natural oak wooden desks with chamfered edges and white/metal drawer pedestals.
- Ergonomic dark gray office chairs with five-wheel bases and armrests.
- Curved brown/charcoal lounge sofas around the central tree.
- One large executive desk with a monitor, device, accessories, shelves, and seating.
- Dual/triple monitors, laptops, tablets, keyboards, mice, papers, desk lamps, mugs, and small office equipment.
- Workstations are arranged in paired clusters that leave circulation paths visible.
- Meeting/collaboration surfaces and display walls are department-specific.
- Materials are realistic: matte painted metal, glossy white polymer, warm wood, smoked glass, dark screen glass, fabric upholstery, and stone.

### Robot family

The reference robots share one product family:

- Rounded, slightly cuboid white heads with a small antenna.
- Glossy black/navy face visors with two bright cyan-blue expressive eyes; some faces show a subtle smile.
- Small humanoid proportions: large head, compact light torso, short limbs, dark feet/hands.
- Blue chest panels, blue shoulder/collar details, dark navy/purple mechanical joints, and white arms/legs.
- Small orange/red ear or side-head accents on some robots; warm orange metallic accents are compatible with the image when kept subtle. Purple/violet joints and ear details provide the requested identity accents without replacing the white/cyan robot family.
- Cyan glowing tablets/documents carried by walking or collaborating robots.
- Robots are shown sitting at desks, standing in corridors, sitting in the lounge, and working in the Executive Office.
- The General Manager robot sits behind the executive desk beneath a gold crown sign.

The implementation must preserve this family. Generic human avatars, colored cubes, flat icons, and unrelated robot characters are outside the specification.

### Lighting and materials

- Bright, neutral daylight from the open top and glass perimeter.
- Warm amber accent lighting along floor edges, shelves, and glass rails.
- Cool cyan emission from screens and robot eyes.
- Soft contact shadows under furniture, robots, and planters.
- Specular highlights on glass, polished floor, and white robot shells.
- Balanced contrast: light office floor and furniture against dark navy UI panels and deep screen glass.

### UI shell shown in the reference

- Left dark sidebar: WORA logo, company switcher, overview/executive/departments/projects/tasks/knowledge/files/reports/integrations/billing/settings navigation, and an upgrade card.
- Top dark bar: global search, company name, total/working/waiting/blocked agent counts, operational status, notifications, and account menu.
- Right floating dark panel: Live Activity with real-looking event rows and a “View All” link.
- Bottom dark command bar: Executive Command with a General Manager robot avatar and natural-language input.
- Bottom-right controls: 3D View, Floor Plan, Live View, and Reset Camera.
- UI is LTR, compact, professional, and subordinate to the 3D company view.

## Implementation rules derived from the reference

1. Default camera is the overhead isometric three-quarter view.
2. The 3D office is the primary visual identity and largest screen region.
3. The building is open from above, with no static ceiling or screenshot backdrop.
4. Floors, walls, desks, chairs, monitors, plants, shelves, signs, and robots are separate interactive 3D objects.
5. Department offices are distinct glass-partitioned environments and can be selected/entered.
6. Robots share the white/cyan/navy family with subtle orange metallic and purple mechanical identity accents.
7. Camera transitions, zoom, pan, rotation, and touch controls are required.
8. Robot states must be derived from real agent lifecycle/task records, not invented progress.
9. A WebGL failure must expose an operational 2D/workbench fallback.
10. The reference image may be used for comparison only; it must never be rendered as the scene background.
