import * as THREE from 'three';
import { CFG } from '../core/Config';
import { PlayerState } from '../player/PlayerController';

/**
 * Third-person chase camera. Everything is exponential smoothing on a
 * half-life, so behaviour is frame-rate independent and never overshoots.
 */
export class CameraController {
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();

  private shake = 0;
  private shakeSeed = Math.random() * 1000;
  private impact = 0;
  private lean = 0;
  private fov = CFG.camera.baseFov;
  private slowMotion = 1;
  private cinematic = 0;
  private time = 0;

  /** Set false during menus so the camera can be posed manually. */
  following = true;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.fov = CFG.camera.baseFov;
    camera.near = CFG.camera.near;
    camera.far = CFG.camera.far;
    camera.updateProjectionMatrix();
    // The world streams from +Z: `TrackManager` draws everything ahead of the
    // player at `absoluteZ - distance`, so an obstacle 50 m away sits at +50.
    // The camera therefore trails at -Z and looks toward +Z. It used to do the
    // exact opposite, which put every obstacle behind the camera.
    this.position.set(0, CFG.camera.height, -CFG.camera.distance);
    this.lookAt.set(0, CFG.camera.lookHeight, CFG.camera.lookAhead);
    camera.position.copy(this.position);
    camera.lookAt(this.lookAt);
  }

  reset(): void {
    this.shake = 0;
    this.impact = 0;
    this.lean = 0;
    this.cinematic = 0;
    this.slowMotion = 1;
    this.fov = CFG.camera.baseFov;
    this.following = true;
  }

  /** Landing thump; magnitude 0..1. */
  addImpact(strength: number): void {
    this.impact = Math.min(1.4, this.impact + strength);
  }

  /** Brief handheld shake, used for near misses and collisions. */
  addShake(strength: number): void {
    this.shake = Math.min(1.2, this.shake + strength);
  }

  /** Slides into the game-over orbit. */
  startGameOverShot(): void {
    this.cinematic = 1;
    this.slowMotion = 0.35;
  }

  get timeScale(): number {
    return this.slowMotion;
  }

  /**
   * Menu framing: a three-quarter portrait from the front.
   *
   * The hero runs toward +Z, so the camera has to sit on the positive Z side
   * to see their face; it drifts slowly around that axis.
   */
  poseForMenu(dt: number, heroHeight: number): void {
    this.following = false;
    this.time += dt;
    const orbit = 0.55 + Math.sin(this.time * 0.18) * 0.28;
    const radius = 2.9;
    this.desired.set(Math.sin(orbit) * radius, heroHeight * 0.66, Math.cos(orbit) * radius);
    this.desiredLook.set(0, heroHeight * 0.55, 0);
    this.smooth(dt, 0.5);
    this.fov += (46 - this.fov) * (1 - Math.exp(-dt / 0.35));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  update(dt: number, player: PlayerState): void {
    this.time += dt;
    this.following = true;

    const speedT = Math.min(1, Math.max(0, (player.speed - CFG.speed.base) / (CFG.speed.max - CFG.speed.base)));

    // Pull back and rise a touch as speed climbs so the road ahead stays visible.
    // Negative: the camera trails the player, and ahead is +Z.
    const distance = -(CFG.camera.distance + speedT * 1.35 + this.cinematic * 1.2);
    const height = CFG.camera.height + player.y * 0.55 + speedT * 0.35;

    // Lane lean: the rig drifts opposite the movement, which reads as weight.
    const targetLean = (player.x / (CFG.laneWidth * 1.0)) * CFG.camera.laneLean;
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-dt / 0.12));

    // Sliding drops the camera to sell the low silhouette.
    const slideDrop = player.sliding ? 0.85 : 0;

    this.desired.set(
      player.x * 0.62,
      height - slideDrop * 0.5 - this.impact * 0.42,
      distance,
    );
    this.desiredLook.set(
      player.x * 0.85,
      player.y + CFG.camera.lookHeight - slideDrop * 0.45 + this.impact * 0.18,
      CFG.camera.lookAhead + speedT * 3.2,
    );

    if (this.cinematic > 0) {
      // Game over: swing round to the front of the hero.
      const swing = Math.min(1, this.cinematic);
      this.desired.x += Math.sin(this.time * 0.9) * 2.4 * swing;
      // Round to the front of the hero, who faces +Z.
      this.desired.z += 4.2 * swing;
      this.desired.y += 0.6 * swing;
      this.desiredLook.z = 1.2;
      this.cinematic = Math.min(1.6, this.cinematic + dt * 0.6);
      this.slowMotion += (1 - this.slowMotion) * (1 - Math.exp(-dt / 2.4));
    }

    this.smooth(dt, CFG.camera.smoothing);

    // Never let the camera sink through the deck or a train roof.
    const floor = player.groundY + 0.85;
    if (this.position.y < floor) this.position.y = floor;

    this.impact = Math.max(0, this.impact - dt * 3.4);
    this.shake = Math.max(0, this.shake - dt * 2.6);

    const targetFov = CFG.camera.baseFov + speedT * CFG.camera.maxFovBoost + this.impact * 3.5;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt / 0.22));

    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.position);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.16;
      this.camera.position.x += this.noise(this.time * 34) * s;
      this.camera.position.y += this.noise(this.time * 29 + 11) * s;
    }
    this.camera.lookAt(this.lookAt);
    this.camera.rotation.z += this.lean;
  }

  private smooth(dt: number, halfLife: number): void {
    const k = 1 - Math.exp(-dt / Math.max(0.001, halfLife));
    this.position.lerp(this.desired, k);
    this.lookAt.lerp(this.desiredLook, Math.min(1, k * 1.35));
  }

  private noise(t: number): number {
    const s = Math.sin(t * 12.9898 + this.shakeSeed) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
