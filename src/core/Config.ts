/**
 * Central tuning table. Gameplay maths lives here so the fairness validator,
 * the player controller and the generator all reason about identical numbers.
 */
export const CFG = {
  /** Three lanes, centre lane index 1. */
  laneCount: 3,
  laneWidth: 2.4,

  /** Modular track segment length in metres. Every template is authored to this. */
  segmentLength: 24,
  /** How far ahead of the player segments stay resident. */
  viewDistance: 210,
  /** How far behind the player a segment survives before recycling. */
  recycleDistance: 34,

  speed: {
    base: 11.5,
    /** m/s per second of elapsed run time. */
    acceleration: 0.085,
    max: 31,
    /** Reference speed the run animation was authored at. */
    referenceRun: 12,
  },

  jump: {
    gravity: -60,
    // Peak 2.70 m: high enough to land on a container (2.55) and, from a
    // ramp, on a train roof. Air time 0.60 s.
    velocity: 18.0,
    /** Grace period after leaving the ground during which a jump still fires. */
    coyoteTime: 0.11,
    /** How early an input is remembered before landing. */
    bufferTime: 0.16,
    /** Downward force multiplier when the jump key is released early. */
    cutMultiplier: 2.1,
  },

  slide: {
    duration: 0.72,
    /** Collider height while sliding. */
    height: 0.85,
    /** Extra downward force so a slide from mid-air snaps to the floor. */
    airSnap: -34,
  },

  player: {
    /** Standing capsule. */
    height: 1.78,
    radius: 0.34,
    laneChangeDuration: 0.17,
    /** Horizontal half width used for collision against obstacles. */
    halfWidth: 0.32,
    /** A miss inside this radius counts as a near miss. */
    nearMissRadius: 0.95,
    /** Invulnerability window after a non fatal stumble. */
    stumbleInvuln: 0.9,
    /** Number of stumbles survivable before the run ends. */
    stumbleAllowance: 1,
  },

  camera: {
    distance: 7.4,
    height: 3.3,
    lookAhead: 9.5,
    // Aim above the runner's head so the horizon sits high enough to read the
    // road ahead, rather than staring down at the sleepers.
    lookHeight: 1.95,
    baseFov: 62,
    maxFovBoost: 13,
    /** Positional smoothing half-life in seconds. */
    smoothing: 0.09,
    laneLean: 0.055,
    near: 0.1,
    far: 420,
  },

  score: {
    /** Points per metre before multipliers. */
    perMetre: 1.0,
    perCoin: 10,
    nearMiss: 25,
    /** Combo increments per pickup, decays after this idle time. */
    comboWindow: 2.4,
    comboStep: 1,
    comboMax: 30,
    /** Multiplier granted per N combo. */
    comboPerMultiplier: 8,
    multiplierMax: 8,
  },

  difficulty: {
    /** Distance in metres at which difficulty reaches 1.0. */
    rampDistance: 4200,
    /** Minimum reaction time the fairness engine guarantees, in seconds. */
    reactionTimeEasy: 0.95,
    reactionTimeHard: 0.52,
    /** Obstacle density scalar across the difficulty range. */
    densityEasy: 0.45,
    densityHard: 1.0,
  },

  coins: {
    /** Vertical offset of a ground level coin. */
    height: 1.15,
    radius: 0.34,
    magnetRadius: 9.5,
    magnetSpeed: 26,
    pickupRadius: 1.05,
  },

  world: {
    /** Track surface Y. */
    groundY: 0,
    /** Distance between origin rebases is unnecessary: the world is drawn
     *  relative to the player, so precision stays constant forever. */
    trainRoofHeight: 3.15,
    /** Ambient prop scatter half-width either side of the track. */
    decorHalfWidth: 46,
  },

  performance: {
    /** Hard ceiling on simultaneous particles. */
    maxParticles: 1400,
    /** Distance at which hero swaps LOD. */
    heroLod1: 26,
    heroLod2: 70,
    /** Cap on delta time to survive tab switches. */
    maxDelta: 1 / 15,
    targetFps: 60,
  },
} as const;

/** World X for a lane index. */
export function laneToX(lane: number): number {
  return (lane - (CFG.laneCount - 1) / 2) * CFG.laneWidth;
}

/** Total airborne time for a full jump, used by the fairness solver. */
export const JUMP_AIR_TIME = (2 * CFG.jump.velocity) / -CFG.jump.gravity;
/** Peak jump height. */
export const JUMP_PEAK = (CFG.jump.velocity * CFG.jump.velocity) / (2 * -CFG.jump.gravity);
