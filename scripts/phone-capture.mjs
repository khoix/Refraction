/**
 * Capture the game as a phone sees it, in play.
 *
 *   node scripts/phone-capture.mjs [outputDir]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures/phone');
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

for (const [name, profile, mode] of [
  ['portrait-flatland', devices['Pixel 7'], 'flatland'],
  ['portrait-ascent', devices['Pixel 7'], 'ascent'],
  ['landscape-ascent', devices['Pixel 7 landscape'], 'ascent'],
]) {
  const context = await browser.newContext({ ...profile });
  const page = await context.newPage();
  await page.goto(`${URL}/?debug=1&seed=phone`);
  await page.waitForSelector('#app[data-ready="true"]');

  // Into a run, with a few pieces down so the board has something in it.
  await page.evaluate((id) => window.__refraction?.play(id, 'phone'), mode);
  await sleep(400);
  await page.evaluate(() => {
    const game = window.__refraction?.game;
    if (!game) throw new Error('no hook');
    for (let x = 0; x < 7; x += 1) {
      for (let y = 0; y < 2 + (x % 3); y += 1) game.board.fill({ x, y, z: 7 - ((x + y) % 8) });
    }
  });
  await sleep(400);
  await page.screenshot({ path: resolve(OUTPUT_DIR, `${name}-play.png`) });

  // And the strip's own geometry, against the Shift meter's.
  const boxes = await page.evaluate(() => {
    const renderer = window.__refraction?.renderer;
    const game = window.__refraction?.game;
    const shift = document.querySelector('.hud__shift');
    if (!renderer || !game || !shift) throw new Error('no hook');
    const well = renderer.wellScreenRect();
    const bar = shift.getBoundingClientRect();
    const STRIP = 84;
    const touch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const hasStrip = touch && !game.rollOnly;
    return {
      touchPrimary: touch,
      rollOnly: game.rollOnly,
      hasStrip,
      stripTop: hasStrip ? window.innerHeight - STRIP : null,
      wellBottom: Math.round(well.top + well.height),
      wellWidth: Math.round(well.width),
      bar: { top: Math.round(bar.top), bottom: Math.round(bar.bottom) },
      overlapsStrip: hasStrip ? bar.bottom > window.innerHeight - STRIP : false,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  console.log(name, JSON.stringify(boxes));
  await context.close();
}

await browser.close();
process.exit(0);
