import {
  CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, type Material, type Texture,
} from 'three';

export type ScreenVariant = 'code' | 'plan' | 'creative' | 'qa' | 'analytics' | 'ops';

export interface OfficePalette {
  marble: MeshStandardMaterial;
  floorEdge: MeshStandardMaterial;
  roomFloor: (accent: string) => MeshStandardMaterial;
  wood: MeshStandardMaterial;
  woodDark: MeshStandardMaterial;
  shell: MeshStandardMaterial;
  white: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  frame: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  cyan: MeshStandardMaterial;
  cyanGlow: MeshBasicMaterial;
  orange: MeshStandardMaterial;
  purple: MeshStandardMaterial;
  green: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  leafDark: MeshStandardMaterial;
  soil: MeshStandardMaterial;
  sofa: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  screenFrame: MeshStandardMaterial;
  screenMaterial: (variant: ScreenVariant) => MeshStandardMaterial;
  signMaterial: (label: string, code: string, accent: string, crown?: boolean) => MeshBasicMaterial;
  logoMaterial: () => MeshBasicMaterial;
  dispose: () => void;
}

const seeded = (seed: number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
};

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable for procedural office materials');
  return { canvas, ctx };
}

function textureFrom(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function makeMarbleTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  const random = seeded(17);
  ctx.fillStyle = '#f2f0e9';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 38; i += 1) {
    const x = random() * 620 - 60;
    const y = random() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 80, y + random() * 80 - 40, x + 170, y + random() * 100 - 50, x + 290, y + random() * 120 - 60);
    ctx.strokeStyle = `rgba(90, 105, 108, ${0.025 + random() * 0.055})`;
    ctx.lineWidth = 0.6 + random() * 2.1;
    ctx.stroke();
  }
  for (let i = 0; i < 9; i += 1) {
    ctx.beginPath();
    ctx.moveTo(random() * 512, random() * 512);
    ctx.lineTo(random() * 512, random() * 512);
    ctx.strokeStyle = 'rgba(160, 145, 120, 0.045)';
    ctx.lineWidth = 3 + random() * 7;
    ctx.stroke();
  }
  return textureFrom(canvas, 3, 2);
}

function makeWoodTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 256);
  const random = seeded(29);
  ctx.fillStyle = '#b47a46';
  ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 80; i += 1) {
    const y = random() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(140, y + random() * 9 - 4, 320, y + random() * 12 - 6, 512, y + random() * 8 - 4);
    ctx.strokeStyle = `rgba(${70 + Math.floor(random() * 40)}, ${42 + Math.floor(random() * 25)}, 20, ${0.07 + random() * 0.12})`;
    ctx.lineWidth = 0.5 + random() * 2.2;
    ctx.stroke();
  }
  return textureFrom(canvas, 2, 1);
}

/** Abstract, decorative screen content. No numeric KPIs, fake charts, or simulated activity. */
function makeScreenTexture(variant: ScreenVariant): CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 300);
  const random = seeded(variant.length * 97 + 41);
  ctx.fillStyle = '#101b2a';
  ctx.fillRect(0, 0, 512, 300);
  ctx.fillStyle = '#16283c';
  roundedRect(ctx, 16, 16, 480, 268, 18);
  ctx.fill();
  ctx.strokeStyle = '#2d6f8e';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (variant === 'code') {
    for (let row = 0; row < 12; row += 1) {
      const indent = 38 + (row % 3) * 26;
      ctx.fillStyle = ['#66d9ef', '#8fb7ff', '#c2a6ff', '#7ee2b8'][row % 4]!;
      roundedRect(ctx, indent, 42 + row * 19, 70 + random() * 250, 6, 3);
      ctx.fill();
    }
  } else if (variant === 'plan') {
    for (let row = 0; row < 4; row += 1) {
      ctx.fillStyle = ['#c2a6ff', '#8fb7ff', '#7ee2b8', '#f0c987'][row]!;
      roundedRect(ctx, 42, 48 + row * 58, 120 + random() * 300, 10, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      roundedRect(ctx, 42, 68 + row * 58, 300, 16, 6);
      ctx.fill();
    }
  } else if (variant === 'creative') {
    const colors = ['#f0a6cf', '#8fb7ff', '#f0c987', '#7ee2b8'];
    for (let i = 0; i < 7; i += 1) {
      ctx.fillStyle = colors[i % colors.length]!;
      roundedRect(ctx, 38 + (i % 3) * 150, 42 + Math.floor(i / 3) * 92, 120, 72, 14);
      ctx.fill();
    }
  } else if (variant === 'qa') {
    for (let i = 0; i < 6; i += 1) {
      ctx.strokeStyle = i % 2 ? '#f0c987' : '#7ee2b8';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(50, 58 + i * 38);
      ctx.lineTo(68, 74 + i * 38);
      ctx.lineTo(96, 44 + i * 38);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      roundedRect(ctx, 120, 52 + i * 38, 270, 12, 6);
      ctx.fill();
    }
  } else if (variant === 'analytics') {
    ctx.strokeStyle = '#7ee2b8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(35, 210);
    for (let x = 35; x < 480; x += 16) ctx.lineTo(x, 180 + Math.sin(x / 44) * 46 + Math.cos(x / 19) * 13);
    ctx.stroke();
    ctx.fillStyle = 'rgba(142, 205, 255, .25)';
    for (let i = 0; i < 8; i += 1) {
      roundedRect(ctx, 42 + i * 56, 238 - (i % 4) * 24, 34, 34 + (i % 4) * 24, 6);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = ['#8fb7ff', '#7ee2b8', '#f0c987', '#c2a6ff', '#f0a6cf'][i]!;
      roundedRect(ctx, 42, 48 + i * 48, 190, 20, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      roundedRect(ctx, 252, 48 + i * 48, 190, 20, 9);
      ctx.fill();
    }
  }
  return textureFrom(canvas);
}

function makeSignTexture(label: string, code: string, accent: string, crown: boolean): CanvasTexture {
  const { canvas, ctx } = canvas2d(768, 176);
  ctx.clearRect(0, 0, 768, 176);
  ctx.shadowColor = 'rgba(0,0,0,.32)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#172433';
  roundedRect(ctx, 8, 12, 752, 144, 30);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = accent;
  roundedRect(ctx, 30, 38, 10, 92, 5);
  ctx.fill();
  if (crown) {
    ctx.beginPath();
    ctx.moveTo(90, 94);
    ctx.lineTo(104, 58);
    ctx.lineTo(122, 82);
    ctx.lineTo(140, 52);
    ctx.lineTo(154, 94);
    ctx.closePath();
    ctx.fillStyle = '#f3c969';
    ctx.fill();
  }
  let fontSize = 48;
  do {
    ctx.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
    fontSize -= 2;
  } while (ctx.measureText(label).width > 570 && fontSize > 25);
  ctx.fillStyle = '#f7fbff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, crown ? 180 : 72, 72);
  ctx.font = '600 22px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(219,236,246,.72)';
  ctx.fillText(`WORA  ·  ${code}`, crown ? 180 : 72, 118);
  return textureFrom(canvas);
}

function makeLogoTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  ctx.clearRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(43, 104, 125, .65)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(256, 256, 216, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200, 167, 89, .75)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(256, 256, 185, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#17465a';
  ctx.font = '800 112px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WORA', 256, 250);
  ctx.fillStyle = 'rgba(23, 70, 90, .55)';
  ctx.font = '600 26px Inter, Arial, sans-serif';
  ctx.fillText('AGENT OS', 256, 330);
  return textureFrom(canvas);
}

export function createOfficePalette(): OfficePalette {
  const textures: Texture[] = [];
  const materials: Material[] = [];
  const roomFloorCache = new Map<string, MeshStandardMaterial>();
  const screenCache = new Map<ScreenVariant, MeshStandardMaterial>();
  const signCache = new Map<string, MeshBasicMaterial>();
  let logoMaterial: MeshBasicMaterial | null = null;

  const trackTexture = <T extends Texture>(texture: T): T => { textures.push(texture); return texture; };
  const trackMaterial = <T extends Material>(material: T): T => { materials.push(material); return material; };

  const marbleTexture = trackTexture(makeMarbleTexture());
  const woodTexture = trackTexture(makeWoodTexture());

  const marble = trackMaterial(new MeshStandardMaterial({ map: marbleTexture, color: 0xffffff, roughness: 0.28, metalness: 0.06 }));
  const floorEdge = trackMaterial(new MeshStandardMaterial({ color: '#233a43', roughness: 0.42, metalness: 0.55 }));
  const wood = trackMaterial(new MeshStandardMaterial({ map: woodTexture, color: '#e1b17c', roughness: 0.5, metalness: 0.03 }));
  const woodDark = trackMaterial(new MeshStandardMaterial({ color: '#70482c', roughness: 0.62 }));
  const shell = trackMaterial(new MeshStandardMaterial({ color: '#eef4f4', roughness: 0.34, metalness: 0.12 }));
  const white = trackMaterial(new MeshStandardMaterial({ color: '#f7f9f8', roughness: 0.46 }));
  const dark = trackMaterial(new MeshStandardMaterial({ color: '#172332', roughness: 0.38, metalness: 0.25 }));
  const metal = trackMaterial(new MeshStandardMaterial({ color: '#80949c', roughness: 0.3, metalness: 0.72 }));
  const frame = trackMaterial(new MeshStandardMaterial({ color: '#263b47', roughness: 0.38, metalness: 0.62 }));
  const glass = trackMaterial(new MeshPhysicalMaterial({
    color: '#a5d4e2', transparent: true, opacity: 0.24, roughness: 0.08, metalness: 0.08,
    clearcoat: 0.7, clearcoatRoughness: 0.12, side: DoubleSide, depthWrite: false,
  }));
  const cyan = trackMaterial(new MeshStandardMaterial({ color: '#42d6f2', emissive: '#0b7c99', emissiveIntensity: 0.85, roughness: 0.28 }));
  const cyanGlow = trackMaterial(new MeshBasicMaterial({ color: '#7eeaff', transparent: true, opacity: 0.78, side: DoubleSide }));
  const orange = trackMaterial(new MeshStandardMaterial({ color: '#e7843c', roughness: 0.32, metalness: 0.45 }));
  const purple = trackMaterial(new MeshStandardMaterial({ color: '#6e4fa8', roughness: 0.34, metalness: 0.28 }));
  const green = trackMaterial(new MeshStandardMaterial({ color: '#2c8b62', roughness: 0.7 }));
  const leaf = trackMaterial(new MeshStandardMaterial({ color: '#3d9c6d', roughness: 0.82, flatShading: true }));
  const leafDark = trackMaterial(new MeshStandardMaterial({ color: '#236b50', roughness: 0.88, flatShading: true }));
  const soil = trackMaterial(new MeshStandardMaterial({ color: '#4c382c', roughness: 1 }));
  const sofa = trackMaterial(new MeshStandardMaterial({ color: '#6b5b54', roughness: 0.92 }));
  const paper = trackMaterial(new MeshStandardMaterial({ color: '#f5f1e5', roughness: 0.9 }));
  const screenFrame = trackMaterial(new MeshStandardMaterial({ color: '#111a26', roughness: 0.3, metalness: 0.55 }));

  return {
    marble, floorEdge, wood, woodDark, shell, white, dark, metal, frame, glass,
    cyan, cyanGlow, orange, purple, green, leaf, leafDark, soil, sofa, paper, screenFrame,
    roomFloor: (accent) => {
      const cached = roomFloorCache.get(accent);
      if (cached) return cached;
      const tint = new Color(accent).lerp(new Color('#f2f0e9'), 0.88);
      const material = trackMaterial(new MeshStandardMaterial({ color: tint, roughness: 0.46, metalness: 0.03 }));
      roomFloorCache.set(accent, material);
      return material;
    },
    screenMaterial: (variant) => {
      const cached = screenCache.get(variant);
      if (cached) return cached;
      const map = trackTexture(makeScreenTexture(variant));
      const material = trackMaterial(new MeshStandardMaterial({
        map, color: 0xffffff, emissive: new Color('#12344a'), emissiveMap: map, emissiveIntensity: 0.32,
        roughness: 0.38, side: DoubleSide,
      }));
      screenCache.set(variant, material);
      return material;
    },
    signMaterial: (label, code, accent, crown = false) => {
      const key = `${label}|${code}|${accent}|${crown}`;
      const cached = signCache.get(key);
      if (cached) return cached;
      const map = trackTexture(makeSignTexture(label, code, accent, crown));
      const material = trackMaterial(new MeshBasicMaterial({ map, transparent: true, side: DoubleSide, depthWrite: false, depthTest: false }));
      signCache.set(key, material);
      return material;
    },
    logoMaterial: () => {
      if (logoMaterial) return logoMaterial;
      const map = trackTexture(makeLogoTexture());
      logoMaterial = trackMaterial(new MeshBasicMaterial({ map, transparent: true, side: DoubleSide, depthWrite: false }));
      return logoMaterial;
    },
    dispose: () => {
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      roomFloorCache.clear();
      screenCache.clear();
      signCache.clear();
      logoMaterial = null;
    },
  };
}
