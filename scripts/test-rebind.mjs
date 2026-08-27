/**
 * Rebinding a key has to work end to end.
 *
 * The mapping and the stored shape are covered headlessly in test:controls.
 * What only a browser can show is the wiring between them: that a chip in the
 * settings panel captures the next key press, that the capture does not also
 * reach the game underneath, and that the key the player chose actually moves
 * the character afterwards while the one it replaced no longer does.
 *
 * That last pair is the whole point of the feature. A player who remaps their
 * controls because they cannot reach the defaults is exactly the player who
 * cannot work around it if the remap silently fails.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.getElementById('menu')?.classList.contains('active'),
  null,
  { timeout: 90000 },
);

const bindings = () => page.evaluate(() => window.game.save.settings.keyBindings);
const press = (selector, text) => page.evaluate(({ selector, text }) => {
  const b = [...document.querySelectorAll(selector)]
    .find((n) => n.textContent.trim() === text);
  if (!b) return false;
  b.click();
  return true;
}, { selector, text });

// --- Open the panel the way a player does -----------------------------------
check('the Settings button exists', (await press('#menu button', 'Settings')) === true);
await page.waitForFunction(
  () => document.getElementById('settings')?.classList.contains('active'),
  null,
  { timeout: 20000 },
);

const before = await bindings();
check('the panel lists a binding for every action',
  ['left', 'right', 'jump', 'slide', 'pause'].every((a) => before[a]?.length > 0),
  JSON.stringify(before));

const chipCount = await page.evaluate(
  () => document.querySelectorAll('#settings .key-chip').length);
check('every bound key has a chip to click', chipCount >= 12, `${chipCount} chips`);

// --- Rebind "Move left" off the arrow key -----------------------------------
// Slot 0 of `left` is ArrowLeft by default; KeyA stays as the second binding,
// so the assertions below are about the slot that changed, not the action.
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#settings .binding-row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent.trim() === 'Move left');
  if (!row) return null;
  const chip = row.querySelector('.key-chip');
  chip.click();
  return chip.textContent.trim();
});
check('clicking a key chip starts listening', clicked === 'Press a key', String(clicked));

// --- Backing out, which on a phone is the only way out ----------------------
// A touch device has no Escape key, so a tap has to be able to abandon a
// capture. Without it a stray tap leaves the panel waiting for a press that
// can never arrive.
const leftChip = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#settings .binding-row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent.trim() === 'Move left');
  const chip = row.querySelector('.key-chip');
  return { text: chip.textContent.trim(), listening: chip.classList.contains('listening') };
});

const tapLeftChip = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#settings .binding-row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent.trim() === 'Move left');
  const chip = row.querySelector('.key-chip');
  chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  chip.click();
});

await tapLeftChip();
await page.waitForTimeout(200);
const toggled = await leftChip();
check('tapping the listening chip again abandons the rebind',
  !toggled.listening && toggled.text !== 'Press a key', JSON.stringify(toggled));
check('abandoning leaves the binding alone',
  JSON.stringify((await bindings()).left) === JSON.stringify(before.left));

// And a tap anywhere else does the same.
await tapLeftChip();
await page.waitForTimeout(200);
await page.evaluate(() => {
  document.querySelector('#settings .panel h2')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await page.waitForTimeout(200);
const tappedAway = await leftChip();
check('tapping elsewhere abandons the rebind',
  !tappedAway.listening && tappedAway.text !== 'Press a key', JSON.stringify(tappedAway));

// Back into a capture for the rebind proper.
await tapLeftChip();
await page.waitForTimeout(200);
check('the chip listens again after being abandoned',
  (await leftChip()).listening);

// A real key press, delivered by the browser rather than a synthetic event.
await page.keyboard.press('j');
await page.waitForTimeout(300);

const after = await bindings();
check('the pressed key is stored for that action',
  after.left.includes('KeyJ'), JSON.stringify(after.left));
check('the key it replaced is released',
  !after.left.includes('ArrowLeft'), JSON.stringify(after.left));
check('no other action was disturbed',
  JSON.stringify(after.jump) === JSON.stringify(before.jump), JSON.stringify(after.jump));

const label = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#settings .binding-row')];
  const row = rows.find((r) => r.querySelector('label')?.textContent.trim() === 'Move left');
  return row.querySelector('.key-chip').textContent.trim();
});
check('the chip shows the new key', label.toUpperCase() === 'J', label);

// The capture must not have leaked into the game: the panel is still open, and
// binding a key over the running game would have moved the player behind it.
check('the settings panel is still open after capturing a key',
  await page.evaluate(() => document.getElementById('settings')?.classList.contains('active')));

// --- Does it actually drive the character? ----------------------------------
await press('#settings button', 'Back');
await page.waitForFunction(
  () => document.getElementById('menu')?.classList.contains('active'),
  null,
  { timeout: 20000 },
);
await page.evaluate(() => { document.querySelector('#menu button.primary').click(); });
await page.waitForFunction(
  () => ['PLAYING', 'TUTORIAL'].includes(window.game?.state?.state),
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(1500);

const lane = () => page.evaluate(() => window.game.player.state.lane);

const startLane = await lane();
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(1200);
const afterOld = await lane();
check('the key that was unbound no longer moves the player',
  afterOld === startLane, `lane ${startLane} -> ${afterOld}`);

await page.keyboard.press('j');
await page.waitForTimeout(1200);
const afterNew = await lane();
check('the newly bound key moves the player',
  afterNew < afterOld, `lane ${afterOld} -> ${afterNew}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
