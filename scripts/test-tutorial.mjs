/**
 * Verifies the first-run tutorial end to end in a real browser: it appears
 * for a player with no history, steps forward as the player performs each
 * action, hands back to PLAYING, and never appears again afterwards.
 */
import { launchGameBrowser } from './browser.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';
const OUT = process.env.OUT_DIR ?? '/tmp/playtest';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const bootToMenu = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('active'), { timeout: 90000 });
  await page.waitForTimeout(800);
};

// --- First run: no history, so the tutorial should take over ---------------
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await bootToMenu();

await page.$eval('#menu button.primary', (el) => el.click());
await page.waitForTimeout(1500);

const state1 = await page.evaluate(() => window.game.state.state);
check('first run enters TUTORIAL', state1 === 'TUTORIAL', `got ${state1}`);

const firstPrompt = await page.evaluate(() => document.querySelector('.tutorial')?.textContent ?? '');
check('a tutorial prompt is shown', firstPrompt.length > 4, `got "${firstPrompt}"`);

const ceiling = await page.evaluate(() => window.game.difficulty.current);
check('difficulty is held down while teaching', ceiling <= 0.1 + 1e-6, `got ${ceiling}`);

await page.screenshot({ path: `${OUT}/tutorial-1.png` });

// Play a few rounds so the prompts genuinely advance in the real game.
//
// Under software rendering the simulation runs at roughly a fifth of real
// time, so playing all six steps through here would take many minutes. The
// step machine is covered exhaustively by test-tutorial-unit; what this test
// is for is the integration: that the prompts render, that the state flips
// back, and that pausing does not skip the rest of the lesson.
const seen = new Set();
const rounds = 14;
for (let i = 0; i < rounds; i++) {
  const snap = await page.evaluate(() => ({
    state: window.game.state.state,
    alive: window.game.player.state.alive,
    prompt: document.querySelector('.tutorial')?.textContent ?? '',
  }));
  if (snap.prompt) seen.add(snap.prompt.slice(0, 24));
  if (!snap.alive || snap.state !== 'TUTORIAL') break;
  // Alternate directions: pressing into a lane you are already in is a no-op,
  // so a one-directional test would never satisfy the lane step.
  await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForTimeout(140);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(140);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(1400);
}
await page.screenshot({ path: `${OUT}/tutorial-2.png` });
check('the prompt advances during a real run', seen.size >= 2,
  `saw ${seen.size}: ${[...seen].join(' | ')}`);

// Mashing every key for a minute can end the run. If it did, start a fresh
// lesson so the pause checks below have a tutorial to act on.
const stillTeaching = await page.evaluate(() => window.game.state.state === 'TUTORIAL');
if (!stillTeaching) {
  await page.evaluate(() => localStorage.clear());
  await bootToMenu();
  await page.$eval('#menu button.primary', (el) => el.click());
  await page.waitForTimeout(1600);
  const restarted = await page.evaluate(() => window.game.state.state);
  check('a fresh profile re-enters the tutorial after a death', restarted === 'TUTORIAL', `got ${restarted}`);
}

// Pausing mid-lesson must resume back into the tutorial, not skip it.
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const pausedState = await page.evaluate(() => window.game.state.state);
check('pause works during the tutorial', pausedState === 'PAUSED', `got ${pausedState}`);
await page.$eval('#pause button.primary', (el) => el.click());
await page.waitForTimeout(600);
const resumedState = await page.evaluate(() => window.game.state.state);
check('resume returns to the tutorial, not past it', resumedState === 'TUTORIAL', `got ${resumedState}`);

// Completing the lesson must hand control back and lift the difficulty cap.
const handover = await page.evaluate(async () => {
  window.game.tutorial.finish();
  await new Promise((r) => setTimeout(r, 600));
  window.game.player.state.distance = 5000;
  await new Promise((r) => setTimeout(r, 600));
  return {
    state: window.game.state.state,
    prompt: document.querySelector('.tutorial')?.classList.contains('show'),
    difficulty: window.game.difficulty.current,
  };
});
check('tutorial hands back to PLAYING', handover.state === 'PLAYING', `got ${handover.state}`);
check('the prompt is cleared on handover', !handover.prompt, 'prompt still visible');
check('difficulty ceiling is released afterwards', handover.difficulty > 0.4,
  `got ${handover.difficulty}`);

// --- Second run: history exists, so it must not reappear -------------------
await page.evaluate(() => {
  // Simulate a completed run without having to die for it.
  window.game.save.update((d) => { d.runs = 3; });
  window.game.save.flush(true);
});
await bootToMenu();
await page.$eval('#menu button.primary', (el) => el.click());
await page.waitForTimeout(1500);
const state2 = await page.evaluate(() => window.game.state.state);
const prompt2 = await page.evaluate(() => document.querySelector('.tutorial')?.classList.contains('show'));
check('a returning player goes straight to PLAYING', state2 === 'PLAYING', `got ${state2}`);
check('no tutorial prompt for a returning player', !prompt2, 'prompt was visible');

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
