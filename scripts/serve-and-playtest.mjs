/** Starts a preview server, runs the browser playtest against it, tears down. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
server.stdout.on('data', (d) => { if (String(d).includes('4173')) ready = true; });

for (let i = 0; i < 40 && !ready; i++) await sleep(250);
await sleep(500);

const test = spawn('node', ['scripts/playtest.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, GAME_URL: 'http://127.0.0.1:4173/' },
});
const code = await new Promise((r) => test.on('close', r));
server.kill();
process.exit(code ?? 0);
