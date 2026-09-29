/**
 * Tutorial step machine, driven headlessly.
 *
 * The browser test cannot cover this properly: under software rendering the
 * simulation runs at a fraction of real time, so a run never travels the few
 * hundred metres the later steps are gated on. This exercises the same class
 * directly at a fixed timestep.
 */
import { Tutorial } from '../src/core/Tutorial';
import { bus } from '../src/core/EventBus';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

/** Minimal stand-in for the save file. */
function fakeSave(runs: number) {
  return { state: { runs } } as never;
}

const dt = 1 / 60;
const SPEED = 11.5;

/**
 * Runs the tutorial to completion. `perform` decides whether the player
 * carries out the action a step asks for.
 */
function playThrough(perform: (id: string) => boolean, maxSeconds = 180) {
  const tutorial = new Tutorial(fakeSave(0));
  tutorial.start();
  let distance = 0;
  let t = 0;
  const shown: string[] = [];
  const blankRuns: number[] = [];
  let blank = 0;
  const acted = new Set<string>();

  while (t < maxSeconds && tutorial.active) {
    t += dt;
    distance += SPEED * dt;
    const step = tutorial.update(dt, distance);
    if (step) {
      if (shown[shown.length - 1] !== step.id) shown.push(step.id);
      if (blank > 0) { blankRuns.push(blank); blank = 0; }
      // Perform the action a beat after the prompt appears.
      if (!acted.has(step.id) && perform(step.id)) {
        acted.add(step.id);
        switch (step.satisfiedBy) {
          case 'laneChange': bus.emit('player:laneChange', { from: 1, to: 0 }); break;
          case 'jump': bus.emit('player:jump', { speed: SPEED }); break;
          case 'slide': bus.emit('player:slide', { speed: SPEED }); break;
          case 'coin': bus.emit('coin:collect', { value: 10, combo: 1, position: [0, 0, 0] }); break;
          default: break;
        }
      }
    } else {
      blank++;
    }
  }
  tutorial.dispose();
  return { shown, seconds: t, distance, finished: !tutorial.active, longestBlank: Math.max(0, ...blankRuns) };
}

console.log('Tutorial step machine:');

// A player who does everything asked.
const eager = playThrough(() => true);
check('shows every step in order', eager.shown.length === 6,
  `saw ${eager.shown.length}: ${eager.shown.join(' -> ')}`);
check('steps appear in authored order',
  eager.shown.join(',') === 'TUT_Run,TUT_Lane,TUT_Jump,TUT_Slide,TUT_Coins,TUT_Done',
  eager.shown.join(','));
check('completes', eager.finished, 'never finished');
check('finishes in a reasonable run', eager.seconds < 90 && eager.distance < 1200,
  `${eager.seconds.toFixed(1)}s, ${eager.distance.toFixed(0)}m`);

// A player who ignores every prompt still gets through on timeouts.
const idle = playThrough(() => false);
check('a silent player still completes on timeouts', idle.finished, 'stalled');
check('a silent player sees every step', idle.shown.length === 6, `${idle.shown.length}`);
check('a silent player takes longer than an eager one', idle.seconds >= eager.seconds,
  `${idle.seconds.toFixed(1)}s vs ${eager.seconds.toFixed(1)}s`);

// The bug this test exists for: a step satisfied immediately must clear.
const instant = new Tutorial(fakeSave(0));
instant.start();
let d = 0;
let stuck = 0;
for (let i = 0; i < 60 * 30; i++) {
  d += SPEED * dt;
  const step = instant.update(dt, d);
  if (step?.id === 'TUT_Lane') {
    bus.emit('player:laneChange', { from: 1, to: 0 });
    stuck++;
  }
}
check('a quickly satisfied prompt clears instead of sticking', stuck < 120,
  `TUT_Lane stayed up for ${stuck} frames (${(stuck / 60).toFixed(1)}s)`);
instant.dispose();

// A returning player is never taught again.
const returning = new Tutorial(fakeSave(4));
check('a returning player skips the tutorial', !returning.shouldRun, 'shouldRun was true');

// The difficulty ceiling lifts once teaching is over.
const ceil = new Tutorial(fakeSave(0));
ceil.start();
const during = ceil.difficultyCeiling;
ceil.finish();
check('difficulty is capped while teaching and released after',
  during <= 0.15 && ceil.difficultyCeiling === 1, `${during} -> ${ceil.difficultyCeiling}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
