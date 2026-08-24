/**
 * Capture the front door at each of its three states.
 *
 * The boot gate is the only screen in the game that is *meant* to be seen
 * mid-transition, and it is the one screen a test can only assert about in
 * fragments: a bar at zero, a bar at full, a button that was hidden and now is
 * not. This holds the asset back with a route so each state can actually be
 * looked at, at a desktop and a phone size.
 *
 *   node scripts/boot-capture.mjs [outputDir]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures/boot');
const URL = 'http://127.0.0.1:4173';
const PREINSTALLED_CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(300);
  }
  throw new Error(`preview server never came up at ${url}`);
}

const server = spawn('npm', ['run', 'preview'], { stdio: 'ignore', detached: true });
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
});

await waitForServer(URL);
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({
  executablePath: existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined,
});

const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];

for (const [name, options] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', phone],
]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();

  /*
   * Hold the track until the shot has been taken.
   *
   * On a preview server over loopback the whole file lands in a few
   * milliseconds, so the loading state is real but unphotographable. Releasing
   * it by hand is the only way to see the screen the player on a phone
   * connection actually sits in front of.
   */
  let release = () => {};
  const held = new Promise((resolve_) => {
    release = resolve_;
  });
  await page.route('**/*.webm', async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(URL);
  await page.waitForSelector('#app[data-ready="true"]');
  // Let the board turn away from its opening face, so the shot shows the gate
  // over a live scene rather than over the first frame of one.
  await sleep(1400);
  await page.screenshot({ path: `${OUTPUT_DIR}/${name}-loading.png` });

  release();
  await page.waitForSelector('.panel--boot.panel--ready');
  await sleep(300);
  await page.screenshot({ path: `${OUTPUT_DIR}/${name}-ready.png` });

  await page.getByRole('button', { name: 'TAP TO PLAY' }).click();
  await sleep(600);
  await page.screenshot({ path: `${OUTPUT_DIR}/${name}-title.png` });

  await context.close();
  console.log(`${name}: loading, ready, title`);
}

await browser.close();
process.exit(0);
