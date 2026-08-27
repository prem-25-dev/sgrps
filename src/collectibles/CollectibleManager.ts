import * as THREE from 'three';
import { CFG } from '../core/Config';
import { bus } from '../core/EventBus';
import { PlannedCoin } from '../procedural/ProceduralGenerator';
import { coinGeometry, coinMaterial } from './CoinFactory';

/**
 * Every coin in the world is one instance of a single InstancedMesh, so the
 * whole collectible layer costs one draw call no matter how many are on
 * screen. Magnet attraction and pickup run on plain numbers.
 */

interface Coin {
  /** Absolute track Z. */
  z: number;
  x: number;
  y: number;
  /** Live position while being pulled by the magnet. */
  cx: number;
  cy: number;
  cz: number;
  active: boolean;
  attracting: boolean;
  spin: number;
}

const MAX_COINS = 420;

export class CollectibleManager {
  readonly mesh: THREE.InstancedMesh;
  private coins: Coin[] = [];
  private free: number[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly pos = new THREE.Vector3();
  private readonly hidden = new THREE.Vector3(0, -900, 0);
  private time = 0;

  /** Set by the magnet power-up. */
  magnetActive = false;
  /** Set by the coin-value power-up. */
  valueMultiplier = 1;

  constructor() {
    this.mesh = new THREE.InstancedMesh(coinGeometry(), coinMaterial(), MAX_COINS);
    this.mesh.name = 'COL_Coins';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < MAX_COINS; i++) {
      this.coins.push({ z: 0, x: 0, y: 0, cx: 0, cy: 0, cz: 0, active: false, attracting: false, spin: 0 });
      this.free.push(i);
      this.matrix.compose(this.hidden, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get liveCount(): number {
    return MAX_COINS - this.free.length;
  }

  /** Adds a batch of coins from a generated segment. */
  spawn(planned: PlannedCoin[]): void {
    for (const p of planned) {
      const i = this.free.pop();
      if (i === undefined) return;
      const coin = this.coins[i];
      coin.x = p.x;
      coin.y = p.y;
      coin.z = p.z;
      coin.cx = p.x;
      coin.cy = p.y;
      coin.cz = p.z;
      coin.active = true;
      coin.attracting = false;
      // Stagger the spin so a row of coins does not flash in unison.
      coin.spin = (p.z * 0.7 + p.x * 1.3) % (Math.PI * 2);
    }
  }

  /** Releases coins that have fallen behind the player. */
  private recycle(index: number): void {
    const coin = this.coins[index];
    if (!coin.active) return;
    coin.active = false;
    this.free.push(index);
    this.matrix.compose(this.hidden, this.quat, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }

  clear(): void {
    for (let i = 0; i < MAX_COINS; i++) this.recycle(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.magnetActive = false;
    this.valueMultiplier = 1;
  }

  /**
   * Runs pickup, magnet attraction and the render transform in one pass.
   * Returns how many coins were collected this frame.
   */
  update(
    dt: number,
    distance: number,
    playerX: number,
    playerY: number,
    onCollect: (x: number, y: number, z: number) => void,
  ): number {
    this.time += dt;
    let collected = 0;
    const magnetRadiusSq = CFG.coins.magnetRadius * CFG.coins.magnetRadius;
    const pickupSq = CFG.coins.pickupRadius * CFG.coins.pickupRadius;
    const targetY = playerY + 0.9;

    for (let i = 0; i < MAX_COINS; i++) {
      const coin = this.coins[i];
      if (!coin.active) continue;

      // Relative Z: negative is ahead of the player.
      const relZ = coin.cz - distance;
      if (relZ < -CFG.recycleDistance) {
        this.recycle(i);
        continue;
      }
      if (relZ > CFG.viewDistance + 20) {
        // Not visible yet; park it out of sight without spending maths on it.
        this.matrix.compose(this.hidden, this.quat, this.scale);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }

      const dx = coin.cx - playerX;
      const dy = coin.cy - targetY;
      const dSq = dx * dx + dy * dy + relZ * relZ;

      if (this.magnetActive && dSq < magnetRadiusSq) {
        coin.attracting = true;
      }
      if (coin.attracting) {
        // Ease toward the player; speed climbs as it gets closer so the pull
        // reads as magnetic rather than linear.
        const dist = Math.sqrt(dSq) || 1;
        const pull = CFG.coins.magnetSpeed * dt * (1 + (CFG.coins.magnetRadius - dist) / CFG.coins.magnetRadius);
        const k = Math.min(1, pull / dist);
        coin.cx += (playerX - coin.cx) * k;
        coin.cy += (targetY - coin.cy) * k;
        coin.cz += (distance - coin.cz) * k;
      }

      if (dSq < pickupSq) {
        onCollect(coin.cx, coin.cy, relZ);
        collected++;
        this.recycle(i);
        continue;
      }

      this.pos.set(coin.cx, coin.cy + Math.sin(this.time * 2.4 + coin.spin) * 0.06, coin.cz - distance);
      this.quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.time * 2.6 + coin.spin);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    return collected;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Emits the collect event with the combo attached. */
export function emitCoinCollect(value: number, combo: number, x: number, y: number, z: number): void {
  bus.emit('coin:collect', { value, combo, position: [x, y, z] });
}
