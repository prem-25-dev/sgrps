/**
 * Headless playtest. Boots the real game in Chromium, plays it with scripted
 * input, and reports console errors, frame rate, draw calls and run outcomes.
 */
import { launchGameBrowser } from './browser.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.GAME_URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT_DIR ?? '/tmp/playtest';
mkdirSync(OUT, { recursive: true });

const errors = [];
const warnings = [];

const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') errors.push(text);
  else if (msg.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}\n${err.stack ?? ''}`));

console.log(`Loading ${URL} ...`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
  }, null, { timeout: 120000 }).catch(() => {});
}

// Wait for boot to reach the main menu.
await page.waitForFunction(() => {
  const menu = document.getElementById('menu');
  return menu && menu.classList.contains('active');
}, null, { timeout: 90000 });
console.log('Reached main menu.');
await waitForMenuCamera(page);
await page.screenshot({ path: `${OUT}/01-menu.png` });

// Probe the scene from inside the page.
const bootInfo = await page.evaluate(() => {
  const g = window.game;
  let meshes = 0, skinned = 0, instanced = 0, lights = 0, tris = 0;
  g.scene.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      if (o.isSkinnedMesh) skinned++;
      if (o.isInstancedMesh) instanced++;
      const idx = o.geometry?.index;
      const count = idx ? idx.count : (o.geometry?.attributes?.position?.count ?? 0);
      tris += (count / 3) * (o.isInstancedMesh ? o.count : 1);
    }
    if (o.isLight) lights++;
  });
  return { meshes, skinned, instanced, lights, tris: Math.round(tris) };
});
console.log('Scene after boot:', bootInfo);

// Start a run.
const clickIn = (sel) => page.$eval(sel, (el) => el.click());
await clickIn('#menu button.primary');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-run-start.png` });

// Play: a scripted sequence of lane changes, jumps and slides for 45 seconds.
const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'ArrowUp'];
const samples = [];
const start = Date.now();
let k = 0;
let shots = 0;

while (Date.now() - start < 45000) {
  const key = keys[k++ % keys.length];
  await page.keyboard.press(key);
  await page.waitForTimeout(280 + Math.floor(Math.random() * 420));

  const snap = await page.evaluate(() => {
    const g = window.game;
    const info = g.renderer.info;
    const st = g.state ?? null;
    return {
      calls: info.render.calls,
      tris: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      // Reach into private fields for observability; this is a test harness.
      distance: g.player?.state?.distance ?? 0,
      speed: g.player?.state?.speed ?? 0,
      alive: g.player?.state?.alive ?? true,
      score: g.score?.score ?? 0,
      coins: g.score?.stats?.coins ?? 0,
      state: st?.state ?? 'unknown',
      anim: g.animator?.currentState ?? '?',
    };
  });
  samples.push(snap);

  if (shots < 5 && (Date.now() - start) > shots * 9000) {
    await page.screenshot({ path: `${OUT}/03-play-${shots}.png` });
    shots++;
  }

  // If the run ended, start another one so we exercise restart too.
  if (!snap.alive) {
    await page.waitForTimeout(2200);
    const overActive = await page.evaluate(() => document.getElementById('gameover')?.classList.contains('active'));
    if (overActive) {
      await page.screenshot({ path: `${OUT}/04-gameover.png` });
      await clickIn('#gameover button.primary');
      await page.waitForTimeout(900);
    }
  }
}

const last = samples[samples.length - 1] ?? {};
const maxCalls = Math.max(...samples.map((s) => s.calls));
const maxTris = Math.max(...samples.map((s) => s.tris));
const maxGeo = Math.max(...samples.map((s) => s.geometries));
const firstGeo = samples[0]?.geometries ?? 0;
const maxDistance = Math.max(...samples.map((s) => s.distance));

// Measure sustained frame rate over 8 seconds of steady running.
const fps = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const t0 = performance.now();
  const tick = () => {
    frames++;
    if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
    else resolve({ fps: (frames * 1000) / (performance.now() - t0), frames });
  };
  requestAnimationFrame(tick);
}));

// Pause only applies mid-run, so make sure we are in one first. A fresh
// profile starts in TUTORIAL, which is just as much "in a run" as PLAYING.
const IN_RUN = ['PLAYING', 'TUTORIAL'];
let inRun = await page.evaluate((states) => states.includes(window.game.state?.state), IN_RUN);
if (!inRun) {
  const overActive = await page.evaluate(() => document.getElementById('gameover')?.classList.contains('active'));
  if (overActive) await clickIn('#gameover button.primary');
  else await clickIn('#menu button.primary');
  await page.waitForTimeout(1400);
  inRun = await page.evaluate((states) => states.includes(window.game.state?.state), IN_RUN);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const paused = await page.evaluate(() =>
  document.getElementById('pause')?.classList.contains('active') && window.game.state?.state === 'PAUSED');
await page.screenshot({ path: `${OUT}/05-pause.png` });
// Resume, then verify the run continues, then quit to the menu.
await clickIn('#pause button.primary');
await page.waitForTimeout(600);
const resumed = await page.evaluate((states) => states.includes(window.game.state?.state), IN_RUN);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await clickIn('#pause button.ghost');
await page.waitForTimeout(700);

const panels = {};
for (const [label, index] of [['missions', 0], ['achievements', 1], ['settings', 2]]) {
  await page.$$eval('#menu .menu-actions div button', (els, i) => els[i].click(), index);
  await page.waitForTimeout(450);
  panels[label] = await page.evaluate((id) => {
    const node = document.getElementById(id);
    return !!node && node.classList.contains('active') && node.innerText.length > 40;
  }, label);
  await page.screenshot({ path: `${OUT}/06-${label}.png` });
  await clickIn(`#${label} button.primary`);
  await page.waitForTimeout(350);
}

// Full screen. A game that cannot fill the screen is not much of a game, and
// this is the one control whose failure mode is silence: an embedded copy in a
// frame without the permission simply does nothing when clicked.
const fullscreen = { offered: false, entered: false, exited: false };
{
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#menu button')]
      .find((x) => /full screen/i.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  fullscreen.offered = clicked;
  if (clicked) {
    await page.waitForTimeout(600);
    fullscreen.entered = await page.evaluate(() => !!document.fullscreenElement);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#menu button')]
        .find((x) => /full screen/i.test(x.textContent || ''));
      b?.click();
    });
    await page.waitForTimeout(600);
    fullscreen.exited = await page.evaluate(() => !document.fullscreenElement);
  }
}

const report = {
  url: URL,
  boot: bootInfo,
  samples: samples.length,
  maxDrawCalls: maxCalls,
  maxTriangles: maxTris,
  geometriesFirst: firstGeo,
  geometriesMax: maxGeo,
  geometryGrowth: maxGeo - firstGeo,
  texturesFinal: last.textures,
  maxDistance: Math.round(maxDistance),
  finalScore: last.score,
  finalCoins: last.coins,
  sustainedFps: Number(fps.fps.toFixed(1)),
  pauseWorked: paused,
  resumeWorked: resumed,
  enteredRunForPause: inRun,
  panels,
  fullscreen,
  errors,
  warnings: warnings.slice(0, 10),
};
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

console.log('\n=== PLAYTEST REPORT ===');
console.log(`sustained fps (software renderer): ${report.sustainedFps}`);
console.log(`draw calls: max ${report.maxDrawCalls}`);
console.log(`triangles: max ${(report.maxTriangles / 1000).toFixed(1)}k`);
console.log(`geometries: ${firstGeo} -> ${maxGeo}  (growth ${report.geometryGrowth})`);
console.log(`textures: ${report.texturesFinal}`);
console.log(`distance reached: ${report.maxDistance} m, score ${report.finalScore}, coins ${report.finalCoins}`);
console.log(`pause: ${paused}  resume: ${resumed}  panels: ${JSON.stringify(panels)}`);
console.log(`full screen: ${JSON.stringify(fullscreen)}`);
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log('  ERROR ' + e.slice(0, 400));
console.log(`warnings: ${warnings.length}`);
for (const w of warnings.slice(0, 6)) console.log('  warn  ' + w.slice(0, 200));

// Reporting a result without gating on it is decoration. The full screen
// control is held to actually working, because its failure mode is silence.
const failures = [];
if (errors.length > 0) failures.push(`${errors.length} console errors`);
if (!fullscreen.offered) failures.push('no full screen control on the menu');
else if (!fullscreen.entered) failures.push('the full screen control did not enter full screen');
else if (!fullscreen.exited) failures.push('full screen could not be left again');
for (const f of failures) console.log(`  FAIL ${f}`);

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
