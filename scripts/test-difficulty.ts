/**
 * The difficulty curve, against what the documents say it does.
 *
 * `DifficultyManager` is read by the generator, the validator, the HUD and the
 * tutorial, and every other suite drives it — but nothing asserted its own
 * behaviour, so the one number the whole game's pacing hangs on could be
 * retuned to anything without a test noticing.
 *
 * Writing this found a documentation defect rather than a code one, and the
 * assertions below pin the curve the code actually draws:
 *
 *   `Math.pow(raw, 0.78)` has an exponent BELOW one, so it sits above the
 *   linear ramp everywhere between 0 and 1 — the run gets harder faster than
 *   linear early, and flattens towards the top. Both the class comment and
 *   GAME_DESIGN.md described it as "eased so the first few hundred metres stay
 *   gentle", which is the opposite of what an exponent below one does. A
 *   player leaves "Warm up" at 369 m rather than the 630 m a linear ramp would
 *   give, and meets moving hazards at 1,509 m rather than 1,890 m.
 *
 * Both documents now describe the real shape, and the test holds the code to
 * it. Whether the curve *should* be front-loaded is a balance decision, not a
 * bug: the fairness engine proves every segment survivable at whatever
 * difficulty it is handed, so this changes how the game feels, not whether it
 * is fair.
 */
import { CFG } from '../src/core/Config';
import { DifficultyManager } from '../src/procedural/DifficultyManager';
import { reactionDistance } from '../src/procedural/SegmentValidator';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Difficulty after running the manager out to a distance. */
function at(distance: number): number {
  const d = new DifficultyManager();
  d.update(distance, 0);
  return d.raw;
}

const RAMP = CFG.difficulty.rampDistance;

// ----------------------------------------------------------------- the ends

check('the curve starts at zero', at(0) === 0);
check(`the curve reaches 1.0 at ${RAMP} m`, Math.abs(at(RAMP) - 1) < 1e-9, `${at(RAMP)}`);
check('and stays at 1.0 beyond the ramp', at(RAMP * 3) === 1);

// --------------------------------------------------------------- monotonic

{
  let drops = 0;
  let prev = -1;
  for (let m = 0; m <= RAMP * 1.2; m += 10) {
    const v = at(m);
    if (v < prev - 1e-12) drops++;
    prev = v;
  }
  check('the curve never goes backwards', drops === 0, `${drops} decreases`);
}

// ------------------------------------------------------------- the shape
//
// These two together fix the curve's character: front-loaded, then flattening.
// Swapping the exponent to anything above 1 fails the first; making it linear
// fails both.

{
  let below = 0;
  let worst = 0;
  for (let m = 10; m < RAMP; m += 10) {
    const linear = m / RAMP;
    const actual = at(m);
    if (actual < linear + 1e-9) below++;
    worst = Math.max(worst, actual - linear);
  }
  check('difficulty runs ahead of a linear ramp for the whole climb', below === 0,
    `${below} samples at or below linear`);
  console.log(`  the curve peaks ${(worst * 100).toFixed(1)} percentage points above linear`);

  // Slope, sampled across the ramp: it has to be falling, which is what makes
  // the top approach 1 rather than slam into it.
  const slope = (m: number): number => (at(m + 20) - at(m - 20)) / 40;
  const early = slope(RAMP * 0.15);
  const late = slope(RAMP * 0.85);
  check('the climb flattens towards the top', late < early * 0.75,
    `slope ${early.toExponential(2)} early vs ${late.toExponential(2)} late`);
}

// ---------------------------------------------------------------- landmarks
//
// Recorded as numbers rather than prose so a retune shows up as a diff in
// metres. The pacing landmarks are where the player feels the curve.

{
  const reach = (target: number): number => {
    for (let m = 0; m <= RAMP; m += 1) if (at(m) >= target) return m;
    return RAMP;
  };
  const landmarks: Array<[string, number, number]> = [
    ['leaves "Warm up"', 0.15, 369],
    ['leaves "Cruising"', 0.35, 1093],
    ['moving hazards begin', 0.45, 1509],
  ];
  const off: string[] = [];
  for (const [what, target, expected] of landmarks) {
    const m = reach(target);
    console.log(`  ${what.padEnd(22)} at ${String(m).padStart(4)} m (linear ramp would be ${Math.round(target * RAMP)} m)`);
    if (Math.abs(m - expected) > 25) off.push(`${what}: ${m} m, expected ~${expected}`);
  }
  check('the pacing landmarks are where they were tuned', off.length === 0, off.join('; '));
}

// ------------------------------------------------------------------ relief
//
// "Difficulty backs off after a stumble, so a recovery is winnable." Unlike
// the reaction guarantee — which was once computed and never enforced — this
// one is wired: Game grants it on a survivable hit.

{
  const d = new DifficultyManager();
  d.update(RAMP * 0.8, 0);
  const before = d.current;
  d.grantRelief();
  check('a stumble makes the world easier', d.current < before - 0.2,
    `${before.toFixed(3)} -> ${d.current.toFixed(3)}`);
  check('but the raw curve is untouched, so scoring and the HUD do not lurch',
    Math.abs(d.raw - before) < 1e-9);

  // Relief decays at 0.25 per second; a 0.28 grant should be spent in ~1.1 s.
  let t = 0;
  while (d.current < d.raw - 1e-9 && t < 5) { d.update(RAMP * 0.8, 1 / 60); t += 1 / 60; }
  check('relief wears off rather than lasting the run', t < 1.5 && t > 0.8,
    `took ${t.toFixed(2)} s`);

  const spam = new DifficultyManager();
  spam.update(RAMP, 0);
  for (let i = 0; i < 20; i++) spam.grantRelief();
  check('repeated stumbles cannot switch the game off', spam.current >= 0.5 - 1e-9,
    `floor reached ${spam.current.toFixed(3)}`);
}

// ----------------------------------------------------------------- ceiling

{
  const d = new DifficultyManager();
  d.update(RAMP, 0);
  d.setCeiling(0.2);
  check('the tutorial ceiling holds the world gentle', d.current <= 0.2 + 1e-9,
    `${d.current.toFixed(3)}`);
  check('and the raw curve keeps climbing underneath it', d.raw === 1);
  d.setCeiling(1);
  check('releasing the ceiling restores full difficulty', d.current === 1);
}

// -------------------------------------------------------- what it drives
//
// GAME_DESIGN.md: "It drives obstacle density, which templates are eligible,
// how often dynamic hazards appear, power-up frequency, and the reaction-time
// guarantee." Each of those is checked to move, and to move the right way.

{
  const easy = new DifficultyManager();
  const hard = new DifficultyManager();
  hard.update(RAMP, 0);

  check('obstacle density spans its configured range',
    Math.abs(easy.obstacleDensity - CFG.difficulty.densityEasy) < 1e-9 &&
    Math.abs(hard.obstacleDensity - CFG.difficulty.densityHard) < 1e-9,
    `${easy.obstacleDensity} .. ${hard.obstacleDensity}`);
  check('power-ups get more common under pressure', hard.powerUpChance > easy.powerUpChance,
    `${easy.powerUpChance.toFixed(3)} -> ${hard.powerUpChance.toFixed(3)}`);
  check('bonus coins get rarer under pressure', hard.bonusCoinChance < easy.bonusCoinChance,
    `${easy.bonusCoinChance.toFixed(3)} -> ${hard.bonusCoinChance.toFixed(3)}`);
  check('moving hazards are held back until mid-run',
    easy.dynamicChance === 0 && hard.dynamicChance > 0,
    `${easy.dynamicChance} -> ${hard.dynamicChance}`);

  // The reaction guarantee, in seconds rather than metres: 0.95 s at the
  // bottom of the curve, 0.52 s at the top, exactly as documented.
  const speed = 16;
  const easyTime = reactionDistance(speed, easy.current) / speed;
  const hardTime = reactionDistance(speed, hard.current) / speed;
  check('the reaction guarantee matches the documented 0.95 s and 0.52 s',
    Math.abs(easyTime - 0.95) < 1e-9 && Math.abs(hardTime - 0.52) < 1e-9,
    `${easyTime.toFixed(3)} s and ${hardTime.toFixed(3)} s`);
  check('and relief buys reaction time back',
    (() => { const d = new DifficultyManager(); d.update(RAMP, 0); const tight = reactionDistance(speed, d.current);
             d.grantRelief(); return reactionDistance(speed, d.current) > tight; })());
}

// ------------------------------------------------------------------ labels

{
  const d = new DifficultyManager();
  const seen: string[] = [];
  for (let m = 0; m <= RAMP; m += 20) {
    d.update(m, 0);
    if (seen[seen.length - 1] !== d.label) seen.push(d.label);
  }
  check('every difficulty band is reachable in one run', seen.length === 6, seen.join(' -> '));
  console.log(`  bands: ${seen.join(' -> ')}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
