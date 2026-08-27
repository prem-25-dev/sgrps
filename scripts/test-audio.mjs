/**
 * The game must actually make a sound.
 *
 * Every sound in NEON RUN is synthesised at runtime — 685 lines of WebAudio
 * graph and 33 hand-built voices, none of which any other suite touches. A
 * voice that fell silent, or started emitting NaN and poisoned the master bus,
 * would ship without a single assertion noticing.
 *
 * Two things make this measurable rather than guesswork:
 *
 * The render loop is stopped first. Under software rasterisation it starves
 * `setTimeout` so badly that a polling analyser reads almost nothing, which is
 * how an earlier version of this measurement concluded that 29 of 33 sounds
 * were silent. They were not; the instrument was. WebAudio runs on its own
 * thread and keeps processing with the loop stopped.
 *
 * And the tap is a ScriptProcessor rather than an AnalyserNode. An analyser
 * shows a window of the recent past, so a short transient — which most of
 * these are — falls between reads. A processor sees every sample block.
 */
import { launchGameBrowser } from './browser.mjs';

const URL = process.env.GAME_URL ?? 'http://127.0.0.1:4173/';

/** Well under the quietest real voice (SFX_Footstep, ~0.017). */
const SILENCE_FLOOR = 0.005;
/** Music is sparse and evolving, so it is measured over a longer window. */
const MUSIC_FLOOR = 0.01;

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const browser = await launchGameBrowser();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log(`  page error: ${e.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => document.getElementById('menu')?.classList.contains('active'),
  null,
  { timeout: 90000 },
);

// Clicking Play is a real user gesture, which is what unlocks WebAudio.
await page.evaluate(() => { document.querySelector('#menu button.primary').click(); });
await page.waitForFunction(
  () => ['PLAYING', 'TUTORIAL'].includes(window.game?.state?.state),
  null,
  { timeout: 60000 },
);

// --- The score, measured while the game is actually running ----------------
const music = await page.evaluate(async () => {
  const a = window.game.audio;
  const ctx = a.ctx;
  if (!ctx) return { error: 'no AudioContext' };
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  let peak = 0;
  let nan = 0;
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (Number.isNaN(v)) nan++;
      else { const m = v < 0 ? -v : v; if (m > peak) peak = m; }
    }
  };
  const sink = ctx.createGain();
  sink.gain.value = 0;
  a.master.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  await new Promise((r) => setTimeout(r, 4000));
  a.master.disconnect(proc);
  return { state: ctx.state, track: a.musicTrack, peak: +peak.toFixed(5), nan };
});

if (music.error) {
  check('the audio context exists', false, music.error);
} else {
  check('the audio context is running', music.state === 'running', music.state);
  check('a run plays music', music.track && music.track !== 'none', String(music.track));
  check('the master bus is not silent during a run',
    music.peak >= MUSIC_FLOOR, `peak ${music.peak}`);
  check('the master bus is free of NaN', music.nan === 0, `${music.nan} NaN samples`);
}

// --- Every voice in the catalogue ------------------------------------------
const sfx = await page.evaluate(async ({ floor }) => {
  // Stop the render loop: it starves setTimeout under software rasterisation,
  // and the waits below would otherwise take minutes and read nothing.
  window.game.stop();
  const a = window.game.audio;
  const ctx = a.ctx;
  a.musicBus.gain.value = 0;
  a.ambienceBus.gain.value = 0;

  const proc = ctx.createScriptProcessor(4096, 1, 1);
  let peak = 0;
  let nan = 0;
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (Number.isNaN(v)) nan++;
      else { const m = v < 0 ? -v : v; if (m > peak) peak = m; }
    }
  };
  const sink = ctx.createGain();
  sink.gain.value = 0;
  a.sfxBus.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);

  const ids = window.SFX_IDS;
  const peaks = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const id of ids) {
    // Wait for the bus to fall quiet before playing the next voice. Without
    // this the previous sound's tail is still ringing when the peak is reset,
    // so a completely dead voice measures as the decay of the one before it —
    // which is exactly how an earlier version of this test passed with two
    // voices deliberately silenced.
    for (let i = 0; i < 25; i++) {
      peak = 0;
      await sleep(120);
      if (peak < floor * 0.5) break;
    }
    peak = 0;
    a.play(id);
    await sleep(400);
    peaks[id] = +peak.toFixed(4);
  }
  return {
    count: ids.length,
    nan,
    silent: Object.entries(peaks).filter(([, v]) => v < floor).map(([k, v]) => `${k}=${v}`),
    quietest: Math.min(...Object.values(peaks)),
    loudest: Math.max(...Object.values(peaks)),
  };
}, { floor: SILENCE_FLOOR });

console.log(`  ${sfx.count} voices, peaks ${sfx.quietest} to ${sfx.loudest}`);
check('the catalogue was enumerated from the source', sfx.count >= 30, `${sfx.count} ids`);
check('every sound effect makes a sound',
  sfx.silent.length === 0, sfx.silent.join(', '));
check('no sound effect emits NaN', sfx.nan === 0, `${sfx.nan} NaN samples`);
check('nothing clips the bus outright', sfx.loudest <= 1, `loudest ${sfx.loudest}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
