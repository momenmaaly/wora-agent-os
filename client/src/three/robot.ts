import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, type BufferGeometry, type Material, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentParticipant } from '../types.js';
import type { OfficePalette } from './materials.js';
import type { RobotVisualState } from './layout.js';

export const ROBOT_SCALE = 1.38;

export interface RobotParts {
  head: Group;
  leftArm: Group;
  rightArm: Group;
  leftLeg: Group;
  rightLeg: Group;
  leftEye: Mesh;
  rightEye: Mesh;
  mouth: Mesh;
  chest: Mesh;
  tablet: Group;
  eyeMaterial: MeshStandardMaterial;
  mouthMaterial: MeshBasicMaterial;
  phase: number;
  baseY: number;
  baseScale: number;
  leftBase: number;
  rightBase: number;
}

export interface RobotRecord {
  group: Group;
  parts: RobotParts;
  agentId: string;
  roomId: string;
  state: RobotVisualState;
  dispose: () => void;
}

interface GeometryCache {
  head: RoundedBoxGeometry;
  visor: RoundedBoxGeometry;
  torso: RoundedBoxGeometry;
  chest: RoundedBoxGeometry;
  foot: RoundedBoxGeometry;
  tablet: RoundedBoxGeometry;
  tabletEdge: RoundedBoxGeometry;
  eye: SphereGeometry;
  joint: SphereGeometry;
  hand: SphereGeometry;
  arm: CylinderGeometry;
  forearm: CylinderGeometry;
  leg: CylinderGeometry;
  neck: CylinderGeometry;
  antenna: CylinderGeometry;
  ear: CylinderGeometry;
  earRing: TorusGeometry;
  mouth: BoxGeometry;
  antennaTip: SphereGeometry;
}

const STATE_COLORS: Record<RobotVisualState, { eye: number; glow: number; opacity: number }> = {
  working:       { eye: 0x68e7ff, glow: 0x0b8fb0, opacity: 1 },
  thinking:      { eye: 0xa9c8ff, glow: 0x315bb0, opacity: 1 },
  communicating: { eye: 0x7eeaff, glow: 0x0c93b5, opacity: 1 },
  idle:          { eye: 0x55d6f0, glow: 0x08718e, opacity: 0.92 },
  reviewing:     { eye: 0xf0d18b, glow: 0x8a621c, opacity: 1 },
  blocked:       { eye: 0xff8d86, glow: 0x9d2f2f, opacity: 1 },
  completed:     { eye: 0x84e2ae, glow: 0x1c7d52, opacity: 1 },
  waiting:       { eye: 0x9fb7c4, glow: 0x304b58, opacity: 0.65 },
  offline:       { eye: 0x394852, glow: 0x121b22, opacity: 0.35 },
  walking:       { eye: 0x76e6ff, glow: 0x0a86a6, opacity: 1 },
  meeting:       { eye: 0xc5b4ff, glow: 0x6348a5, opacity: 1 },
};

function hashPhase(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return (hash / 997) * Math.PI * 2;
}

function makeGeometries(): GeometryCache {
  return {
    head: new RoundedBoxGeometry(0.66, 0.58, 0.54, 6, 0.16),
    visor: new RoundedBoxGeometry(0.52, 0.32, 0.07, 5, 0.1),
    torso: new RoundedBoxGeometry(0.52, 0.62, 0.36, 5, 0.11),
    chest: new RoundedBoxGeometry(0.26, 0.17, 0.035, 3, 0.045),
    foot: new RoundedBoxGeometry(0.2, 0.1, 0.29, 3, 0.045),
    tablet: new RoundedBoxGeometry(0.3, 0.42, 0.035, 3, 0.035),
    tabletEdge: new RoundedBoxGeometry(0.34, 0.46, 0.018, 3, 0.04),
    eye: new SphereGeometry(0.062, 22, 16),
    joint: new SphereGeometry(0.088, 18, 14),
    hand: new SphereGeometry(0.078, 18, 14),
    arm: new CylinderGeometry(0.067, 0.074, 0.32, 18),
    forearm: new CylinderGeometry(0.06, 0.067, 0.3, 18),
    leg: new CylinderGeometry(0.072, 0.08, 0.28, 18),
    neck: new CylinderGeometry(0.075, 0.085, 0.16, 18),
    antenna: new CylinderGeometry(0.018, 0.022, 0.22, 14),
    ear: new CylinderGeometry(0.085, 0.085, 0.055, 24),
    earRing: new TorusGeometry(0.071, 0.018, 10, 28),
    mouth: new BoxGeometry(0.16, 0.028, 0.022),
    antennaTip: new SphereGeometry(0.052, 18, 14),
  };
}

function shadow(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function put(
  parent: Object3D,
  geometry: BufferGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = shadow(new Mesh(geometry, material));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function makeArm(parent: Object3D, side: -1 | 1, geo: GeometryCache, palette: OfficePalette): Group {
  const arm = new Group();
  arm.position.set(side * 0.34, 0.71, 0);
  arm.rotation.z = side * 0.12;
  put(arm, geo.joint, palette.purple, 0, 0, 0);
  put(arm, geo.arm, palette.shell, 0, -0.2, 0);
  put(arm, geo.joint, palette.purple, 0, -0.38, 0);
  put(arm, geo.forearm, palette.shell, 0, -0.53, 0);
  put(arm, geo.hand, palette.dark, 0, -0.7, 0);
  parent.add(arm);
  return arm;
}

function makeLeg(parent: Object3D, side: -1 | 1, geo: GeometryCache, palette: OfficePalette): Group {
  const leg = new Group();
  leg.position.set(side * 0.16, 0.36, 0);
  put(leg, geo.joint, palette.purple, 0, 0, 0);
  put(leg, geo.leg, palette.shell, 0, -0.16, 0);
  put(leg, geo.joint, palette.purple, 0, -0.3, 0);
  put(leg, geo.foot, palette.dark, 0, -0.34, 0.06);
  parent.add(leg);
  return leg;
}

export function createRobotFactory(palette: OfficePalette) {
  const geo = makeGeometries();
  const geometries: BufferGeometry[] = Object.values(geo);

  function create(agent: AgentParticipant, state: RobotVisualState, x: number, z: number, facing: number): RobotRecord {
    const group = new Group();
    group.name = `robot-${agent.id}`;
    group.position.set(x, 0.25, z);
    group.rotation.y = facing;
    group.scale.setScalar(ROBOT_SCALE);
    group.userData.agentId = agent.id;
    group.userData.roomId = agent.zoneId;
    group.userData.state = state;

    const eyeMaterial = palette.cyan.clone();
    eyeMaterial.transparent = true;
    eyeMaterial.opacity = 1;
    const mouthMaterial = palette.cyanGlow.clone();
    mouthMaterial.transparent = true;

    const head = new Group();
    head.position.set(0, 1.29, 0);
    put(head, geo.head, palette.shell, 0, 0, 0);
    put(head, geo.visor, palette.dark, 0, 0.015, 0.285);
    const leftEye = put(head, geo.eye, eyeMaterial, -0.125, 0.035, 0.327);
    const rightEye = put(head, geo.eye, eyeMaterial, 0.125, 0.035, 0.327);
    const mouth = put(head, geo.mouth, mouthMaterial, 0, -0.085, 0.328);
    mouth.visible = false;
    put(head, geo.antenna, palette.metal, 0, 0.37, 0);
    put(head, geo.antennaTip, palette.orange, 0, 0.49, 0);
    const leftEar = put(head, geo.ear, palette.purple, -0.34, 0, 0);
    leftEar.rotation.z = Math.PI / 2;
    const rightEar = put(head, geo.ear, palette.purple, 0.34, 0, 0);
    rightEar.rotation.z = Math.PI / 2;
    const orangeRing = put(head, geo.earRing, palette.orange, 0.375, 0, 0);
    orangeRing.rotation.y = Math.PI / 2;
    group.add(head);

    put(group, geo.neck, palette.cyan, 0, 0.94, 0);
    put(group, geo.torso, palette.shell, 0, 0.62, 0);
    const chest = put(group, geo.chest, palette.cyan, 0, 0.65, 0.195);
    put(group, geo.joint, palette.purple, -0.26, 0.45, 0);
    put(group, geo.joint, palette.purple, 0.26, 0.45, 0);
    const leftArm = makeArm(group, -1, geo, palette);
    const rightArm = makeArm(group, 1, geo, palette);
    const leftLeg = makeLeg(group, -1, geo, palette);
    const rightLeg = makeLeg(group, 1, geo, palette);

    const tablet = new Group();
    tablet.position.set(0.48, 0.48, 0.2);
    tablet.rotation.set(-0.2, -0.35, 0.12);
    put(tablet, geo.tabletEdge, palette.cyanGlow, 0, 0, 0);
    put(tablet, geo.tablet, palette.dark, 0, 0, 0.018);
    tablet.visible = false;
    group.add(tablet);

    const record: RobotRecord = {
      group,
      agentId: agent.id,
      roomId: agent.zoneId ?? 'zone-planning',
      state,
      parts: {
        head, leftArm, rightArm, leftLeg, rightLeg, leftEye, rightEye, mouth, chest, tablet,
        eyeMaterial, mouthMaterial,
        phase: hashPhase(agent.id),
        baseY: group.position.y,
        baseScale: ROBOT_SCALE,
        leftBase: leftArm.rotation.z,
        rightBase: rightArm.rotation.z,
      },
      dispose: () => {
        eyeMaterial.dispose();
        mouthMaterial.dispose();
        group.removeFromParent();
      },
    };
    applyState(record, state);
    return record;
  }

  function applyState(record: RobotRecord, state: RobotVisualState): void {
    const colors = STATE_COLORS[state];
    record.parts.eyeMaterial.color.setHex(colors.eye);
    record.parts.eyeMaterial.emissive.setHex(colors.glow);
    record.parts.eyeMaterial.opacity = colors.opacity;
    record.parts.mouthMaterial.opacity = state === 'communicating' ? 0.9 : 0;
    record.parts.mouth.visible = state === 'communicating';
    record.parts.tablet.visible = state === 'reviewing' || state === 'communicating' || state === 'thinking' || state === 'meeting';
    record.group.scale.setScalar(record.parts.baseScale * (state === 'meeting' ? 0.94 : 1));
    record.group.userData.state = state;
    record.state = state;
  }

  function update(record: RobotRecord, state: RobotVisualState, elapsed: number, reducedMotion: boolean): void {
    if (record.state !== state) applyState(record, state);
    const { head, leftArm, rightArm, leftLeg, rightLeg, leftEye, rightEye, chest, tablet, phase, baseY, leftBase, rightBase } = record.parts;
    if (reducedMotion || state === 'offline' || state === 'blocked') {
      head.rotation.set(0, 0, 0);
      leftArm.rotation.z = leftBase;
      rightArm.rotation.z = rightBase;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      leftEye.scale.y = 1;
      rightEye.scale.y = 1;
      chest.scale.setScalar(1);
      record.group.position.y = baseY;
      return;
    }
    const t = elapsed + phase;
    let amplitude = 0.025;
    let speed = 1.35;
    let headTilt = 0;
    let wave = 0;
    let legSwing = 0;
    if (state === 'working') { amplitude = 0.13; speed = 5.2; headTilt = 0.05; }
    else if (state === 'thinking') { amplitude = 0.035; speed = 1.1; headTilt = -0.13; }
    else if (state === 'communicating') { amplitude = 0.05; speed = 3.1; wave = 0.55; }
    else if (state === 'reviewing') { amplitude = 0.045; speed = 1.5; headTilt = 0.1; }
    else if (state === 'completed') { amplitude = 0.055; speed = 1.8; }
    else if (state === 'waiting') { amplitude = 0.012; speed = 0.75; }
    else if (state === 'walking') { amplitude = 0.26; speed = 5.6; legSwing = 0.42; headTilt = 0.03; }
    else if (state === 'meeting') { amplitude = 0.018; speed = 0.9; headTilt = -0.04; }

    const motion = Math.sin(t * speed);
    leftArm.rotation.z = leftBase + motion * amplitude;
    rightArm.rotation.z = rightBase - motion * amplitude + wave * Math.max(0, Math.sin(t * 4.4));
    leftLeg.rotation.x = legSwing ? motion * legSwing : 0;
    rightLeg.rotation.x = legSwing ? -motion * legSwing : 0;
    head.rotation.z = headTilt + motion * 0.018;
    head.rotation.x = Math.sin(t * speed * 0.55) * 0.02;
    record.group.position.y = baseY + Math.sin(t * (state === 'walking' ? 5.6 : 1.6)) * (state === 'walking' ? 0.035 : 0.012);
    const blink = Math.sin(t * 0.9) > 0.985 ? 0.16 : 1;
    leftEye.scale.y = blink;
    rightEye.scale.y = blink;
    chest.scale.y = 1 + Math.sin(t * speed) * (state === 'working' || state === 'communicating' || state === 'walking' ? 0.045 : 0.012);
    tablet.rotation.z = 0.12 + Math.sin(t * 1.2) * 0.025;
  }

  return {
    create,
    update,
    dispose: () => { for (const geometry of geometries) geometry.dispose(); },
  };
}

export type RobotFactory = ReturnType<typeof createRobotFactory>;
