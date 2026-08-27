import { SegmentValidator, SolverObstacle, reactionDistance } from '../src/procedural/SegmentValidator';
import { ProceduralGenerator } from '../src/procedural/ProceduralGenerator';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { CFG } from '../src/core/Config';
import { SEGMENT_TEMPLATES } from '../data/segments';
import { OBSTACLE_BY_ID } from '../data/obstacles';

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
check('one jumpable barrier', v.solve([ob(1, 12, 0, 1.0)], opts()).survivable, true);
check('one slideable beam', v.solve([ob(1, 12, 1.12, 1.7)], opts()).survivable, true);
check('two lanes blocked full height', v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7)], opts()).survivable, true);
check('all three lanes blocked full height', v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 2.7)], opts()).survivable, false);
check('full wall + jumpable in third lane', v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0)], opts()).survivable, true);
check('low overhead can be cleared over the top when jumpable',
  v.solve([ob(1, 12, 1.12, 1.9)], opts()).survivable, true);
check('jump-then-slide too close (0.6m apart)',
  v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0), ob(2, 12.6, 1.2, 2.8)], opts()).survivable, false);
check('jump-then-slide with room (7m apart)',
  v.solve([ob(0, 12, 0, 2.7), ob(1, 12, 0, 2.7), ob(2, 12, 0, 1.0), ob(2, 19, 1.2, 2.8)], opts()).survivable, true);
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
      const r = new SegmentValidator().solve(obs, {
        length: 24, speed, entryLanes: [0, 1, 2], reactionDistance: reactionDistance(speed, tpl.minDifficulty),
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
