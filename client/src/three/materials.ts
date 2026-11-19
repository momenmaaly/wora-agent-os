import {
  CanvasTexture, Color, DoubleSide, LinearFilter, LinearMipmapLinearFilter, Material,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping,
  SRGBColorSpace, Texture,
} from 'three';

export type ScreenVariant = 'code' | 'analytics' | 'creative' | 'qa' | 'world' | 'plan' | 'ops';

export interface OfficePalette {
  marble: MeshPhysicalMaterial;
  marbleDark: MeshPhysicalMaterial;
  floorWood: MeshStandardMaterial;
  floorEdge: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  woodDark: MeshStandardMaterial;
  woodSlat: MeshStandardMaterial;
  shell: MeshStandardMaterial;
  white: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  metalDark: MeshStandardMaterial;
  frame: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  warmLed: MeshBasicMaterial;
  cyan: MeshStandardMaterial;
  cyanGlow: MeshBasicMaterial;
  orange: MeshStandardMaterial;
  purple: MeshStandardMaterial;
  green: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  leafDark: MeshStandardMaterial;
  soil: MeshStandardMaterial;
  sofa: MeshStandardMaterial;
  sofaBrown: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  screenFrame: MeshStandardMaterial;
  robotShell: MeshStandardMaterial;
  robotVisor: MeshStandardMaterial;
  robotCyan: MeshStandardMaterial;
  robotBlue: MeshStandardMaterial;
  robotJoint: MeshStandardMaterial;
  robotDark: MeshStandardMaterial;
  rug: MeshStandardMaterial;
  woraCyan: MeshBasicMaterial;
  roomFloor: (accent: string) => MeshPhysicalMaterial;
  screenMaterial: (variant: ScreenVariant) => MeshStandardMaterial;
  dispose: () => void;
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable for procedural office materials.');
  return { canvas, ctx };
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function textureFrom(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 16;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** High-resolution warm gray/rose marble with irregular white and charcoal veins. */
function makeMarbleTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(2048, 2048);
  const random = seeded(41);
  ctx.fillStyle = '#c7bec0';
  ctx.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 220; i += 1) {
    const x = random() * 2048;
    const y = random() * 2048;
    const radius = 50 + random() * 240;
    const tint = random() > 0.55 ? '#e2d8da' : '#a79ba2';
    ctx.fillStyle = `${tint}${Math.floor(20 + random() * 30).toString(16).padStart(2, '0')}`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.4 + random() * 0.7), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < 140; i += 1) {
      const x = random() * 2400 - 200;
      const y = random() * 2048;
      const length = 120 + random() * 620;
      ctx.strokeStyle = pass % 2 === 0
        ? `rgba(246,240,238,${0.16 + random() * 0.28})`
        : `rgba(65,68,82,${0.08 + random() * 0.13})`;
      ctx.lineWidth = 0.7 + random() * (pass === 0 ? 3.4 : 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + length * 0.3, y + random() * 90 - 45, x + length * 0.65, y + random() * 140 - 70, x + length, y + random() * 100 - 50);
      ctx.stroke();
    }
  }
  return textureFrom(canvas, 2, 2);
}

function makeWoodTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 1024);
  const random = seeded(73);
  ctx.fillStyle = '#9c6b3f';
  ctx.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 170; i += 1) {
    const y = random() * 1024;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(250, y + random() * 18 - 9, 700, y + random() * 24 - 12, 1024, y + random() * 16 - 8);
    ctx.strokeStyle = `rgba(${80 + Math.floor(random() * 55)}, ${45 + Math.floor(random() * 35)}, 22, ${0.08 + random() * 0.18})`;
    ctx.lineWidth = 0.8 + random() * 3.2;
    ctx.stroke();
  }
  return textureFrom(canvas, 1, 1);
}

/** Abstract screen content only. No text, numeric KPIs, productivity, or simulated activity. */
function makeScreenTexture(variant: ScreenVariant): CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 600);
  const random = seeded(variant.length * 137 + 29);
  ctx.fillStyle = '#071627';
  ctx.fillRect(0, 0, 1024, 600);
  ctx.fillStyle = '#0b2842';
  roundedRect(ctx, 18, 18, 988, 564, 22);
  ctx.fill();
  ctx.strokeStyle = '#1c88b8';
  ctx.lineWidth = 3;
  ctx.stroke();
  if (variant === 'code') {
    for (let row = 0; row < 17; row += 1) {
      const indent = 48 + (row % 4) * 34;
      ctx.fillStyle = ['#55d8ef', '#8fb7ff', '#c2a6ff', '#7ee2b8'][row % 4]!;
      roundedRect(ctx, indent, 54 + row * 29, 120 + random() * 520, 8, 4);
      ctx.fill();
    }
  } else if (variant === 'world') {
    ctx.fillStyle = '#0a5da8';
    roundedRect(ctx, 52, 60, 920, 480, 28);
    ctx.fill();
    ctx.fillStyle = '#29c2e8';
    for (let i = 0; i < 24; i += 1) {
      const x = 90 + random() * 840;
      const y = 100 + random() * 390;
      const w = 36 + random() * 100;
      const h = 22 + random() * 58;
      roundedRect(ctx, x, y, w, h, 12);
      ctx.fill();
    }
  } else if (variant === 'creative') {
    const colors = ['#f0a6cf', '#8fb7ff', '#f0c987', '#7ee2b8', '#ffffff'];
    for (let i = 0; i < 10; i += 1) {
      ctx.fillStyle = colors[i % colors.length]!;
      roundedRect(ctx, 58 + (i % 4) * 230, 64 + Math.floor(i / 4) * 165, 190, 125, 22);
      ctx.fill();
    }
  } else if (variant === 'qa') {
    ctx.strokeStyle = '#23d5ee';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(510, 285, 135, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(430, 290);
    ctx.lineTo(490, 350);
    ctx.lineTo(610, 215);
    ctx.stroke();
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = 'rgba(80,220,245,.18)';
      roundedRect(ctx, 58, 72 + i * 76, 270, 34, 8);
      ctx.fill();
      roundedRect(ctx, 696, 72 + i * 76, 270, 34, 8);
      ctx.fill();
    }
  } else if (variant === 'analytics') {
    ctx.fillStyle = '#1b78c8';
    for (let i = 0; i < 12; i += 1) {
      const h = 90 + random() * 330;
      roundedRect(ctx, 72 + i * 72, 500 - h, 42, h, 8);
      ctx.fill();
    }
    ctx.strokeStyle = '#7ee2b8';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(72, 220);
    for (let x = 72; x < 950; x += 28) ctx.lineTo(x, 190 + Math.sin(x / 70) * 72);
    ctx.stroke();
  } else {
    for (let row = 0; row < 7; row += 1) {
      ctx.fillStyle = ['#8fb7ff', '#7ee2b8', '#f0c987', '#c2a6ff'][row % 4]!;
      roundedRect(ctx, 64, 66 + row * 70, 330, 22, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      roundedRect(ctx, 430, 66 + row * 70, 520, 22, 9);
      ctx.fill();
    }
  }
  return textureFrom(canvas);
}

export function createOfficePalette(): OfficePalette {
  const textures: Texture[] = [];
  const materials: Material[] = [];
  const roomFloorCache = new Map<string, MeshPhysicalMaterial>();
  const screenCache = new Map<ScreenVariant, MeshStandardMaterial>();
  const trackTexture = <T extends Texture>(texture: T): T => { textures.push(texture); return texture; };
  const trackMaterial = <T extends Material>(material: T): T => { materials.push(material); return material; };
  const marbleTexture = trackTexture(makeMarbleTexture());
  const woodTexture = trackTexture(makeWoodTexture());

  const marble = trackMaterial(new MeshPhysicalMaterial({
    map: marbleTexture, color: 0xffffff, roughness: 0.27, metalness: 0.02,
    clearcoat: 0.78, clearcoatRoughness: 0.18, envMapIntensity: 1.1,
  }));
  const marbleDark = trackMaterial(new MeshPhysicalMaterial({
    map: marbleTexture, color: '#8d858b', roughness: 0.34, metalness: 0.03, clearcoat: 0.6,
  }));
  const floorWood = trackMaterial(new MeshStandardMaterial({ map: woodTexture, color: '#9d7c5e', roughness: 0.5, metalness: 0.02 }));
  const floorEdge = trackMaterial(new MeshStandardMaterial({ color: '#273744', roughness: 0.35, metalness: 0.62 }));
  const wood = trackMaterial(new MeshStandardMaterial({ map: woodTexture, color: '#b99776', roughness: 0.42, metalness: 0.02 }));
  const woodDark = trackMaterial(new MeshStandardMaterial({ color: '#7d6048', roughness: 0.58 }));
  const woodSlat = trackMaterial(new MeshStandardMaterial({ color: '#80634a', roughness: 0.52, metalness: 0.03 }));
  const shell = trackMaterial(new MeshStandardMaterial({ color: '#eef4f4', roughness: 0.32, metalness: 0.08 }));
  const white = trackMaterial(new MeshStandardMaterial({ color: '#f7f9f8', roughness: 0.4, metalness: 0.05 }));
  const dark = trackMaterial(new MeshStandardMaterial({ color: '#101a27', roughness: 0.38, metalness: 0.3 }));
  const metal = trackMaterial(new MeshStandardMaterial({ color: '#9aa8ae', roughness: 0.28, metalness: 0.76 }));
  const metalDark = trackMaterial(new MeshStandardMaterial({ color: '#35485a', roughness: 0.32, metalness: 0.7 }));
  const frame = trackMaterial(new MeshStandardMaterial({ color: '#4c6679', roughness: 0.32, metalness: 0.72 }));
  const glass = trackMaterial(new MeshPhysicalMaterial({
    color: '#b8dce8', transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0.04,
    clearcoat: 1, clearcoatRoughness: 0.06, side: DoubleSide, depthWrite: false, envMapIntensity: 1.2,
  }));
  const warmLed = trackMaterial(new MeshBasicMaterial({ color: '#ffe4ae', toneMapped: false }));
  const cyan = trackMaterial(new MeshStandardMaterial({ color: '#2bd5ec', emissive: '#0b8cad', emissiveIntensity: 0.8, roughness: 0.3 }));
  const cyanGlow = trackMaterial(new MeshBasicMaterial({ color: '#7eeaff', transparent: true, opacity: 0.8, side: DoubleSide, toneMapped: false }));
  const orange = trackMaterial(new MeshStandardMaterial({ color: '#e7a24a', roughness: 0.32, metalness: 0.48 }));
  const purple = trackMaterial(new MeshStandardMaterial({ color: '#6e4fa8', roughness: 0.36, metalness: 0.3 }));
  const green = trackMaterial(new MeshStandardMaterial({ color: '#2c8b62', roughness: 0.72 }));
  const leaf = trackMaterial(new MeshStandardMaterial({ color: '#3d9c6d', roughness: 0.82, flatShading: true }));
  const leafDark = trackMaterial(new MeshStandardMaterial({ color: '#236b50', roughness: 0.88, flatShading: true }));
  const soil = trackMaterial(new MeshStandardMaterial({ color: '#3a3028', roughness: 1 }));
  const sofa = trackMaterial(new MeshStandardMaterial({ color: '#4b4a50', roughness: 0.92 }));
  const sofaBrown = trackMaterial(new MeshStandardMaterial({ color: '#8a5a3b', roughness: 0.88 }));
  const paper = trackMaterial(new MeshStandardMaterial({ color: '#f5f1e5', roughness: 0.9 }));
  const screenFrame = trackMaterial(new MeshStandardMaterial({ color: '#0a1420', roughness: 0.28, metalness: 0.55 }));
  const robotShell = trackMaterial(new MeshPhysicalMaterial({ color: '#f4f7f7', roughness: 0.24, metalness: 0.08, clearcoat: 0.4, clearcoatRoughness: 0.18 }));
  const robotVisor = trackMaterial(new MeshPhysicalMaterial({ color: '#07111d', roughness: 0.14, metalness: 0.18, clearcoat: 1 }));
  const robotCyan = trackMaterial(new MeshStandardMaterial({ color: '#1fd8f5', emissive: '#068cb7', emissiveIntensity: 1.4, roughness: 0.22 }));
  const robotBlue = trackMaterial(new MeshStandardMaterial({ color: '#168bd7', emissive: '#063e78', emissiveIntensity: 0.6, roughness: 0.3 }));
  const robotJoint = trackMaterial(new MeshStandardMaterial({ color: '#232a42', roughness: 0.35, metalness: 0.42 }));
  const robotDark = trackMaterial(new MeshStandardMaterial({ color: '#17202e', roughness: 0.36, metalness: 0.3 }));
  const rug = trackMaterial(new MeshStandardMaterial({ color: '#d8cfc4', roughness: 0.96 }));
  const woraCyan = trackMaterial(new MeshBasicMaterial({ color: '#1fc3e0', toneMapped: false }));

  return {
    marble, marbleDark, floorWood, floorEdge, wood, woodDark, woodSlat, shell, white, dark,
    metal, metalDark, frame, glass, warmLed, cyan, cyanGlow, orange, purple, green,
    leaf, leafDark, soil, sofa, sofaBrown, paper, screenFrame,
    robotShell, robotVisor, robotCyan, robotBlue, robotJoint, robotDark, rug, woraCyan,
    roomFloor: (accent) => {
      const cached = roomFloorCache.get(accent);
      if (cached) return cached;
      const tint = new Color(accent).lerp(new Color('#d8cfd2'), 0.86);
      const material = trackMaterial(new MeshPhysicalMaterial({
        map: marbleTexture, color: tint, roughness: 0.3, metalness: 0.02,
        clearcoat: 0.7, clearcoatRoughness: 0.2,
      }));
      roomFloorCache.set(accent, material);
      return material;
    },
    screenMaterial: (variant) => {
      const cached = screenCache.get(variant);
      if (cached) return cached;
      const map = trackTexture(makeScreenTexture(variant));
      const material = trackMaterial(new MeshStandardMaterial({
        map, color: 0xffffff, emissive: new Color('#0b4a70'), emissiveMap: map, emissiveIntensity: 0.42,
        roughness: 0.34, side: DoubleSide,
      }));
      screenCache.set(variant, material);
      return material;
    },
    dispose: () => {
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      roomFloorCache.clear();
      screenCache.clear();
    },
  };
}
