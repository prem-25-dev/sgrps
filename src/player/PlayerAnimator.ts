import * as THREE from 'three';
import { Hero, HeroLod } from '../assets/HeroFactory';
import { REFERENCE_HEIGHT } from '../assets/HeroRig';
import { CFG } from '../core/Config';
import { bus } from '../core/EventBus';
import * as clips from './AnimationClips';
import { GaitParams } from './AnimationClips';
import { BONE_INDEX, Pose } from './Pose';

/**
 * Drives the hero rig. Owns clip selection, crossfading, additive layers,
 * a foot-contact pass, and the LOD swap.
 */

export type AnimState =
  | 'idle' | 'idleA' | 'idleB'
  | 'locomotion'
  | 'jumpAnticipation' | 'jumpTakeoff' | 'airborne' | 'landing' | 'hardLanding'
  | 'slide' | 'slideRecover'
  | 'stumble' | 'trip' | 'hit' | 'knockback' | 'recover'
  | 'deathForward' | 'deathSideways' | 'deathCollapse'
  | 'menuIdle' | 'menuGesture' | 'victory' | 'celebration';

interface StateDef {
  /** Seconds; 0 means the state is driven externally (locomotion, airborne). */
  duration: number;
  /** Crossfade in, seconds. */
  fade: number;
  /** State to fall back to when a one-shot finishes. */
  next?: AnimState;
  /** One-shots outrank locomotion and cannot be interrupted by it. */
  priority: number;
}

const STATES: Record<AnimState, StateDef> = {
  idle: { duration: 0, fade: 0.25, priority: 0 },
  idleA: { duration: 4.5, fade: 0.4, next: 'idle', priority: 0 },
  idleB: { duration: 4.0, fade: 0.4, next: 'idle', priority: 0 },
  locomotion: { duration: 0, fade: 0.18, priority: 0 },
  jumpAnticipation: { duration: 0.075, fade: 0.05, next: 'jumpTakeoff', priority: 2 },
  jumpTakeoff: { duration: 0.13, fade: 0.05, next: 'airborne', priority: 2 },
  airborne: { duration: 0, fade: 0.08, priority: 2 },
  landing: { duration: 0.30, fade: 0.07, next: 'locomotion', priority: 2 },
  hardLanding: { duration: 0.46, fade: 0.06, next: 'locomotion', priority: 2 },
  slide: { duration: 0, fade: 0.08, priority: 2 },
  slideRecover: { duration: 0.24, fade: 0.09, next: 'locomotion', priority: 2 },
  stumble: { duration: 0.85, fade: 0.06, next: 'recover', priority: 3 },
  trip: { duration: 0.7, fade: 0.05, next: 'recover', priority: 3 },
  hit: { duration: 0.6, fade: 0.04, next: 'recover', priority: 3 },
  knockback: { duration: 0.9, fade: 0.05, next: 'recover', priority: 3 },
  recover: { duration: 0.45, fade: 0.12, next: 'locomotion', priority: 1 },
  deathForward: { duration: 1.5, fade: 0.06, priority: 9 },
  deathSideways: { duration: 1.5, fade: 0.06, priority: 9 },
  deathCollapse: { duration: 1.6, fade: 0.06, priority: 9 },
  menuIdle: { duration: 0, fade: 0.4, priority: 0 },
  menuGesture: { duration: 2.2, fade: 0.35, next: 'menuIdle', priority: 1 },
  victory: { duration: 2.6, fade: 0.25, next: 'menuIdle', priority: 4 },
  celebration: { duration: 2.4, fade: 0.25, next: 'menuIdle', priority: 4 },
};

/** Everything the animator needs to know about the player each frame. */
export interface AnimContext {
  speed: number;
  grounded: boolean;
  verticalVelocity: number;
  /** 0..1 progress through the current airborne arc. */
  airProgress: number;
  /** 0..1 progress through the current slide. */
  slideProgress: number;
  /** -1..1 lane change direction, 0 when settled. */
  laneDir: number;
  /** 0..1 progress through the lane change. */
  laneProgress: number;
  laneQuick: boolean;
  /** Camera-relative distance, used for LOD. */
  cameraDistance: number;
}

export class PlayerAnimator {
  private state: AnimState = 'menuIdle';
  private stateTime = 0;
  private cyclePhase = 0;
  private fadeRemaining = 0;
  private fadeDuration = 0;

  private readonly current = new Pose();
  private readonly fadeFrom = new Pose();
  private readonly output = new Pose();

  private readonly restLocal: THREE.Vector3[] = [];
  private readonly heightScale: number;
  private gait: GaitParams = clips.GAITS.idle;
  private time = 0;
  private idleTimer = 0;
  /** Footstep bookkeeping so audio and dust fire on real contacts. */
  private lastFootPhase = 0;
  private footIkEnabled = true;

  constructor(private readonly hero: Hero) {
    this.heightScale = hero.identity.height / REFERENCE_HEIGHT;
    for (const bone of hero.rig.bones) this.restLocal.push(bone.position.clone());
    this.current.identity();
    this.output.identity();
  }

  get currentState(): AnimState {
    return this.state;
  }

  /** True while a death clip owns the rig. */
  get isDead(): boolean {
    return this.state.startsWith('death');
  }

  setFootIk(enabled: boolean): void {
    this.footIkEnabled = enabled;
  }

  /** Requests a state change; lower-priority requests are ignored mid-clip. */
  play(next: AnimState, force = false): void {
    if (next === this.state && !force) return;
    const currentDef = STATES[this.state];
    const nextDef = STATES[next];
    const oneShotBusy = currentDef.duration > 0 && this.stateTime < currentDef.duration;
    if (!force && oneShotBusy && nextDef.priority < currentDef.priority) return;

    this.fadeFrom.copy(this.output);
    this.fadeDuration = nextDef.fade;
    this.fadeRemaining = nextDef.fade;
    this.state = next;
    this.stateTime = 0;
  }

  /** Resets to a clean run start. */
  reset(): void {
    this.state = 'locomotion';
    this.stateTime = 0;
    this.cyclePhase = 0;
    this.fadeRemaining = 0;
    this.idleTimer = 0;
  }

  update(dt: number, ctx: AnimContext): void {
    this.time += dt;
    this.stateTime += dt;
    this.gait = clips.gaitForSpeed(ctx.speed);

    // The run cycle is driven by ground speed, never by wall clock, so feet
    // never slide regardless of how fast the game gets.
    if (ctx.grounded && ctx.speed > 0.2) {
      const rate = clips.strideRate(ctx.speed, this.gait, this.heightScale);
      const prev = this.cyclePhase;
      this.cyclePhase = (this.cyclePhase + rate * dt) % 1;
      this.emitFootsteps(prev, this.cyclePhase, ctx.speed);
    } else if (!ctx.grounded) {
      this.cyclePhase = (this.cyclePhase + dt * 0.4) % 1;
    }

    this.advanceStateMachine(dt, ctx);
    if (this.fadeRemaining > 0) this.fadeRemaining = Math.max(0, this.fadeRemaining - dt);
    this.evaluate(ctx);
    this.applyToRig(ctx);
    this.updateLod(ctx.cameraDistance);
  }

  /** Fires a footstep at each mid-stance, twice per stride. */
  private emitFootsteps(prev: number, next: number, speed: number): void {
    const crossed = (mark: number) => (prev < mark && next >= mark) || (next < prev && (prev < mark || next >= mark));
    if (crossed(0.06) || crossed(0.56)) {
      if (Math.abs(this.cyclePhase - this.lastFootPhase) > 0.15 || this.lastFootPhase === 0) {
        bus.emit('player:footstep', { speed });
        this.lastFootPhase = this.cyclePhase;
      }
    }
  }

  private advanceStateMachine(dt: number, ctx: AnimContext): void {
    const def = STATES[this.state];
    if (def.duration > 0 && this.stateTime >= def.duration && def.next) {
      this.play(def.next, true);
      return;
    }
    // Idle variations keep the menu and pre-run stance alive.
    if (this.state === 'idle') {
      this.idleTimer += dt;
      if (this.idleTimer > 6) {
        this.idleTimer = 0;
        this.play(Math.random() < 0.5 ? 'idleA' : 'idleB');
      }
    }
    // Locomotion falls back to idle when the player stops.
    if (this.state === 'locomotion' && ctx.speed < 0.15 && ctx.grounded) this.play('idle');
    if (this.state === 'idle' && ctx.speed > 0.4) this.play('locomotion');
  }

  private evaluate(ctx: AnimContext): void {
    const pose = this.current;
    const t = this.stateTime;
    const def = STATES[this.state];
    const progress = def.duration > 0 ? Math.min(1, t / def.duration) : 0;

    switch (this.state) {
      case 'idle': clips.locomotion(this.time * 0.25, clips.GAITS.idle, pose); break;
      case 'idleA': clips.idleVariationA(t, pose); break;
      case 'idleB': clips.idleVariationB(t, pose); break;
      case 'locomotion': clips.locomotion(this.cyclePhase, this.gait, pose); break;
      case 'jumpAnticipation': clips.jumpAnticipation(progress, pose, this.gait); break;
      case 'jumpTakeoff': clips.jumpTakeoff(progress, pose); break;
      case 'airborne': clips.airborne(ctx.airProgress, pose); break;
      case 'landing': clips.landing(progress, pose, false); break;
      case 'hardLanding': clips.landing(progress, pose, true); break;
      case 'slide': clips.slide(ctx.slideProgress, pose); break;
      case 'slideRecover': clips.slideRecover(progress, pose, this.gait); break;
      case 'stumble': clips.stumble(t, pose, this.gait); break;
      case 'trip': clips.trip(progress, pose); break;
      case 'hit': clips.hit(t, pose); break;
      case 'knockback': clips.knockback(progress, pose); break;
      case 'recover': clips.recover(progress, pose, this.gait); break;
      case 'deathForward': clips.fallForward(progress, pose); break;
      case 'deathSideways': clips.fallSideways(progress, pose); break;
      case 'deathCollapse': clips.collapse(progress, pose); break;
      case 'menuIdle': clips.menuIdle(this.time, pose); break;
      case 'menuGesture': clips.menuGesture(t, pose); break;
      case 'victory': clips.victory(t, pose); break;
      case 'celebration': clips.celebration(t, pose); break;
    }

    if (this.fadeRemaining > 0) {
      const k = this.fadeDuration > 0 ? 1 - this.fadeRemaining / this.fadeDuration : 1;
      Pose.blend(this.fadeFrom, pose, k, this.output);
    } else {
      this.output.copy(pose);
    }

    // Additive layers ride on top of whatever the base layer produced.
    if (!this.isDead) {
      if (ctx.laneDir !== 0 && ctx.laneProgress < 1) {
        clips.laneAdditive(ctx.laneProgress, ctx.laneDir, ctx.laneQuick, this.output);
      }
      const pitchComp = this.state === 'locomotion' ? this.gait.lean * 0.2 : 0;
      clips.secondaryLayer(this.output, this.time, ctx.speed, ctx.verticalVelocity, pitchComp);
    }
  }

  private applyToRig(ctx: AnimContext): void {
    const bones = this.hero.rig.bones;
    this.output.apply(bones, this.restLocal);
    if (this.footIkEnabled && ctx.grounded && !this.isDead) this.groundFeet();
  }

  /**
   * Foot contact pass. Rather than a full two-bone IK solve, the pelvis is
   * lifted until the lowest foot rests on the deck. On a flat running surface
   * that removes every ground-penetration frame for a fraction of the cost.
   */
  private groundFeet(): void {
    const root = this.hero.rig.root;
    root.updateMatrixWorld(true);
    const hips = this.hero.rig.bones[BONE_INDEX['hips']];
    let lowest = Infinity;
    for (const name of ['toe_L', 'toe_R', 'foot_L', 'foot_R']) {
      const bone = this.hero.rig.byName.get(name);
      if (!bone) continue;
      const y = bone.matrixWorld.elements[13] - (name.startsWith('toe') ? 0.018 : 0.05) * this.heightScale;
      if (y < lowest) lowest = y;
    }
    if (!Number.isFinite(lowest)) return;
    const penetration = -lowest;
    if (penetration > 0.0005) {
      hips.position.y += Math.min(penetration, 0.14 * this.heightScale);
      root.updateMatrixWorld(true);
    }
  }

  private updateLod(distance: number): void {
    const level: HeroLod = distance > CFG.performance.heroLod2 ? 2 : distance > CFG.performance.heroLod1 ? 1 : 0;
    this.hero.setLod(level);
  }

  /** Picks a death clip that reads well for the cause of the run ending. */
  playDeath(cause: 'front' | 'side' | 'collapse'): void {
    this.play(cause === 'front' ? 'deathForward' : cause === 'side' ? 'deathSideways' : 'deathCollapse', true);
  }
}
