/**
 * Every panel's actions must be reachable, at every screen size.
 *
 * This exists because the game shipped for a while with the game-over panel's
 * "Run again" and "Menu" buttons entirely below the fold — at 1280x720, at
 * 1024x600 and on a phone. A player who died could neither restart nor leave.
 *
 * The browser suite did not notice, and could not have: it drives buttons with
 * el.click(), which works perfectly well on an element nobody can see or
 * reach. So this test checks geometry rather than behaviour. After the open
 * animation has settled, every button on every panel must lie inside the
 * viewport, and the panel itself must not overflow it.
 *
 * The cause is worth remembering too. Panels are centred with
 * `transform: translate(-50%, -50%)`, and an animation's transform replaces
 * the base transform outright — with `animation-fill-mode: both` it goes on
 * replacing it after the animation ends. Sharing a `scale`-only keyframe
 * therefore threw the centring away and pinned every panel's top edge to the
 * vertical midpoint.
 */
import { launchGameBrowser } from './browser.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';

const ONLY = process.env.UI_FIT_ONLY;
const VIEWPORTS = [
  { width: 1920, height: 1080, label: 'desktop' },
  { width: 1280, height: 720, label: 'laptop' },
  { width: 1024, height: 600, label: 'small laptop' },
  { width: 390, height: 844, label: 'phone portrait' },
  { width: 844, height: 390, label: 'phone landscape' },
];

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/**
 * Presses a button by clicking it, and only clicking it.
 *
 * Dispatching a pointerup as well double-fires: InputManager deliberately
 * ignores pointer events that begin on interface, so the click is the whole
 * path, and sending both starts a run twice.
 */
const press = (page, selector, text) => page.evaluate(({ selector, text }) => {
  const buttons = [...document.querySelectorAll(selector)];
  const button = text
    ? buttons.find((b) => b.textContent.trim() === text)
    : buttons[0];
  if (!button) return false;
  button.click();
  return true;
}, { selector, text });

const browser = await launchGameBrowser();

for (const vp of VIEWPORTS.filter((v) => !ONLY || v.label === ONLY)) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.getElementById('menu')?.classList.contains('active'),
    null,
    { timeout: 90000 },
  );

  /** Waits for a screen to be active and its open animation to have finished. */
  const settle = (id) => page.waitForFunction((s) => {
    const screen = document.getElementById(s);
    if (!screen?.classList.contains('active')) return false;
    const panel = screen.querySelector('.panel');
    return !!panel && panel.getAnimations().every((a) => a.playState === 'finished');
  }, id, { timeout: 30000 }).catch(() => {});

  const measure = async (id) => {
    const report = await page.evaluate((s) => {
      const screen = document.getElementById(s);
      const panel = screen?.querySelector('.panel');
      if (!panel) return { missing: true };
      // A hidden screen measures as all zeros, and zeros satisfy every bound
      // below — so without this the whole test passes vacuously whenever a
      // panel fails to open, which is exactly when it is most needed.
      if (!screen.classList.contains('active')) return { notOpen: true };
      const pr = panel.getBoundingClientRect();
      if (pr.width < 1 || pr.height < 1) return { collapsed: true };
      const offenders = [...screen.querySelectorAll('button')]
        .map((b) => ({ text: b.textContent.trim(), r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.bottom > innerHeight + 1 || r.top < -1
          || r.right > innerWidth + 1 || r.left < -1)
        .map(({ text, r }) => `${text} at ${Math.round(r.top)}..${Math.round(r.bottom)}`);
      return {
        offenders,
        overflows: pr.bottom > innerHeight + 1 || pr.top < -1,
        top: Math.round(pr.top), bottom: Math.round(pr.bottom), vh: innerHeight,
      };
    }, id);

    if (report.missing) { check(`${vp.label}: ${id} has a panel`, false); return; }
    if (report.notOpen) { check(`${vp.label}: ${id} actually opened`, false); return; }
    if (report.collapsed) { check(`${vp.label}: the ${id} panel has a size`, false); return; }
    check(`${vp.label}: ${id} actually opened`, true);
    check(`${vp.label}: every ${id} button is on screen`,
      report.offenders.length === 0, report.offenders.join('; '));
    check(`${vp.label}: the ${id} panel fits the viewport`,
      !report.overflows, `panel spans ${report.top}..${report.bottom} in ${report.vh}px`);
  };

  // The menu panels open from their own buttons, exactly as a player opens them.
  for (const label of ['Missions', 'Achievements', 'Settings']) {
    const id = label.toLowerCase();
    const opened = await press(page, '#menu button', label);
    check(`${vp.label}: the ${label} button exists`, opened === true);
    await settle(id);
    await measure(id);
    await press(page, `#${id} button`, 'Back');
    await page.waitForFunction(
      () => document.getElementById('menu')?.classList.contains('active'),
      null,
      { timeout: 20000 },
    ).catch(() => {});
  }

  // Game over is only reachable by dying, so die on purpose rather than
  // waiting: under software rasterisation a natural run takes minutes.
  check(`${vp.label}: the Play button exists`, (await press(page, '#menu button.primary')) === true);
  await page.waitForFunction(
    () => ['PLAYING', 'TUTORIAL'].includes(window.game?.state?.state),
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => { window.game.player.kill('front', 'ui-fit probe'); });
  // The death sequence runs on simulated time, and software rasterisation
  // advances that at a fraction of real time, so the ~1.5 s countdown takes
  // the better part of half a minute on the wall clock here.
  try {
    await page.waitForFunction(
      () => document.getElementById('gameover')?.classList.contains('active'),
      null,
      { timeout: 180000 },
    );
  } catch (err) {
    const st = await page.evaluate(() => ({
      state: window.game?.state?.state,
      alive: window.game?.player?.state?.alive,
      active: [...document.querySelectorAll('.screen.active')].map((x) => x.id),
    }));
    console.log(`  [debug] ${vp.label} never reached game over: ${JSON.stringify(st)} (${err.message.split('\n')[0]})`);
    throw err;
  }
  await settle('gameover');
  await measure('gameover');

  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
