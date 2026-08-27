/** Quick capture: menu, run start, and mid-run, for eyeballing changes. */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('active'), { timeout: 90000 });
await page.waitForTimeout(3000);
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
