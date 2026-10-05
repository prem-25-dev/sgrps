import * as THREE from 'three';
import { CFG } from '../core/Config';
import { bus } from '../core/EventBus';
import { material } from '../assets/MaterialLibrary';
import { ParticleSystem } from './ParticleSystem';

/**
 * VFX_* library. Every effect is an emitter preset on the shared particle
 * system, plus a small number of mesh-based effects (shield bubble, speed
 * lines) that need geometry rather than points.
 */

/**
 * Every effect the game can play.
 *
 * A list rather than a bare union so the catalogue can be enumerated: the
 * only way an effect that quietly stopped emitting would be noticed is by
 * playing each one and counting particles. `VFXId` is derived from it, so
 * adding an effect to the type is the same act as adding it to the coverage.
 */
export const VFX_IDS = [
  'VFX_CoinPickup', 'VFX_CoinTrail', 'VFX_CoinAttract',
  'VFX_JumpDust', 'VFX_LandDust', 'VFX_HardLandDust', 'VFX_FootstepDust',
  'VFX_SlideSparks', 'VFX_SpeedLines', 'VFX_Boost',
  'VFX_ShieldImpact', 'VFX_ShieldPickup', 'VFX_MagnetField',
  'VFX_PowerUpPickup', 'VFX_NearMiss', 'VFX_Collision',
  'VFX_TrainSparks', 'VFX_ElectricSpark', 'VFX_Smoke', 'VFX_Steam',
  'VFX_Debris', 'VFX_NeonGlow', 'VFX_MissionComplete',
] as const;

export type VFXId = typeof VFX_IDS[number];

export class VFXManager {
  readonly particles = new ParticleSystem();
  readonly root = new THREE.Group();

  private speedLines: THREE.Points;
  private speedLineAlpha = 0;
  private shieldBubble: THREE.Mesh;
  private magnetRing: THREE.Mesh;
  private time = 0;
  private reducedMotion = false;
  private intensity = 1;

  constructor() {
    this.root.name = 'VFX_Root';
    this.root.add(this.particles.points);

    this.speedLines = this.buildSpeedLines();
    this.root.add(this.speedLines);

    const shieldMat = material('MAT_Shield').clone();
    shieldMat.opacity = 0.2;
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.2, 22, 16), shieldMat);
    this.shieldBubble.name = 'VFX_ShieldBubble';
    this.shieldBubble.visible = false;
    this.root.add(this.shieldBubble);

    const magnetMat = material('MAT_Magnet').clone();
    magnetMat.transparent = true;
    magnetMat.opacity = 0.28;
    magnetMat.depthWrite = false;
    this.magnetRing = new THREE.Mesh(new THREE.TorusGeometry(CFG.coins.magnetRadius * 0.55, 0.06, 6, 40), magnetMat);
    this.magnetRing.rotation.x = Math.PI / 2;
    this.magnetRing.name = 'VFX_MagnetField';
    this.magnetRing.visible = false;
    this.root.add(this.magnetRing);

    this.bindEvents();
  }

  setQuality(reducedMotion: boolean, intensity: number): void {
    this.reducedMotion = reducedMotion;
    this.intensity = intensity;
    this.speedLines.visible = !reducedMotion;
  }

  setPixelRatio(ratio: number): void {
    this.particles.setPixelRatio(ratio);
  }

  /** Long thin streaks that only appear at high speed. */
  private buildSpeedLines(): THREE.Points {
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3.5 + Math.random() * 7;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.6 + Math.sin(a) * r * 0.55;
      positions[i * 3 + 2] = -Math.random() * 90;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const mat = new THREE.PointsMaterial({
      color: 0xdff4ff,
      size: 0.22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.name = 'VFX_SpeedLines';
    return points;
  }

  private bindEvents(): void {
    bus.on('coin:collect', ({ position, combo }) => {
      this.play('VFX_CoinPickup', position[0], position[1], position[2], 0.6 + Math.min(1, combo / 20));
    });
    bus.on('player:jump', () => this.play('VFX_JumpDust', 0, 0, 0, 1));
    bus.on('player:land', ({ hard }) => this.play(hard ? 'VFX_HardLandDust' : 'VFX_LandDust', 0, 0, 0, 1));
    bus.on('player:footstep', ({ speed }) => {
      if (speed > 8) this.play('VFX_FootstepDust', 0, 0, 0, Math.min(1, speed / 24));
    });
    bus.on('player:nearMiss', () => this.play('VFX_NearMiss', 0, 1.1, 0, 1));
    bus.on('player:hit', () => this.play('VFX_Collision', 0, 1.0, -0.4, 1));
    bus.on('shield:absorb', () => this.play('VFX_ShieldImpact', 0, 1.0, -0.3, 1));
    bus.on('powerup:collect', () => this.play('VFX_PowerUpPickup', 0, 1.2, 0, 1));
    bus.on('mission:complete', () => this.play('VFX_MissionComplete', 0, 1.6, -1, 1));
  }

  /** Fires one effect. Positions are in player-relative world space. */
  play(id: VFXId, x: number, y: number, z: number, scale = 1): void {
    if (this.reducedMotion && id !== 'VFX_CoinPickup' && id !== 'VFX_PowerUpPickup') return;
    const s = scale * this.intensity;

    switch (id) {
      case 'VFX_CoinPickup':
        this.particles.emit({
          x, y, z, count: Math.round(10 * s), size: 0.16, life: 0.42,
          color: 0xffe9a8, colorEnd: 0xff9a1f, speed: 2.6, spread: 1, gravity: -3.5, drag: 2.4,
        });
        break;
      case 'VFX_CoinTrail':
        this.particles.emit({
          x, y, z, count: 2, size: 0.1, life: 0.3, color: 0xffd86b, colorEnd: 0xffa020,
          speed: 0.5, spread: 0.6, gravity: 0, drag: 1.6,
        });
        break;
      case 'VFX_CoinAttract':
        this.particles.emit({
          x, y, z, count: 3, size: 0.09, life: 0.24, color: 0xff7a4a, colorEnd: 0xffd86b,
          speed: 1.2, spread: 0.5, gravity: 0, drag: 1.2,
        });
        break;
      case 'VFX_JumpDust':
        this.particles.emit({
          x, y: y + 0.05, z, count: Math.round(14 * s), size: 0.3, life: 0.55,
          color: 0xa9a08e, colorEnd: 0x5d574c, vy: 1.4, speed: 2.2, spread: 1.4, gravity: -5, drag: 2.2,
        });
        break;
      case 'VFX_LandDust':
        this.particles.emit({
          x, y: y + 0.04, z, count: Math.round(16 * s), size: 0.34, life: 0.6,
          color: 0xb3aa97, colorEnd: 0x5d574c, vy: 0.9, speed: 3.0, spread: 2.2, gravity: -4, drag: 2.6,
        });
        break;
      case 'VFX_HardLandDust':
        this.particles.emit({
          x, y: y + 0.04, z, count: Math.round(30 * s), size: 0.45, life: 0.8,
          color: 0xc4bba6, colorEnd: 0x4f4a41, vy: 1.2, speed: 4.6, spread: 3.0, gravity: -4, drag: 2.2,
        });
        break;
      case 'VFX_FootstepDust':
        this.particles.emit({
          x: x + (Math.random() - 0.5) * 0.3, y: y + 0.03, z, count: 3, size: 0.17, life: 0.34,
          color: 0x9a927f, colorEnd: 0x54503f, vy: 0.5, speed: 1.1, spread: 1.0, gravity: -3, drag: 3,
        });
        break;
      case 'VFX_SlideSparks':
        this.particles.emit({
          x, y: y + 0.08, z: z + 0.3, count: Math.round(6 * s), size: 0.13, life: 0.35,
          color: 0xffd27a, colorEnd: 0xff5a1a, vz: 5, vy: 1.2, speed: 2.4, spread: 0.7, gravity: -14, drag: 1.2,
        });
        break;
      case 'VFX_Boost':
        this.particles.emit({
          x, y: y + 0.9, z: z + 0.6, count: Math.round(8 * s), size: 0.26, life: 0.42,
          color: 0x9dffdc, colorEnd: 0x1f8f6a, vz: 9, speed: 1.6, spread: 1.0, gravity: 0, drag: 1.6,
        });
        break;
      case 'VFX_ShieldImpact':
        this.particles.emit({
          x, y, z, count: Math.round(26 * s), size: 0.2, life: 0.5,
          color: 0xd6f8ff, colorEnd: 0x2aa6d8, speed: 5.5, spread: 1.6, gravity: -2, drag: 2.4,
        });
        break;
      case 'VFX_ShieldPickup':
      case 'VFX_PowerUpPickup':
        this.particles.emit({
          x, y, z, count: Math.round(22 * s), size: 0.22, life: 0.6,
          color: 0xffffff, colorEnd: 0x63e8ff, speed: 3.6, spread: 1.5, gravity: -1.5, drag: 2.0,
        });
        break;
      case 'VFX_MagnetField':
        this.particles.emit({
          x, y: y + 0.8, z, count: 2, size: 0.12, life: 0.5,
          color: 0xff6a4a, colorEnd: 0xffd0a0, speed: 2.4, spread: 1.6, gravity: 0, drag: 1.0,
        });
        break;
      case 'VFX_NearMiss':
        this.particles.emit({
          x, y, z, count: Math.round(12 * s), size: 0.18, life: 0.36,
          color: 0xffffff, colorEnd: 0x51fff0, speed: 4.4, spread: 1.2, gravity: 0, drag: 3.2,
        });
        break;
      case 'VFX_Collision':
        this.particles.emit({
          x, y, z, count: Math.round(34 * s), size: 0.24, life: 0.7,
          color: 0xffd9a0, colorEnd: 0x8a3a1a, speed: 6.5, spread: 2.0, gravity: -11, drag: 1.6,
        });
        this.particles.emit({
          x, y, z, count: Math.round(18 * s), size: 0.4, life: 0.9,
          color: 0x8a8378, colorEnd: 0x2a2724, speed: 2.4, spread: 2.4, gravity: -1.5, drag: 2.6,
        });
        break;
      case 'VFX_TrainSparks':
      case 'VFX_ElectricSpark':
        this.particles.emit({
          x, y, z, count: Math.round(10 * s), size: 0.11, life: 0.4,
          color: 0xdff2ff, colorEnd: 0x3a7fd8, speed: 7, spread: 1.4, gravity: -18, drag: 1.0,
        });
        break;
      case 'VFX_Smoke':
        this.particles.emit({
          x, y, z, count: Math.round(6 * s), size: 0.7, life: 1.8,
          color: 0x6b6659, colorEnd: 0x2a2823, vy: 1.0, speed: 0.7, spread: 1.0, gravity: 0.4, drag: 0.8,
        });
        break;
      case 'VFX_Steam':
        this.particles.emit({
          x, y, z, count: Math.round(8 * s), size: 0.6, life: 1.3,
          color: 0xe8eef2, colorEnd: 0x9fb0bb, vy: 2.0, speed: 0.9, spread: 0.8, gravity: 0.8, drag: 1.2,
        });
        break;
      case 'VFX_Debris':
        this.particles.emit({
          x, y, z, count: Math.round(14 * s), size: 0.15, life: 1.0,
          color: 0x9a8f7a, colorEnd: 0x4a443a, speed: 5, spread: 1.8, gravity: -16, drag: 0.7,
        });
        break;
      case 'VFX_NeonGlow':
        this.particles.emit({
          x, y, z, count: 3, size: 0.4, life: 1.4,
          color: 0xff3ea8, colorEnd: 0x51fff0, speed: 0.4, spread: 1.2, gravity: 0.2, drag: 0.6,
        });
        break;
      case 'VFX_MissionComplete':
        this.particles.emit({
          x, y, z, count: Math.round(40 * s), size: 0.2, life: 1.2,
          color: 0xffe9a8, colorEnd: 0xff3ea8, speed: 5.5, spread: 2.4, gravity: -4, drag: 1.4,
        });
        break;
    }
  }

  setShield(active: boolean): void {
    this.shieldBubble.visible = active;
  }

  setMagnet(active: boolean): void {
    this.magnetRing.visible = active && !this.reducedMotion;
  }

  /**
   * `worldShift` is the metres the player advanced this frame; particles are
   * pushed backwards by it so they stay planted in the world.
   */
  update(dt: number, worldShift: number, playerX: number, playerY: number, speedT: number): void {
    this.time += dt;
    this.particles.update(dt, worldShift);

    this.shieldBubble.position.set(playerX, playerY + 0.95, 0);
    this.shieldBubble.rotation.y += dt * 0.9;
    const shieldMat = this.shieldBubble.material as THREE.MeshStandardMaterial;
    shieldMat.opacity = 0.16 + Math.sin(this.time * 4) * 0.05;

    this.magnetRing.position.set(playerX, playerY + 0.4, 0);
    this.magnetRing.rotation.z += dt * 1.6;
    this.magnetRing.scale.setScalar(1 + Math.sin(this.time * 3.2) * 0.06);

    // Speed lines fade in over the top third of the speed range.
    const target = Math.max(0, (speedT - 0.55) / 0.45) * 0.5;
    this.speedLineAlpha += (target - this.speedLineAlpha) * Math.min(1, dt * 4);
    (this.speedLines.material as THREE.PointsMaterial).opacity = this.speedLineAlpha;
    this.speedLines.position.x = playerX * 0.4;
  }

  reset(): void {
    this.particles.clear();
    this.shieldBubble.visible = false;
    this.magnetRing.visible = false;
    this.speedLineAlpha = 0;
  }

  get liveParticles(): number {
    return this.particles.live;
  }

  dispose(): void {
    this.particles.dispose();
    this.speedLines.geometry.dispose();
    (this.speedLines.material as THREE.Material).dispose();
  }
}
