import { SEGMENT_TEMPLATES } from '../../data/segments';
import { OBSTACLE_BY_ID } from '../../data/obstacles';
import { POWERUP_DEFS } from '../../data/powerups';
import { CFG, laneToX } from '../core/Config';
import { Random } from '../core/Random';
import { LaneIndex, ObstacleDef, SegmentTemplate } from '../core/Types';
import { CoinPatternId, expandCoinPattern } from '../collectibles/CoinFactory';
import { DifficultyManager } from './DifficultyManager';
import { reactionDistance, SegmentValidator, SolverObstacle } from './SegmentValidator';

/**
 * The generator. It never places obstacles at random: it picks a template that
 * fits the current difficulty and the lanes the player can actually be in,
 * expands it, proves it survivable with the validator, repairs it if it is
 * not, and only then hands it to the world.
 */

export interface PlannedObstacle {
  def: ObstacleDef;
  lane: LaneIndex;
  /** Absolute track Z. */
  z: number;
  /** Drift for dynamic hazards, metres per second. */
  driftZ: number;
  driftX: number;
  seed: number;
}

export interface PlannedCoin {
  x: number;
  y: number;
  z: number;
}

export interface PlannedPowerUp {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface PlannedSegment {
  index: number;
  templateId: string;
  /** Absolute track Z of the segment entry. */
  startZ: number;
  length: number;
  obstacles: PlannedObstacle[];
  coins: PlannedCoin[];
  powerUps: PlannedPowerUp[];
  exitLanes: LaneIndex[];
  difficulty: number;
  /** Diagnostics for the debug overlay. */
  attempts: number;
  repaired: boolean;
  worstApproach: number;
}

/** How many segments must pass before a template can repeat. */
const DEFAULT_COOLDOWN = 4;
const MAX_ATTEMPTS = 8;

export class ProceduralGenerator {
  private readonly validator = new SegmentValidator();
  private rng: Random;
  private recent: string[] = [];
  private segmentIndex = 0;
  private nextZ = 0;
  private entryLanes: LaneIndex[] = [0, 1, 2];
  /** Segments since the last breather, used to pace the run. */
  private sinceBreather = 0;
  private sincePowerUp = 0;

  /** Diagnostics. */
  stats = { generated: 0, rejected: 0, repaired: 0, fallbacks: 0 };

  constructor(seed: number, private readonly difficulty: DifficultyManager) {
    this.rng = new Random(seed);
  }

  get validatorStats(): { accepted: number; rejections: number } {
    return { accepted: this.validator.accepted, rejections: this.validator.rejections };
  }

  reset(seed: number): void {
    this.rng = new Random(seed);
    this.recent = [];
    this.segmentIndex = 0;
    this.nextZ = 0;
    this.entryLanes = [0, 1, 2];
    this.sinceBreather = 0;
    this.sincePowerUp = 0;
    this.stats = { generated: 0, rejected: 0, repaired: 0, fallbacks: 0 };
    this.validator.resetStats();
  }

  /** Z at which the next segment will start. */
  get frontier(): number {
    return this.nextZ;
  }

  /**
   * Produces the next segment. `speed` is the speed the player will actually
   * be doing when they reach it, which is what the fairness solver is run at.
   */
  next(speed: number): PlannedSegment {
    const difficulty = this.difficulty.current;
    const startZ = this.nextZ;
    const length = CFG.segmentLength;

    // The first stretch of every run is a guaranteed clean approach so the
    // player is moving before anything is asked of them.
    if (this.segmentIndex < 2) {
      const plan = this.emptySegment(startZ, length, difficulty, 'SEG_Intro');
      if (this.segmentIndex === 1) {
        for (const c of expandCoinPattern('PAT_Straight', 1, startZ + 6)) plan.coins.push(c);
      }
      this.commit(plan);
      return plan;
    }

    const candidates = this.candidateTemplates(difficulty);
    let attempts = 0;

    for (const template of candidates) {
      attempts++;
      if (attempts > MAX_ATTEMPTS) break;
      const plan = this.expand(template, startZ, length, difficulty, speed);
      const result = this.validate(plan, speed, difficulty, length);
      if (result.survivable) {
        plan.attempts = attempts;
        plan.exitLanes = result.exitLanes.length ? (result.exitLanes as LaneIndex[]) : [1];
        plan.worstApproach = result.worstApproach;
        this.stats.generated++;
        this.commit(plan);
        return plan;
      }

      // Repair: drop the obstacles the solver could not get past and retry
      // once. A repaired segment is still a real segment, just kinder.
      this.stats.rejected++;
      const repaired = this.repair(plan, result.blockers);
      if (repaired) {
        const retry = this.validate(plan, speed, difficulty, length);
        if (retry.survivable) {
          plan.repaired = true;
          plan.attempts = attempts;
          plan.exitLanes = retry.exitLanes.length ? (retry.exitLanes as LaneIndex[]) : [1];
          plan.worstApproach = retry.worstApproach;
          this.stats.repaired++;
          this.stats.generated++;
          this.commit(plan);
          return plan;
        }
      }
    }

    // Nothing fitted: ship a clean segment rather than an unfair one.
    this.stats.fallbacks++;
    const fallback = this.emptySegment(startZ, length, difficulty, 'SEG_Fallback');
    fallback.attempts = attempts;
    this.commit(fallback);
    return fallback;
  }

  private commit(plan: PlannedSegment): void {
    this.nextZ += plan.length;
    this.segmentIndex++;
    this.entryLanes = plan.exitLanes.length ? plan.exitLanes : [0, 1, 2];
    this.recent.push(plan.templateId);
    if (this.recent.length > 12) this.recent.shift();
    this.sinceBreather = plan.obstacles.length === 0 ? 0 : this.sinceBreather + 1;
    this.sincePowerUp = plan.powerUps.length > 0 ? 0 : this.sincePowerUp + 1;
  }

  private emptySegment(startZ: number, length: number, difficulty: number, id: string): PlannedSegment {
    return {
      index: this.segmentIndex,
      templateId: id,
      startZ,
      length,
      obstacles: [],
      coins: [],
      powerUps: [],
      exitLanes: [0, 1, 2],
      difficulty,
      attempts: 0,
      repaired: false,
      worstApproach: length,
    };
  }

  /**
   * Ordered list of templates worth trying, best first. Pacing rules live
   * here: forced breathers, power-up drought relief, no immediate repeats.
   */
  private candidateTemplates(difficulty: number): SegmentTemplate[] {
    const needBreather = this.sinceBreather >= 3 + Math.round((1 - difficulty) * 2);
    const needPowerUp = this.sincePowerUp >= 9;

    const pool = SEGMENT_TEMPLATES.filter((t) => {
      if (difficulty < t.minDifficulty || difficulty > t.maxDifficulty) return false;
      // The template must be enterable from at least one lane the player can
      // actually be in when they arrive.
      if (!t.entryLanes.some((l) => this.entryLanes.includes(l))) return false;
      const cooldown = t.cooldown ?? DEFAULT_COOLDOWN;
      const lastIndex = this.recent.lastIndexOf(t.id);
      if (lastIndex >= 0 && this.recent.length - lastIndex <= cooldown) return false;
      if (needBreather && t.items.some((i) => i.type === 'obstacle' || i.type === 'train')) return false;
      if (needPowerUp && !t.items.some((i) => i.type === 'powerup')) return false;
      return true;
    });

    if (pool.length === 0) {
      return SEGMENT_TEMPLATES.filter((t) => t.kind === 'straight' || t.kind === 'coin');
    }

    // Weighted draw without replacement, so retries try genuinely different
    // templates rather than rerolling the same favourite.
    const remaining = [...pool];
    const ordered: SegmentTemplate[] = [];
    while (remaining.length > 0 && ordered.length < MAX_ATTEMPTS) {
      const pick = this.rng.weighted(remaining, (t) => this.weightFor(t, difficulty));
      ordered.push(pick);
      remaining.splice(remaining.indexOf(pick), 1);
    }
    return ordered;
  }

  private weightFor(t: SegmentTemplate, difficulty: number): number {
    let w = t.weight;
    // Favour templates authored near the current difficulty.
    const centre = (t.minDifficulty + Math.min(1, t.minDifficulty + 0.35)) / 2;
    w *= 1 / (1 + Math.abs(difficulty - centre) * 2.2);
    if (t.kind === 'special' && this.rng.next() > this.difficulty.dynamicChance + 0.2) w *= 0.35;
    if (t.kind === 'powerup') w *= 0.6 + this.sincePowerUp * 0.25;
    return Math.max(0.01, w);
  }

  /** Turns a template into concrete world placements. */
  private expand(
    template: SegmentTemplate,
    startZ: number,
    length: number,
    difficulty: number,
    speed: number,
  ): PlannedSegment {
    const plan = this.emptySegment(startZ, length, difficulty, template.id);

    for (const item of template.items) {
      switch (item.type) {
        case 'obstacle':
        case 'train': {
          const def = OBSTACLE_BY_ID[item.id!];
          if (!def) break;
          const dynamic = def.category === 'dynamic';
          // A service train runs the other way. Everything else on a train
          // lane is parked stock.
          const oncoming = def.id === 'OBS_TrainMoving_01';
          plan.obstacles.push({
            def,
            lane: item.lane,
            z: startZ + item.z + (item.type === 'train' ? (item.length ?? def.depth) / 2 : 0),
            // Moving hazards close on the player slowly enough to stay fair:
            // never faster than a quarter of the closing speed.
            driftZ: oncoming
              ? -speed * CFG.oncomingTrain.speedFactor
              : dynamic ? this.rng.range(-0.18, 0.22) * speed * 0.25 : 0,
            driftX: def.id === 'OBS_SlidingBarrier_01' ? this.rng.range(0.6, 1.1) : 0,
            seed: this.rng.int(1, 0xffff),
          });
          break;
        }
        case 'coinPattern': {
          for (const c of expandCoinPattern(item.id as CoinPatternId, item.lane, startZ + item.z, item.y)) {
            plan.coins.push(c);
          }
          break;
        }
        case 'coin':
          plan.coins.push({ x: laneToX(item.lane), y: item.y ?? CFG.coins.height, z: startZ + item.z });
          break;
        case 'powerup': {
          const def = this.rng.pick(POWERUP_DEFS);
          plan.powerUps.push({
            id: def.id,
            x: laneToX(item.lane),
            y: item.y ?? 1.35,
            z: startZ + item.z,
          });
          break;
        }
        case 'prop':
          break;
      }
    }

    // Opportunistic extras: a coin trail on an empty lane, or a rare bonus
    // power-up when the player has gone a long time without one.
    if (plan.coins.length === 0 && this.rng.bool(this.difficulty.bonusCoinChance)) {
      const freeLane = this.freeLane(plan);
      if (freeLane !== null) {
        for (const c of expandCoinPattern('PAT_Straight', freeLane, startZ + 5)) plan.coins.push(c);
      }
    }
    if (plan.powerUps.length === 0 && this.rng.bool(this.difficulty.powerUpChance)) {
      const freeLane = this.freeLane(plan);
      if (freeLane !== null) {
        plan.powerUps.push({
          id: this.rng.pick(POWERUP_DEFS).id,
          x: laneToX(freeLane),
          y: 1.35,
          z: startZ + length * 0.6,
        });
      }
    }

    return plan;
  }

  /** A lane with no obstacle in this segment, preferring the centre. */
  private freeLane(plan: PlannedSegment): LaneIndex | null {
    const order: LaneIndex[] = [1, 0, 2];
    for (const lane of order) {
      if (!plan.obstacles.some((o) => o.lane === lane)) return lane;
    }
    return null;
  }

  /** Runs the fairness solver over the segment plus its approach. */
  private validate(plan: PlannedSegment, speed: number, difficulty: number, length: number) {
    // A moving hazard is proved over the whole range it can occupy while the
    // player crosses the segment, not just where it starts. That keeps the
    // survivability proof valid for drifting obstacles too.
    const crossingTime = length / Math.max(1, speed);
    const solverObstacles: SolverObstacle[] = plan.obstacles.map((o) => {
      const depth = o.def.depth;
      const centreY = o.def.yOffset;
      const sweep = Math.abs(o.driftZ) * crossingTime;
      return {
        id: `${o.def.id}@${o.lane}:${Math.round(o.z)}`,
        lane: o.lane,
        zStart: o.z - depth / 2 - sweep - plan.startZ,
        zEnd: o.z + depth / 2 + sweep - plan.startZ,
        minY: centreY - o.def.height / 2,
        maxY: centreY + o.def.height / 2,
        standable: !!o.def.standable,
        slope: !!o.def.slope,
      };
    });

    return this.validator.solve(solverObstacles, {
      length,
      speed,
      entryLanes: this.entryLanes,
      reactionDistance: reactionDistance(speed, difficulty),
    });
  }

  /** Removes the obstacles the solver flagged as unpassable. */
  private repair(plan: PlannedSegment, blockers: string[]): boolean {
    if (blockers.length === 0) return false;
    const before = plan.obstacles.length;
    const blocked = new Set(blockers);
    plan.obstacles = plan.obstacles.filter(
      (o) => !blocked.has(`${o.def.id}@${o.lane}:${Math.round(o.z)}`),
    );
    // Never repair a segment into emptiness by deleting everything blindly:
    // if the whole thing was unpassable the caller falls through to another
    // template instead.
    if (plan.obstacles.length === before) return false;
    return plan.obstacles.length > 0 || before <= 2;
  }
}
