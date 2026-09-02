import * as THREE from 'three';
import { CFG, laneToX } from '../core/Config';
import { LaneIndex } from '../core/Types';
import { material } from '../assets/MaterialLibrary';
import { paintedTexture } from '../assets/TextureFactory';

/**
 * COL_Coin: a struck coin with a milled edge, a raised rim and an embossed
 * face, plus a soft emissive core so it stays readable against dark ballast.
 */
export function buildCoinGeometry(): THREE.BufferGeometry {
  const r = CFG.coins.radius;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(0, -0.045),
    new THREE.Vector2(r * 0.55, -0.045),
    new THREE.Vector2(r * 0.82, -0.062),
    new THREE.Vector2(r, -0.03),
    new THREE.Vector2(r, 0.03),
    new THREE.Vector2(r * 0.82, 0.062),
    new THREE.Vector2(r * 0.55, 0.045),
    new THREE.Vector2(0, 0.045),
  ];
  // Lathe around Y then stand the coin upright so it faces the runner.
  const geo = new THREE.LatheGeometry(points, 20);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Embossed face texture, applied to the coin's flat sides. */
export function coinFaceTexture(): THREE.Texture {
  return paintedTexture('coin:face', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#ffe9a8');
    g.addColorStop(0.65, '#ffc93c');
    g.addColorStop(1, '#c98a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120,80,10,0.7)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,80,10,0.85)';
    ctx.font = `bold ${s * 0.42}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', s / 2, s * 0.53);
  });
}

export interface CoinVisual {
  mesh: THREE.Mesh;
  glow: THREE.Sprite | null;
}

let sharedGeometry: THREE.BufferGeometry | null = null;
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

export function coinMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) {
    sharedMaterial = material('MAT_CoinGold').clone();
    sharedMaterial.map = coinFaceTexture();
    sharedMaterial.emissiveMap = sharedMaterial.map;
  }
  return sharedMaterial;
}

export function coinGeometry(): THREE.BufferGeometry {
  if (!sharedGeometry) sharedGeometry = buildCoinGeometry();
  return sharedGeometry;
}

/** Named coin patterns. Each returns offsets relative to the pattern origin. */
export type CoinPatternId =
  | 'PAT_Straight' | 'PAT_Arc' | 'PAT_ZigZag' | 'PAT_LaneSwitch'
  | 'PAT_JumpTrail' | 'PAT_Spiral' | 'PAT_RiskReward' | 'PAT_Burst'
  | 'PAT_Stair' | 'PAT_Double' | 'PAT_Wave' | 'PAT_Roof';

export const COIN_PATTERNS: CoinPatternId[] = [
  'PAT_Straight', 'PAT_Arc', 'PAT_ZigZag', 'PAT_LaneSwitch',
  'PAT_JumpTrail', 'PAT_Spiral', 'PAT_RiskReward', 'PAT_Burst',
  'PAT_Stair', 'PAT_Double', 'PAT_Wave', 'PAT_Roof',
];

export interface CoinPlacement {
  x: number;
  y: number;
  z: number;
}

/**
 * Expands a pattern into coin placements. `lane` is where the pattern starts;
 * patterns that move across lanes clamp to the playfield.
 */
export function expandCoinPattern(
  pattern: CoinPatternId,
  lane: LaneIndex,
  baseZ: number,
  baseY: number = CFG.coins.height,
): CoinPlacement[] {
  const out: CoinPlacement[] = [];
  const x0 = laneToX(lane);
  const clampLane = (l: number) => Math.max(0, Math.min(CFG.laneCount - 1, l));
  const spacing = 1.5;

  switch (pattern) {
    case 'PAT_Straight':
      for (let i = 0; i < 8; i++) out.push({ x: x0, y: baseY, z: baseZ + i * spacing });
      break;
    case 'PAT_Arc':
      // Traces the exact arc of a full-height jump, so collecting it all
      // rewards jumping at the right moment.
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        out.push({ x: x0, y: baseY + Math.sin(t * Math.PI) * 1.5, z: baseZ + i * spacing });
      }
      break;
    case 'PAT_ZigZag':
      for (let i = 0; i < 9; i++) {
        const l = clampLane(lane + (i % 4 < 2 ? 0 : 1) * (lane === CFG.laneCount - 1 ? -1 : 1));
        out.push({ x: laneToX(l), y: baseY, z: baseZ + i * spacing });
      }
      break;
    case 'PAT_LaneSwitch': {
      const target = clampLane(lane + (lane === CFG.laneCount - 1 ? -1 : 1));
      for (let i = 0; i < 10; i++) {
        const t = Math.min(1, Math.max(0, (i - 3) / 3));
        const k = t * t * (3 - 2 * t);
        out.push({ x: x0 + (laneToX(target) - x0) * k, y: baseY, z: baseZ + i * spacing });
      }
      break;
    }
    case 'PAT_JumpTrail':
      for (let i = 0; i < 11; i++) {
        const t = i / 10;
        out.push({ x: x0, y: baseY + Math.max(0, Math.sin(t * Math.PI * 2)) * 1.7, z: baseZ + i * spacing });
      }
      break;
    case 'PAT_Spiral':
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 3;
        out.push({ x: x0 + Math.sin(a) * 0.75, y: baseY + 0.75 + Math.cos(a) * 0.7, z: baseZ + i * 1.25 });
      }
      break;
    case 'PAT_RiskReward': {
      // Dense line hugging the outermost lane: worth more, less room to dodge.
      const edge = lane === 1 ? 0 : lane;
      for (let i = 0; i < 12; i++) out.push({ x: laneToX(edge), y: baseY, z: baseZ + i * 1.15 });
      break;
    }
    case 'PAT_Burst':
      for (let ring = 0; ring < 2; ring++) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          out.push({
            x: x0 + Math.cos(a) * (0.6 + ring * 0.4),
            y: baseY + 0.5 + Math.sin(a) * (0.6 + ring * 0.4),
            z: baseZ + ring * 1.4,
          });
        }
      }
      break;
    case 'PAT_Stair':
      for (let i = 0; i < 8; i++) out.push({ x: x0, y: baseY + i * 0.22, z: baseZ + i * spacing });
      break;
    case 'PAT_Double':
      for (let i = 0; i < 7; i++) {
        out.push({ x: x0 - 0.5, y: baseY, z: baseZ + i * spacing });
        out.push({ x: x0 + 0.5, y: baseY, z: baseZ + i * spacing });
      }
      break;
    case 'PAT_Wave':
      for (let i = 0; i < 12; i++) {
        out.push({ x: x0, y: baseY + 0.5 + Math.sin((i / 12) * Math.PI * 3) * 0.55, z: baseZ + i * 1.3 });
      }
      break;
    case 'PAT_Roof':
      // Sits on top of a train, rewarding a rooftop route.
      for (let i = 0; i < 10; i++) out.push({ x: x0, y: CFG.world.trainRoofHeight + 1.0, z: baseZ + i * 1.6 });
      break;
  }
  return out;
}

/** Highest coin in a pattern, used by the validator to check reachability. */
export function patternMaxHeight(pattern: CoinPatternId): number {
  let max = 0;
  for (const p of expandCoinPattern(pattern, 1, 0)) max = Math.max(max, p.y);
  return max;
}
