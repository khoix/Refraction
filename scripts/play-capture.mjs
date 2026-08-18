/**
 * Capture frames from a real played game.
 *
 * `capture.mjs` composes deliberate set-pieces: a hand-filled board, a turn held
 * open, a menu. Useful for documenting a feature, useless for answering "what
 * does this actually look like to play". A synthetic board tends to be one lane
 * deep, which means one hue, which is exactly the question a colour-driven game
 * needs answered honestly.
 *
 * So this one plays. It drops pieces with varied lateral movement and rotation
 * so the well fills across every lane, then captures the board mid-fall (lane
 * focus active) and settled (every cube in its own depth colour, no focus).
 *
 *   node scripts/play-capture.mjs [outputDir]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures/play');
const URL = 'http://127.0.0.1:4173';
const PREINSTALLED_CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
/** Enough pieces to stack several rows deep across the whole width. */
const PIECES = 34;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const server = spawn('npm', ['run', 'preview'], { stdio: 'ignore', detached: true });
  const shutdown = () => {
    try {
      process.kill(-server.pid);
    } catch {
      // Already gone.
    }
  };

  try {
    await waitForServer(URL);

    const browser = await chromium.launch({
      ...(existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const shot = async (name) => {
      const file = resolve(OUTPUT_DIR, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`wrote ${file}`);
    };

    await page.goto(`${URL}/?debug=1&mode=ascent&seed=preview`);
    await page.waitForSelector('#app[data-ready="true"]');
    await sleep(600);

    // Spread the stack rather than piling one column: a well filled evenly is
    // what the player actually sees, and it puts several depths on screen at
    // once. The lane the piece arrives in is dealt, not chosen, so the depth
    // spread comes for free.
    const drift = [-3, 2, -1, 3, 0, -2, 1, -4, 4, -1, 2, -3];
    for (let i = 0; i < PIECES; i += 1) {
      const steps = drift[i % drift.length];
      for (let s = 0; s < Math.abs(steps); s += 1) {
        await page.keyboard.press(steps < 0 ? 'ArrowLeft' : 'ArrowRight');
      }
      if (i % 3 === 0) await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await sleep(90);
    }

    // Mid-fall with the piece in a middle lane: all three bands are on screen
    // at once -- x-ray in front, full colour in the piece's own lane, dark
    // behind. This is the ordinary case and the one worth judging the look on.
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game?.active) game.active = { ...game.active, lane: 3, y: 14 };
    });
    await sleep(400);
    await shot('play-falling');

    // The same board with the piece dealt to the back lane. Every settled cube
    // is then in front of it, so the whole board x-rays at once. It is the
    // hardest case for the effect and the one that shows whether "see through"
    // still reads when there is a lot to see through.
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game?.active) game.active = { ...game.active, lane: 7, y: 14 };
    });
    await sleep(400);
    await shot('play-deep');

    // Settled: no active piece, so no lane focus. Every cube renders in its own
    // depth colour at full strength -- the flat mosaic the design calls for, and
    // the honest test of whether the palette survives the render pipeline.
    // Done by clearing the piece rather than ending the run, so no panel covers
    // the board.
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game) game.active = null;
    });
    await sleep(400);
    await shot('play-settled');

    await browser.close();
  } finally {
    shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
