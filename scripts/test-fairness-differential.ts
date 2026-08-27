import * as THREE from 'three';
import { createHero } from '../src/assets/HeroFactory';
import { DEFAULT_IDENTITY } from '../src/assets/HeroIdentity';
import { ActiveObstacle, CollisionSystem, HitResult } from '../src/core/CollisionSystem';
import { CFG, laneToX } from '../src/core/Config';
import { ObstacleDef } from '../src/core/Types';
import { InputManager } from '../src/player/InputManager';
import { PlayerAnimator } from '../src/player/PlayerAnimator';
import { PlayerController } from '../src/player/PlayerController';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { PlannedSegment, ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import {
  reactionDistance, SegmentValidator, SolverObstacle, WitnessStep,
} from '../src/procedural/SegmentValidator';

/**
 * Differential test: the solver against the real game.
 *
 * The fairness suite proves the solver agrees with hand-written expectations,
 * and the gameplay suite proves the physics behave in hand-built scenarios.
 * Neither one ever checks the two against each other, and that gap is exactly
 * where the solver was twice found unsound — a roof-fall modelled as a point
 * on the jump arc, and a slide that never checked for support. Both were
 * caught by a throwaway brute-force repro, not by the 154 assertions that
 * were passing at the time.
 *
 * This makes that repro permanent and general. For every segment the
 * generator ships, the solver is asked not just "is this survivable" but
 * "show me the route". That route is then flown through the real
 * PlayerController and CollisionSystem. If the player is touched, the
 * solver's proof was wrong about the game it is meant to be proving things
 * about.
 *
 * Timing tolerance: the solver plans on a 0.5 m grid and the game runs on a
 * 60 Hz clock, so a route cannot be replayed frame-perfectly. Each action is
 * therefore tried across a band of offsets and the route counts as flown if
 * any of them survives. That is the honest reading of the promise anyway —
 * it is meant to hold for a competent player, not one with frame-perfect
 * hands. The width of the band that actually succeeds is reported, because a
 * route that only works in a single 0.05 m window would be a fairness
 * failure even though it is technically survivable.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

class StubTarget {
  private handlers = new Map<string, Array<(ev: unknown) => void>>();
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type: string, ev: unknown): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(ev);
  }
}

const DT = 1 / 60;

/**
 * Offsets applied to every action on the route, in metres.
 *
 * Scaled by the distance covered in one frame, because that is the real limit
 * on how precisely a player can act: at 31 m/s a single frame is 0.52 m, so a
 * fixed metre band narrower than that cannot express "one frame early" at all
 * and reports timing quantisation as if it were a solver defect.
 */
function offsetsFor(speed: number): number[] {
  const frame = speed * DT;
  const out: number[] = [];
  for (let k = -2; k <= 2; k += 0.5) out.push(k * frame);
  return out;
}

/**
 * Finer sweep used only to explain a failure: how wide is the window of
 * take-off positions that actually survives? A route with no surviving window
 * is a solver defect; one with a window narrower than a frame is a fairness
 * defect, because no player can hit it.
 */
function surviveWindow(
  plan: PlannedSegment, route: WitnessStep[], speed: number,
): { widest: number; anyOffset: number | null } {
  let widest = 0;
  let run = 0;
  let anyOffset: number | null = null;
  const stepSize = 0.05;
  for (let o = -6; o <= 6 + 1e-9; o += stepSize) {
    if (fly(plan, route, speed, o).survived) {
      run += stepSize;
      if (anyOffset === null) anyOffset = o;
      if (run > widest) widest = run;
    } else {
      run = 0;
    }
  }
  return { widest, anyOffset };
}

interface Rig {
  player: PlayerController;
  collision: CollisionSystem;
  obstacles: ActiveObstacle[];
  hits: string[];
  deaths: string[];
  key(code: string): void;
  dispose(): void;
}

function makeRig(): Rig {
  const hero = createHero(DEFAULT_IDENTITY);
  const animator = new PlayerAnimator(hero);
  const target = new StubTarget();
  const input = new InputManager(target as unknown as HTMLElement);
  input.attach();

  const collision = new CollisionSystem();
  const obstacles: ActiveObstacle[] = [];
  const hits: string[] = [];
  const deaths: string[] = [];

  const player = new PlayerController(hero, animator, collision, input, {
    onHit(hit: HitResult) { hits.push(hit.obstacle.def.id); return false; },
    onNearMiss() {},
    onDeath(cause) { deaths.push(cause); },
  });
  player.reset();
  collision.setObstacles(obstacles);

  return {
    player, collision, obstacles, hits, deaths,
    /**
     * A tap, not a hold. InputManager drops a repeat while the action is still
     * held, so a harness that only ever sends keydown silently loses every
     * press after the first in each direction — which looked exactly like the
     * solver routing a player through a wall.
     */
    key(code: string) {
      target.dispatch('keydown', { code, preventDefault() {} });
      target.dispatch('keyup', { code, preventDefault() {} });
    },
    dispose() { input.dispose(); hero.dispose(); },
  };
}

/** The same solver view of a plan that the generator builds internally. */
function solverObstaclesFor(plan: PlannedSegment, speed: number): SolverObstacle[] {
  const crossingTime = plan.length / Math.max(1, speed);
  return plan.obstacles.map((o) => {
    const sweep = Math.abs(o.driftZ) * crossingTime;
    return {
      id: `${o.def.id}@${o.lane}:${Math.round(o.z)}`,
      lane: o.lane,
      zStart: o.z - o.def.depth / 2 - sweep - plan.startZ,
      zEnd: o.z + o.def.depth / 2 + sweep - plan.startZ,
      minY: o.def.yOffset - o.def.height / 2,
      maxY: o.def.yOffset + o.def.height / 2,
      standable: !!o.def.standable,
      slope: !!o.def.slope,
    };
  });
}

/**
 * Compresses a per-step route into the inputs a player would actually press.
 * The solver emits a decision at every 0.5 m whether or not anything changes.
 */
function inputsFor(route: WitnessStep[], speed: number): Array<{ z: number; code: string }> {
  const out: Array<{ z: number; code: string }> = [];
  // The solver's state moves to the new lane within a single 0.5 m step, while
  // the game slides across over laneChangeDuration — 5.3 m at top speed. It is
  // still sound about collisions (the blocking test sweeps both lanes across
  // the whole move), but a route that says "be in lane 1 by z" has to be
  // *started* before z. That is what a player does anyway: you commit to the
  // gap on approach, not at the obstacle. Without this lead the replay judges
  // the solver's grid resolution rather than the segment.
  const lead = CFG.player.laneChangeDuration * speed;
  for (const s of route) {
    if (s.action === 'jump') out.push({ z: s.z, code: 'Space' });
    else if (s.action === 'slide') out.push({ z: s.z, code: 'ArrowDown' });
    if (s.toLane > s.lane) out.push({ z: s.z - lead, code: 'ArrowRight' });
    else if (s.toLane < s.lane) out.push({ z: s.z - lead, code: 'ArrowLeft' });
  }
  return out.sort((a, b) => a.z - b.z);
}

interface FlightResult {
  survived: boolean;
  touchedBy: string;
  reachedZ: number;
}

/**
 * Flies one route through the real physics at a pinned speed.
 *
 * Speed is held at the value the solver proved against rather than left to
 * accelerate, so that a divergence means a modelling error and not simply
 * that the player was going faster than the proof assumed.
 */
/**
 * One rig, reused for every flight. Building a hero rebuilds a full skinned
 * mesh with three LODs, which dwarfs the cost of the simulation itself and put
 * a full sweep past ten minutes; PlayerController.reset() restores the whole
 * state, so a shared rig gives identical results in a fraction of the time.
 */
let sharedRig: Rig | null = null;
function rig(): Rig {
  if (!sharedRig) sharedRig = makeRig();
  const r = sharedRig;
  r.player.reset();
  r.hits.length = 0;
  r.deaths.length = 0;
  r.obstacles.length = 0;
  r.collision.setObstacles(r.obstacles);
  return r;
}

function fly(
  plan: PlannedSegment, route: WitnessStep[], speed: number, offset: number,
): FlightResult {
  const rig_ = rig();
  const s = rig_.player.state;
  let runTime = 0;

  /** One frame at the pinned speed. */
  const stepFrame = () => {
    runTime += DT;
    const natural = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * runTime);
    rig_.player.speedMultiplier = speed / natural;
    rig_.player.update(DT, 8);
  };

  try {
    // The solver is asked to enter from any lane, and picks whichever one its
    // route needs — mid-run the player really can arrive in any of them, fed
    // by the previous segment's exit lanes. The player starts in the middle,
    // so walk them across first and only then call it the segment entry.
    // Getting this wrong is what made the first run of this test report 188
    // divergences: the routes were fine, the player was simply in the wrong
    // lane when the segment began.
    const entryLane = route.length > 0 ? route[0].lane : 1;
    if (entryLane !== 1) {
      rig_.key(entryLane < 1 ? 'ArrowLeft' : 'ArrowRight');
      const settle = Math.ceil((CFG.player.laneChangeDuration * 1.5) / DT);
      for (let i = 0; i < settle; i++) stepFrame();
    }
    const base = s.distance;

    for (const o of plan.obstacles) {
      const def: ObstacleDef = o.def;
      rig_.obstacles.push({
        def, z: base + (o.z - plan.startZ), lane: o.lane, x: laneToX(o.lane), baseY: 0,
        object: new THREE.Object3D(), driftZ: 0, driftX: 0,
        poolKey: `${def.id}|0`, hit: false, nearMissed: false, passed: false,
      });
    }
    rig_.collision.setObstacles(rig_.obstacles);

    const schedule = inputsFor(route, speed)
      .map((i) => ({ z: base + Math.max(0, i.z + offset), code: i.code }))
      .sort((a, b) => a.z - b.z);
    let next = 0;

    // Run a little past the exit so a jump begun near the end still lands.
    const limit = base + plan.length + 6;
    let guard = 0;
    while (s.distance < limit && guard++ < 20000) {
      while (next < schedule.length && schedule[next].z <= s.distance) {
        rig_.key(schedule[next].code);
        next++;
      }
      stepFrame();

      if (rig_.hits.length > 0 || rig_.deaths.length > 0) {
        return {
          survived: false,
          touchedBy: rig_.hits[0] ?? rig_.deaths[0],
          reachedZ: s.distance - base,
        };
      }
    }
    return { survived: true, touchedBy: '', reachedZ: s.distance - base };
  } finally {
    // The rig is shared; reset() on the next acquisition does the cleanup.
  }
}

// ---------------------------------------------------------------- the sweep

const SPEEDS = (process.env.DIFF_SPEEDS ?? `${CFG.speed.base},12,15,${CFG.speed.max}`)
  .split(',').map(Number);
const SEEDS = (process.env.DIFF_SEEDS ?? '7,1337,90210,555001').split(',').map(Number);
const SEGMENTS_PER_RUN = Number(process.env.DIFF_SEGMENTS ?? 40);

interface Divergence {
  segment: string;
  speed: number;
  touchedBy: string;
  reachedZ: number;
  length: number;
  /** Widest run of take-off positions that survives, metres. 0 = none. */
  widest: number;
  frame: number;
}

/** Fine sweeps are 101 flights each, so only the first few are explained. */
const MAX_EXPLAINED = 200;
let explained = 0;
const divergences: Divergence[] = [];
/** Routes that survive somewhere, but only inside a sub-frame window. */
const unhittable: Divergence[] = [];
/**
 * Routes that survive comfortably, but not within two frames of the take-off
 * the solver named. The segment is fair; the solver's grid simply places the
 * decision a little away from where the player has to make it.
 */
const offsetRoutes: Divergence[] = [];
const bandWidth: number[] = [];
let flown = 0;
let noRoute = 0;

const validator = new SegmentValidator();

for (const seed of SEEDS) {
  for (const speed of SPEEDS) {
    const difficulty = new DifficultyManager();
    const gen = new ProceduralGenerator(seed, difficulty);
    let distance = 0;

    for (let i = 0; i < SEGMENTS_PER_RUN; i++) {
      distance += 60;
      difficulty.update(distance, speed);
      const plan = gen.next(speed);
      if (plan.obstacles.length === 0) continue;

      const result = validator.solve(solverObstaclesFor(plan, speed), {
        length: plan.length,
        speed,
        entryLanes: [0, 1, 2],
        reactionDistance: reactionDistance(speed, difficulty.value),
        witness: true,
      });
      if (!result.survivable || !result.route) { noRoute++; continue; }

      const offsets = offsetsFor(speed);
      let survivingOffsets = 0;
      let firstTouch = '';
      let firstReach = 0;
      for (const offset of offsets) {
        const f = fly(plan, result.route, speed, offset);
        if (f.survived) survivingOffsets++;
        else if (!firstTouch) { firstTouch = f.touchedBy; firstReach = f.reachedZ; }
      }
      flown++;
      bandWidth.push(survivingOffsets / offsets.length);

      if (survivingOffsets === 0) {
        // Nothing in the coarse band worked. Sweep finely before calling it a
        // solver defect: a route can be sound and still be missed by a band
        // that happens to straddle it.
        const { widest } = explained < MAX_EXPLAINED
          ? (explained++, surviveWindow(plan, result.route, speed))
          : { widest: -1 };
        const row = {
          segment: `${plan.templateId} (seed ${seed} #${i})`,
          speed, touchedBy: firstTouch, reachedZ: firstReach, length: plan.length,
          widest, frame: speed * DT,
        };
        if (widest <= 0) divergences.push(row);
        else if (widest < row.frame) unhittable.push(row);
        else offsetRoutes.push(row);
      }
    }
  }
}

const median = [...bandWidth].sort((a, b) => a - b)[Math.floor(bandWidth.length / 2)] ?? 0;

console.log(`\nflew ${flown} solver-approved routes through the real physics`);
console.log(`  timing offsets per route: 9, spanning +/-2 frames at the test speed`);
console.log(`  median fraction of offsets surviving: ${(median * 100).toFixed(0)}%`);
console.log(`  segments with no route to fly: ${noRoute}`);

if (divergences.length > 0) {
  console.log('\ndivergences (solver said survivable, no take-off position survives):');
  for (const d of divergences.slice(0, 12)) {
    console.log(`  ${d.segment} @${d.speed}m/s — touched by ${d.touchedBy} at z=${d.reachedZ.toFixed(1)}/${d.length}`);
  }
}
if (unhittable.length > 0) {
  console.log('\nsurvivable only inside a sub-frame window (no player could hit it):');
  for (const d of unhittable.slice(0, 12)) {
    console.log(`  ${d.segment} @${d.speed}m/s — widest window ${d.widest.toFixed(2)}m vs ${d.frame.toFixed(2)}m frame`);
  }
}

if (offsetRoutes.length > 0) {
  console.log(`\nfair, but the route's stated take-off is off the mark: ${offsetRoutes.length}`);
  for (const d of offsetRoutes.slice(0, 6)) {
    console.log(`  ${d.segment} @${d.speed}m/s — ${d.widest.toFixed(2)}m window, ${(d.widest / d.frame).toFixed(1)} frames wide`);
  }
}

/**
 * Known-divergence budget.
 *
 * The solver proves that *a* route exists; this test additionally demands that
 * the specific route it names can be flown by the real player. That is a
 * strictly stronger property than the fairness promise, and it is not yet
 * fully met: the witness take-off positions come off a 0.5 m grid on which a
 * lane change completes in one step, while the game slides across over
 * 0.17 s, so a witness can name a decision point the player cannot use even
 * though the segment itself is passable.
 *
 * The three clusters behind the current budget, all reproducible:
 *   - tall standable roofs (OBS_Container_01, OBS_TrainCar_01): clearing a
 *     2.55 m roof leaves a 1.7 m window of take-off positions at 12 m/s
 *     against a 2.70 m peak, and the witness often names a point outside it;
 *   - full-height lane dodges (OBS_FencePanel_01) where the witness changes
 *     lane later than the transit time allows;
 *   - one top-speed slide (OBS_Pipe_01 at 31 m/s).
 *
 * This number is a ratchet: it may only go down. It is not a statement that
 * these segments kill the player — the player is free to take a different
 * route — but each one is a place where the solver's own answer is not
 * directly playable, and that is worth keeping visible rather than rounding
 * off. `offsetRoutes` counts the milder version of the same thing: a route
 * that flies once the take-off is moved, with a window several frames wide.
 */
const DIVERGENCE_BUDGET = 32;

console.log('');
check('the sweep actually flew routes', flown > 100, `only ${flown}`);
check('the typical solver route flies untouched at its stated timing',
  median >= 0.99, `median ${(median * 100).toFixed(0)}%`);
check('no route demands sub-frame timing',
  unhittable.length === 0, `${unhittable.length} of ${flown} need a sub-frame window`);
check(`witness routes that cannot be flown at all stay within budget (${DIVERGENCE_BUDGET})`,
  divergences.length <= DIVERGENCE_BUDGET,
  `${divergences.length} of ${flown} diverged, budget ${DIVERGENCE_BUDGET}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
