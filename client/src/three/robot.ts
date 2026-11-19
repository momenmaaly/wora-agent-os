import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, type BufferGeometry, type Material, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AgentParticipant } from '../types.js';
import type { OfficePalette } from './materials.js';
import type { RobotVisualState } from './layout.js';

export const ROBOT_SCALE = 0.72;

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
    head: new RoundedBoxGeometry(0.72, 0.62, 0.58, 8, 0.2),
    visor: new RoundedBoxGeometry(0.58, 0.36, 0.08, 7, 0.12),
    torso: new RoundedBoxGeometry(0.58, 0.66, 0.4, 6, 0.12),
    chest: new RoundedBoxGeometry(0.3, 0.2, 0.04, 4, 0.05),
    foot: new RoundedBoxGeometry(0.22, 0.11, 0.32, 4, 0.05),
    tablet: new RoundedBoxGeometry(0.34, 0.46, 0.04, 4, 0.04),
    tabletEdge: new RoundedBoxGeometry(0.38, 0.5, 0.02, 4, 0.045),
    eye: new SphereGeometry(0.075, 32, 24),
    joint: new SphereGeometry(0.1, 24, 18),
    hand: new SphereGeometry(0.088, 24, 18),
    arm: new CylinderGeometry(0.075, 0.082, 0.34, 22),
    forearm: new CylinderGeometry(0.068, 0.075, 0.32, 22),
    leg: new CylinderGeometry(0.08, 0.088, 0.3, 22),
    neck: new CylinderGeometry(0.085, 0.095, 0.18, 22),
    antenna: new CylinderGeometry(0.02, 0.024, 0.24, 16),
    ear: new CylinderGeometry(0.095, 0.095, 0.06, 28),
    earRing: new TorusGeometry(0.08, 0.02, 12, 32),
    mouth: new BoxGeometry(0.18, 0.03, 0.024),
    antennaTip: new SphereGeometry(0.058, 20, 16),
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
  put(arm, geo.joint, palette.robotJoint, 0, 0, 0);
  put(arm, geo.arm, palette.robotShell, 0, -0.2, 0);
  put(arm, geo.joint, palette.robotJoint, 0, -0.38, 0);
  put(arm, geo.forearm, palette.robotShell, 0, -0.53, 0);
  put(arm, geo.hand, palette.dark, 0, -0.7, 0);
  parent.add(arm);
  return arm;
}

function makeLeg(parent: Object3D, side: -1 | 1, geo: GeometryCache, palette: OfficePalette): Group {
  const leg = new Group();
  leg.position.set(side * 0.16, 0.36, 0);
  put(leg, geo.joint, palette.robotJoint, 0, 0, 0);
  put(leg, geo.leg, palette.robotShell, 0, -0.16, 0);
  put(leg, geo.joint, palette.robotJoint, 0, -0.3, 0);
  put(leg, geo.foot, palette.robotDark, 0, -0.34, 0.06);
  parent.add(leg);
  return leg;
}

export function createRobotFactory(palette: OfficePalette) {
  const geo = makeGeometries();
  const geometries: BufferGeometry[] = Object.values(geo);

  function create(
    agent: AgentParticipant, state: RobotVisualState, x: number, z: number, facing: number,
    scale = ROBOT_SCALE,
  ): RobotRecord {
    const group = new Group();
    group.name = `robot-${agent.id}`;
    group.position.set(x, 0.25, z);
    group.rotation.y = facing;
    group.scale.setScalar(scale);
    group.userData.agentId = agent.id;
    group.userData.roomId = agent.zoneId;
    group.userData.state = state;

    const eyeMaterial = palette.cyan.clone();
    eyeMaterial.transparent = true;
    eyeMaterial.opacity = 1;
    const mouthMaterial = palette.cyanGlow.clone();
    mouthMaterial.transparent = true;

    const head = new Group();
    head.position.set(0, 1.32, 0);
    put(head, geo.head, palette.shell, 0, 0, 0);
    put(head, geo.visor, palette.robotVisor, 0, 0.02, 0.31);
    const leftEye = put(head, geo.eye, eyeMaterial, -0.14, 0.045, 0.36);
    leftEye.scale.set(1, 1.25, 0.45);
    const rightEye = put(head, geo.eye, eyeMaterial, 0.14, 0.045, 0.36);
    rightEye.scale.set(1, 1.25, 0.45);
    const mouth = put(head, geo.mouth, mouthMaterial, 0, -0.09, 0.355);
    mouth.visible = false;
    put(head, geo.antenna, palette.robotJoint, 0.3, 0.42, 0).rotation.z = -0.25;
    put(head, geo.antennaTip, palette.orange, 0.36, 0.53, 0);
    const leftEar = put(head, geo.ear, palette.robotJoint, -0.34, 0, 0);
    leftEar.rotation.z = Math.PI / 2;
    const rightEar = put(head, geo.ear, palette.robotJoint, 0.34, 0, 0);
    rightEar.rotation.z = Math.PI / 2;
    const leftRing = put(head, geo.earRing, palette.robotCyan, -0.375, 0, 0);
    leftRing.rotation.y = Math.PI / 2;
    const rightRing = put(head, geo.earRing, palette.robotBlue, 0.375, 0, 0);
    rightRing.rotation.y = Math.PI / 2;
    put(head, geo.antennaTip, palette.orange, 0.39, 0.17, 0).scale.setScalar(0.38);
    group.add(head);

    put(group, geo.neck, palette.robotBlue, 0, 0.97, 0);
    const collar = put(group, geo.earRing, palette.robotBlue, 0, 1.02, 0);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(1.15);
    put(group, geo.torso, palette.robotShell, 0, 0.64, 0);
    const chest = put(group, geo.chest, palette.robotBlue, 0, 0.68, 0.215);
    put(group, geo.mouth, palette.robotCyan, 0, 0.68, 0.24).scale.set(0.9, 0.7, 0.5);
    put(group, geo.tablet, palette.robotDark, 0, 0.64, -0.22);
    put(group, geo.joint, palette.robotJoint, -0.26, 0.45, 0);
    put(group, geo.joint, palette.robotJoint, 0.26, 0.45, 0);
    const leftArm = makeArm(group, -1, geo, palette);
    const rightArm = makeArm(group, 1, geo, palette);
    const leftLeg = makeLeg(group, -1, geo, palette);
    const rightLeg = makeLeg(group, 1, geo, palette);

    const tablet = new Group();
    tablet.position.set(0.48, 0.48, 0.2);
    tablet.rotation.set(-0.2, -0.35, 0.12);
    put(tablet, geo.tabletEdge, palette.robotCyan, 0, 0, 0);
    put(tablet, geo.tablet, palette.dark, 0, 0, 0.018);
    tablet.visible = true;
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
        baseScale: scale,
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
    record.parts.tablet.visible = !['offline', 'blocked', 'waiting'].includes(state);
    record.group.scale.setScalar(record.parts.baseScale * (state === 'meeting' ? 0.94 : 1));
    record.group.userData.state = state;
    record.state = state;
  }

  function update(record: RobotRecord, state: RobotVisualState, elapsed: number, reducedMotion: boolean): void {
    if (record.state !== state) applyState(record, state);
    const { head, leftArm, rightArm, leftLeg, rightLeg, leftEye, rightEye, chest, tablet, phase, baseY, leftBase, rightBase } = record.parts;
    if (reducedMotion || ['offline', 'blocked', 'waiting', 'idle', 'completed'].includes(state)) {
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
