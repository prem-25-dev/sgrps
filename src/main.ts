import './ui/styles.css';
import { Game } from './core/Game';

/**
 * Entry point. Boots the game into #app and reports any fatal failure on
 * screen rather than leaving a black canvas.
 */

function fail(message: string, detail?: unknown): void {
  console.error('[NEON RUN]', message, detail);
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div style="position:fixed;inset:0;display:grid;place-content:center;gap:12px;
                text-align:center;font-family:system-ui,sans-serif;color:#e8f2fa;
                background:#05070d;padding:24px">
      <div style="font-size:28px;font-weight:800">NEON RUN could not start</div>
      <div style="color:#8ea6bd;max-width:44ch;line-height:1.6">${message}</div>
    </div>`;
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) {
    fail('The page is missing its #app container.');
    return;
  }

  // WebGL is the one hard requirement; check it before building anything.
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
  if (!gl) {
    fail('This browser does not support WebGL, which the game needs to render.');
    return;
  }

  try {
    const game = new Game(app);
    (window as unknown as { game: Game }).game = game;
    await game.boot();
  } catch (err) {
    fail('Something went wrong while starting up. Check the console for details.', err);
  }
}

void main();
