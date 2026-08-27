/**
 * The game has to be playable with a thumb.
 *
 * Swiping is the primary input on a phone, and it had no coverage at all —
 * `test:ui-fit` checks that panels fit a phone screen, which says nothing
 * about whether the player can actually move. The gameplay suite drives the
 * real PlayerController but only ever presses keys.
 *
 * The risk is concrete rather than theoretical. Taps and swipes share a code
 * path with the menu: a tap on the play surface means "confirm", and an
 * earlier bug had every tap counting as confirm, so every button on the main
 * menu started a run. The guard that fixed it sits directly in the touch
 * handler, which makes this the part of the input system most likely to break
 * silently for the players least able to work around it.
 */
import { launchGameBrowser } from './browser.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const browser = await launchGameBrowser();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.getElementById('menu')?.classList.contains('active'),
  null,
  { timeout: 90000 },
);

/** A swipe on the play surface, as a finger would make it. */
const swipe = (dx, dy) => page.evaluate(({ dx, dy }) => {
  const target = document.querySelector('canvas') ?? document.body;
  const event = (type, x, y) => {
    const touch = { identifier: 1, target, clientX: x, clientY: y };
    const ev = new Event(type, { bubbles: true });
    Object.defineProperty(ev, 'changedTouches', { value: [touch] });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  };
  const x0 = 195;
  const y0 = 500;
  window.dispatchEvent(event('touchstart', x0, y0));
  window.dispatchEvent(event('touchend', x0 + dx, y0 + dy));
}, { dx, dy });

const state = () => page.evaluate(() => {
  const s = window.game.player.state;
  return { lane: s.lane, y: s.y, sliding: s.sliding, jumping: s.jumping };
});

// A tap on the play surface is "confirm", which is how a phone starts a run.
await swipe(0, 0);
const started = await page.waitForFunction(
  () => ['PLAYING', 'TUTORIAL'].includes(window.game?.state?.state),
  null,
  { timeout: 30000 },
).then(() => true).catch(() => false);
check('a tap on the play surface starts a run', started);

if (started) {
  await page.waitForTimeout(1500);
  const before = await state();

  await swipe(-90, 0);
  await page.waitForTimeout(1200);
  const left = await state();
  check('swiping left changes lane', left.lane < before.lane,
    `lane ${before.lane} -> ${left.lane}`);

  await swipe(90, 0);
  await page.waitForTimeout(1200);
  const right = await state();
  check('swiping right changes lane back', right.lane > left.lane,
    `lane ${left.lane} -> ${right.lane}`);

  await swipe(0, -90);
  await page.waitForTimeout(300);
  const up = await state();
  check('swiping up jumps', up.jumping && up.y > 0.2, `y ${up.y.toFixed(2)}`);

  // Let the jump finish before asking for a slide.
  await page.waitForTimeout(2500);
  await swipe(0, 90);
  await page.waitForTimeout(400);
  const down = await state();
  check('swiping down slides', down.sliding === true, JSON.stringify(down));

  // A swipe shorter than the threshold must not be read as a direction.
  await page.waitForTimeout(1200);
  const beforeNudge = await state();
  await swipe(8, 0);
  await page.waitForTimeout(600);
  const nudge = await state();
  check('a movement under the swipe threshold is not a lane change',
    nudge.lane === beforeNudge.lane, `lane ${beforeNudge.lane} -> ${nudge.lane}`);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
