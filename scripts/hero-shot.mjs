/** Close-up captures of the hero from several angles, for art review. */
import { launchGameBrowser } from './browser.mjs';
const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('menu')?.classList.contains('active'), { timeout: 90000 });
await page.waitForTimeout(1500);

// Hide the UI and light the hero neutrally so the model itself is judged.
await page.evaluate(() => {
  document.getElementById('ui').style.display = 'none';
  const g = window.game;
  // Stop the frame loop so the next RAF cannot overwrite our camera pose.
  g.stop();
  g.cameraController.following = false;
  g.lighting.sun.intensity = 2.6;
  g.lighting.ambient.intensity = 1.5;
  g.scene.fog.far = 4000;
});

const angles = [
  { name: 'front', a: 0, y: 0.62, r: 2.4 },
  { name: 'threequarter', a: 0.7, y: 0.62, r: 2.4 },
  { name: 'side', a: 1.5708, y: 0.62, r: 2.4 },
  { name: 'face', a: 0.25, y: 0.93, r: 0.85 },
  { name: 'legs', a: 0.3, y: 0.35, r: 1.6 },
  { name: 'shoulder', a: 0.45, y: 0.83, r: 0.75 },
  { name: 'back', a: 3.1416, y: 0.62, r: 2.4 },
];
for (const { name, a, y, r } of angles) {
  await page.evaluate(({ a, y, r }) => {
    const g = window.game;
    const h = g.hero.identity.height;
    g.camera.position.set(Math.sin(a) * r, h * y, -Math.cos(a) * r);
    g.camera.lookAt(0, h * y, 0);
    g.camera.fov = 40;
    g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
  }, { a, y, r });
  await page.screenshot({ path: `/tmp/playtest/hero-${name}.png` });
}
console.log('captured');
await browser.close();
