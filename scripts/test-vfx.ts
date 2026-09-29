import { VFXManager, VFX_IDS } from '../src/vfx/VFXManager';
import { bus } from '../src/core/EventBus';

/**
 * Every effect has to actually emit something.
 *
 * 23 presets share one particle pool, and nothing else in the suite touches
 * them. An effect that quietly stopped emitting — a preset whose count fell to
 * zero, a switch case that stopped matching after a rename — would look
 * identical to one that works: no error, no warning, just a game that has
 * gradually lost its sparkle.
 *
 * This runs headless in Node rather than a browser. The particle system is
 * plain BufferGeometry and needs no renderer, and the browser job is already
 * long enough.
 */

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const vfx = new VFXManager();

// ---------------------------------------------------------- every preset

/**
 * Effects that are not one-shot bursts.
 *
 * Speed lines are a dedicated mesh whose opacity tracks the player's speed
 * from `update`, so `play('VFX_SpeedLines')` correctly emits nothing — there
 * is no case for it in the switch at all. It is still a VFX in the library, so
 * it stays in the catalogue and is asserted on its own terms below rather than
 * excluded and forgotten.
 */
const CONTINUOUS: readonly string[] = ['VFX_SpeedLines'];

const emitted: string[] = [];
const silent: string[] = [];
for (const id of VFX_IDS) {
  if (CONTINUOUS.includes(id)) continue;
  // Drain the pool so each preset is measured on its own.
  vfx.update(5, 0, 0, 0, 0);
  const before = vfx.particles.live;
  vfx.play(id, 0, 1, 0, 1);
  const after = vfx.particles.live;
  if (after > before) emitted.push(id);
  else silent.push(id);
}

check('the catalogue was enumerated from the source', VFX_IDS.length >= 20,
  `${VFX_IDS.length} ids`);
check('every one-shot effect emits particles', silent.length === 0, silent.join(', '));
console.log(`  ${emitted.length} of ${VFX_IDS.length - CONTINUOUS.length} one-shot presets emitted`);

// The continuous effect, on its own terms: opacity has to follow speed.
{
  const lines = vfx.root.getObjectByName('VFX_SpeedLines') as {
    material: { opacity: number };
  } | undefined;
  if (!lines) {
    check('the speed-line mesh exists', false);
  } else {
    for (let i = 0; i < 120; i++) vfx.update(1 / 60, 0, 0, 0, 1);
    const fast = lines.material.opacity;
    for (let i = 0; i < 240; i++) vfx.update(1 / 60, 0, 0, 0, 0);
    const slow = lines.material.opacity;
    check('speed lines fade in at speed', fast > 0.05, `opacity ${fast.toFixed(3)}`);
    check('speed lines fade out when slow', slow < fast * 0.2,
      `${fast.toFixed(3)} -> ${slow.toFixed(3)}`);
  }
}

// ---------------------------------------------------------- reduced motion

{
  const quiet = new VFXManager();
  quiet.setQuality(true, 1);
  let suppressed = 0;
  let allowed = 0;
  for (const id of VFX_IDS) {
    quiet.update(5, 0, 0, 0, 0);
    const before = quiet.particles.live;
    quiet.play(id, 0, 1, 0, 1);
    if (quiet.particles.live > before) allowed++; else suppressed++;
  }
  // Reduced motion is meant to calm the screen, not silence the feedback that
  // tells a player something happened: pickups still show.
  check('reduced motion suppresses most effects', suppressed > allowed,
    `${suppressed} suppressed, ${allowed} allowed`);
  check('reduced motion still shows pickup feedback', allowed > 0,
    `${allowed} allowed`);
  quiet.dispose();
}

// ---------------------------------------------------------- the shared pool

{
  // Hammer every preset far past the pool's capacity, then let it drain. A
  // leak here would starve every later effect in a long run, and the soak
  // cannot see it: particles live in typed arrays, not the scene graph.
  let peak = 0;
  for (let i = 0; i < 400; i++) {
    for (const id of VFX_IDS) vfx.play(id, 0, 1, 0, 1);
    vfx.update(1 / 60, 0, 0, 0, 0);
    if (vfx.particles.live > peak) peak = vfx.particles.live;
  }
  check('the pool never exceeds its own capacity', peak <= 4000, `peak ${peak}`);

  for (let i = 0; i < 600; i++) vfx.update(1 / 60, 0, 0, 0, 0);
  check('the pool drains back to empty once nothing is emitting',
    vfx.particles.live === 0, `${vfx.particles.live} still live`);
  console.log(`  peak ${peak} particles under sustained load, drained to ${vfx.particles.live}`);
}

// ---------------------------------------------------------- event wiring

{
  const wired = new VFXManager();
  wired.update(5, 0, 0, 0, 0);
  const before = wired.particles.live;
  bus.emit('player:jump', { speed: 12 });
  check('a gameplay event reaches the effect that listens for it',
    wired.particles.live > before,
    `${before} -> ${wired.particles.live}`);
  wired.dispose();
}

vfx.dispose();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
