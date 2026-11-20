import { equal, match, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import {
  REFERENCE_CAMERA_OFFSET, REFERENCE_CAMERA_POSITION, REFERENCE_CAMERA_TARGET, REFERENCE_ROOMS,
  REFERENCE_ROBOT_POINTS, REFERENCE_VIEWPORT, buildReferenceRooms, makeReferenceCamera,
  screenToLabel, visualRoomForLogical,
} from '../src/three/referenceLayout.ts';
import { projectToViewport, rectanglesOverlap } from '../src/three/architecture.ts';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

function labelRects(width, height, camera) {
  return buildReferenceRooms(camera, width, height).map((room) => {
    const anchor = projectToViewport(room.labelPoint, camera, width, height);
    return {
      id: room.definition.id,
      left: anchor.x - room.definition.labelWidth / 2,
      right: anchor.x + room.definition.labelWidth / 2,
      top: anchor.y - 46,
      bottom: anchor.y + 4,
    };
  });
}

test('the exact seven-room reference composition replaces the ten-label diamond office', () => {
  const rooms = REFERENCE_ROOMS;
  equal(rooms.length, 7);
  equal(new Set(rooms.map((room) => room.id)).size, 7);
  equal(new Set(rooms.map((room) => room.label)).size, 7);
  for (const name of ['Marketing', 'Executive Office', 'Engineering', 'Creative Studio', 'Management', 'Research', 'QA & Testing']) {
    ok(rooms.some((room) => room.label === name), `${name} is present`);
  }
  equal(visualRoomForLogical('zone-product'), 'management');
  equal(visualRoomForLogical('zone-analytics'), 'research');
  equal(visualRoomForLogical('zone-review'), 'qa');
  ok(Object.values(REFERENCE_ROBOT_POINTS).reduce((sum, points) => sum + points.length, 0) >= 30);

  const scene = read('three/officeScene.ts');
  const ui = read('components/Office3D.tsx');
  const campus = read('components/Campus.tsx');
  for (const forbidden of [
    'OrbitControls', 'enablePan', 'enableRotate', 'enableZoom', 'listenToKeyEvents',
    'DEFAULT_OFFSET', 'controls.update()', 'outdoorGround', 'createSlab', 'slabThickness',
    'dashedCorridorPath', 'Product Lab', 'Analytics',
  ]) ok(!scene.includes(forbidden), `no ${forbidden}`);
  match(scene, /REFERENCE_CAMERA_TARGET/);
  match(scene, /applyReferenceCamera\(camera, cameraTarget, cameraScale\)/);
  match(scene, /duration: 760/);
  match(scene, /function createGround\(\)/);
  match(scene, /function glassEdge\(/);
  match(scene, /function createCorridors\(\)/);
  match(scene, /const referenceRooms = buildReferenceRooms/);
  for (const forbidden of ['Drag to rotate', 'Scroll or pinch to zoom', 'RotateCcw']) {
    ok(!ui.includes(forbidden), `UI does not advertise ${forbidden}`);
  }
  match(ui, /Fixed architectural view/);
  match(ui, /aria-label="Return to full office view"/);
  match(ui, /callbacks\.current\.onRoom\(null\)/);
  match(ui, /useWoraStore\.getState\(\)\.selectAgent\(null\)/);
  match(ui, /<ReferenceChrome/);
  match(ui, /office3d-live-summary/);
  match(ui, /Recorded workspace totals/);
  match(campus, /const chooseRoom = useCallback\(\(id: string \| null\)/);
  match(campus, /onVisit\(null\)/);
});

test('real extruded 3D plaques, WORA medallion text and high-resolution materials replace DOM tags', () => {
  const scene = read('three/officeScene.ts');
  const materials = read('three/materials.ts');
  const css = read('styles/company-frame.css');

  match(scene, /plaqueLayer\.name = 'real-3d-room-plaques'/);
  match(scene, /new TextGeometry\(text, \{/);
  match(scene, /new Font\(helvetikerBold\)/);
  match(scene, /helvetiker_bold\.typeface\.json/);
  match(scene, /function createPlaques\(\)/);
  match(scene, /function createMedallionText\(\)/);
  match(scene, /makeTextGeometry\(definition\.label, textSize\)/);
  match(scene, /makeTextGeometry\('WORA', unit\(42\)\)/);
  match(scene, /availableWidth = plaqueWidth - iconWidth/);
  match(scene, /plaqueMaterials\.set\(definition\.id, plaqueMaterial\)/);
  match(scene, /scene\.add\(environmentLayer, roomLayer, robotLayer, plaqueLayer\)/);
  ok(!scene.includes("document.createElement('button')"), 'no DOM room-label buttons');
  ok(!scene.includes('office3d-room-label'), 'no DOM room-label class in scene');
  ok(!scene.includes('labelLayer'), 'no DOM label layer in scene');
  for (const forbidden of ['makeSignTexture', 'makeLogoTexture', 'signMaterial', 'logoMaterial', 'fillText', 'ctx.font']) {
    ok(!materials.includes(forbidden), `no baked text path ${forbidden}`);
  }
  match(materials, /texture\.anisotropy = 16/);
  match(materials, /new MeshPhysicalMaterial\(\{\s*map: marbleTexture/s);
  match(css, /\.reference-sidebar \{/);
  match(css, /@media \(max-width: 1500px\)/);
});

test('high-quality rendering, reference robots and connected architectural furniture are retained', () => {
  const scene = read('three/officeScene.ts');
  const robot = read('three/robot.ts');

  match(scene, /antialias: quality === 'high'/);
  match(scene, /setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, quality === 'high' \? 2 : 1\.25\)\)/);
  match(scene, /PCFSoftShadowMap/);
  match(scene, /factory\.create\(/);
  match(scene, /non-pickable-glass-partitions/);
  match(scene, /if \(isIgnoredForPicking\(hit\.object\)\) continue;/);
  for (const feature of [
    'function desk(', 'function chair(', 'function executiveDesk(', 'function conferenceTable(',
    'function screenBoard(', 'function shelf(', 'function serverRack(', 'palette.screenMaterial', 'palette.glass',
  ]) ok(scene.includes(feature), `${feature} is present`);
  match(scene, /const robotScale = unit\(112\) \/ 1\.78;/);
  match(scene, /const deskScale = unit\(108\) \/ 1\.42;/);
  match(scene, /const wallHeight = unit\(132\);/);
  match(scene, /RoomEnvironment/);
  match(scene, /scene\.fog = new Fog/);
  match(scene, /curtainGlass/);
  match(robot, /export const ROBOT_SCALE = 0\.72;/);
  match(robot, /group\.scale\.setScalar\(scale\)/);
  match(robot, /baseScale: scale/);
  match(robot, /new SphereGeometry\(0\.075, 32, 24\)/);
  match(robot, /new RoundedBoxGeometry\(0\.72, 0\.62, 0\.58, 8, 0\.2\)/);
  match(robot, /\['offline', 'blocked', 'waiting', 'idle', 'completed'\]\.includes\(state\)/);
});

test('the fixed reference camera projects the seven plaques and workspace without overlap', () => {
  const viewports = [
    [REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height],
    [1440, 900], [1280, 720],
  ];
  for (const [width, height] of viewports) {
    const camera = makeReferenceCamera(width / height);
    const actualOffset = camera.position.clone().sub(REFERENCE_CAMERA_TARGET);
    ok(actualOffset.distanceTo(REFERENCE_CAMERA_OFFSET) < 1e-8, `${width}x${height}: fixed angle`);
    ok(camera.position.distanceTo(REFERENCE_CAMERA_POSITION) < 1e-8, `${width}x${height}: fixed position`);

    const rooms = buildReferenceRooms(camera, width, height);
    equal(rooms.length, 7);
    for (const room of rooms) {
      ok(room.width > 1 && room.depth > 1, `${width}x${height}: ${room.definition.id} has real floor area`);
      const label = projectToViewport(room.labelPoint, camera, width, height);
      ok(label.x > -20 && label.x < width + 20 && label.y > -20 && label.y < height + 20,
        `${width}x${height}: ${room.definition.id} plaque is in the viewport`);
    }
    const rects = labelRects(width, height, camera);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        ok(!rectanglesOverlap(rects[i], rects[j], 2),
          `${width}x${height}: ${rects[i].id} and ${rects[j].id} plaques do not overlap`);
      }
    }
  }

  const camera = makeReferenceCamera(REFERENCE_VIEWPORT.width / REFERENCE_VIEWPORT.height);
  for (const definition of REFERENCE_ROOMS) {
    const labelPoint = screenToLabel(
      definition.screenLabel, camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height,
    );
    const projected = projectToViewport(labelPoint, camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height);
    ok(Math.abs(projected.x - definition.screenLabel[0]) < 0.01, `${definition.id}: exact label x`);
    ok(Math.abs(projected.y - definition.screenLabel[1]) < 0.01, `${definition.id}: exact label y`);
  }
  const floorCorners = [
    screenToLabel([300, 0], camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height),
    screenToLabel([1400, 0], camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height),
    screenToLabel([1600, 900], camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height),
    screenToLabel([300, 900], camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height),
  ];
  const xs = floorCorners.map((point) => projectToViewport(point, camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height).x);
  const ys = floorCorners.map((point) => projectToViewport(point, camera, REFERENCE_VIEWPORT.width, REFERENCE_VIEWPORT.height).y);
  ok(Math.max(...xs) - Math.min(...xs) > REFERENCE_VIEWPORT.width * 0.7, 'grounded office fills the horizontal viewport');
  ok(Math.max(...ys) - Math.min(...ys) > REFERENCE_VIEWPORT.height * 0.7, 'grounded office fills the vertical viewport');
});
