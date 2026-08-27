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
  /**
   * Record a concrete surviving route as well as proving one exists.
   *
   * Off by default: it costs a parent pointer and an action byte per state,
   * which the generator does not need. The differential test turns it on so
   * the route can be replayed through the real player physics.
   */
  witness?: boolean;
}

/** One decision on a surviving route, in segment-local metres. */
export interface WitnessStep {
  /** Local Z at which the action is taken. */
  z: number;
  /** Lane the player is in when taking it. */
  lane: number;
  /** Lane to move to; equals `lane` when holding. */
  toLane: number;
  action: 'run' | 'jump' | 'slide';
}

export interface SolveResult {
  /** True only when a route exists *and* the reaction guarantee is met. */
  survivable: boolean;
  /** A route exists, but the approach to some obstacle was too short. */
  rushed: boolean;
  /** Lanes the player can be in at the exit; feeds the next segment. */
  exitLanes: number[];
  /** Smallest clear approach any forced decision had, in metres. */
  worstApproach: number;
  /** Obstacles that no route could clear, for the debug overlay. */
  blockers: string[];
  /** How many distinct states were explored; used by the perf report. */
  explored: number;
  /** A concrete surviving route, when `witness` was requested. */
  route?: WitnessStep[];
}

const MODE_GROUND = 0;

/**
 * Upper bound on distinct standing heights tracked per solve. Ramps are
 * sampled along their rise, so this needs enough room for a slope's steps
 * plus any flat roofs in the same window.
 */
const MAX_SURFACES = 12;
/** Tallest surface a player can run off, used to size the free-fall table. */
const MAX_FALL_HEIGHT = 6;
/**
 * Fraction of the nominal reaction distance that must separate consecutive
 * forced decisions in a lane. 1.0 is the full promise.
 */
const MIN_APPROACH_FRACTION = 1.0;
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
  /** Steps in a free fall from rest, long enough to drop off the tallest roof. */
  fallSteps: number;
  /** Drop below the take-off surface after k steps of free fall from rest. */
  fallDrop: Float32Array;
  /** First mode index of the falling range. */
  fallBase: number;
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

  // Free fall from rest, for a player who runs off the end of a roof rather
  // than jumping. This is a different curve from the jump arc: it starts at
  // zero vertical velocity and only descends.
  const fallTime = Math.sqrt((2 * MAX_FALL_HEIGHT) / -CFG.jump.gravity);
  const fallSteps = Math.max(1, Math.ceil((fallTime * speed) / step) + 1);
  const fallDrop = new Float32Array(fallSteps + 1);
  for (let k = 0; k <= fallSteps; k++) {
    const t = (k * step) / speed;
    fallDrop[k] = 0.5 * -CFG.jump.gravity * t * t;
  }

  return {
    step,
    zSteps: Math.max(1, Math.ceil(length / step)),
    airSteps,
    slideSteps,
    laneSteps,
    // ground + air(1..airSteps) + slide(1..slideSteps) + fall(1..fallSteps)
    modes: 1 + airSteps + slideSteps + fallSteps,
    arc,
    fallSteps,
    fallDrop,
    fallBase: 1 + airSteps + slideSteps,
  };
}

/**
 * Vertical extent the player occupies in a given mode, and how deep the
 * collision box is along the run axis in that mode.
 *
 * The depth matters because the solver plans on a grid of player centres: an
 * obstacle is reached by the leading edge a half-depth before the centre gets
 * there, and left by the trailing edge a half-depth after.
 */
function playerBox(
  model: Model, mode: number, surface: number,
): { min: number; max: number; landing: boolean; halfDepth: number } {
  if (mode === MODE_GROUND) {
    return {
      min: surface, max: surface + CFG.player.height,
      landing: false, halfDepth: CFG.player.halfDepth,
    };
  }
  if (mode <= model.airSteps) {
    // Sweep the box over the whole step rather than sampling its start. At a
    // 0.5 m resolution a descending state could otherwise skim an obstacle's
    // trailing edge and be reported clear.
    const y = surface + model.arc[mode];
    const yNext = surface + model.arc[Math.min(model.airSteps, mode + 1)];
    return {
      min: Math.min(y, yNext),
      max: Math.max(y, yNext) + CFG.player.height,
      landing: model.arc[mode] < model.arc[Math.max(0, mode - 1)],
      halfDepth: CFG.player.halfDepth,
    };
  }
  if (mode >= model.fallBase) {
    // Free fall: always descending, so always a landing candidate.
    const k = Math.min(model.fallSteps, mode - model.fallBase + 1);
    const y = surface - model.fallDrop[k];
    const yNext = surface - model.fallDrop[Math.min(model.fallSteps, k + 1)];
    return { min: yNext, max: y + CFG.player.height, landing: true, halfDepth: CFG.player.halfDepth };
  }
  return {
    min: surface, max: surface + CFG.slide.height,
    landing: false, halfDepth: CFG.slide.halfDepth,
  };
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
  // Witness recording only; left at zero length until a caller asks for it.
  private parent = new Int32Array(0);
  private action = new Uint8Array(0);
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

    const witness = opts.witness === true;
    if (witness) {
      if (this.parent.length < total) {
        this.parent = new Int32Array(total);
        this.action = new Uint8Array(total);
      }
      this.parent.fill(-1, 0, total);
      this.action.fill(0, 0, total);
    }
    const parent = this.parent;
    const action = this.action;

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
          // The jump arc ends back at the take-off height; if nothing is
          // supporting the player there, the ground branch turns it into a fall.
          modeBuf[modeCount++] = mode + 1 > model.airSteps ? MODE_GROUND : mode + 1;
        } else if (mode >= model.fallBase) {
          const fallStep = mode - model.fallBase + 1;
          // Terminal step repeats, so a fall past the table still descends.
          modeBuf[modeCount++] = fallStep >= model.fallSteps ? mode : mode + 1;
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
            // What the player pressed to produce this transition. Only a
            // grounded state offers a choice; every other mode is the
            // continuation of an action already committed to. Captured here
            // because the landing and fall branches below rewrite `m`.
            const kind = mode === MODE_GROUND ? mi : 0;

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
            } else if (m >= model.fallBase) {
              // Falling: land as soon as a surface comes up to meet us.
              const k = Math.min(model.fallSteps, m - model.fallBase + 1);
              const y = surface - model.fallDrop[k];
              const ground = supportAt(nl, z0, z1, y);
              if (y <= ground) {
                m = MODE_GROUND;
                nextSurface = ground;
              }
            } else if (m === MODE_GROUND || (m > model.airSteps && m < model.fallBase)) {
              // Ground and slide are both supported states, so both have to
              // check for support. Checking only the grounded mode let a
              // sliding player carry a roof's height out over the gap beyond
              // it and hover there for the length of the slide.
              const ground = supportAt(nl, z0, z1, surface);
              if (surface > 0.05 && ground < surface - 0.05) {
                // Ran off the edge of a roof. This is a free fall from rest,
                // not a jump: modelling it as a point on the jump arc left the
                // player hovering 2.7 m above the roof for the whole descent,
                // which let the solver approve routes that kill the player.
                m = model.fallBase;
                nextSurface = surface;
              } else {
                nextSurface = ground;
              }
            }

            const box = playerBox(model, m, nextSurface);
            // The player is a box, not a point. Widening the tested span by
            // the half-depth is what stops an ascending jump being approved
            // against an obstacle whose front face the player is already
            // inside: without it the step that would have caught the clip is
            // skipped for starting just short of the obstacle, and the next
            // step clears it using a height the player has not reached yet.
            const hd = box.halfDepth;
            const zA = z0 - hd;
            const zB = (changing ? laneSweepEnd : z1) + hd;
            let hit = blockedIn(lane, zA, zB, box.min, box.max);
            if (!hit && changing) hit = blockedIn(nl, zA, laneSweepEnd + hd, box.min, box.max);
            if (hit) {
              blockers.add(hit.id);
              continue;
            }

            const nsi = surfaceIndex(nextSurface);
            const nk = key(zi + 1, nl, m, nsi);
            if (visited[nk]) continue;
            visited[nk] = 1;
            if (witness) {
              parent[nk] = k;
              action[nk] = kind * 4 + (nl - lane + 1);
            }
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
        return { survivable: false, rushed: false, exitLanes: [], worstApproach: 0, blockers: [...blockers], explored };
      }
    }

    this.frontier = frontier;
    this.nextFrontier = nextFrontier;

    const exitLanes: number[] = [];
    for (let l = 0; l < lanes; l++) if (exitMask & (1 << l)) exitLanes.push(l);
    if (exitLanes.length === 0) {
      for (let l = 0; l < lanes; l++) if (laneReach[model.zSteps * lanes + l]) exitLanes.push(l);
    }

    // Walk the parent pointers back from an exit state to recover one concrete
    // route. Grounded exits are preferred so the replay finishes on its feet
    // rather than mid-jump, which is also what the next segment assumes.
    let route: WitnessStep[] | undefined;
    if (witness && frontierCount > 0) {
      let end = -1;
      for (let f = 0; f < frontierCount; f++) {
        const local = frontier[f] - model.zSteps * perZ;
        const si = local % surfaceCount;
        const mode = ((local - si) / surfaceCount) % model.modes;
        if (mode === MODE_GROUND) { end = frontier[f]; break; }
      }
      if (end < 0) end = frontier[0];

      const steps: WitnessStep[] = [];
      let cur = end;
      for (let zi = model.zSteps; zi > 0; zi--) {
        const prev = parent[cur];
        if (prev < 0) break;
        const code = action[cur];
        const kind = (code / 4) | 0;
        const delta = (code % 4) - 1;
        const pLocal = prev - (zi - 1) * perZ;
        const pSi = pLocal % surfaceCount;
        const pMode = ((pLocal - pSi) / surfaceCount) % model.modes;
        const pLane = (((pLocal - pSi) / surfaceCount) - pMode) / model.modes;
        steps.push({
          z: (zi - 1) * step,
          lane: pLane,
          toLane: pLane + delta,
          action: kind === 1 ? 'jump' : kind === 2 ? 'slide' : 'run',
        });
        cur = prev;
      }
      steps.reverse();
      route = steps;
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
    // Enforce the reaction guarantee. Computing it and returning it without
    // ever comparing it to the requirement meant the documented promise —
    // that the player always gets a clear run-up before a forced decision —
    // was never actually kept.
    // Infinity means nothing preceded the obstacle inside this window, so the
    // approach runs back into the previous segment and is unconstrained. It
    // must be tested before being clamped for reporting, or a segment with no
    // obstacles at all would be judged against a requirement it cannot meet.
    const rushed = worstApproach < opts.reactionDistance * MIN_APPROACH_FRACTION;
    const reported = Number.isFinite(worstApproach) ? worstApproach : opts.length;
    if (rushed) {
      this.rejections++;
      return { survivable: false, rushed: true, exitLanes, worstApproach: reported, blockers: [], explored };
    }

    this.accepted++;
    return { survivable: true, rushed: false, exitLanes, worstApproach: reported, blockers: [], explored, route };
  }

  /**
   * Distance of clear track immediately before `z` in one lane.
   *
   * Unbounded when nothing precedes it: the approach runs back into the
   * previous segment, which was itself validated and which the player entered
   * on foot. Measuring from the segment boundary instead would treat every
   * window edge as a wall and reject perfectly readable patterns purely for
   * sitting near the start of a module.
   *
   * So the guarantee this expresses is the one that matters: consecutive
   * forced decisions in a lane are never closer together than the player's
   * reaction distance.
   */
  private clearRunUp(laneObstacles: SolverObstacle[], z: number): number {
    let nearest = Infinity;
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
