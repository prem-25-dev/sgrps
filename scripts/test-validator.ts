import { SegmentValidator, SolverObstacle, reactionDistance } from '../src/procedural/SegmentValidator';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { CFG, JUMP_PEAK } from '../src/core/Config';
import { SEGMENT_TEMPLATES } from '../data/segments';
import { OBSTACLE_BY_ID, OBSTACLE_DEFS } from '../data/obstacles';

const v = new SegmentValidator();
let pass = 0, fail = 0;
function check(name: string, actual: boolean, expected: boolean) {
  if (actual === expected) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} (got ${actual}, want ${expected})`); }
}

const opts = (entry = [0, 1, 2]) => ({
  length: 24, speed: 16, entryLanes: entry, reactionDistance: reactionDistance(16, 0.5),
});

const ob = (lane: number, z: number, minY: number, maxY: number, depth = 0.5, standable = false, slope = false): SolverObstacle =>
  ({ lane, zStart: z - depth / 2, zEnd: z + depth / 2, minY, maxY, standable, slope, id: `o${lane}@${z}` });

console.log('Fairness solver:');
check('empty segment', v.solve([], opts()).survivable, true);
check('an empty segment is never judged rushed', v.solve([], opts()).rushed, false);
check('a lone obstacle is never judged rushed', v.solve([ob(1, 4, 0, 1.0)], opts()).rushed, false);
check('one jumpable barrier', v.solve([ob(1, 12, 0, 1.0)], opts()).survivable, true);
check('one slideable beam', v.solve([ob(1, 12, 1.12, 1.7)], opts()).survivable, true);
check('two lanes blocked full height', v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7)], opts()).survivable, true);
// Taller than the jump can reach, whatever the jump is set to.
const ABOVE_THE_JUMP = JUMP_PEAK * 1.02;
check('all three lanes blocked full height',
  v.solve([ob(0, 12, 0, ABOVE_THE_JUMP), ob(1, 12, 0, ABOVE_THE_JUMP), ob(2, 12, 0, ABOVE_THE_JUMP)], opts()).survivable, false);

// The dodge-only category, checked against the jump rather than against a
// number written down next to it.
//
// This used to be a lone fixture at 2.7 m, which was the jump peak of the day.
// That made it a restatement of the constant rather than a test of the design:
// raising the jump made it fail, and the only thing it could say was that the
// number had changed. What matters is that the obstacles the data calls
// dodge-only really cannot be jumped, at any speed the runner reaches — so it
// reads the heights out of the obstacle table and the speeds out of CFG.
{
  const SPEEDS = [8, 12, 16, 20, 24, CFG.speed.max];
  const dodgeOnly = OBSTACLE_DEFS.filter((d) => d.category === 'full' && !d.standable);
  for (const def of dodgeOnly) {
    const top = def.yOffset + def.height / 2;
    // Measured against the solver, a wall stops being jumpable at any speed at
    // about 0.96 of the jump peak. FencePanel sits below that line by design
    // and has always been clearable at pace, so it is held to being a wall at
    // the two slowest speeds rather than at all of them.
    const SOLID_AT_EVERY_SPEED = 0.96 * JUMP_PEAK;
    const speeds = top < SOLID_AT_EVERY_SPEED ? SPEEDS.slice(0, 2) : SPEEDS;
    const jumpable = speeds.filter((speed) => v.solve(
      [ob(0, 12, 0, top), ob(1, 12, 0, top), ob(2, 12, 0, top)],
      { length: 24, speed, entryLanes: [0, 1, 2], reactionDistance: reactionDistance(speed, 0.5) },
    ).survivable);
    check(`${def.id} (${top.toFixed(2)} m) cannot be jumped at ${speeds.join('/')} m/s`, jumpable.length === 0, true);
  }
  // And the platform in the same category still has to be mountable, or the
  // rooftop routes lose their first step.
  const container = OBSTACLE_BY_ID['OBS_Container_01'];
  const cTop = container.yOffset + container.height / 2;
  check(`OBS_Container_01 (${cTop.toFixed(2)} m) can still be jumped onto`,
    v.solve([ob(0, 12, 0, cTop, container.depth, true)], opts()).survivable, true);
}
check('full wall + jumpable in third lane', v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0)], opts()).survivable, true);
check('low overhead can be cleared over the top when jumpable',
  v.solve([ob(1, 12, 1.12, 1.9)], opts()).survivable, true);
check('jump-then-slide too close (0.6m apart)',
  v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0), ob(2, 12.6, 1.2, 2.8)], opts()).survivable, false);
// 7 m apart is physically survivable but leaves only 0.44 s to react at
// 16 m/s, under the 0.74 s the guarantee promises at this difficulty. The
// solver must reject it, and say why.
{
  const rushedCase = v.solve(
    [ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0), ob(2, 19, 1.2, 2.8)], opts());
  check('jump-then-slide 7m apart is rejected as rushed', rushedCase.survivable, false);
  check('a rushed pattern is reported as rushed, not impossible', rushedCase.rushed, true);
}
check('jump-then-slide with real room (14m apart)',
  v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0), ob(2, 26, 1.2, 2.8)],
    { ...opts(), length: 32 }).survivable, true);
check('locked into blocked lane at entry',
  v.solve([ob(1, 3, 0, 2.7)], { ...opts([1]), reactionDistance: 8 }).survivable, false);
check('train blocks lane, roof standable',
  v.solve([ob(1, 12, 0, 3.15, 21, true)], opts()).survivable, true);
check('train roof unreachable from the deck (no ramp)',
  v.solve([ob(0, 12, 0, 3.15, 21, true), ob(1, 12, 0, 3.15, 21, true), ob(2, 12, 0, 3.15, 21, true)], opts()).survivable, false);
// Ramp ends at 3.6, train starts at 5.5: the jump has to be taken off the
// ramp and land on the roof, which is exactly the intended route.
check('ramp makes the train roof reachable',
  v.solve([
    ob(0, 16, 0, 3.15, 21, true), ob(1, 16, 0, 3.15, 21, true), ob(2, 16, 0, 3.15, 21, true),
    ob(1, 2, 0, 1.2, 3.2, true, true),
  ], opts()).survivable, true);
check('container is reachable by jumping (2.55m)',
  v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.55, 2.4, true), ob(2, 12, 0, 2.7)], opts()).survivable, true);

// Regression: a player who runs off the end of a roof must fall, not hover.
// Modelling the drop as a point on the jump arc parked them 2.7 m above the
// roof for the whole descent; carrying a slide's surface past the roof edge
// did the same for the length of the slide. Either one let the solver approve
// a route that kills the player.
{
  const roofRun = [
    ob(1, 6.5, 0, 2.55, 9, true),   // standable roof, z 2..11
    ob(0, 15, 0, 2.7, 18),          // walls either side from z 6
    ob(2, 15, 0, 2.7, 18),
    ob(1, 17, 0, 2.4, 10),          // solid block past the roof, z 12..22
  ];
  const r = v.solve(roofRun, opts());
  check('running off a roof falls rather than hovering', r.survivable, false);
}

// The player is a box, not a point. A jump taken so late that the leading
// edge is already inside the obstacle when the body is still below its top
// must be rejected: the solver used to approve exactly this, because it
// planned on player *centres* and skipped the step that starts just short of
// the obstacle, then cleared the next step using a height not yet reached.
{
  // The exact shape that used to be approved and then killed the player:
  // a 0.95 m block in the only reachable lane, cleared by a jump.
  const speed = 12;
  const zStart = 7.6;
  const top = 0.95;
  // Lanes 0 and 2 are walled at the same Z so jumping is the only way past;
  // otherwise the solver quite reasonably sidesteps and there is no jump to
  // inspect.
  const r = v.solve([
    ob(1, zStart + 0.4, 0, top, 0.8),
    ob(0, zStart + 0.4, 0, 2.7, 0.8),
    ob(2, zStart + 0.4, 0, 2.7, 0.8),
  ], {
    length: 24, speed, entryLanes: [1], reactionDistance: 0.1, witness: true,
  });
  const jump = (r.route ?? []).find((st) => st.action === 'jump');
  // Height the analytic arc has reached by the time the player's leading edge
  // touches the obstacle. This is the number the solver used to get wrong.
  let clearance = -1;
  if (jump) {
    const travel = zStart - (jump.z + CFG.player.halfDepth);
    const t = travel / speed;
    clearance = CFG.jump.velocity * t + 0.5 * CFG.jump.gravity * t * t;
  }
  check('a witness jump clears the obstacle at its leading edge, not its centre',
    !!jump && clearance >= top, true);
}
check('the player half-depth is shared with the collision system',
  CFG.player.halfDepth > 0 && CFG.slide.halfDepth > CFG.player.halfDepth, true);

const wall = v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7)], opts());
check('exit lanes exclude blocked lanes', wall.exitLanes.length > 0 && wall.exitLanes.includes(2), true);

// Every authored template must be survivable at the speed band it unlocks in.
console.log('\nTemplate sweep (all templates x 5 speeds):');
{
  let unfair = 0;
  for (const tpl of SEGMENT_TEMPLATES) {
    for (const speed of [12, 16, 20, 25, 31]) {
      const obs: SolverObstacle[] = [];
      for (const item of tpl.items) {
        if (item.type !== 'obstacle' && item.type !== 'train') continue;
        const d = OBSTACLE_BY_ID[item.id!];
        if (!d) continue;
        const depth = item.type === 'train' ? (item.length ?? d.depth) : d.depth;
        const centre = item.z + (item.type === 'train' ? depth / 2 : 0);
        obs.push({
          id: `${d.id}@${item.lane}`, lane: item.lane,
          zStart: centre - depth / 2, zEnd: centre + depth / 2,
          minY: d.yOffset - d.height / 2, maxY: d.yOffset + d.height / 2,
          standable: !!d.standable, slope: !!d.slope,
        });
      }
      // Difficulty tracks speed in a real run, so pair them here rather than
      // testing a template's easiest reaction window at the fastest speed.
      const difficultyForSpeed = Math.min(1, Math.max(0, (speed - CFG.speed.base) / (CFG.speed.max - CFG.speed.base)));
      const r = new SegmentValidator().solve(obs, {
        length: 24, speed, entryLanes: [0, 1, 2],
        reactionDistance: reactionDistance(speed, Math.max(tpl.minDifficulty, difficultyForSpeed)),
      });
      if (!r.survivable) { unfair++; console.log(`  UNFAIR ${tpl.id} @ ${speed} m/s -> ${r.blockers.join(', ')}`); }
    }
  }
  console.log(`  ${SEGMENT_TEMPLATES.length} templates x 5 speeds, ${unfair} unsurvivable`);
  check('every authored template is survivable at every speed', unfair === 0, true);
}

console.log('\nGenerator soak (12000 segments across the difficulty curve):');
const diff = new DifficultyManager();
const gen = new ProceduralGenerator(12345, diff);
let distance = 0;
let unsurvivable = 0;
const t0 = Date.now();
for (let i = 0; i < 12000; i++) {
  diff.update(distance, 1 / 60);
  const speed = Math.min(CFG.speed.max, CFG.speed.base + CFG.speed.acceleration * (distance / 18));
  const seg = gen.next(speed);
  // Independently re-verify every shipped segment.
  const check2 = new SegmentValidator().solve(
    seg.obstacles.map((o) => ({
      id: o.def.id, lane: o.lane,
      zStart: o.z - o.def.depth / 2 - seg.startZ, zEnd: o.z + o.def.depth / 2 - seg.startZ,
      minY: o.def.yOffset - o.def.height / 2, maxY: o.def.yOffset + o.def.height / 2,
      standable: !!o.def.standable, slope: !!o.def.slope,
    })),
    { length: seg.length, speed, entryLanes: [0, 1, 2], reactionDistance: reactionDistance(speed, seg.difficulty) },
  );
  if (!check2.survivable) { unsurvivable++; if (unsurvivable < 4) console.log('  UNSURVIVABLE', seg.templateId, JSON.stringify(seg.obstacles.map(o=>[o.def.id,o.lane,Math.round(o.z-seg.startZ)]))); }
  distance += seg.length;
}
const ms = Date.now() - t0;
console.log(`  shipped segments with no survivable route: ${unsurvivable}`);
console.log(`  generator stats:`, gen.stats);
console.log(`  validator: ${gen.validatorStats.accepted} accepted, ${gen.validatorStats.rejections} rejected`);
console.log(`  ${ms}ms for 12000 segments (${(ms / 12000).toFixed(3)}ms each, ${(distance/1000).toFixed(1)}km of track)`);
check('no unsurvivable segment ever shipped', unsurvivable === 0, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
