import * as THREE from 'three';
import { POWERUP_BY_ID, POWERUP_DEFS } from '../../data/powerups';
import { bus } from '../core/EventBus';
import { CFG } from '../core/Config';
import { ObjectPool } from '../core/ObjectPool';
import { PlannedPowerUp } from '../procedural/ProceduralGenerator';
import { PowerUpDef } from '../core/Types';
import { animatePowerUp, buildPowerUpMesh } from './PowerUpFactory';

/**
 * Owns both halves of the power-up loop: the pickups sitting in the world,
 * and the timed effects they grant. Effects are additive — a shield and a
 * magnet can run at once — and each has its own timer.
 */

interface Pickup {
  def: PowerUpDef;
  x: number;
  y: number;
  z: number;
  object: THREE.Group;
  active: boolean;
}

export interface ActiveEffect {
  def: PowerUpDef;
  remaining: number;
}

export class PowerUpManager {
  readonly root = new THREE.Group();
  private pickups: Pickup[] = [];
  private pools = new Map<string, ObjectPool<THREE.Group>>();
  private active = new Map<string, ActiveEffect>();
  private time = 0;

  /** Consumed by the collision handler; true while a shield can absorb a hit. */
  get shielded(): boolean {
    return this.active.has('PWR_Shield_01');
  }

  get magnetActive(): boolean {
    return this.active.has('PWR_Magnet_01');
  }

  get scoreMultiplier(): number {
    return this.active.has('PWR_Multiplier_01') ? 2 : 1;
  }

  get coinMultiplier(): number {
    return this.active.has('PWR_CoinValue_01') ? 2 : 1;
  }

  get speedMultiplier(): number {
    return this.active.has('PWR_Boost_01') ? 1.42 : 1;
  }

  get effects(): ActiveEffect[] {
    return [...this.active.values()];
  }

  constructor() {
    this.root.name = 'PWR_Root';
    for (const def of POWERUP_DEFS) {
      this.pools.set(
        def.id,
        new ObjectPool<THREE.Group>(
          () => buildPowerUpMesh(def.id),
          (obj) => { obj.visible = true; },
          (obj) => { obj.visible = false; this.root.remove(obj); },
        ),
      );
    }
  }

  spawn(planned: PlannedPowerUp[]): void {
    for (const p of planned) {
      const pool = this.pools.get(p.id);
      if (!pool) continue;
      const object = pool.acquire();
      object.position.set(p.x, p.y, p.z);
      this.root.add(object);
      this.pickups.push({ def: POWERUP_BY_ID[p.id], x: p.x, y: p.y, z: p.z, object, active: true });
    }
  }

  /** Grants an effect, refreshing the timer if it is already running. */
  grant(id: string): void {
    const def = POWERUP_BY_ID[id];
    if (!def) return;
    const existing = this.active.get(id);
    if (existing) existing.remaining = def.duration;
    else this.active.set(id, { def, remaining: def.duration });
    bus.emit('powerup:collect', { id });
  }

  /** Consumes the shield. Returns true if one was available. */
  consumeShield(): boolean {
    if (!this.active.has('PWR_Shield_01')) return false;
    this.active.delete('PWR_Shield_01');
    bus.emit('powerup:expire', { id: 'PWR_Shield_01' });
    bus.emit('shield:absorb', {});
    return true;
  }

  update(dt: number, distance: number, playerX: number, playerY: number, onCollect: (def: PowerUpDef) => void): void {
    this.time += dt;

    // Timers.
    for (const [id, effect] of [...this.active]) {
      effect.remaining -= dt;
      if (effect.remaining <= 0) {
        this.active.delete(id);
        bus.emit('powerup:expire', { id });
      }
    }

    // Pickups.
    const pickupRadiusSq = 1.35 * 1.35;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      const relZ = p.z - distance;
      if (relZ < -CFG.recycleDistance) {
        this.release(i);
        continue;
      }
      p.object.position.z = relZ;
      p.object.visible = relZ < CFG.viewDistance;
      if (p.object.visible) animatePowerUp(p.object, this.time + p.z * 0.1);

      const dx = p.x - playerX;
      const dy = p.y - (playerY + 0.9);
      if (dx * dx + dy * dy + relZ * relZ < pickupRadiusSq) {
        this.grant(p.def.id);
        onCollect(p.def);
        this.release(i);
      }
    }
  }

  private release(index: number): void {
    const p = this.pickups[index];
    this.pools.get(p.def.id)?.release(p.object);
    this.pickups.splice(index, 1);
  }

  clear(): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) this.release(i);
    this.active.clear();
  }

  reset(): void {
    this.clear();
    this.time = 0;
  }
}
