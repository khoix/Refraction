/**
 * Capture screenshots of the running game.
 *
 * Builds, serves, drives the game with scripted key presses, and writes PNGs.
 * Used for design review and for attaching visuals to a milestone write-up.
 *
 *   node scripts/capture.mjs [outputDir]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const OUTPUT_DIR = resolve(process.argv[2] ?? 'captures');
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
    // A stretched turn makes a chosen moment of the rotation reachable: screenshot
    // latency is unpredictable and would otherwise land wherever it lands.
    await page.goto(`${URL}/?debug=1&seed=capture&turnMs=6000`);
    await page.waitForSelector('#app[data-ready="true"]');
    await sleep(700);

    const shot = async (name) => {
      const file = resolve(OUTPUT_DIR, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`wrote ${file}`);
    };

    await shot('01-start');

    // Land a handful of pieces so the well has structure to read.
    for (let i = 0; i < 7; i += 1) {
      await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await sleep(120);
    }
    await sleep(400);
    await shot('02-stacking');

    // Build a structure that is incomplete from the front but already complete
    // along Z, then fill the meter. This is the Refraction Clear setup: the
    // lines exist physically, and only the turn makes them eligible.
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) return;
      for (let x = 2; x <= 4; x += 1) {
        for (let z = 0; z < 8; z += 1) game.board.fill({ x, y: 0, z });
      }
      game.shiftMeter = game.stage.linesPerTurn;
      game.status = 'awaitingTurn';
    });
    await sleep(250);

    if (await page.locator('.prompt').isVisible()) {
      await shot('03-shift-prompt');

      // Catch the turn mid-flight. Screenshots are not instant, so sample a few
      // points across the 750ms rotation rather than trusting one sleep.
      await page.keyboard.press('ArrowRight');
      const started = Date.now();
      for (const [name, target] of [
        ['04-turn-early', 1500],
        ['04-turn-mid', 3000],
        ['04-turn-late', 4500],
      ]) {
        const wait = target - (Date.now() - started);
        if (wait > 0) await sleep(wait);
        await shot(name);
      }

      await sleep(2500);
      await shot('05-new-face');
    } else {
      console.warn('meter never filled; skipping turn captures');
    }

    if (await page.locator('.overlay').isVisible()) await shot('06-game-over');

    await browser.close();
  } finally {
    shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
