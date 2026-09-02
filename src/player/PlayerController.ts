import * as THREE from 'three';
import { Hero } from '../assets/HeroFactory';
import { CFG, JUMP_AIR_TIME, laneToX } from '../core/Config';
import { ActiveObstacle, CollisionSystem, HitResult, PlayerVolume } from '../core/CollisionSystem';
import { bus } from '../core/EventBus';
import { AnimContext, PlayerAnimator } from './PlayerAnimator';
import { Action, InputManager } from './InputManager';

/**
 * The player never moves in world Z. Distance is a scalar and the world is
 * drawn relative to it, so floating point precision is identical at 10 m and
 * at 100 km.
 */
export interface PlayerState {
  /** Metres travelled since the run began. */
  distance: number;
  speed: number;
  lane: number;
  x: number;
  /** Feet height above the track surface. */
  y: number;
  verticalVelocity: number;
  grounded: boolean;
  sliding: boolean;
  jumping: boolean;
  /** Height of the surface currently underfoot (0, or a train roof). */
  groundY: number;
  alive: boolean;
  stumbles: number;
  invulnerable: number;
}

export interface PlayerHooks {
  /** Returns true if the hit was absorbed (shield) and should not wound. */
  onHit(result: HitResult): boolean;
  onNearMiss(obstacle: ActiveObstacle): void;
  onDeath(cause: string): void;
}

export class PlayerController {
  readonly state: PlayerState = {
    distance: 0,
    speed: 0,
    lane: 1,
    x: 0,
    y: 0,
    verticalVelocity: 0,
    grounded: true,
    sliding: false,
    jumping: false,
    groundY: 0,
    alive: true,
    stumbles: 0,
    invulnerable: 0,
  };

  /** Multiplier applied by the speed-boost power-up. */
  speedMultiplier = 1;

  private targetLane = 1;
  private previousLane = 1;
  private laneT = 1;
  private laneQuick = false;
  private laneDir = 0;

  private slideTimer = 0;
  private airTime = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private runTime = 0;
  private prevDistance = 0;

  private readonly volume: PlayerVolume = {
    x: 0, y: 0, z: 0, halfWidth: CFG.player.halfWidth, height: CFG.player.height, halfDepth: CFG.player.halfDepth,
  };
  private readonly hits: HitResult[] = [];
  private readonly nearMisses: ActiveObstacle[] = [];

  constructor(
    private readonly hero: Hero,
    readonly animator: PlayerAnimator,
    private readonly collision: CollisionSystem,
    private readonly input: InputManager,
    private readonly hooks: PlayerHooks,
  ) {
    this.input.on((action) => this.onAction(action));
  }

  reset(): void {
    const s = this.state;
    s.distance = 0;
    s.speed = CFG.speed.base;
    s.lane = 1;
    s.x = 0;
    s.y = 0;
    s.verticalVelocity = 0;
    s.grounded = true;
    s.sliding = false;
    s.jumping = false;
    s.groundY = 0;
    s.alive = true;
    s.stumbles = 0;
    s.invulnerable = 0;
    this.targetLane = 1;
    this.previousLane = 1;
    this.laneT = 1;
    this.laneDir = 0;
    this.slideTimer = 0;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.runTime = 0;
    this.prevDistance = 0;
    this.speedMultiplier = 1;
    this.animator.reset();
    this.hero.object.position.set(0, 0, 0);
    this.hero.object.rotation.set(0, 0, 0);
  }

  private onAction(action: Action): void {
    if (!this.state.alive) return;
    switch (action) {
      case 'left': this.requestLane(this.targetLane - 1); break;
      case 'right': this.requestLane(this.targetLane + 1); break;
      case 'jump': this.jumpBuffer = CFG.jump.bufferTime; break;
      case 'slide': this.slideBuffer = CFG.jump.bufferTime; break;
      default: break;
    }
  }

  private requestLane(next: number): void {
    const clamped = Math.max(0, Math.min(CFG.laneCount - 1, next));
    if (clamped === this.targetLane) return;
    // A second input mid-move makes the dodge sharper rather than queuing.
    this.laneQuick = this.laneT < 0.6;
    this.previousLane = this.state.lane;
    this.laneDir = Math.sign(clamped - this.targetLane);
    this.targetLane = clamped;
    this.laneT = 0;
    bus.emit('player:laneChange', { from: this.previousLane, to: clamped });
  }

  update(dt: number, cameraDistance: number): void {
    const s = this.state;
    if (!s.alive) {
      this.updateAnimator(dt, cameraDistance);
      return;
    }

    this.runTime += dt;
    s.speed = Math.min(
      CFG.speed.max,
      CFG.speed.base + CFG.speed.acceleration * this.runTime,
    ) * this.speedMultiplier;

    this.prevDistance = s.distance;
    s.distance += s.speed * dt;
    s.invulnerable = Math.max(0, s.invulnerable - dt);

    this.updateLanes(dt);
    this.updateVertical(dt);
    this.updateSlide(dt);
    this.resolveCollisions();
    this.syncTransform();
    this.updateAnimator(dt, cameraDistance);

    bus.emit('distance:changed', { distance: s.distance, speed: s.speed });
  }

  private updateLanes(dt: number): void {
    const s = this.state;
    if (this.laneT < 1) {
      const duration = CFG.player.laneChangeDuration * (this.laneQuick ? 0.72 : 1);
      this.laneT = Math.min(1, this.laneT + dt / duration);
      // Ease-out so the move starts fast and settles cleanly in the lane.
      const k = 1 - Math.pow(1 - this.laneT, 3);
      s.x = laneToX(this.previousLane) + (laneToX(this.targetLane) - laneToX(this.previousLane)) * k;
      if (this.laneT >= 1) {
        s.lane = this.targetLane;
        this.laneDir = 0;
        this.laneQuick = false;
      }
    } else {
      s.x = laneToX(s.lane);
    }
  }

  private updateVertical(dt: number): void {
    const s = this.state;
    const surface = this.collision.groundHeight(s.x, s.distance, s.y);
    s.groundY = surface;

    if (s.grounded) {
      this.coyote = CFG.jump.coyoteTime;
      s.y = surface;
    } else {
      this.coyote = Math.max(0, this.coyote - dt);
      this.airTime += dt;
    }

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.slideBuffer = Math.max(0, this.slideBuffer - dt);

    // Jump: buffered input plus coyote time means a press near the edge of a
    // platform or just before landing still fires.
    if (this.jumpBuffer > 0 && (s.grounded || this.coyote > 0) && !s.sliding) {
      this.jumpBuffer = 0;
      this.coyote = 0;
      s.verticalVelocity = CFG.jump.velocity;
      s.grounded = false;
      s.jumping = true;
      this.airTime = 0;
      this.animator.play('jumpAnticipation');
      bus.emit('player:jump', { speed: s.speed });
    }

    if (!s.grounded) {
      // Releasing jump early cuts the arc, giving variable jump height.
      const cutting = s.verticalVelocity > 0 && !this.input.isHeld('jump');
      const gravity = CFG.jump.gravity * (cutting ? CFG.jump.cutMultiplier : 1);
      const accel = gravity + (s.sliding ? CFG.slide.airSnap : 0);
      // Integrate position with the acceleration term included. Stepping the
      // velocity first and the position second undershoots the apex by
      // v*dt/2, which both lowers the jump below its configured height and
      // makes that height depend on the frame rate — so a player at 30 fps
      // would clear less than one at 60. This form is exact for constant
      // acceleration, and matches the arc the fairness solver proves against.
      s.y += s.verticalVelocity * dt + 0.5 * accel * dt * dt;
      s.verticalVelocity += accel * dt;

      const landingSurface = this.collision.groundHeight(s.x, s.distance, s.y);
      if (s.y <= landingSurface && s.verticalVelocity <= 0) {
        const hard = s.verticalVelocity < -19;
        s.y = landingSurface;
        s.verticalVelocity = 0;
        s.grounded = true;
        s.jumping = false;
        if (!s.sliding) this.animator.play(hard ? 'hardLanding' : 'landing', true);
        bus.emit('player:land', { hard, speed: s.speed });
      } else if (s.jumping && this.animator.currentState === 'airborne') {
        // stay airborne
      } else if (this.animator.currentState !== 'jumpAnticipation' && this.animator.currentState !== 'jumpTakeoff' && !s.sliding) {
        this.animator.play('airborne');
      }
    } else {
      // Walked off a roof edge.
      if (s.y > surface + 0.02) {
        s.grounded = false;
        s.verticalVelocity = 0;
        this.airTime = 0;
      }
    }
  }

  private updateSlide(dt: number): void {
    const s = this.state;
    if (this.slideBuffer > 0 && !s.sliding) {
      this.slideBuffer = 0;
      s.sliding = true;
      this.slideTimer = 0;
      this.animator.play('slide', true);
      bus.emit('player:slide', { speed: s.speed });
    }
    if (s.sliding) {
      this.slideTimer += dt;
      // Cancelling a slide with a jump is allowed the moment the player is
      // grounded again, which keeps chained obstacles readable.
      if (this.jumpBuffer > 0 && s.grounded) {
        this.endSlide();
        return;
      }
      if (this.slideTimer >= CFG.slide.duration) this.endSlide();
    }
  }

  private endSlide(): void {
    this.state.sliding = false;
    this.slideTimer = 0;
    this.animator.play('slideRecover', true);
  }

  private resolveCollisions(): void {
    const s = this.state;
    this.volume.x = s.x;
    this.volume.y = s.y;
    this.volume.z = s.distance;
    this.volume.height = s.sliding ? CFG.slide.height : CFG.player.height;
    this.volume.halfDepth = s.sliding ? CFG.slide.halfDepth : CFG.player.halfDepth;

    this.collision.queryNearMisses(this.volume, this.prevDistance, this.nearMisses);
    for (const obstacle of this.nearMisses) this.hooks.onNearMiss(obstacle);

    if (s.invulnerable > 0) return;
    this.collision.queryHits(this.volume, this.hits);
    if (this.hits.length === 0) return;

    // Take the deepest overlap as the authoritative hit.
    let worst = this.hits[0];
    for (const hit of this.hits) if (hit.overlapX > worst.overlapX) worst = hit;
    worst.obstacle.hit = true;

    if (this.hooks.onHit(worst)) {
      // Shield absorbed it: keep running, brief invulnerability.
      s.invulnerable = CFG.player.stumbleInvuln;
      this.animator.play('hit');
      return;
    }

    const fatal = !worst.grazing || s.stumbles >= CFG.player.stumbleAllowance;
    bus.emit('player:hit', { obstacle: worst.obstacle.def.id, fatal });

    if (!fatal) {
      s.stumbles++;
      s.invulnerable = CFG.player.stumbleInvuln;
      // Losing speed on a graze is the cost, rather than an instant loss.
      this.runTime = Math.max(0, this.runTime - 9);
      this.animator.play('stumble', true);
      bus.emit('player:stumble', { obstacle: worst.obstacle.def.id });
      return;
    }

    this.kill(worst.obstacle.def.category === 'overhead' ? 'collapse' : 'front', worst.obstacle.def.id);
  }

  kill(cause: 'front' | 'side' | 'collapse', reason: string): void {
    if (!this.state.alive) return;
    this.state.alive = false;
    this.state.sliding = false;
    this.animator.playDeath(cause);
    this.hooks.onDeath(reason);
  }

  private syncTransform(): void {
    const s = this.state;
    this.hero.object.position.set(s.x, s.y, 0);
    // A slight body yaw into the lane change sells the direction change.
    //
    // The base is a half turn: the model is authored facing -Z, and the world
    // streams from +Z, so the runner has to face +Z to be running into it
    // rather than away from it. The yaw is negated against that turn so the
    // shoulders still lead into the lane the player is moving to.
    const yaw = this.laneT < 1 ? -this.laneDir * 0.22 * Math.sin(this.laneT * Math.PI) : 0;
    this.hero.object.rotation.y = Math.PI - yaw;
  }

  private readonly animContext: AnimContext = {
    speed: 0, grounded: true, verticalVelocity: 0, airProgress: 0,
    slideProgress: 0, laneDir: 0, laneProgress: 1, laneQuick: false, cameraDistance: 0,
  };

  private updateAnimator(dt: number, cameraDistance: number): void {
    const s = this.state;
    const ctx = this.animContext;
    ctx.speed = s.alive ? s.speed : 0;
    ctx.grounded = s.grounded;
    ctx.verticalVelocity = s.verticalVelocity;
    ctx.airProgress = Math.min(1, this.airTime / JUMP_AIR_TIME);
    ctx.slideProgress = Math.min(1, this.slideTimer / CFG.slide.duration);
    ctx.laneDir = this.laneDir;
    ctx.laneProgress = this.laneT;
    ctx.laneQuick = this.laneQuick;
    ctx.cameraDistance = cameraDistance;
    this.animator.update(dt, ctx);
  }

  /** Player-space collision volume, exposed for the magnet and debug draw. */
  get collisionVolume(): Readonly<PlayerVolume> {
    return this.volume;
  }

  /** World position used by VFX and audio emitters. */
  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.state.x, this.state.y, 0);
  }
}
