/**
 * Capture the title screen, including mid-turn.
 *
 *   node scripts/title-capture.mjs [outputDir]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures/title');
const URL = 'http://127.0.0.1:4173';
const PREINSTALLED_CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
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

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['portrait', { width: 420, height: 860 }],
]) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${URL}/?debug=1`);
  await page.waitForSelector('#app[data-ready="true"]');
  await sleep(700);
  await page.screenshot({ path: resolve(OUTPUT_DIR, `${name}-settled.png`) });

  // Wait for the attract turn to reach its dimensional peak.
  await page.waitForFunction(
    () => {
      const renderer = window.__refraction?.renderer;
      return Boolean(renderer?.isTurning && renderer.flatness < 0.3);
    },
    { timeout: 15_000 }
  );
  await page.screenshot({ path: resolve(OUTPUT_DIR, `${name}-turning.png`) });
  console.log(`wrote ${name}`);
  await page.close();
}

await browser.close();
process.exit(0);
