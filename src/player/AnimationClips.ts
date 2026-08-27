import { bump, easeInOut, easeOut, Pose, smoothstep, TAU } from './Pose';

/**
 * ANM_Hero_* clip library.
 *
 * Clips are authored as functions of phase rather than baked keyframes. That
 * keeps the run cycle locked to gameplay speed (no foot sliding at any speed),
 * lets the jump respond to real airtime, and costs no download.
 *
 * Sign conventions for this rig (character faces -Z):
 *   + rotation.x on a downward bone  = swings forward
 *   - rotation.x on the spine        = leans forward
 *   - rotation.x on the calf         = knee bends (heel toward glutes)
 *   + rotation.x on the foot         = toes lift (dorsiflexion)
 */

/** Shape of one locomotion gait; interpolating these gives walk..sprint. */
export interface GaitParams {
  /** Strides per second at the reference speed. */
  cadence: number;
  hipSwing: number;
  hipMid: number;
  kneeSwing: number;
  kneeStance: number;
  ankleSwing: number;
  armSwing: number;
  elbowBend: number;
  elbowPump: number;
  lean: number;
  bob: number;
  pelvisTwist: number;
  chestTwist: number;
  shoulderRoll: number;
  /** Vertical drop of the hips at mid-stance. */
  crouch: number;
}

export const GAITS: Record<string, GaitParams> = {
  idle: {
    cadence: 0.32, hipSwing: 0.02, hipMid: 0.0, kneeSwing: 0.04, kneeStance: 0.09,
    ankleSwing: 0.01, armSwing: 0.02, elbowBend: 0.14, elbowPump: 0.02, lean: 0.02,
    bob: 0.004, pelvisTwist: 0.01, chestTwist: 0.02, shoulderRoll: 0.02, crouch: 0.0,
  },
  walk: {
    cadence: 0.92, hipSwing: 0.42, hipMid: 0.06, kneeSwing: 0.62, kneeStance: 0.12,
    ankleSwing: 0.22, armSwing: 0.28, elbowBend: 0.30, elbowPump: 0.10, lean: 0.04,
    bob: 0.022, pelvisTwist: 0.07, chestTwist: 0.09, shoulderRoll: 0.03, crouch: 0.01,
  },
  jog: {
    cadence: 1.34, hipSwing: 0.62, hipMid: 0.20, kneeSwing: 0.95, kneeStance: 0.24,
    ankleSwing: 0.32, armSwing: 0.55, elbowBend: 0.85, elbowPump: 0.24, lean: 0.10,
    bob: 0.038, pelvisTwist: 0.12, chestTwist: 0.16, shoulderRoll: 0.05, crouch: 0.02,
  },
  run: {
    cadence: 1.58, hipSwing: 0.82, hipMid: 0.34, kneeSwing: 1.22, kneeStance: 0.32,
    ankleSwing: 0.42, armSwing: 0.78, elbowBend: 1.12, elbowPump: 0.34, lean: 0.16,
    bob: 0.05, pelvisTwist: 0.16, chestTwist: 0.24, shoulderRoll: 0.07, crouch: 0.03,
  },
  fastRun: {
    cadence: 1.74, hipSwing: 0.95, hipMid: 0.40, kneeSwing: 1.42, kneeStance: 0.36,
    ankleSwing: 0.48, armSwing: 0.92, elbowBend: 1.25, elbowPump: 0.40, lean: 0.22,
    bob: 0.058, pelvisTwist: 0.19, chestTwist: 0.29, shoulderRoll: 0.08, crouch: 0.036,
  },
  sprint: {
    cadence: 1.92, hipSwing: 1.12, hipMid: 0.46, kneeSwing: 1.62, kneeStance: 0.40,
    ankleSwing: 0.55, armSwing: 1.08, elbowBend: 1.38, elbowPump: 0.46, lean: 0.30,
    bob: 0.064, pelvisTwist: 0.22, chestTwist: 0.34, shoulderRoll: 0.09, crouch: 0.042,
  },
};

function lerpGait(a: GaitParams, b: GaitParams, t: number): GaitParams {
  const out = {} as GaitParams;
  for (const key of Object.keys(a) as Array<keyof GaitParams>) {
    out[key] = a[key] + (b[key] - a[key]) * t;
  }
  return out;
}

const GAIT_LADDER: Array<{ speed: number; gait: GaitParams }> = [
  { speed: 0.0, gait: GAITS.idle },
  { speed: 1.6, gait: GAITS.walk },
  { speed: 5.0, gait: GAITS.jog },
  { speed: 12.0, gait: GAITS.run },
  { speed: 20.0, gait: GAITS.fastRun },
  { speed: 30.0, gait: GAITS.sprint },
];

/** Blends the authored gaits into a continuous locomotion parameter set. */
export function gaitForSpeed(speed: number): GaitParams {
  if (speed <= GAIT_LADDER[0].speed) return GAIT_LADDER[0].gait;
  for (let i = 1; i < GAIT_LADDER.length; i++) {
    const hi = GAIT_LADDER[i];
    if (speed <= hi.speed) {
      const lo = GAIT_LADDER[i - 1];
      const t = (speed - lo.speed) / (hi.speed - lo.speed);
      return lerpGait(lo.gait, hi.gait, smoothstep(t));
    }
  }
  return GAIT_LADDER[GAIT_LADDER.length - 1].gait;
}

/**
 * Calibration factor that locks the cycle to the ground.
 *
 * The authored cadences alone left a planted foot travelling backwards at
 * only ~78% of ground speed, so the foot skated forwards under the body —
 * the most recognisable tell of a bad run cycle. Measured by sweeping this
 * multiplier and sampling the toe's velocity through the contact window:
 *
 *   1.00 -> 77-80%    1.20 -> 92-96%    1.35 -> 103-108%
 *   1.10 -> 84-88%    1.28 -> 98-103%   1.45 -> 111-116%
 *
 * `npm run test:animation` re-measures this and fails if it drifts either way.
 */
const CADENCE_CALIBRATION = 1.28;

/** Strides per second, so the cycle stays locked to ground speed. */
export function strideRate(speed: number, gait: GaitParams, heightScale: number): number {
  // A real stride covers roughly 2.1x hip height at a run; scaling cadence by
  // sqrt(speed) matches how humans trade cadence against stride length.
  const base = gait.cadence * CADENCE_CALIBRATION;
  const ref = 12;
  const k = speed <= 0.05 ? 1 : Math.sqrt(Math.max(0.15, speed / ref));
  return (base * k) / Math.max(0.5, heightScale);
}

/**
 * ANM_Hero_Locomotion. One generator covers idle, walk, jog, run, fast run and
 * sprint; the gait parameters do the shaping.
 */
export function locomotion(phase: number, gait: GaitParams, out: Pose): Pose {
  out.identity();
  const p = phase % 1;

  for (const side of [1, -1]) {
    const name = side > 0 ? 'L' : 'R';
    const sp = side > 0 ? p : (p + 0.5) % 1;

    // Hip: sinusoidal drive, forward at the top of the swing.
    const hip = gait.hipMid + gait.hipSwing * Math.sin(sp * TAU);
    // Knee: a large swing-phase peak plus a smaller stance-absorption peak.
    const knee =
      gait.kneeStance * 0.5 +
      gait.kneeSwing * bump(sp, 0.68, 0.30) +
      gait.kneeStance * bump(sp, 0.12, 0.22);
    // Ankle: toes lift through the swing, plantar flex at toe-off.
    const ankle =
      gait.ankleSwing * bump(sp, 0.55, 0.28) - gait.ankleSwing * 0.75 * bump(sp, 0.95, 0.22);

    out.set(`thigh_${name}`, hip, 0, side * 0.03);
    out.set(`calf_${name}`, -knee);
    out.set(`foot_${name}`, ankle - 0.06);
    out.set(`toe_${name}`, Math.max(0, -0.4 * bump(sp, 0.93, 0.16)));

    // Arms counter-swing against the legs.
    const arm = gait.hipMid * 0.3 - gait.armSwing * Math.sin(sp * TAU);
    const elbow = gait.elbowBend + gait.elbowPump * Math.max(0, Math.sin(sp * TAU + Math.PI));
    out.set(`upperArm_${name}`, arm, side * gait.chestTwist * 0.3, side * (0.1 + gait.armSwing * 0.06));
    out.set(`forearm_${name}`, elbow, 0, side * 0.12);
    out.set(`hand_${name}`, 0.1, 0, side * 0.16);
    out.set(`shoulder_${name}`, gait.shoulderRoll * Math.sin(sp * TAU), 0, side * gait.shoulderRoll);
  }

  // Spine chain: forward lean, counter-rotation, and a small lateral sway.
  out.set('hips', -gait.lean * 0.25, gait.pelvisTwist * Math.sin(p * TAU), gait.pelvisTwist * 0.4 * Math.cos(p * TAU));
  out.set('spine', -gait.lean * 0.35, -gait.chestTwist * 0.4 * Math.sin(p * TAU), 0);
  out.set('chest', -gait.lean * 0.4, -gait.chestTwist * Math.sin(p * TAU), 0);
  // Head stabilises: it counters the chest twist and stays level with the horizon.
  out.set('neck', gait.lean * 0.35, gait.chestTwist * 0.5 * Math.sin(p * TAU), 0);
  out.set('head', gait.lean * 0.65, gait.chestTwist * 0.35 * Math.sin(p * TAU), 0);

  // Vertical bob: two rises per stride, lowest at each mid-stance.
  const bob = -gait.crouch - gait.bob * 0.5 + gait.bob * 0.5 * Math.cos(p * 2 * TAU);
  out.offset.set(gait.pelvisTwist * 0.02 * Math.sin(p * TAU), bob, 0);
  return out;
}

/** ANM_Hero_Idle_Var1: weight shift onto one hip. */
export function idleVariationA(t: number, out: Pose): Pose {
  locomotion(t * 0.25, GAITS.idle, out);
  const k = Math.sin(t * TAU * 0.25);
  out.add('hips', 0, 0, 0.06 * k);
  out.add('spine', 0, 0.04 * k, -0.04 * k);
  out.add('thigh_L', 0.05 * k, 0, 0);
  out.add('thigh_R', -0.05 * k, 0, 0);
  out.add('head', 0, 0.12 * k, 0);
  return out;
}

/** ANM_Hero_Idle_Var2: shoulder roll and a glance down the track. */
export function idleVariationB(t: number, out: Pose): Pose {
  locomotion(t * 0.25, GAITS.idle, out);
  const roll = Math.sin(t * TAU * 0.4);
  out.add('shoulder_L', -0.12 * roll, 0, 0.08 * roll);
  out.add('shoulder_R', -0.12 * roll, 0, -0.08 * roll);
  out.add('chest', -0.05 * Math.abs(roll), 0, 0);
  out.add('head', 0.08 * roll, -0.18 * roll, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Jump
// ---------------------------------------------------------------------------

/** ANM_Hero_Jump_Anticipation: the compression before launch. */
export function jumpAnticipation(t: number, out: Pose, gait: GaitParams): Pose {
  locomotion(0.25, gait, out);
  const k = smoothstep(t);
  out.setPair('thigh', 0.55 * k + 0.2, 0, 0.06);
  out.setPair('calf', -1.05 * k);
  out.setPair('foot', 0.42 * k);
  out.setPair('upperArm', -0.55 * k, 0, 0.16);
  out.setPair('forearm', 0.55 + 0.35 * k, 0, 0.12);
  out.set('spine', -0.28 * k);
  out.set('chest', -0.22 * k);
  out.set('head', 0.34 * k);
  out.offset.set(0, -0.17 * k, 0);
  return out;
}

/** ANM_Hero_Jump_Takeoff: explosive extension, arms drive up. */
export function jumpTakeoff(t: number, out: Pose): Pose {
  out.identity();
  const k = easeOut(t);
  out.setPair('thigh', -0.32 * k + 0.18, 0, 0.05);
  out.setPair('calf', -0.28 * (1 - k) - 0.05);
  out.setPair('foot', -0.5 * k);
  out.setPair('toe', -0.35 * k);
  out.setPair('upperArm', 1.15 * k - 0.3, 0, 0.2);
  out.setPair('forearm', 0.9 - 0.35 * k, 0, 0.1);
  out.set('spine', -0.06 + 0.1 * k);
  out.set('chest', 0.05 * k);
  out.set('head', -0.08 * k);
  out.offset.set(0, 0.05 * k, 0);
  return out;
}

/**
 * ANM_Hero_Airborne: one continuous arc through rising, apex and falling.
 * `t` is 0 at takeoff, 0.5 at apex, 1 at touchdown.
 */
export function airborne(t: number, out: Pose): Pose {
  out.identity();
  const rise = smoothstep(Math.min(1, t * 2.2));
  const fall = smoothstep(Math.max(0, (t - 0.55) / 0.45));

  // Lead leg tucks on the way up, then reaches out for the landing.
  out.set('thigh_L', 0.85 * rise - 0.55 * fall + 0.15);
  out.set('calf_L', -1.25 * rise + 0.95 * fall);
  out.set('foot_L', 0.2 * rise + 0.3 * fall);
  // Trail leg extends behind, then swings under the body.
  out.set('thigh_R', -0.45 * rise + 0.75 * fall);
  out.set('calf_R', -0.85 * rise - 0.15 * fall);
  out.set('foot_R', -0.25 * rise + 0.35 * fall);

  out.set('upperArm_L', 0.85 - 0.55 * fall, 0, 0.24);
  out.set('upperArm_R', -0.45 + 0.35 * fall, 0, -0.3);
  out.set('forearm_L', 0.55 + 0.35 * fall, 0, 0.12);
  out.set('forearm_R', 0.75 + 0.25 * fall, 0, -0.12);

  out.set('spine', -0.05 - 0.12 * fall, 0.05 * rise, 0);
  out.set('chest', -0.04 - 0.1 * fall, -0.08 * rise, 0);
  out.set('head', 0.12 + 0.1 * fall);
  return out;
}

/** ANM_Hero_Jump_Land: absorb, then push back to running height. */
export function landing(t: number, out: Pose, hard: boolean): Pose {
  out.identity();
  const depth = hard ? 1 : 0.55;
  // Compress fast, recover slower.
  const k = t < 0.32 ? easeOut(t / 0.32) : 1 - easeInOut((t - 0.32) / 0.68);
  out.setPair('thigh', (0.72 * depth) * k + 0.12, 0, 0.07);
  out.setPair('calf', -(1.25 * depth) * k - 0.1);
  out.setPair('foot', (0.5 * depth) * k);
  out.setPair('upperArm', -(0.45 * depth) * k, 0, 0.24 + 0.1 * k);
  out.setPair('forearm', 0.7 + 0.5 * k, 0, 0.12);
  out.set('spine', -(0.35 * depth) * k);
  out.set('chest', -(0.22 * depth) * k);
  out.set('head', (0.42 * depth) * k);
  out.offset.set(0, -(0.24 * depth) * k, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Slide
// ---------------------------------------------------------------------------

/**
 * ANM_Hero_Slide: a baseball slide. `t` runs 0..1 across entry, hold and exit,
 * so the whole action is one readable silhouette from the chase camera.
 */
export function slide(t: number, out: Pose): Pose {
  out.identity();
  const entry = smoothstep(Math.min(1, t / 0.16));
  const exit = smoothstep(Math.max(0, (t - 0.76) / 0.24));
  const k = entry * (1 - exit);

  // Lead leg extends forward, trail leg folds under.
  out.set('thigh_L', 1.32 * k, 0, 0.16 * k);
  out.set('calf_L', -0.22 * k);
  out.set('foot_L', 0.42 * k);
  out.set('thigh_R', 0.72 * k, 0, -0.34 * k);
  out.set('calf_R', -1.75 * k);
  out.set('foot_R', -0.2 * k);

  // Torso reclines and the trailing arm props against the ground.
  out.set('hips', -0.92 * k, 0.12 * k, 0);
  out.set('spine', 0.32 * k, 0.1 * k, 0.06 * k);
  out.set('chest', 0.26 * k, 0.08 * k, 0);
  out.set('neck', -0.3 * k);
  out.set('head', -0.32 * k, -0.16 * k, 0);

  out.set('upperArm_L', -0.95 * k, 0, 0.5 * k);
  out.set('forearm_L', 0.55 * k, 0, 0.2 * k);
  out.set('upperArm_R', -1.15 * k, 0, -0.62 * k);
  out.set('forearm_R', 0.35 * k, 0, -0.18 * k);

  // Drop the whole body toward the deck.
  out.offset.set(0, -0.62 * k, 0.06 * k);
  return out;
}

/** ANM_Hero_Slide_Recover: the push back up to a run. */
export function slideRecover(t: number, out: Pose, gait: GaitParams): Pose {
  const k = 1 - easeOut(t);
  locomotion(0.15, gait, out);
  out.add('hips', -0.55 * k);
  out.add('spine', 0.2 * k);
  out.add('thigh_L', 0.6 * k);
  out.add('calf_R', -0.7 * k);
  out.add('upperArm_L', -0.4 * k);
  out.add('upperArm_R', -0.5 * k);
  out.offset.y -= 0.3 * k;
  return out;
}

// ---------------------------------------------------------------------------
// Lane movement (additive over locomotion)
// ---------------------------------------------------------------------------

/**
 * ANM_Hero_Lane: a cross-step and body lean layered over the run. `dir` is -1
 * for left, +1 for right; `quick` sharpens it for a dodge.
 */
export function laneAdditive(t: number, dir: number, quick: boolean, out: Pose): void {
  const power = quick ? 1.35 : 1;
  // Lean peaks in the middle of the move and unwinds by the end.
  const k = Math.sin(smoothstep(t) * Math.PI) * power;
  const lean = -dir * k;
  out.add('hips', 0, lean * 0.12, lean * 0.2);
  out.add('spine', 0, lean * 0.1, lean * 0.16);
  out.add('chest', 0, lean * 0.08, lean * 0.12);
  out.add('head', 0, -lean * 0.22, -lean * 0.1);
  // Outside arm swings wide for balance.
  const outer = dir > 0 ? 'L' : 'R';
  const inner = dir > 0 ? 'R' : 'L';
  out.add(`upperArm_${outer}`, -0.2 * k, 0, (outer === 'L' ? 1 : -1) * 0.5 * k);
  out.add(`upperArm_${inner}`, 0.15 * k, 0, (inner === 'L' ? 1 : -1) * -0.2 * k);
  // Cross-step: the trailing leg reaches across.
  out.add(`thigh_${inner}`, 0.1 * k, 0, (inner === 'L' ? 1 : -1) * -0.28 * k);
  out.add(`thigh_${outer}`, -0.05 * k, 0, (outer === 'L' ? 1 : -1) * 0.14 * k);
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** ANM_Hero_Stumble: pitch forward, arms flail, then recover. */
export function stumble(t: number, out: Pose, gait: GaitParams): Pose {
  locomotion(t * 1.5, gait, out);
  const k = Math.sin(Math.min(1, t) * Math.PI);
  const flail = Math.sin(t * TAU * 3.2);
  out.add('spine', -0.55 * k);
  out.add('chest', -0.32 * k);
  out.add('head', 0.6 * k, 0.2 * flail * k, 0);
  out.add('upperArm_L', -1.1 * k, 0, 0.55 * k + 0.2 * flail * k);
  out.add('upperArm_R', -0.95 * k, 0, -0.62 * k - 0.2 * flail * k);
  out.add('forearm_L', 0.5 * k);
  out.add('forearm_R', 0.6 * k);
  out.add('thigh_L', 0.35 * k * flail);
  out.add('thigh_R', -0.3 * k * flail);
  out.offset.y -= 0.12 * k;
  return out;
}

/** ANM_Hero_Trip: the foot catches and the body folds over it. */
export function trip(t: number, out: Pose): Pose {
  out.identity();
  const k = smoothstep(Math.min(1, t * 1.6));
  out.set('hips', -0.5 * k);
  out.set('spine', -0.7 * k, 0.12 * k, 0);
  out.set('chest', -0.42 * k);
  out.set('head', 0.5 * k);
  out.set('thigh_L', -0.7 * k);
  out.set('calf_L', -1.5 * k);
  out.set('thigh_R', 0.9 * k);
  out.set('calf_R', -0.4 * k);
  out.setPair('upperArm', -1.4 * k, 0, 0.4);
  out.setPair('forearm', 0.35 * k, 0, 0.1);
  out.offset.set(0, -0.35 * k, -0.15 * k);
  return out;
}

/** ANM_Hero_Hit: sharp recoil from a frontal impact. */
export function hit(t: number, out: Pose): Pose {
  out.identity();
  const k = Math.exp(-t * 5) * Math.cos(t * 26) * (1 - smoothstep(t));
  const impact = smoothstep(Math.min(1, t * 5));
  out.set('spine', 0.35 * impact + 0.2 * k);
  out.set('chest', 0.28 * impact + 0.18 * k);
  out.set('neck', -0.3 * impact);
  out.set('head', -0.45 * impact + 0.2 * k);
  out.setPair('upperArm', -0.9 * impact, 0, 0.45);
  out.setPair('forearm', 1.15 * impact, 0, 0.14);
  out.setPair('thigh', 0.25 * impact, 0, 0.08);
  out.setPair('calf', -0.55 * impact);
  out.offset.set(0, -0.12 * impact, 0.08 * impact);
  return out;
}

/** ANM_Hero_Knockback: thrown backwards off the feet. */
export function knockback(t: number, out: Pose): Pose {
  out.identity();
  const k = smoothstep(Math.min(1, t * 1.3));
  out.set('hips', 0.85 * k, 0.15 * k, 0);
  out.set('spine', 0.5 * k, 0.1 * k, 0.1 * k);
  out.set('chest', 0.35 * k);
  out.set('head', -0.55 * k, 0.2 * k, 0);
  out.setPair('upperArm', -1.6 * k, 0, 0.7);
  out.setPair('forearm', 0.5 * k, 0, 0.12);
  out.set('thigh_L', 1.1 * k);
  out.set('thigh_R', 0.75 * k);
  out.setPair('calf', -0.75 * k);
  out.offset.set(0, -0.5 * k, 0.25 * k);
  return out;
}

/** ANM_Hero_Recover: back up to a run after a survivable hit. */
export function recover(t: number, out: Pose, gait: GaitParams): Pose {
  const k = 1 - easeOut(t);
  locomotion(t * 1.2, gait, out);
  out.add('spine', -0.4 * k);
  out.add('chest', -0.25 * k);
  out.add('head', 0.45 * k);
  out.add('upperArm_L', -0.5 * k, 0, 0.2 * k);
  out.add('upperArm_R', -0.5 * k, 0, -0.2 * k);
  out.offset.y -= 0.14 * k;
  return out;
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

/** ANM_Hero_Death_FallForward */
export function fallForward(t: number, out: Pose): Pose {
  out.identity();
  const k = smoothstep(Math.min(1, t * 1.1));
  const settle = smoothstep(Math.max(0, (t - 0.6) / 0.4));
  out.set('hips', -1.25 * k);
  out.set('spine', -0.35 * k + 0.15 * settle);
  out.set('chest', -0.2 * k);
  out.set('head', 0.35 * k - 0.5 * settle);
  out.setPair('upperArm', -1.5 * k, 0, 0.55 - 0.2 * settle);
  out.setPair('forearm', 0.9 * k);
  out.setPair('thigh', 0.35 * k);
  out.setPair('calf', -0.45 * k - 0.2 * settle);
  out.offset.set(0, -0.78 * k, -0.34 * k);
  return out;
}

/** ANM_Hero_Death_FallSideways */
export function fallSideways(t: number, out: Pose): Pose {
  out.identity();
  const k = smoothstep(Math.min(1, t * 1.05));
  out.set('hips', -0.2 * k, 0.3 * k, 1.35 * k);
  out.set('spine', -0.1 * k, 0.2 * k, 0.25 * k);
  out.set('chest', 0, 0.15 * k, 0.18 * k);
  out.set('head', 0.2 * k, -0.35 * k, -0.4 * k);
  out.set('upperArm_L', -1.15 * k, 0, 0.85 * k);
  out.set('upperArm_R', -0.55 * k, 0, -0.35 * k);
  out.setPair('forearm', 0.65 * k, 0, 0.1);
  out.set('thigh_L', 0.55 * k, 0, 0.3 * k);
  out.set('thigh_R', 0.2 * k, 0, 0.12 * k);
  out.setPair('calf', -0.85 * k);
  out.offset.set(0.22 * k, -0.8 * k, 0);
  return out;
}

/** ANM_Hero_Death_Collapse: legs give way straight down. */
export function collapse(t: number, out: Pose): Pose {
  out.identity();
  const drop = smoothstep(Math.min(1, t * 1.35));
  const fold = smoothstep(Math.max(0, (t - 0.35) / 0.65));
  out.setPair('thigh', 1.35 * drop, 0, 0.22 * drop);
  out.setPair('calf', -2.1 * drop);
  out.setPair('foot', 0.35 * drop);
  out.set('hips', -0.45 * fold);
  out.set('spine', -0.55 * fold);
  out.set('chest', -0.35 * fold);
  out.set('head', 0.5 * fold);
  out.setPair('upperArm', -0.65 * drop, 0, 0.35);
  out.setPair('forearm', 0.85 * drop, 0, 0.12);
  out.offset.set(0, -0.86 * drop, -0.08 * fold);
  return out;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** ANM_Hero_MenuIdle: relaxed stance with breathing and a slow look around. */
export function menuIdle(t: number, out: Pose): Pose {
  out.identity();
  const breath = Math.sin(t * TAU * 0.28);
  const sway = Math.sin(t * TAU * 0.16);
  out.set('hips', -0.02, sway * 0.05, sway * 0.04);
  out.set('spine', -0.03 + breath * 0.018, sway * 0.04, 0);
  out.set('chest', -0.02 + breath * 0.026, sway * 0.05, 0);
  out.set('neck', 0.03);
  out.set('head', 0.02 - breath * 0.02, -sway * 0.28, sway * 0.03);
  out.setPair('shoulder', breath * 0.03, 0, 0.02);
  out.set('upperArm_L', 0.04, 0, 0.14 + breath * 0.012);
  out.set('upperArm_R', 0.04, 0, -0.14 - breath * 0.012);
  out.setPair('forearm', 0.22, 0, 0.1);
  out.setPair('hand', 0.08, 0, 0.12);
  out.setPair('thigh', 0.02, 0, 0.035);
  out.setPair('calf', -0.06);
  out.offset.set(0, breath * 0.004, 0);
  return out;
}

/** ANM_Hero_MenuGesture: a beckoning wave on the menu. */
export function menuGesture(t: number, out: Pose): Pose {
  menuIdle(t, out);
  const k = Math.sin(Math.min(1, t) * Math.PI);
  const wave = Math.sin(t * TAU * 2.4);
  out.add('upperArm_R', -1.35 * k, 0, -0.55 * k);
  out.add('forearm_R', 0.85 * k, 0, -0.2 * k);
  out.add('hand_R', 0, 0, -0.45 * k * wave);
  out.add('chest', 0, -0.12 * k, 0);
  out.add('head', 0, -0.18 * k, 0);
  return out;
}

/** ANM_Hero_Victory: a fist pump. */
export function victory(t: number, out: Pose): Pose {
  out.identity();
  const pump = Math.max(0, Math.sin(t * TAU * 1.4));
  const k = smoothstep(Math.min(1, t * 2));
  out.set('spine', -0.08 * k + 0.05 * pump);
  out.set('chest', -0.05 * k);
  out.set('head', -0.18 * k - 0.12 * pump);
  out.set('upperArm_R', -2.35 * k * (0.7 + 0.3 * pump), 0, -0.35);
  out.set('forearm_R', 1.35 - 0.55 * pump, 0, -0.15);
  out.set('upperArm_L', -0.55 * k, 0, 0.3);
  out.set('forearm_L', 1.15 * k, 0, 0.12);
  out.setPair('thigh', 0.06, 0, 0.05);
  out.setPair('calf', -0.14 - 0.12 * pump);
  out.offset.set(0, 0.03 * pump, 0);
  return out;
}

/** ANM_Hero_Celebration: a small hop with both arms up. */
export function celebration(t: number, out: Pose): Pose {
  out.identity();
  const hop = Math.max(0, Math.sin(t * TAU * 1.1));
  const k = smoothstep(Math.min(1, t * 2.5));
  out.setPair('upperArm', -2.5 * k, 0, 0.45);
  out.setPair('forearm', 0.55 + 0.35 * hop, 0, 0.1);
  out.set('spine', 0.1 * k);
  out.set('chest', 0.08 * k);
  out.set('head', -0.3 * k);
  out.setPair('thigh', 0.15 + 0.35 * (1 - hop), 0, 0.06);
  out.setPair('calf', -0.3 - 0.5 * (1 - hop));
  out.setPair('foot', -0.25 * hop);
  out.offset.set(0, hop * 0.16 - 0.06, 0);
  return out;
}

/** Secondary motion applied on top of everything: breath and head levelling. */
export function secondaryLayer(
  out: Pose,
  time: number,
  speed: number,
  verticalVelocity: number,
  pitchCompensation: number,
): void {
  const breath = Math.sin(time * TAU * (0.28 + speed * 0.02));
  out.add('chest', breath * 0.014, 0, 0);
  out.add('spine', breath * 0.008, 0, 0);
  // Head levelling: counter part of the body's vertical motion so the gaze
  // stays on the horizon, which is what stops a run looking robotic.
  const level = Math.max(-0.3, Math.min(0.3, verticalVelocity * 0.012));
  out.add('neck', -level * 0.5 + pitchCompensation * 0.4, 0, 0);
  out.add('head', -level * 0.5 + pitchCompensation * 0.6, 0, 0);
}
