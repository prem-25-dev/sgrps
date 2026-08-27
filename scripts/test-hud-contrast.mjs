/**
 * The HUD has to stay readable over the game behind it.
 *
 * Score, distance and the coin count float directly on the 3D scene, and the
 * scene is bright: the palest zone sky is rgb(223,233,242). Measured against
 * what is actually rendered rather than against the DOM ancestor the browser
 * reports, those three readouts came in at 2.73:1, 1.35:1 and 1.25:1 — against
 * WCAG minimums of 3:1 for large text and 4.5:1 for small. `.hud-score`
 * already carried a text-shadow, which helps the eye but contributes nothing
 * measurable, and was not enough on its own.
 *
 * Measuring live gameplay pixels would make this test depend on whatever the
 * generator happened to spawn behind the numbers, so a flat sheet of the
 * brightest colour any zone paints is laid over the canvas and under the
 * interface instead. That is deterministic, and it is the worst case the HUD
 * has to survive — anything darker only helps.
 *
 * It reads the pixels the browser actually rendered rather than compositing
 * the scrim itself. The first version of this file did the arithmetic in
 * JavaScript and got it wrong — it reported the scrim at alpha 0.09 where it
 * is 0.62, and would have failed a HUD that was perfectly readable. Asking
 * the renderer what it drew removes a whole class of that mistake.
 */
import { launchGameBrowser } from './browser.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';

/** The palest colour in the zone palettes, and a mid sky for a second case. */
const BACKDROPS = [
  { label: 'the palest zone sky', rgb: [223, 233, 242] },
  { label: 'a mid daylight sky', rgb: [160, 191, 225] },
];

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.getElementById('menu')?.classList.contains('active'),
  null,
  { timeout: 90000 },
);
await page.evaluate(() => { document.querySelector('#menu button.primary').click(); });
await page.waitForFunction(
  () => ['PLAYING', 'TUTORIAL'].includes(window.game?.state?.state),
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(2500);

for (const backdrop of BACKDROPS) {
  // The scene is replaced by a flat worst-case colour rather than overlaid:
  // #ui lives inside #app, which is its own stacking context, so a sheet
  // appended to the body paints over the interface no matter how low its
  // z-index. Hiding the canvas and colouring #app has no such trap.
  await page.evaluate((bd) => {
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.style.visibility = 'hidden';
    document.getElementById('app').style.background = `rgb(${bd.rgb.join(',')})`;
  }, backdrop);

  const items = await page.evaluate(() => {
    const hud = document.getElementById('hud');
    // The band the top cluster lives in. Falls back to a fixed slice of the
    // viewport when there is no scrim, so a HUD that lost its backdrop is
    // reported as unreadable rather than as having nothing to measure.
    const scrimHeight = parseFloat(getComputedStyle(hud, '::before').height) || innerHeight * 0.25;
    const out = [];
    for (const el of hud.querySelectorAll('*')) {
      const text = (el.textContent || '').trim();
      if (!text || el.children.length) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;

      // Only the top cluster. Those are the readouts that sit on the sky,
      // which is the bright surface the game actually puts behind text; the
      // mission tracker and tutorial line sit low, over ground and track,
      // and every zone's ground is dark (the palest is rgb(110,101,82)).
      // Asserting those against a sky colour would be testing a case the
      // game never renders.
      if (r.bottom > scrimHeight) continue;

      const size = parseFloat(cs.fontSize);
      const weight = +cs.fontWeight || 400;
      out.push({
        text: text.slice(0, 30), size: +size.toFixed(1), weight,
        large: size >= 24 || (size >= 18.66 && weight >= 700),
        fg: cs.color.match(/[\d.]+/g).map(Number).slice(0, 3),
        opacity: +cs.opacity,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return out;
  });

  // Measured from the pixels the browser actually rendered. The screenshot is
  // handed back to the page and decoded there, so the browser's own decoder
  // and colour handling are the ones doing the work rather than a
  // reimplementation of either.
  const shot = (await page.screenshot()).toString('base64');
  const results = await page.evaluate(async ({ b64, items }) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);

    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const dpr = bmp.width / innerWidth;

    return items.map((o) => {
      const r = o.rect;
      const d = ctx.getImageData(
        Math.max(0, Math.round(r.x * dpr)), Math.max(0, Math.round(r.y * dpr)),
        Math.max(1, Math.round(r.w * dpr)), Math.max(1, Math.round(r.h * dpr)),
      ).data;
      const px = [];
      for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);

      // WCAG is defined on the specified text colour, not on the partially
      // covered pixels along a glyph's edge — at 8.8px very few pixels reach
      // full coverage, so reading the foreground off the render would judge
      // small text more harshly than the standard does. The backdrop is the
      // half of the box least like the text colour, which is the scrim as the
      // renderer actually composited it.
      const dist = (c) => Math.hypot(c[0] - o.fg[0], c[1] - o.fg[1], c[2] - o.fg[2]);
      const byDistance = [...px].sort((a, b) => dist(a) - dist(b));
      const far = byDistance.slice(Math.floor(byDistance.length * 0.7));
      const bg = [0, 1, 2].map((i) => far.reduce((t, c) => t + c[i], 0) / far.length);
      // An element's own opacity blends it toward whatever is behind it.
      const fg = o.fg.map((c, i) => c * o.opacity + bg[i] * (1 - o.opacity));

      const la = Math.max(lum(fg), lum(bg));
      const lb = Math.min(lum(fg), lum(bg));
      return {
        ...o,
        ratio: +(((la + 0.05) / (lb + 0.05))).toFixed(2),
        fgText: `rgb(${fg.map(Math.round)})`, bgText: `rgb(${bg.map(Math.round)})`,
      };
    });
  }, { b64: shot, items });

  check(`${backdrop.label}: the HUD has readouts sitting on the scene`,
    results.length >= 3, `${results.length} found`);

  for (const o of results) {
    const need = o.large ? 3 : 4.5;
    check(`${backdrop.label}: "${o.text}" clears ${need}:1`,
      o.ratio >= need,
      `${o.ratio}:1 at ${o.size}px/${o.weight}, ${o.fgText} on ${o.bgText}`);
  }
}

await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (canvas) canvas.style.visibility = '';
  document.getElementById('app').style.background = '';
});
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
