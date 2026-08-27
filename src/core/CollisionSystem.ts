import * as THREE from 'three';
import { ObstacleDef } from './Types';
import { CFG } from './Config';

/**
 * Gameplay collision runs on simple analytic volumes, entirely separate from
 * the render meshes. Nothing here touches geometry, so a 40k-triangle train
 * costs exactly the same to collide with as a crate.
 */

export interface ActiveObstacle {
  def: ObstacleDef;
  /** Absolute track Z of the obstacle centre, metres from the run start. */
  z: number;
  lane: number;
  x: number;
  /** Track surface height this obstacle sits on. */
  baseY: number;
  object: THREE.Object3D;
  /** Metres per second along Z for moving hazards; positive = toward player. */
  driftZ: number;
  /** Lateral drift for sliding hazards. */
  driftX: number;
  /** Key this instance was acquired from the pool with. */
  poolKey: string;
  hit: boolean;
  nearMissed: boolean;
  /** Set when the obstacle has passed the player and can be scored. */
  passed: boolean;
}

export interface PlayerVolume {
  x: number;
  /** Feet height. */
  y: number;
  z: number;
  halfWidth: number;
  height: number;
  halfDepth: number;
}

export interface HitResult {
  obstacle: ActiveObstacle;
  /** How far the player penetrated horizontally; drives stumble vs fatal. */
  overlapX: number;
  /** True when the player clipped the top edge only. */
  grazing: boolean;
}

/**
 * Walkable height of an obstacle at a given track Z. Ramps rise linearly
 * across their run; everything else is flat. This must stay identical to the
 * fairness solver's model, otherwise a segment proved survivable offline
 * could still kill the player at runtime.
 */
function surfaceOf(o: ActiveObstacle, z: number): number {
  const halfD = o.def.depth / 2;
  const top = o.baseY + o.def.yOffset + o.def.height / 2;
  if (!o.def.slope) return top;
  const t = Math.min(1, Math.max(0, (z - (o.z - halfD)) / o.def.depth));
  return o.baseY + top * t;
}

function obstacleBounds(o: ActiveObstacle): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const halfW = o.def.width / 2;
  const halfD = o.def.depth / 2;
  const centreY = o.baseY + o.def.yOffset;
  return {
    minX: o.x - halfW,
    maxX: o.x + halfW,
    minY: centreY - o.def.height / 2,
    maxY: centreY + o.def.height / 2,
    minZ: o.z - halfD,
    maxZ: o.z + halfD,
  };
}

export class CollisionSystem {
  /** Obstacles currently in the simulation window, sorted by Z. */
  private obstacles: ActiveObstacle[] = [];

  setObstacles(list: ActiveObstacle[]): void {
    this.obstacles = list;
  }

  get active(): readonly ActiveObstacle[] {
    return this.obstacles;
  }

  /**
   * Highest standable surface under the player. Train roofs and platform decks
   * become real floors, which is what makes rooftop routes possible.
   */
  groundHeight(x: number, z: number, feetY: number): number {
    let best: number = CFG.world.groundY;
    for (const o of this.obstacles) {
      if (!o.def.standable && !o.def.slope) continue;
      const b = obstacleBounds(o);
      if (z < b.minZ - 0.2 || z > b.maxZ + 0.2) continue;
      if (x < b.minX - 0.1 || x > b.maxX + 0.1) continue;
      const top = surfaceOf(o, z);
      // Only snap onto a surface the player is at or above.
      if (top <= feetY + 0.34 && top > best) best = top;
    }
    return best;
  }

  /** All obstacles overlapping the player volume this frame. */
  queryHits(p: PlayerVolume, out: HitResult[]): HitResult[] {
    out.length = 0;
    const pMinX = p.x - p.halfWidth;
    const pMaxX = p.x + p.halfWidth;
    const pMinY = p.y;
    const pMaxY = p.y + p.height;
    const pMinZ = p.z - p.halfDepth;
    const pMaxZ = p.z + p.halfDepth;

    for (const o of this.obstacles) {
      if (o.hit) continue;
      const b = obstacleBounds(o);
      if (b.maxZ < pMinZ || b.minZ > pMaxZ) continue;
      if (b.maxX < pMinX || b.minX > pMaxX) continue;
      // A ramp is only solid below its slope where the player actually is.
      const top = o.def.slope ? surfaceOf(o, pMaxZ) : b.maxY;
      if (top < pMinY || b.minY > pMaxY) continue;
      // Standing on top of a standable surface is not a collision.
      if ((o.def.standable || o.def.slope) && pMinY >= top - 0.14) continue;
      const overlapX = Math.min(pMaxX, b.maxX) - Math.max(pMinX, b.minX);
      const overlapY = Math.min(pMaxY, top) - Math.max(pMinY, b.minY);
      out.push({ obstacle: o, overlapX, grazing: overlapY < 0.14 || overlapX < 0.1 });
    }
    return out;
  }

  /**
   * Near misses: obstacles the player passed this frame without touching, close
   * enough to feel dangerous. Scoring these is what rewards risky lanes.
   */
  queryNearMisses(p: PlayerVolume, prevZ: number, out: ActiveObstacle[]): ActiveObstacle[] {
    out.length = 0;
    for (const o of this.obstacles) {
      if (o.nearMissed || o.hit) continue;
      const b = obstacleBounds(o);
      // Did the player cross the obstacle's centre plane this frame?
      if (!(prevZ > o.z && p.z <= o.z)) continue;
      o.passed = true;
      const gapX = Math.max(0, Math.max(b.minX - (p.x + p.halfWidth), (p.x - p.halfWidth) - b.maxX));
      const clearedOver = p.y >= b.maxY - 0.05 && b.maxY > CFG.world.groundY + 0.15;
      const clearedUnder = p.y + p.height <= b.minY + 0.12 && b.minY > 0.4;
      const closeLaterally = gapX > 0 && gapX < CFG.player.nearMissRadius;
      if (closeLaterally || clearedOver || clearedUnder) {
        o.nearMissed = true;
        out.push(o);
      }
    }
    return out;
  }
}
