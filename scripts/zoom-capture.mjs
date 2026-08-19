/**
 * Crop a patch of the rendered board and blow it up.
 *
 * A full-frame capture answers "does the board look right"; it cannot answer
 * "does a cube look right", because a cube is about thirty pixels across and any
 * material decision lives inside that. This fills a few rows, screenshots the
 * canvas, then draws a crop of it into a scaled-up canvas with smoothing off, so
 * one voxel becomes big enough to actually judge.
 *
 *   node scripts/zoom-capture.mjs [outputDir] [zoom]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures/zoom');
const ZOOM = Number(process.argv[3] ?? 6);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

/** Fill the bottom rows across every lane, so the crop shows the whole ramp. */
async function fillBoard(turning) {
  await page.evaluate(
    ({ turning }) => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      // One cube per lane along the bottom, then a second row offset by a lane,
      // so vertically adjacent cubes differ in depth and the material can be
      // compared across the ramp in one crop.
      for (let x = 0; x < 8; x += 1) {
        game.board.fill({ x, y: 0, z: 7 - x });
        game.board.fill({ x, y: 1, z: 7 - ((x + 4) % 8) });
        game.board.fill({ x, y: 2, z: 7 - x });
      }
      game.active = null;
      if (turning) {
        game.shiftMeter = game.stage.linesPerTurn;
        game.status = 'awaitingTurn';
      }
    },
    { turning }
  );
}

async function zoomShot(name) {
  const data = await page.evaluate(
    ({ zoom }) => {
      const source = document.querySelector('canvas.stage');
      const renderer = window.__refraction?.renderer;
      if (!renderer) throw new Error('debug hook unavailable');
      const rect = renderer.wellScreenRect();
      const box = source.getBoundingClientRect();
      const scaleX = source.width / box.width;
      const scaleY = source.height / box.height;
      const PAD = 0.6;
      const rows = 18 + PAD * 2;
      // The bottom three rows, full width.
      const sx = (rect.left - box.left) * scaleX;
      const sy = (rect.top - box.top + (rect.height * (PAD + 15)) / rows) * scaleY;
      const sw = rect.width * scaleX;
      const sh = ((rect.height * 3) / rows) * scaleY;

      const out = document.createElement('canvas');
      out.width = Math.round(sw * zoom);
      out.height = Math.round(sh * zoom);
      const context = out.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
    { zoom: ZOOM }
  );
  const file = resolve(OUTPUT_DIR, `${name}.png`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`wrote ${file}`);
}

await page.goto(`${URL}/?debug=1&mode=ascent&seed=gel`);
await page.waitForSelector('#app[data-ready="true"]');
await fillBoard(false);
await sleep(400);
await zoomShot('settled');

// The meter has to be full before the arrow means anything: without this the
// key press is swallowed and the second shot is a copy of the first, which
// looks like "the turn changes nothing" rather than like a script bug.
await fillBoard(true);
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => {
  const renderer = window.__refraction?.renderer;
  return Boolean(renderer?.isTurning && renderer.flatness < 0.3);
});
await zoomShot('turning');

await browser.close();
process.exit(0);
