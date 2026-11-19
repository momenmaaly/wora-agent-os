import { equal, match, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import {
  ARCHITECTURAL_OFFSET, ROOM_ARCHITECTURE_LABELS, computeArchitecturalFrame, makeArchitecturalCamera,
  projectToViewport, rectanglesOverlap, roomArchitectureLabel, roomLabelAnchor, roomLabelSpan,
} from '../src/three/architecture.ts';
import { OFFICE_WORLD, ROOM_3D_LAYOUTS } from '../src/three/layout.ts';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');

function cssBlock(css, selector) {
  const start = css.indexOf(selector);
  ok(start >= 0, `${selector} exists`);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const channels = [0, 2, 4].map((index) => {
    const channel = parseInt(full.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function desktopLabelRects(width, height, camera) {
  return ROOM_3D_LAYOUTS.map((room) => {
    const anchor = projectToViewport(roomLabelAnchor(room), camera, width, height);
    const span = roomLabelSpan(room);
    const left = projectToViewport(span.left, camera, width, height);
    const right = projectToViewport(span.right, camera, width, height);
    const projectedWidth = Math.max(1, Math.abs(right.x - left.x));
    const labelWidth = Math.max(150, Math.min(160, projectedWidth * 0.92));
    return {
      id: room.id,
      left: anchor.x - labelWidth / 2,
      right: anchor.x + labelWidth / 2,
      top: anchor.y - 38,
      bottom: anchor.y,
    };
  });
}

test('the fixed architectural camera replaces orbit, pan, zoom, dragging and the old floating slab', () => {
  const scene = read('three/officeScene.ts');
  const ui = read('components/Office3D.tsx');
  const campus = read('components/Campus.tsx');
  const workbench = read('styles/workbench.css');

  for (const forbidden of [
    'OrbitControls', 'enablePan', 'enableRotate', 'enableZoom', 'listenToKeyEvents',
    'DEFAULT_OFFSET', 'controls.update()', 'billboards', 'outdoorGround', 'createSlab',
    'slabThickness', 'floorEdge', 'dashedCorridorPath', 'perimeter',
  ]) ok(!scene.includes(forbidden), `no ${forbidden}`);

  match(scene, /ARCHITECTURAL_OFFSET/);
  match(scene, /camera\.position\.copy\(target\)\.add\(ARCHITECTURAL_OFFSET\)/);
  match(scene, /cameraFrame\.roomZoom/);
  match(scene, /duration:\s*760/);
  match(scene, /function createGround\(\): void \{[\s\S]*cache\.plane\(80, 60\)/);
  match(scene, /function glassWall\([\s\S]*palette\.glass/);
  match(scene, /function createCorridors\(\): void/);

  for (const forbidden of ['Drag to rotate', 'Scroll or pinch to zoom', 'RotateCcw']) {
    ok(!ui.includes(forbidden), `UI does not advertise ${forbidden}`);
  }
  match(ui, /Fixed architectural view/);
  match(ui, /aria-label="Return to full office view"/);
  match(ui, /callbacks\.current\.onRoom\(null\)/);
  match(ui, /useWoraStore\.getState\(\)\.selectAgent\(null\)/);
  match(campus, /const chooseRoom = useCallback\(\(id: string \| null\)/);
  match(campus, /onVisit\(null\)/);
  match(workbench, /\.campus-stage:has\(\.office3d-shell\) \{ border: 0; border-radius: 0; background: #dfe6e7; \}/);
});

test('real DOM nameplates replace baked text and remain high-contrast and sharp', () => {
  const scene = read('three/officeScene.ts');
  const materials = read('three/materials.ts');
  const css = read('styles/company-frame.css');

  match(scene, /labelLayer\.className = 'office3d-labels'/);
  match(scene, /document\.createElement\('button'\)/);
  match(scene, /title\.textContent = display\.en/);
  match(scene, /subtitle\.textContent = display\.ar/);
  match(scene, /container\.appendChild\(labelLayer\)/);
  match(scene, /focusRoom\(room\.id\);\s*onRoom\(room\.id\);/);
  match(scene, /const overlapsRoomLabel = visibleRects\.some/);
  match(scene, /rectanglesOverlap\(lobbyRect, rect, 4\)/);

  for (const forbidden of ['makeSignTexture', 'makeLogoTexture', 'signMaterial', 'logoMaterial', 'fillText', 'ctx.font']) {
    ok(!materials.includes(forbidden), `no baked text path ${forbidden}`);
  }
  ok(!scene.includes('palette.signMaterial') && !scene.includes('palette.logoMaterial'));
  match(materials, /texture\.anisotropy = 8/);
  match(materials, /ctx\.scale\(2, 2\)/);

  const label = cssBlock(css, '.office3d-room-label {');
  const strong = cssBlock(css, '.office3d-room-label strong {');
  const small = cssBlock(css, '.office3d-room-label small {');
  const layer = cssBlock(css, '.office3d-labels {');
  match(label, /background: #173440/);
  match(label, /color: #fff/);
  match(label, /pointer-events: auto/);
  match(strong, /font-size: 12px/);
  match(strong, /font-weight: 760/);
  match(small, /font-size: 9px/);
  match(layer, /-webkit-font-smoothing: antialiased/);
  match(css, /\.office3d-room-label\[hidden\], \.office3d-lobby-label\[hidden\] \{ display: none !important; \}/);
  ok(contrastRatio('#ffffff', '#173440') > 7, 'primary label contrast exceeds WCAG AAA');
  ok(contrastRatio('#d1eef2', '#173440') > 7, 'secondary label contrast exceeds WCAG AAA');

  equal(Object.keys(ROOM_ARCHITECTURE_LABELS).length, ROOM_3D_LAYOUTS.length);
  const labels = ROOM_3D_LAYOUTS.map((room) => roomArchitectureLabel(room));
  for (const name of ['Executive Office', 'Marketing', 'Engineering', 'Creative Studio', 'Meeting Room', 'Operations']) {
    ok(labels.some((label) => label.en === name), `${name} is present`);
  }
  ok(labels.some((label) => label.en.includes('Research')), 'Research is present');
  for (const label of labels) {
    ok(label.en.length >= 8 && label.ar.length > 0, 'every room has readable English and Arabic text');
  }
});

test('high-quality rendering, larger detailed robots and connected architectural furniture are retained', () => {
  const scene = read('three/officeScene.ts');
  const robot = read('three/robot.ts');

  match(scene, /antialias: quality === 'high'/);
  match(scene, /setPixelRatio\(Math\.min\(window\.devicePixelRatio \|\| 1, quality === 'high' \? 2 : 1\.25\)\)/);
  match(scene, /PCFSoftShadowMap/);
  match(scene, /factory\.create\(agent, state, spot\.point\.x, spot\.point\.z, facing\)/);
  match(scene, /non-pickable-glass-partitions/);
  match(scene, /if \(isIgnoredForPicking\(hit\.object\)\) continue;/);
  for (const feature of ['function desk(', 'function chair(', 'function executiveDesk(', 'function lounge(', 'palette.screenMaterial', 'palette.glass']) {
    ok(scene.includes(feature), `${feature} is present`);
  }
  match(robot, /export const ROBOT_SCALE = 1\.38;/);
  match(robot, /group\.scale\.setScalar\(ROBOT_SCALE\)/);
  match(robot, /baseScale: ROBOT_SCALE/);
  match(robot, /new SphereGeometry\(0\.062, 22, 16\)/);
});

test('the fixed frame tightly fits desktop viewports and room nameplates do not overlap', () => {
  const viewports = [[1440, 900], [1280, 720], [1024, 768]];
  for (const [width, height] of viewports) {
    const frame = computeArchitecturalFrame(width / height);
    const camera = makeArchitecturalCamera(frame);
    const actualOffset = frame.position.clone().sub(frame.target);
    ok(actualOffset.distanceTo(ARCHITECTURAL_OFFSET) < 1e-8, `${width}x${height}: fixed angle`);
    ok(frame.zoom > 0.6, `${width}x${height}: readable default zoom`);
    ok(frame.roomZoom > frame.zoom * 1.8, `${width}x${height}: detailed room transition`);
    ok(frame.agentZoom > frame.roomZoom, `${width}x${height}: detailed employee transition`);

    const floorCorners = [];
    for (const x of [-OFFICE_WORLD.slabWidth / 2, OFFICE_WORLD.slabWidth / 2]) {
      for (const z of [-OFFICE_WORLD.slabDepth / 2, OFFICE_WORLD.slabDepth / 2]) {
        floorCorners.push(projectToViewport(new Vector3(x, 0, z), camera, width, height));
      }
    }
    const xs = floorCorners.map((point) => point.x);
    const ys = floorCorners.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    ok(minX >= 0 && maxX <= width && minY >= 0 && maxY <= height, `${width}x${height}: office fits viewport`);
    ok((maxX - minX) / width >= 0.65, `${width}x${height}: office fills horizontal workspace`);
    ok((maxY - minY) / height >= 0.75, `${width}x${height}: office fills vertical workspace`);

    const rects = desktopLabelRects(width, height, camera);
    for (const rect of rects) {
      ok(rect.left >= 0 && rect.right <= width && rect.top >= 20 && rect.bottom <= height,
        `${width}x${height}: ${rect.id} nameplate is inside safe viewport bounds`);
    }
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        ok(!rectanglesOverlap(rects[i], rects[j], 2),
          `${width}x${height}: ${rects[i].id} and ${rects[j].id} nameplates do not overlap`);
      }
    }
  }

  const collisionFrame = computeArchitecturalFrame(1280 / 720);
  const collisionCamera = makeArchitecturalCamera(collisionFrame);
  const lobby = projectToViewport(new Vector3(-1.7, 1.15, -1.35), collisionCamera, 1280, 720);
  const lobbyRect = { left: lobby.x - 60, right: lobby.x + 60, top: lobby.y - 11, bottom: lobby.y + 11 };
  ok(desktopLabelRects(1280, 720, collisionCamera).some((rect) => rectanglesOverlap(lobbyRect, rect, 4)),
    'the runtime lobby-label collision guard is exercised at a real desktop size');
});
