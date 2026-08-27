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

const env = { ...process.env, GAME_URL: 'http://127.0.0.1:4173/' };
let code = 0;
for (const script of ['scripts/playtest.mjs', 'scripts/test-ui-fit.mjs', 'scripts/test-tutorial.mjs']) {
  console.log(`\n=== ${script} ===`);
  const run = spawn('node', [script], { stdio: 'inherit', env });
  const result = await new Promise((r) => run.on('close', r));
  if (result) code = result;
}
server.kill();
process.exit(code);
