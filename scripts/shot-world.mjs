/**
 * Photographs the things this round added: the avenue, the houses down the
 * left, and the inspector.
 *
 * Every wait here is on a condition the simulation reports, never on the
 * clock. Under swiftshader this page runs at a couple of frames a second, so
 * a fixed pause photographs whatever happened to be on screen — which is how
 * every previous "framing bug" in this project turned out to be a harness
 * bug instead.
 */
import { launchGameBrowser } from './browser.mjs';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('active'), null, { timeout: 120000 });

await page.$eval('#menu button.primary', (el) => el.click());
await page.waitForFunction(() => window.game?.player?.state?.distance > 1, null, { timeout: 120000 });

/** Waits until the run has covered `metres` of track. */
const runTo = (metres) => page.waitForFunction(
  (m) => (window.game?.player?.state?.distance ?? 0) > m, metres, { timeout: 300000 },
);

await runTo(60);
await page.screenshot({ path: `${OUT}/world-early.png` });

// Satisfy the tutorial as we go, so the run is not held at its opening pace.
for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(400);
}
await runTo(130);
await page.screenshot({ path: `${OUT}/world-avenue.png` });

// And a shot with the inspector pressing: a hit brings him onto the shoulder.
await page.evaluate(() => window.game.chaser?.onPlayerHit());
await page.waitForFunction(() => (window.game.chaser?.pressure ?? 0) > 0.8, null, { timeout: 120000 });
await page.screenshot({ path: `${OUT}/world-chaser.png` });

// What is actually out there, measured rather than eyeballed: the decor is
// parented under the track root and positioned relative to the player, so a
// positive X is the screen-left side.
const scenery = await page.evaluate(() => {
  const out = { houses: 0, trees: 0, leftHouses: 0, rightHouses: 0, nearestTree: 1e9, chaser: null };
  window.game.scene.traverse((o) => {
    if (!o.visible) return;
    const name = o.name ?? '';
    if (name === 'ENV_House') {
      out.houses++;
      // World position straight off the matrix: THREE is not on window.
      o.updateWorldMatrix(true, false);
      if (o.matrixWorld.elements[12] > 0) out.leftHouses++; else out.rightHouses++;
    }
    if (name === 'VEG_Tree' || name === 'VEG_Palm' || name === 'VEG_Sapling') {
      out.trees++;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      if (e[14] > 0 && e[14] < 80) out.nearestTree = Math.min(out.nearestTree, Math.abs(e[12]));
    }
  });
  const c = window.game.chaser;
  if (c) out.chaser = { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2), pressure: +c.pressure.toFixed(2) };
  return out;
});
console.log('scenery:', JSON.stringify(scenery));

const perf = await page.evaluate(() => ({
  calls: window.game.renderer.info.render.calls,
  tris: window.game.renderer.info.render.triangles,
  distance: Math.round(window.game.player.state.distance),
}));
console.log('render:', JSON.stringify(perf));
console.log('errors:', errors.length, errors.slice(0, 5));

await browser.close();
