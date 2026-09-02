import * as THREE from 'three';
import { dataTexture, fbm, noiseTexture, normalFromHeight, paintedTexture } from './TextureFactory';

/**
 * MAT_* library. Every entry is a full PBR set (base colour + roughness +
 * metalness + normal where it earns its keep), generated procedurally.
 * Materials are shared instances so the renderer batches aggressively.
 */

export type MaterialId =
  | 'MAT_Asphalt'
  | 'MAT_AsphaltMarked'
  | 'MAT_Concrete'
  | 'MAT_ConcreteDirty'
  | 'MAT_ConcreteRib'
  | 'MAT_PaintedMetal'
  | 'MAT_PaintedMetalDark'
  | 'MAT_RustedMetal'
  | 'MAT_StainlessSteel'
  | 'MAT_BrushedAlu'
  | 'MAT_Chrome'
  | 'MAT_Copper'
  | 'MAT_Corrugated'
  | 'MAT_Glass'
  | 'MAT_GlassTinted'
  | 'MAT_WindowLit'
  | 'MAT_Plastic'
  | 'MAT_PlasticDark'
  | 'MAT_Rubber'
  | 'MAT_Wood'
  | 'MAT_WoodWorn'
  | 'MAT_Brick'
  | 'MAT_Stone'
  | 'MAT_Dirt'
  | 'MAT_Gravel'
  | 'MAT_Ballast'
  | 'MAT_RailSteel'
  | 'MAT_Sleeper'
  | 'MAT_PlatformTile'
  | 'MAT_PlatformEdge'
  | 'MAT_PaintedWall'
  | 'MAT_Plaster'
  | 'MAT_Neon'
  | 'MAT_NeonMagenta'
  | 'MAT_NeonCyan'
  | 'MAT_NeonAmber'
  | 'MAT_LedPanel'
  | 'MAT_Headlight'
  | 'MAT_TailLight'
  | 'MAT_HazardStripe'
  | 'MAT_SafetyOrange'
  | 'MAT_SafetyYellow'
  | 'MAT_Cable'
  | 'MAT_Foliage'
  | 'MAT_Bark'
  | 'MAT_Grass'
  | 'MAT_CoinGold'
  | 'MAT_CoinCore'
  | 'MAT_Skin'
  | 'MAT_Hair'
  | 'MAT_ShirtFabric'
  | 'MAT_Denim'
  | 'MAT_ShoeRubber'
  | 'MAT_ShoeFabric'
  | 'MAT_Eye'
  | 'MAT_EyeWhite'
  | 'MAT_Teeth'
  | 'MAT_Mouth'
  | 'MAT_TrainBodyA'
  | 'MAT_TrainBodyB'
  | 'MAT_TrainBodyC'
  | 'MAT_TrainRoof'
  | 'MAT_TrainSkirt'
  | 'MAT_Signage'
  | 'MAT_Billboard'
  | 'MAT_Shield'
  | 'MAT_Magnet'
  | 'MAT_Boost';

interface Spec {
  color: number;
  roughness: number;
  metalness: number;
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  side?: THREE.Side;
  /** Procedural map generator key + params. */
  map?: {
    a: string;
    b: string;
    period?: number;
    octaves?: number;
    contrast?: number;
    repeat?: number;
    size?: number;
    seed?: number;
    decorate?: (ctx: CanvasRenderingContext2D, size: number) => void;
  };
  /** Normal map from a height field. */
  normal?: { strength: number; repeat?: number; size?: number; height: (x: number, y: number, size: number) => number };
  /** Roughness variation map. */
  rough?: { repeat?: number; size?: number; value: (x: number, y: number, size: number) => number };
  flatShading?: boolean;
}

const grain = (period: number, seed: number, contrast = 1) => (x: number, y: number, size: number) =>
  Math.min(1, Math.max(0, (fbm(x / size, y / size, 4, period, seed) - 0.5) * contrast + 0.5));

const SPECS: Record<MaterialId, Spec> = {
  MAT_Asphalt: {
    color: 0xffffff, roughness: 0.94, metalness: 0.0,
    map: { a: '#26282c', b: '#3a3d43', period: 16, contrast: 1.3, repeat: 4 },
    normal: { strength: 2.2, repeat: 4, height: grain(24, 11, 1.6) },
  },
  MAT_AsphaltMarked: {
    color: 0xffffff, roughness: 0.9, metalness: 0.0,
    map: {
      a: '#25272b', b: '#35383d', period: 14, repeat: 1, size: 256,
      decorate: (ctx, s) => {
        ctx.fillStyle = 'rgba(226,222,190,0.85)';
        for (let i = 0; i < 6; i++) ctx.fillRect(s * 0.48, (i / 6) * s + s * 0.02, s * 0.04, s * 0.09);
      },
    },
  },
  MAT_Concrete: {
    color: 0xffffff, roughness: 0.88, metalness: 0.0,
    map: { a: '#6b6b6b', b: '#8f8e8a', period: 10, contrast: 0.9, repeat: 3 },
    normal: { strength: 1.4, repeat: 3, height: grain(18, 23, 1.2) },
  },
  MAT_ConcreteDirty: {
    color: 0xffffff, roughness: 0.95, metalness: 0.0,
    map: { a: '#4a4842', b: '#767268', period: 7, contrast: 1.4, repeat: 2 },
  },
  MAT_ConcreteRib: {
    color: 0xffffff, roughness: 0.9, metalness: 0.0,
    map: {
      a: '#5d5d5d', b: '#7d7c78', period: 9, repeat: 2,
      decorate: (ctx, s) => {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (let i = 0; i < 16; i++) ctx.fillRect(0, (i / 16) * s, s, s * 0.012);
      },
    },
    normal: { strength: 2.6, repeat: 2, height: (_x, y, size) => (Math.sin((y / size) * Math.PI * 32) * 0.5 + 0.5) },
  },
  MAT_PaintedMetal: {
    color: 0xffffff, roughness: 0.42, metalness: 0.65,
    map: { a: '#9aa4ae', b: '#c3ccd4', period: 6, contrast: 0.6, repeat: 2 },
  },
  MAT_PaintedMetalDark: { color: 0x3c434c, roughness: 0.45, metalness: 0.7 },
  MAT_RustedMetal: {
    color: 0xffffff, roughness: 0.85, metalness: 0.45,
    map: { a: '#5a3520', b: '#9c5c2c', period: 9, contrast: 1.5, repeat: 2, seed: 41 },
    normal: { strength: 2.8, repeat: 2, height: grain(20, 41, 1.7) },
  },
  MAT_StainlessSteel: { color: 0xc9d0d6, roughness: 0.28, metalness: 0.95 },
  MAT_BrushedAlu: {
    color: 0xffffff, roughness: 0.34, metalness: 0.9,
    map: { a: '#9fa6ac', b: '#cfd5da', period: 3, contrast: 0.5, repeat: 3 },
    normal: { strength: 1.1, repeat: 3, height: (x, _y, size) => (Math.sin((x / size) * Math.PI * 90) * 0.5 + 0.5) },
  },
  MAT_Chrome: { color: 0xe8eef3, roughness: 0.08, metalness: 1.0 },
  MAT_Copper: { color: 0xb87333, roughness: 0.38, metalness: 0.95 },
  MAT_Corrugated: {
    color: 0xffffff, roughness: 0.55, metalness: 0.6,
    map: { a: '#7b8189', b: '#a6adb4', period: 5, repeat: 2 },
    normal: { strength: 3.4, repeat: 2, height: (x, _y, size) => Math.sin((x / size) * Math.PI * 24) * 0.5 + 0.5 },
  },
  MAT_Glass: { color: 0x9fd4e8, roughness: 0.06, metalness: 0.1, opacity: 0.34, transparent: true },
  MAT_GlassTinted: { color: 0x18323f, roughness: 0.12, metalness: 0.4, opacity: 0.62, transparent: true },
  MAT_WindowLit: {
    color: 0xffffff, roughness: 0.2, metalness: 0.2, emissive: 0xffe6b0, emissiveIntensity: 0.85,
    map: {
      a: '#101820', b: '#ffd9a0', period: 4, contrast: 2.6, repeat: 1, size: 128, seed: 91,
      decorate: (ctx, s) => {
        ctx.fillStyle = 'rgba(6,10,16,0.9)';
        for (let i = 0; i <= 8; i++) {
          ctx.fillRect(0, (i / 8) * s - 1, s, 2.5);
          ctx.fillRect((i / 8) * s - 1, 0, 2.5, s);
        }
      },
    },
  },
  MAT_Plastic: { color: 0xd8dde2, roughness: 0.5, metalness: 0.0 },
  MAT_PlasticDark: { color: 0x1d2126, roughness: 0.55, metalness: 0.0 },
  MAT_Rubber: { color: 0x14161a, roughness: 0.95, metalness: 0.0 },
  MAT_Wood: {
    color: 0xffffff, roughness: 0.72, metalness: 0.0,
    map: { a: '#6a4527', b: '#a3703f', period: 3, contrast: 1.8, repeat: 2, seed: 63 },
  },
  MAT_WoodWorn: { color: 0x6f5638, roughness: 0.85, metalness: 0.0 },
  MAT_Brick: {
    color: 0xffffff, roughness: 0.9, metalness: 0.0,
    map: {
      a: '#7a3b2c', b: '#a55842', period: 8, repeat: 3, size: 256,
      decorate: (ctx, s) => {
        ctx.strokeStyle = 'rgba(190,185,175,0.55)';
        ctx.lineWidth = 2;
        const rows = 12;
        for (let r = 0; r < rows; r++) {
          const y = (r / rows) * s;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
          const off = r % 2 === 0 ? 0 : s / 12;
          for (let c = 0; c < 6; c++) {
            const x = (c / 6) * s + off;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s / rows); ctx.stroke();
          }
        }
      },
    },
    normal: { strength: 2.0, repeat: 3, height: grain(14, 63, 1.2) },
  },
  MAT_Stone: {
    color: 0xffffff, roughness: 0.85, metalness: 0.0,
    map: { a: '#5f5c57', b: '#8d8880', period: 6, contrast: 1.4, repeat: 2, seed: 77 },
  },
  MAT_Dirt: {
    color: 0xffffff, roughness: 0.98, metalness: 0.0,
    map: { a: '#3b3129', b: '#6a5a45', period: 8, contrast: 1.2, repeat: 5, seed: 15 },
  },
  MAT_Gravel: {
    color: 0xffffff, roughness: 0.97, metalness: 0.0,
    map: { a: '#3d3f42', b: '#7d7a74', period: 22, contrast: 2.0, repeat: 6, seed: 29 },
    normal: { strength: 3.0, repeat: 6, height: grain(30, 29, 2.0) },
  },
  MAT_Ballast: {
    color: 0xffffff, roughness: 0.98, metalness: 0.02,
    map: { a: '#4a4c44', b: '#8d8a7c', period: 26, contrast: 2.2, repeat: 8, seed: 31 },
    normal: { strength: 3.6, repeat: 8, height: grain(34, 31, 2.2) },
  },
  MAT_RailSteel: {
    color: 0xffffff, roughness: 0.3, metalness: 0.92,
    map: { a: '#5a5f66', b: '#b9c2c9', period: 4, contrast: 1.1, repeat: 1, seed: 5 },
  },
  MAT_Sleeper: {
    color: 0xffffff, roughness: 0.92, metalness: 0.0,
    map: { a: '#5d5a54', b: '#837f76', period: 7, contrast: 1.1, repeat: 1, seed: 47 },
  },
  MAT_PlatformTile: {
    color: 0xffffff, roughness: 0.55, metalness: 0.05,
    map: {
      a: '#8c8f93', b: '#b8bcc0', period: 5, repeat: 6, size: 256,
      decorate: (ctx, s) => {
        ctx.strokeStyle = 'rgba(50,52,56,0.6)';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath(); ctx.moveTo(0, (i / 4) * s); ctx.lineTo(s, (i / 4) * s); ctx.stroke();
          ctx.beginPath(); ctx.moveTo((i / 4) * s, 0); ctx.lineTo((i / 4) * s, s); ctx.stroke();
        }
      },
    },
  },
  MAT_PlatformEdge: {
    color: 0xffffff, roughness: 0.6, metalness: 0.0,
    map: {
      a: '#c8b83a', b: '#e6d75c', period: 6, repeat: 8, size: 128,
      decorate: (ctx, s) => {
        ctx.fillStyle = 'rgba(28,28,30,0.85)';
        for (let i = 0; i < 6; i++) ctx.fillRect((i / 6) * s, 0, s * 0.06, s);
      },
    },
  },
  MAT_PaintedWall: {
    color: 0xffffff, roughness: 0.75, metalness: 0.0,
    map: { a: '#8e9aa4', b: '#c2ccd4', period: 5, contrast: 0.7, repeat: 3, seed: 83 },
  },
  MAT_Plaster: { color: 0xd6cfc2, roughness: 0.9, metalness: 0.0 },
  MAT_Neon: { color: 0x000000, roughness: 0.4, metalness: 0.0, emissive: 0x36f0ff, emissiveIntensity: 3.0 },
  MAT_NeonMagenta: { color: 0x000000, roughness: 0.4, metalness: 0.0, emissive: 0xff3ea8, emissiveIntensity: 3.0 },
  MAT_NeonCyan: { color: 0x000000, roughness: 0.4, metalness: 0.0, emissive: 0x51fff0, emissiveIntensity: 3.0 },
  MAT_NeonAmber: { color: 0x000000, roughness: 0.4, metalness: 0.0, emissive: 0xffb64a, emissiveIntensity: 2.6 },
  MAT_LedPanel: {
    color: 0x05070a, roughness: 0.35, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 1.1,
    map: {
      a: '#050709', b: '#1a2733', period: 3, repeat: 1, size: 128, seed: 12,
      decorate: (ctx, s) => {
        ctx.fillStyle = '#ffb020';
        ctx.font = `bold ${s * 0.17}px monospace`;
        ctx.fillText('NEXT  2 MIN', s * 0.05, s * 0.35);
        ctx.fillStyle = '#54ffd0';
        ctx.fillText('PLATFORM 3', s * 0.05, s * 0.68);
      },
    },
  },
  MAT_Headlight: { color: 0xfff6d8, roughness: 0.1, metalness: 0.0, emissive: 0xfff2cc, emissiveIntensity: 4.0 },
  MAT_TailLight: { color: 0x330000, roughness: 0.2, metalness: 0.0, emissive: 0xff2a1a, emissiveIntensity: 2.6 },
  MAT_HazardStripe: {
    color: 0xffffff, roughness: 0.6, metalness: 0.1,
    map: {
      a: '#f2c400', b: '#f2c400', period: 2, repeat: 3, size: 128,
      decorate: (ctx, s) => {
        ctx.save();
        ctx.fillStyle = '#17181b';
        ctx.translate(s / 2, s / 2); ctx.rotate(Math.PI / 4); ctx.translate(-s, -s);
        for (let i = 0; i < 12; i++) ctx.fillRect(i * (s / 6), 0, s / 12, s * 2);
        ctx.restore();
      },
    },
  },
  MAT_SafetyOrange: { color: 0xe1621d, roughness: 0.62, metalness: 0.0 },
  MAT_SafetyYellow: { color: 0xe8bb18, roughness: 0.6, metalness: 0.05 },
  MAT_Cable: { color: 0x1a1c20, roughness: 0.8, metalness: 0.2 },
  MAT_Foliage: {
    color: 0xffffff, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
    map: { a: '#1d3b1f', b: '#4a7a35', period: 12, contrast: 1.4, repeat: 1, seed: 55 },
  },
  MAT_Bark: {
    color: 0xffffff, roughness: 0.95, metalness: 0.0,
    map: { a: '#3b2c20', b: '#63503c', period: 4, contrast: 1.8, repeat: 2, seed: 71 },
  },
  MAT_Grass: {
    color: 0xffffff, roughness: 0.92, metalness: 0.0,
    map: { a: '#2b4a24', b: '#557f30', period: 18, contrast: 1.3, repeat: 8, seed: 66 },
  },
  MAT_CoinGold: {
    color: 0xffc93c, roughness: 0.22, metalness: 1.0, emissive: 0xff9a1f, emissiveIntensity: 0.35,
  },
  MAT_CoinCore: { color: 0xfff0b8, roughness: 0.15, metalness: 0.9, emissive: 0xffd86b, emissiveIntensity: 0.9 },
  MAT_Skin: {
    color: 0xffffff, roughness: 0.62, metalness: 0.0,
    map: { a: '#a86a45', b: '#d9a273', period: 5, contrast: 0.45, repeat: 1, size: 256, seed: 3 },
    normal: { strength: 0.5, repeat: 1, height: grain(30, 3, 0.6) },
  },
  MAT_Hair: {
    color: 0xffffff, roughness: 0.42, metalness: 0.06,
    map: { a: '#0b0908', b: '#2a2018', period: 30, contrast: 1.6, repeat: 1, size: 256, seed: 9 },
  },
  MAT_ShirtFabric: {
    color: 0xffffff, roughness: 0.8, metalness: 0.0,
    map: { a: '#123340', b: '#1f5f72', period: 26, contrast: 0.9, repeat: 2, size: 256, seed: 19 },
    normal: { strength: 1.0, repeat: 2, height: grain(40, 19, 1.0) },
  },
  MAT_Denim: {
    color: 0xffffff, roughness: 0.86, metalness: 0.0,
    map: { a: '#1c2434', b: '#33415c', period: 34, contrast: 1.0, repeat: 2, size: 256, seed: 27 },
    normal: { strength: 1.2, repeat: 2, height: grain(46, 27, 1.1) },
  },
  MAT_ShoeRubber: { color: 0xf2f2f0, roughness: 0.7, metalness: 0.0 },
  MAT_ShoeFabric: { color: 0x1b1e24, roughness: 0.78, metalness: 0.0 },
  MAT_Eye: { color: 0x2d1c10, roughness: 0.18, metalness: 0.0 },
  MAT_EyeWhite: { color: 0xf3f1ec, roughness: 0.16, metalness: 0.0 },
  MAT_Teeth: { color: 0xf6f3ea, roughness: 0.3, metalness: 0.0 },
  MAT_Mouth: { color: 0x6b2f31, roughness: 0.5, metalness: 0.0 },
  MAT_TrainBodyA: {
    color: 0xffffff, roughness: 0.3, metalness: 0.75,
    map: { a: '#c9d2d8', b: '#eef3f6', period: 4, contrast: 0.5, repeat: 1, size: 256, seed: 33 },
  },
  MAT_TrainBodyB: { color: 0x1d5f8a, roughness: 0.32, metalness: 0.7 },
  MAT_TrainBodyC: { color: 0x8a1d3a, roughness: 0.34, metalness: 0.68 },
  MAT_TrainRoof: { color: 0x53595f, roughness: 0.68, metalness: 0.5 },
  MAT_TrainSkirt: { color: 0x232830, roughness: 0.6, metalness: 0.55 },
  MAT_Signage: {
    color: 0xffffff, roughness: 0.5, metalness: 0.1, emissive: 0x8fd8ff, emissiveIntensity: 0.5,
  },
  MAT_Billboard: {
    color: 0xffffff, roughness: 0.45, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.55,
    map: {
      a: '#12162a', b: '#3a2060', period: 4, repeat: 1, size: 256, seed: 88,
      decorate: (ctx, s) => {
        const grad = ctx.createLinearGradient(0, 0, s, s);
        grad.addColorStop(0, 'rgba(255,62,168,0.55)');
        grad.addColorStop(1, 'rgba(81,255,240,0.5)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${s * 0.15}px system-ui, sans-serif`;
        ctx.fillText('NEON', s * 0.09, s * 0.45);
        ctx.fillText('LINE 7', s * 0.09, s * 0.68);
      },
    },
  },
  MAT_Shield: {
    color: 0x63e8ff, roughness: 0.1, metalness: 0.2, emissive: 0x3ad4ff, emissiveIntensity: 1.6,
    opacity: 0.32, transparent: true, side: THREE.DoubleSide,
  },
  MAT_Magnet: { color: 0xe8443a, roughness: 0.35, metalness: 0.5, emissive: 0xff5a3a, emissiveIntensity: 0.6 },
  MAT_Boost: { color: 0x51ffb0, roughness: 0.25, metalness: 0.4, emissive: 0x35ffa0, emissiveIntensity: 1.4 },
};

const built = new Map<MaterialId, THREE.MeshStandardMaterial>();

/** Fetch (and lazily build) a shared material instance. */
export function material(id: MaterialId): THREE.MeshStandardMaterial {
  const cached = built.get(id);
  if (cached) return cached;
  const spec = SPECS[id];
  const mat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: spec.side ?? THREE.FrontSide,
    flatShading: spec.flatShading ?? false,
  });
  if (spec.emissive !== undefined) {
    mat.emissive = new THREE.Color(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }
  if (spec.transparent) {
    mat.transparent = true;
    mat.opacity = spec.opacity ?? 1;
    mat.depthWrite = false;
  }
  if (spec.map) {
    const m = spec.map;
    const tex = noiseTexture(`${id}:base`, {
      colorA: m.a,
      colorB: m.b,
      period: m.period,
      octaves: m.octaves,
      contrast: m.contrast,
      repeat: m.repeat,
      size: m.size,
      seed: m.seed,
      decorate: m.decorate,
    });
    mat.map = tex;
    if (spec.emissive !== undefined && (id === 'MAT_WindowLit' || id === 'MAT_Billboard' || id === 'MAT_LedPanel')) {
      mat.emissiveMap = tex;
    }
  }
  if (spec.normal) {
    const size = spec.normal.size ?? 256;
    mat.normalMap = normalFromHeight(`${id}:normal`, size, spec.normal.repeat ?? 1, spec.normal.strength, (x, y) =>
      spec.normal!.height(x, y, size),
    );
    mat.normalScale = new THREE.Vector2(1, 1);
  }
  if (spec.rough) {
    const size = spec.rough.size ?? 128;
    mat.roughnessMap = dataTexture(`${id}:rough`, size, spec.rough.repeat ?? 1, (x, y) => spec.rough!.value(x, y, size));
  }
  built.set(id, mat);
  return mat;
}

/** All material ids, used by the asset manifest and the debug panel. */
export function allMaterialIds(): MaterialId[] {
  return Object.keys(SPECS) as MaterialId[];
}

/** Warm the whole library during the loading screen. */
export function prewarmMaterials(onStep?: (index: number, total: number) => void): void {
  const ids = allMaterialIds();
  ids.forEach((id, i) => {
    material(id);
    onStep?.(i + 1, ids.length);
  });
}

/** Emissive materials get dimmed in daylight zones and lifted at night. */
export function setNeonIntensity(scale: number): void {
  for (const id of ['MAT_Neon', 'MAT_NeonMagenta', 'MAT_NeonCyan', 'MAT_NeonAmber', 'MAT_WindowLit', 'MAT_Billboard'] as MaterialId[]) {
    const base = SPECS[id].emissiveIntensity ?? 1;
    material(id).emissiveIntensity = base * scale;
  }
}

/** DEC_* decals: transparent overlays that break up repeated surfaces. */
export type DecalId =
  | 'DEC_Dirt' | 'DEC_Scratches' | 'DEC_Rust' | 'DEC_Graffiti' | 'DEC_Oil'
  | 'DEC_WarningStripes' | 'DEC_RailMarking' | 'DEC_Arrow' | 'DEC_Numbers' | 'DEC_Ad';

const decalCache = new Map<DecalId, THREE.MeshStandardMaterial>();

export function decal(id: DecalId): THREE.MeshStandardMaterial {
  const cached = decalCache.get(id);
  if (cached) return cached;
  const tex = paintedTexture(`decal:${id}`, 256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    switch (id) {
      case 'DEC_Dirt':
      case 'DEC_Rust': {
        const tint = id === 'DEC_Dirt' ? '60,52,40' : '140,70,28';
        for (let i = 0; i < 240; i++) {
          const x = (fbm(i * 0.13, 0.5, 3, 8, 5) * s);
          const y = (fbm(0.5, i * 0.17, 3, 8, 9) * s);
          const r = 4 + fbm(i * 0.3, i * 0.2, 2, 6, 3) * 26;
          ctx.fillStyle = `rgba(${tint},${0.05 + fbm(i * 0.4, 0.1, 2, 5, 1) * 0.2})`;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'DEC_Scratches': {
        ctx.strokeStyle = 'rgba(230,230,230,0.28)';
        for (let i = 0; i < 40; i++) {
          const x = fbm(i * 0.21, 0.3, 2, 7, 13) * s;
          const y = fbm(0.7, i * 0.19, 2, 7, 17) * s;
          ctx.lineWidth = 0.6 + fbm(i * 0.5, 0.5, 1, 4, 2) * 1.6;
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.lineTo(x + (fbm(i * 0.7, 0.2, 1, 3, 4) - 0.5) * 90, y + (fbm(0.2, i * 0.7, 1, 3, 6) - 0.5) * 90);
          ctx.stroke();
        }
        break;
      }
      case 'DEC_Graffiti': {
        const colors = ['#ff3ea8', '#51fff0', '#ffb64a', '#8a6bff'];
        for (let i = 0; i < 5; i++) {
          ctx.strokeStyle = colors[i % colors.length];
          ctx.lineWidth = 9 + i * 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(20 + i * 12, s * 0.7);
          ctx.bezierCurveTo(s * 0.3, s * 0.2 + i * 14, s * 0.65, s * 0.9 - i * 10, s - 24, s * 0.4 + i * 8);
          ctx.stroke();
        }
        break;
      }
      case 'DEC_Oil': {
        const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(10,10,14,0.72)');
        g.addColorStop(0.7, 'rgba(18,16,24,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        break;
      }
      case 'DEC_WarningStripes': {
        ctx.save(); ctx.translate(s / 2, s / 2); ctx.rotate(-Math.PI / 4); ctx.translate(-s, -s);
        for (let i = 0; i < 16; i++) {
          ctx.fillStyle = i % 2 ? 'rgba(242,196,0,0.9)' : 'rgba(24,24,26,0.9)';
          ctx.fillRect(i * (s / 8), 0, s / 8, s * 2);
        }
        ctx.restore();
        break;
      }
      case 'DEC_RailMarking': {
        ctx.strokeStyle = 'rgba(235,232,214,0.8)'; ctx.lineWidth = 8;
        ctx.strokeRect(s * 0.12, s * 0.12, s * 0.76, s * 0.76);
        ctx.fillStyle = 'rgba(235,232,214,0.8)';
        ctx.font = `bold ${s * 0.26}px system-ui, sans-serif`;
        ctx.fillText('SAFE', s * 0.2, s * 0.6);
        break;
      }
      case 'DEC_Arrow': {
        ctx.fillStyle = 'rgba(240,240,235,0.85)';
        ctx.beginPath();
        ctx.moveTo(s * 0.5, s * 0.12); ctx.lineTo(s * 0.86, s * 0.5); ctx.lineTo(s * 0.64, s * 0.5);
        ctx.lineTo(s * 0.64, s * 0.88); ctx.lineTo(s * 0.36, s * 0.88); ctx.lineTo(s * 0.36, s * 0.5);
        ctx.lineTo(s * 0.14, s * 0.5); ctx.closePath(); ctx.fill();
        break;
      }
      case 'DEC_Numbers': {
        ctx.fillStyle = 'rgba(228,226,218,0.82)';
        ctx.font = `bold ${s * 0.62}px system-ui, sans-serif`;
        ctx.fillText('07', s * 0.14, s * 0.78);
        break;
      }
      case 'DEC_Ad': {
        const g = ctx.createLinearGradient(0, 0, s, s);
        g.addColorStop(0, 'rgba(255,62,168,0.85)');
        g.addColorStop(1, 'rgba(60,110,255,0.85)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${s * 0.16}px system-ui, sans-serif`;
        ctx.fillText('RIDE THE', s * 0.1, s * 0.42);
        ctx.fillText('NEON LINE', s * 0.1, s * 0.62);
        break;
      }
    }
  }, { transparent: true });

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.85,
    metalness: 0.0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (id === 'DEC_Ad' || id === 'DEC_Graffiti') {
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = tex;
    mat.emissiveIntensity = 0.35;
  }
  decalCache.set(id, mat);
  return mat;
}

export function allDecalIds(): DecalId[] {
  return ['DEC_Dirt', 'DEC_Scratches', 'DEC_Rust', 'DEC_Graffiti', 'DEC_Oil',
    'DEC_WarningStripes', 'DEC_RailMarking', 'DEC_Arrow', 'DEC_Numbers', 'DEC_Ad'];
}
