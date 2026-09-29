/**
 * Resolves a Chromium to drive the game with.
 *
 * Three environments have to work: CI (Playwright downloads its own matching
 * revision), this sandbox (a pre-baked Chromium whose revision may not match
 * the installed Playwright), and a developer's machine. So: honour an explicit
 * override, then Playwright's own answer if it exists on disk, then scan the
 * browsers directory for any Chromium at all.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return expected;
  } catch {
    // Playwright cannot say; fall through to the scan.
  }

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      for (const candidate of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const full = join(root, entry, candidate);
        if (existsSync(full)) return full;
      }
    }
  }
  return undefined;
}

/** Launch args that make WebGL work on a headless CI runner. */
export const HEADLESS_GL_ARGS = [
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage',
];

export async function launchGameBrowser() {
  const executablePath = resolveChromium();
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: HEADLESS_GL_ARGS,
  });
}
