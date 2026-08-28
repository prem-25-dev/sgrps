/**
 * "Every obstacle teaches one verb, and its geometry tells you which."
 *
 * That sentence in GAME_DESIGN.md is the contract the whole affordance design
 * rests on — it is why the colourblind audit concluded no colourblind mode was
 * needed, since what an obstacle demands is carried by its silhouette rather
 * than its colour. Nothing checked it, and three of the published bands did
 * not match the data.
 *
 * Two kinds of assertion here. The geometric ones read the archetype table.
 * The behavioural ones fly the real `PlayerController` at the real
 * `CollisionSystem` and find out what actually clears, because the arithmetic
 * is not reliable: a point-mass estimate said a 2.6 m signal box was clearable
 * above 17 m/s, and it is not clearable at any speed.
 */
import { CFG } from '../src/core/Config';
import { OBSTACLE_DEFS } from '../data/obstacles';
import { ObstacleDef } from '../src/core/Types';
import { makeHarness } from './harness';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const top = (o: ObstacleDef): number => o.yOffset + o.height / 2;
const under = (o: ObstacleDef): number => o.yOffset - o.height / 2;
const of = (cat: string): ObstacleDef[] => OBSTACLE_DEFS.filter((o) => o.category === cat);

const JUMP_PEAK = (CFG.jump.velocity * CFG.jump.velocity) / (2 * -CFG.jump.gravity);

check('the archetype count the documents quote is right', OBSTACLE_DEFS.length === 33,
  `${OBSTACLE_DEFS.length}`);
check(`the jump peak is the documented ${JUMP_PEAK.toFixed(2)} m`, Math.abs(JUMP_PEAK - 2.70) < 1e-9,
  `${JUMP_PEAK}`);

// -------------------------------------------------------------- ground
//
// "Ground (top 0.85–1.25 m) — jump, or change lane." Ramps are a separate verb
// in the same category: you run up them, so their top is not a jump target.

{
  const plain = of('ground').filter((o) => !o.slope);
  const outside = plain.filter((o) => top(o) < 0.85 || top(o) > 1.35);
  check('every ground obstacle sits in the 0.85–1.35 m band', outside.length === 0,
    outside.map((o) => `${o.id} ${top(o).toFixed(2)}`).join(', '));
  console.log(`  ground tops: ${Math.min(...plain.map(top)).toFixed(2)}–${Math.max(...plain.map(top)).toFixed(2)} m ` +
    `(the document said 0.85–1.25; OBS_CableDrum_01 is 1.35)`);

  const noJump = plain.filter((o) => !o.requiredActions.includes('jump'));
  check('and every one of them accepts a jump', noJump.length === 0, noJump.map((o) => o.id).join(', '));
  const tooTall = plain.filter((o) => top(o) >= JUMP_PEAK);
  check('and none is taller than the jump can reach', tooTall.length === 0,
    tooTall.map((o) => o.id).join(', '));
}

// ------------------------------------------------------------ overhead
//
// "Overhead (underside at 1.0 m+) — slide, or change lane." The number that
// matters for play is not 1.0 but the sliding collider, 0.85 m.

{
  const over = of('overhead');
  const low = over.filter((o) => under(o) < 1.0);
  check('every overhead obstacle has its underside at 1.0 m or higher', low.length === 0,
    low.map((o) => `${o.id} ${under(o).toFixed(2)}`).join(', '));

  const tight = over.filter((o) => under(o) <= CFG.slide.height);
  check(`and clears the ${CFG.slide.height} m sliding collider`, tight.length === 0,
    tight.map((o) => `${o.id} ${under(o).toFixed(2)}`).join(', '));
  const margin = Math.min(...over.map((o) => under(o) - CFG.slide.height));
  console.log(`  tightest slide clearance: ${margin.toFixed(2)} m`);

  const noSlide = over.filter((o) => !o.requiredActions.includes('slide'));
  check('and every one of them accepts a slide', noSlide.length === 0, noSlide.map((o) => o.id).join(', '));
}

// -------------------------------------------------------------- dynamic
//
// "They only appear above ~0.5 difficulty." The generator's dynamicChance
// opens at 0.45, but each archetype carries its own gate, and those are what
// actually hold the line.

{
  const early = of('dynamic').filter((o) => o.difficulty < 0.5);
  check('no moving hazard is eligible below 0.5 difficulty', early.length === 0,
    early.map((o) => `${o.id} ${o.difficulty}`).join(', '));
}

// ----------------------------------------------------------- full height
//
// "Full height — change lane; there is no other answer." Measured, that is
// true of three of the five. The container is standable and is the rooftop
// route the same document celebrates; the fence panel is 2.40 m and 0.16 m
// deep, so a held jump carries the player over it at every speed.
//
// `requiredActions` stays lane-change-only for all five on purpose: it is what
// the fairness solver plans with, and a guarantee that depends on frame-perfect
// timing is not a guarantee. This pins the real behaviour so a geometry edit
// that makes a wall hoppable — or takes the rooftop route away — is visible.

function clearableByJump(id: string): boolean {
  // The apex is `velocity / |gravity|` seconds after takeoff, so the timing
  // that matters is a jump started about `speed * apexTime` metres out. The
  // search is a narrow window around that rather than the whole approach: a
  // full sweep is 900 simulations per obstacle and most of them are nowhere
  // near the answer.
  const apexTime = CFG.jump.velocity / -CFG.jump.gravity;
  for (const speed of [12, 18, 24]) {
    const ideal = speed * apexTime;
    for (let trigger = Math.max(1, ideal - 4); trigger <= ideal + 4; trigger += 0.2) {
      const h = makeHarness();
      h.player.state.speed = speed;
      const o = h.addObstacle(id, 1, 40);
      let jumped = false;
      // Held, never released: an early release runs the ascent at cut gravity
      // and peaks at 1.29 m, which reports everything as unclearable.
      h.step(4.0, () => {
        if (!jumped && o.z - h.player.state.distance <= trigger) { jumped = true; h.key('ArrowUp'); }
      });
      const survived = h.events.hits.length === 0 && h.player.state.distance > 40;
      h.dispose();
      if (survived) return true;
    }
  }
  return false;
}

{
  const full = of('full');
  const noLaneChange = full.filter((o) => !o.requiredActions.includes('laneChange'));
  check('a lane change is always an answer to a full-height obstacle', noLaneChange.length === 0,
    noLaneChange.map((o) => o.id).join(', '));

  const jumpable = full.filter((o) => clearableByJump(o.id)).map((o) => o.id).sort();
  const expected = ['OBS_Container_01', 'OBS_FencePanel_01'];
  check('exactly the two known full-height archetypes are also passable by jumping',
    jumpable.join(',') === expected.join(','),
    `measured [${jumpable.join(', ')}], expected [${expected.join(', ')}]`);
  console.log(`  passable by a held jump: ${jumpable.join(', ') || 'none'}`);
}

// ---------------------------------------------------------------- trains

{
  const trains = of('train');
  const standable = trains.filter((o) => o.standable).map((o) => o.id);
  check('parked train cars are a route', standable.length === 2, standable.join(', '));
  const moving = trains.find((o) => o.id === 'OBS_TrainMoving_01');
  check('and the moving one is not', moving !== undefined && !moving.standable);
}

// ------------------------------------------------------------ every verb

{
  // Nothing may be silent about what it wants.
  const mute = OBSTACLE_DEFS.filter((o) => o.requiredActions.length === 0);
  check('every archetype names at least one survivable action', mute.length === 0,
    mute.map((o) => o.id).join(', '));
  const cats = new Set(OBSTACLE_DEFS.map((o) => o.category));
  check('all five categories are populated', cats.size === 5, [...cats].join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
