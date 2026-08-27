/** Quick capture: menu, run start, and mid-run, for eyeballing changes. */
import { launchGameBrowser } from './browser.mjs';
const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
/**
 * Wait for the menu camera to finish swinging round to the hero.
 *
 * Wall-clock waits are useless here: under software rasterisation the
 * simulation advances at a fraction of real time, so a fixed pause catches the
 * camera mid-transition and photographs the back of the hero's head. Every
 * such shot looked like a framing bug in the game rather than in the harness.
 */
async function waitForMenuCamera(page) {
  await page.waitForFunction(() => {
    const c = window.game?.camera;
    return c && c.fov < 46.4 && c.position.z < -2.0;
  }, { timeout: 120000 }).catch(() => {});
}

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('active'), { timeout: 90000 });
await waitForMenuCamera(page);
await page.screenshot({ path: '/tmp/playtest/menu2.png' });
await page.$eval('#menu button.primary', el => el.click());
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/playtest/run2.png' });
for (let i = 0; i < 12; i++) {
  await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4]);
  await page.waitForTimeout(800);
}
await page.screenshot({ path: '/tmp/playtest/run3.png' });
const st = await page.evaluate(() => ({
  state: window.game.state?.state,
  distance: Math.round(window.game.player?.state?.distance ?? 0),
  calls: window.game.renderer.info.render.calls,
}));
console.log('state:', JSON.stringify(st), 'errors:', errors.length, errors.slice(0, 5));
await browser.close();
