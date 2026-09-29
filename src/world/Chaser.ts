import * as THREE from 'three';
import { createHero, Hero } from '../assets/HeroFactory';
import { makeIdentity } from '../assets/HeroIdentity';

import { PlayerAnimator } from '../player/PlayerAnimator';
import { PlayerState } from '../player/PlayerController';

/**
 * CHR_Chaser: the inspector on the runner's heels.
 *
 * Two problems had to be solved before a pursuer could exist at all.
 *
 * **He has to be on screen.** The chase camera sits 7.4 m behind the runner,
 * so anything genuinely "behind" is behind the camera as well and is never
 * drawn. The gap is therefore held between 2.2 m and 6.6 m — close enough to
 * be inside the frustum, far enough that he reads as pursuit rather than as
 * a passenger — and he runs offset to one side so he never covers the track
 * the player is trying to read.
 *
 * **He must not run through walls.** A pursuer that clips a container every
 * few seconds is worse than no pursuer. Rather than give him his own
 * collision, path-finding and fairness guarantees, he replays the player's
 * own trajectory, delayed by the gap: he jumps where they jumped, slides
 * where they slid, and takes the lane they took. The route is survivable by
 * construction, because somebody just survived it. It also costs nothing —
 * the history is a small ring buffer of positions, not a second simulation.
 *
 * He carries no collider and cannot end a run. What he does is tell the
 * player how well they are doing, in the only language a runner has time to
 * read: he is closer when they are struggling and further back when they are
 * not.
 */

/** One recorded moment of the player's run. */
interface Sample {
  /** Distance travelled when this was recorded. */
  d: number;
  x: number;
  y: number;
  airborne: boolean;
  sliding: boolean;
}

/** Distance between recorded samples, in metres. */
const SAMPLE_STEP = 0.2;
/** Enough history to cover the widest gap with room to spare. */
const HISTORY = 96;

/**
 * The separation band, in metres, and why it is this narrow.
 *
 * The chase camera sits 7.4 m behind the runner and looks slightly down, so
 * the bottom of the frame at a distance `d` in front of the camera is at
 * roughly `y = 3.3 - 0.68 d`. Working that back through `gap = 7.4 - d`:
 *
 * Measured by projecting him through the real `CameraController` rather than
 * worked out on paper, because the controller's smoothing, lane lean and
 * follow height all move the answer:
 *
 *   gap 5.5 m -> his head crosses the bottom of the frame: gone
 *   gap 4.3 m -> head and shoulders, falling away
 *   gap 3.3 m -> visible from the waist up, over the runner's shoulder
 *   gap 3.1 m -> feet enter the frame: the whole man
 *
 * A first pass cruised at 3.9 m, and a screenshot settled it: at that
 * distance he is a head in the bottom corner of the frame and reads as a
 * bystander rather than as somebody coming for you. The band below is where
 * he is recognisably a running man for the whole of it.
 *
 * Anything past about 5.5 m is off the bottom of the screen entirely, and
 * anything past 7.4 m is behind the camera. So the band is not a matter of
 * taste: it is the only window in which a pursuer exists at all, and how
 * much of him is showing *is* the readout. A player in trouble sees a whole
 * man; a player running well sees a head that is falling away.
 */
const GAP = {
  /** Where he settles on a clean run: visible from the waist up. */
  cruise: 3.3,
  /** How far back a long clean streak pushes him, before he leaves frame. */
  relaxed: 4.3,
  /** Right on the runner's shoulder, after a mistake. */
  lunge: 2.3,
  /** How quickly the gap closes and opens, in metres per second. */
  closeRate: 7.0,
  openRate: 1.1,
};

/** Seconds of clean running before he starts dropping back. */
const RELIEF_TIME = 7;
/**
 * How far off the player's line he runs, in metres, and which way.
 *
 * He holds one side for the whole run rather than picking the roomier one
 * each time the player changes lane. Swapping sides sounds better and is
 * worse: the offset has to pass through zero to get there, and for those few
 * frames he is directly behind the runner, covering the strip of track the
 * player is reading. Measured, a swap brought him within 1 cm of the line.
 *
 * A fixed offset is always safe, because the lanes only reach ±2.4 m inside
 * a ±4.8 m track bed: even in the outermost lane he stays on the ballast.
 * Negative is screen-right, which keeps him off the side the houses are on.
 */
const LATERAL_OFFSET = -1.15;

export class Chaser {
  readonly root = new THREE.Group();
  private readonly hero: Hero;
  private readonly animator: PlayerAnimator;

  private readonly history: Sample[] = [];
  private head = 0;
  private filled = 0;
  private lastSampleDistance = -Infinity;

  /** Current and target separation, in metres of track. */
  private gap = GAP.cruise;
  private targetGap = GAP.cruise;
  /** Seconds since the player last took a hit. */
  private clean = RELIEF_TIME;
  private lateral = LATERAL_OFFSET;
  private airborne = false;
  private sliding = false;
  private enabled = true;

  constructor() {
    this.root.name = 'CHR_Chaser';
    // Visibly not the runner: heavier, taller, in a dark uniform with a
    // high-visibility flash. The silhouette has to survive being read at a
    // glance, in the corner of the eye, while the player is looking at
    // something else.
    this.hero = createHero(makeIdentity({
      name: 'Inspector',
      height: 1.86,
      build: 0.72,
      shoulderRatio: 0.27,
      colors: {
        skin: 0x8d6449,
        skinShadow: 0x6b4733,
        hair: 0x1b1b1f,
        brow: 0x141417,
        iris: 0x3a2d25,
        lips: 0x7a5245,
        shirt: 0x1d2430,
        shirtAccent: 0xf0b429,
        pants: 0x171b22,
        shoeBody: 0x101216,
        shoeSole: 0x2a2d33,
        accent: 0xf0b429,
      },
      face: { jawTaper: 0.2, brow: 0.78, cheekbone: 0.42, noseWidth: 0.6, length: 0.245 },
      hair: { style: 'short', volume: 0.018, fringe: 0.2, sideburn: 0.4, stubble: 0.55 },
      outfit: { top: 'longSleeve', bottom: 'jeans', watch: true, band: false, backpack: false },
    }));
    this.root.add(this.hero.object);
    // No footstep events: the bus feeds the player's own audio and dust, and
    // a second runner firing into it doubles every step the player takes.
    this.animator = new PlayerAnimator(this.hero, { emitEvents: false });
    this.animator.reset();
  }

  /** Where he is, relative to the player, for the torch to be aimed from. */
  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** 0 when he is as far back as he gets, 1 when he is on the shoulder. */
  get pressure(): number {
    const t = (GAP.relaxed - this.gap) / (GAP.relaxed - GAP.lunge);
    return Math.min(1, Math.max(0, t));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.visible = on;
  }

  reset(): void {
    this.head = 0;
    this.filled = 0;
    this.lastSampleDistance = -Infinity;
    this.gap = GAP.cruise;
    this.targetGap = GAP.cruise;
    this.clean = RELIEF_TIME;
    this.lateral = LATERAL_OFFSET;
    this.airborne = false;
    this.sliding = false;
    this.animator.reset();
    this.root.position.set(0, 0, -GAP.cruise);
    this.root.visible = this.enabled;
  }

  /** The player took a hit: he lunges. */
  onPlayerHit(): void {
    this.clean = 0;
    this.gap = Math.min(this.gap, GAP.lunge + 0.6);
  }

  /** A near miss is skill, and buys a little room. */
  onNearMiss(): void {
    this.clean = Math.min(RELIEF_TIME, this.clean + 1.2);
  }

  update(dt: number, s: PlayerState, cameraDistanceToPlayer: number): void {
    if (!this.enabled) return;
    this.record(s);

    this.clean += dt;
    // Pressure is a function of how long it has been since the last mistake,
    // not of raw distance: a player who has just been hit deserves to see him
    // arrive, and a player running clean deserves to see him give up ground.
    const relief = Math.min(1, this.clean / RELIEF_TIME);
    this.targetGap = GAP.lunge + (GAP.relaxed - GAP.lunge) * relief;
    const rate = this.gap < this.targetGap ? GAP.openRate : GAP.closeRate;
    this.gap += Math.max(-rate * dt, Math.min(rate * dt, this.targetGap - this.gap));

    // Follow the route the player actually took, delayed by the gap.
    const at = this.sampleAt(s.distance - this.gap, s);

    // Run off the player's line. Chasing directly up the middle would hide
    // the one thing the player has to see. He also swings in a little as he
    // closes, which is what makes the lunge read as a lunge.
    const lateralTarget = LATERAL_OFFSET * (1 - 0.18 * this.pressure);
    this.lateral += (lateralTarget - this.lateral) * Math.min(1, dt * 4.5);

    this.root.position.set(at.x + this.lateral, at.y, -this.gap);
    // Face the way he is running, leaning in as he closes.
    this.root.rotation.set(0, Math.PI, -this.lateral * 0.06 * this.pressure);

    // Drive the rig from the state the player was in at that point on the
    // track, so his jumps and slides line up with the obstacles he passes.
    if (at.airborne !== this.airborne) {
      this.airborne = at.airborne;
      this.animator.play(at.airborne ? 'airborne' : 'landing', true);
    }
    if (at.sliding !== this.sliding) {
      this.sliding = at.sliding;
      this.animator.play(at.sliding ? 'slide' : 'slideRecover', true);
    }

    this.animator.update(dt, {
      speed: s.speed,
      grounded: !at.airborne,
      verticalVelocity: 0,
      airProgress: at.airborne ? 0.5 : 0,
      slideProgress: at.sliding ? 0.5 : 1,
      laneDir: 0,
      laneProgress: 1,
      laneQuick: false,
      // He is always further from the camera than the player is.
      cameraDistance: cameraDistanceToPlayer + this.gap,
    });
  }

  /** Stores the player's position at fixed intervals of track. */
  private record(s: PlayerState): void {
    if (s.distance - this.lastSampleDistance < SAMPLE_STEP) return;
    this.lastSampleDistance = s.distance;
    const sample: Sample = {
      d: s.distance,
      x: s.x,
      y: s.y,
      airborne: !s.grounded,
      sliding: s.sliding,
    };
    if (this.filled < HISTORY) {
      this.history.push(sample);
      this.filled++;
    } else {
      this.history[this.head] = sample;
    }
    this.head = (this.head + 1) % HISTORY;
  }

  /**
   * The player's state at a point of track already run, interpolated.
   *
   * Before there is enough history — the first few metres of a run — he
   * simply mirrors the player, which is right: at the start line he is
   * standing where they are standing.
   */
  private sampleAt(distance: number, now: PlayerState): Sample {
    if (this.filled === 0) {
      return { d: distance, x: now.x, y: 0, airborne: false, sliding: false };
    }
    let before: Sample | null = null;
    let after: Sample | null = null;
    for (let i = 0; i < this.filled; i++) {
      const sample = this.history[i];
      if (sample.d <= distance && (!before || sample.d > before.d)) before = sample;
      if (sample.d >= distance && (!after || sample.d < after.d)) after = sample;
    }
    if (!before) return after ?? { d: distance, x: now.x, y: 0, airborne: false, sliding: false };
    if (!after || after.d === before.d) return before;
    const t = (distance - before.d) / (after.d - before.d);
    return {
      d: distance,
      x: before.x + (after.x - before.x) * t,
      y: before.y + (after.y - before.y) * t,
      // Discrete states take the nearer sample rather than blending; half a
      // slide is not a pose.
      airborne: t < 0.5 ? before.airborne : after.airborne,
      sliding: t < 0.5 ? before.sliding : after.sliding,
    };
  }

  dispose(): void {
    this.hero.dispose();
  }
}
