import { CFG } from '../core/Config';

/**
 * The fairness engine.
 *
 * Before any pattern reaches the player it is proved survivable by simulating
 * every legal sequence of run / jump / slide / lane-change decisions across the
 * segment and checking that at least one reaches the exit untouched. This is a
 * real breadth-first search over the player's state space, not a heuristic, so
 * "the generator killed me" cannot happen.
 *
 * On top of survivability it enforces a reaction-time guarantee: at the moment
 * the player must commit to an action, they must have had at least
 * `reactionDistance` metres of clear approach in some reachable lane.
 */

export interface SolverObstacle {
  lane: number;
  /** Local Z range within the window, metres. */
  zStart: number;
  zEnd: number;
  /** Vertical extent above the deck. */
  minY: number;
  maxY: number;
  /** Roof can be landed on and run along. */
  standable: boolean;
  /** Walkable surface rises linearly from zStart (deck) to zEnd (maxY). */
  slope?: boolean;
  id: string;
}

/** Walkable height of an obstacle at a given Z; ramps rise across their run. */
function surfaceOf(o: SolverObstacle, z: number): number {
  if (!o.slope) return o.maxY;
  const span = o.zEnd - o.zStart;
  if (span <= 0) return o.maxY;
  const t = Math.min(1, Math.max(0, (z - o.zStart) / span));
  return o.maxY * t;
}

export interface SolveOptions {
  /** Total window length in metres. */
  length: number;
  /** Player speed used for the timing model. */
  speed: number;
  /** Lanes the player may enter the window in. */
  entryLanes: number[];
  /** Metres of clear approach required before a forced action. */
  reactionDistance: number;
  /** Resolution of the simulation, metres. Smaller is stricter and slower. */
  step?: number;
}

export interface SolveResult {
  survivable: boolean;
  /** Lanes the player can be in at the exit; feeds the next segment. */
  exitLanes: number[];
  /** Smallest clear approach any forced decision had, in metres. */
  worstApproach: number;
  /** Obstacles that no route could clear, for the debug overlay. */
  blockers: string[];
  /** How many distinct states were explored; used by the perf report. */
  explored: number;
}

const MODE_GROUND = 0;

/**
 * Upper bound on distinct standing heights tracked per solve. Ramps are
 * sampled along their rise, so this needs enough room for a slope's steps
 * plus any flat roofs in the same window.
 */
const MAX_SURFACES = 12;
/** Vertical resolution of the standing-height buckets, metres. */
const SURFACE_RESOLUTION = 0.2;

interface Model {
  step: number;
  zSteps: number;
  airSteps: number;
  slideSteps: number;
  laneSteps: number;
  modes: number;
  /** Jump arc height above the take-off surface, per air step. */
  arc: Float32Array;
  /** Air step whose vertical velocity is zero; where a roof fall begins. */
  apexStep: number;
}

function buildModel(speed: number, length: number, step: number): Model {
  const airTime = (2 * CFG.jump.velocity) / -CFG.jump.gravity;
  const airSteps = Math.max(1, Math.ceil((airTime * speed) / step));
  const slideSteps = Math.max(1, Math.ceil((CFG.slide.duration * speed) / step));
  const laneSteps = Math.max(1, Math.ceil((CFG.player.laneChangeDuration * speed) / step));
  const arc = new Float32Array(airSteps + 1);
  for (let k = 0; k <= airSteps; k++) {
    const t = (k * step) / speed;
    arc[k] = CFG.jump.velocity * t + 0.5 * CFG.jump.gravity * t * t;
  }
  return {
    step,
    zSteps: Math.max(1, Math.ceil(length / step)),
    airSteps,
    slideSteps,
    laneSteps,
    // ground + air(1..airSteps) + slide(1..slideSteps)
    modes: 1 + airSteps + slideSteps,
    arc,
    apexStep: Math.max(1, Math.min(airSteps, Math.round(airSteps / 2))),
  };
}

/** Vertical extent the player occupies in a given mode. */
function playerBox(model: Model, mode: number, surface: number): { min: number; max: number; landing: boolean } {
  if (mode === MODE_GROUND) {
    return { min: surface, max: surface + CFG.player.height, landing: false };
  }
  if (mode <= model.airSteps) {
    const y = surface + model.arc[mode];
    return { min: y, max: y + CFG.player.height, landing: model.arc[mode] < model.arc[Math.max(0, mode - 1)] };
  }
  return { min: surface, max: surface + CFG.slide.height, landing: false };
}

export class SegmentValidator {
  /** Rejected pattern count, surfaced in the debug overlay. */
  rejections = 0;
  /** Accepted pattern count. */
  accepted = 0;

  // Scratch buffers reused across solves so a solve allocates nothing.
  private visited = new Uint8Array(0);
  private frontier = new Int32Array(4096);
  private nextFrontier = new Int32Array(4096);
  private laneReach = new Uint8Array(0);
  private readonly surfaces = new Float64Array(MAX_SURFACES);
  private surfaceCount = 1;

  /**
   * Proves the window survivable and reports the exit lane set.
   *
   * Breadth-first over (z, lane, vertical mode, standing surface). Surfaces
   * are collected from the actual standable obstacles in the window, so a
   * roof route is only considered reachable if the jump arc really gets there.
   */
  solve(obstacles: SolverObstacle[], opts: SolveOptions): SolveResult {
    const step = opts.step ?? 0.5;
    const model = buildModel(opts.speed, opts.length, step);
    const lanes = CFG.laneCount;

    // Distinct standable heights, deck first.
    this.surfaces[0] = 0;
    this.surfaceCount = 1;
    for (const o of obstacles) {
      if (!o.standable && !o.slope) continue;
      // A ramp is sampled along its rise so the player can climb it a step at
      // a time and take off from anywhere on it, not only from the very top.
      const heights: number[] = [];
      if (o.slope) {
        const steps = Math.max(1, Math.ceil(o.maxY / SURFACE_RESOLUTION));
        for (let k = 1; k <= steps; k++) heights.push((o.maxY * k) / steps);
      } else {
        heights.push(o.maxY);
      }
      for (const h of heights) {
        let seen = false;
        for (let i = 0; i < this.surfaceCount; i++) {
          if (Math.abs(this.surfaces[i] - h) < SURFACE_RESOLUTION * 0.5) { seen = true; break; }
        }
        if (!seen && this.surfaceCount < MAX_SURFACES) this.surfaces[this.surfaceCount++] = h;
      }
    }
    const surfaceCount = this.surfaceCount;
    const surfaces = this.surfaces;
    // Snap a continuous surface height to the nearest tracked bucket.
    const surfaceIndex = (h: number) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < surfaceCount; i++) {
        const d = Math.abs(surfaces[i] - h);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    const perZ = lanes * model.modes * surfaceCount;
    const total = (model.zSteps + 1) * perZ;
    if (this.visited.length < total) this.visited = new Uint8Array(total);
    else this.visited.fill(0, 0, total);
    const visited = this.visited;

    const laneReachSize = (model.zSteps + 1) * lanes;
    if (this.laneReach.length < laneReachSize) this.laneReach = new Uint8Array(laneReachSize);
    else this.laneReach.fill(0, 0, laneReachSize);
    const laneReach = this.laneReach;

    if (this.frontier.length < perZ) {
      this.frontier = new Int32Array(perZ);
      this.nextFrontier = new Int32Array(perZ);
    }
    let frontier = this.frontier;
    let nextFrontier = this.nextFrontier;
    let frontierCount = 0;
    let nextCount = 0;

    // Per-lane obstacle lists; obstacle counts are small so a linear scan of
    // one lane's list is faster than building a spatial index.
    const byLane: SolverObstacle[][] = [[], [], []];
    for (const o of obstacles) {
      if (o.lane >= 0 && o.lane < lanes) byLane[o.lane].push(o);
    }

    const blockedIn = (lane: number, z0: number, z1: number, min: number, max: number): SolverObstacle | null => {
      const list = byLane[lane];
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o.zEnd <= z0 || o.zStart >= z1) continue;
        // A ramp only blocks what is below its slope at the trailing edge.
        const top = o.slope ? surfaceOf(o, z1) : o.maxY;
        if (top <= min || o.minY >= max) continue;
        if ((o.standable || o.slope) && min >= top - 0.14) continue;
        return o;
      }
      return null;
    };

    const supportAt = (lane: number, z0: number, z1: number, feet: number): number => {
      const list = byLane[lane];
      let best = 0;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!o.standable && !o.slope) continue;
        if (o.zEnd <= z0 || o.zStart >= z1) continue;
        const top = surfaceOf(o, z1);
        if (top <= feet + 0.55 && top > best) best = top;
      }
      return best;
    };

    const key = (zi: number, lane: number, mode: number, si: number) =>
      zi * perZ + (lane * model.modes + mode) * surfaceCount + si;

    for (const lane of opts.entryLanes) {
      if (lane < 0 || lane >= lanes) continue;
      const k = key(0, lane, MODE_GROUND, 0);
      if (visited[k]) continue;
      visited[k] = 1;
      frontier[frontierCount++] = k;
      laneReach[lane] = 1;
    }

    const blockers = new Set<string>();
    let explored = frontierCount;
    let exitMask = 0;

    // Reusable transition scratch: at most three next modes per state.
    const modeBuf = [0, 0, 0];

    for (let zi = 0; zi < model.zSteps; zi++) {
      const z0 = zi * step;
      const z1 = z0 + step;
      const laneSweepEnd = z0 + step * model.laneSteps;
      nextCount = 0;

      for (let f = 0; f < frontierCount; f++) {
        const k = frontier[f];
        const local = k - zi * perZ;
        const si = local % surfaceCount;
        const rest = (local - si) / surfaceCount;
        const mode = rest % model.modes;
        const lane = (rest - mode) / model.modes;
        const surface = surfaces[si];

        let modeCount = 0;
        if (mode === MODE_GROUND) {
          modeBuf[modeCount++] = MODE_GROUND;
          modeBuf[modeCount++] = 1;
          modeBuf[modeCount++] = model.airSteps + 1;
        } else if (mode <= model.airSteps) {
          modeBuf[modeCount++] = mode + 1 > model.airSteps ? MODE_GROUND : mode + 1;
        } else {
          const slideStep = mode - model.airSteps;
          modeBuf[modeCount++] = slideStep + 1 > model.slideSteps ? MODE_GROUND : model.airSteps + slideStep + 1;
        }

        const laneLo = lane > 0 ? lane - 1 : lane;
        const laneHi = lane < lanes - 1 ? lane + 1 : lane;

        for (let nl = laneLo; nl <= laneHi; nl++) {
          const changing = nl !== lane;
          for (let mi = 0; mi < modeCount; mi++) {
            let m = modeBuf[mi];
            let nextSurface = surface;

            if (m > 0 && m <= model.airSteps) {
              const y = surface + model.arc[m];
              const descending = model.arc[m] < model.arc[m - 1];
              if (descending) {
                const ground = supportAt(nl, z0, z1, y);
                if (y <= ground) {
                  m = MODE_GROUND;
                  nextSurface = ground;
                }
              }
            } else if (m === MODE_GROUND) {
              const ground = supportAt(nl, z0, z1, surface);
              if (surface > 0.05 && ground < surface - 0.05) {
                // Ran off the edge of a roof: fall from the arc apex.
                m = model.apexStep;
                nextSurface = surface;
              } else {
                nextSurface = ground;
              }
            }

            const box = playerBox(model, m, nextSurface);
            let hit = blockedIn(lane, z0, changing ? laneSweepEnd : z1, box.min, box.max);
            if (!hit && changing) hit = blockedIn(nl, z0, laneSweepEnd, box.min, box.max);
            if (hit) {
              blockers.add(hit.id);
              continue;
            }

            const nsi = surfaceIndex(nextSurface);
            const nk = key(zi + 1, nl, m, nsi);
            if (visited[nk]) continue;
            visited[nk] = 1;
            explored++;
            nextFrontier[nextCount++] = nk;
            laneReach[(zi + 1) * lanes + nl] = 1;
            if (zi + 1 === model.zSteps && m === MODE_GROUND) exitMask |= 1 << nl;
          }
        }
      }

      const swap = frontier;
      frontier = nextFrontier;
      nextFrontier = swap;
      frontierCount = nextCount;

      if (frontierCount === 0) {
        this.frontier = frontier;
        this.nextFrontier = nextFrontier;
        this.rejections++;
        return { survivable: false, exitLanes: [], worstApproach: 0, blockers: [...blockers], explored };
      }
    }

    this.frontier = frontier;
    this.nextFrontier = nextFrontier;

    const exitLanes: number[] = [];
    for (let l = 0; l < lanes; l++) if (exitMask & (1 << l)) exitLanes.push(l);
    if (exitLanes.length === 0) {
      for (let l = 0; l < lanes; l++) if (laneReach[model.zSteps * lanes + l]) exitLanes.push(l);
    }

    // Reaction guarantee: at the point the player had to commit, did they have
    // at least `reactionDistance` of clear approach in a lane they could be in?
    let worstApproach = Infinity;
    for (const o of obstacles) {
      if (o.standable) continue;
      const approachZ = Math.max(0, o.zStart - opts.reactionDistance);
      const approachIndex = Math.min(model.zSteps, Math.floor(approachZ / step));
      let best = 0;
      for (let l = 0; l < lanes; l++) {
        if (!laneReach[approachIndex * lanes + l]) continue;
        best = Math.max(best, this.clearRunUp(byLane[l], o.zStart));
      }
      worstApproach = Math.min(worstApproach, best);
    }
    if (!Number.isFinite(worstApproach)) worstApproach = opts.length;

    this.accepted++;
    return { survivable: true, exitLanes, worstApproach, blockers: [], explored };
  }

  /** Distance of clear track immediately before `z` in one lane. */
  private clearRunUp(laneObstacles: SolverObstacle[], z: number): number {
    let nearest = z;
    for (const o of laneObstacles) {
      if (o.zEnd <= z && z - o.zEnd < nearest) nearest = z - o.zEnd;
    }
    return nearest;
  }

  resetStats(): void {
    this.rejections = 0;
    this.accepted = 0;
  }
}

/** Reaction distance in metres for the current speed and difficulty. */
export function reactionDistance(speed: number, difficulty: number): number {
  const t = CFG.difficulty.reactionTimeEasy +
    (CFG.difficulty.reactionTimeHard - CFG.difficulty.reactionTimeEasy) * Math.min(1, Math.max(0, difficulty));
  return speed * t;
}
