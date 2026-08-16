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

    // Stage transition. Hand the run one line short of a boundary and clear it,
    // so the banner fires exactly the way it does in play.
    await page.evaluate(() => {
      const handle = window.__refraction;
      if (!handle) return;
      handle.restart('stage');
      const game = handle.game;
      game.lines = 15 * 3 - 1;
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
    });
    await sleep(150);
    await page.keyboard.press('Space');
    await sleep(500);
    await shot('06-stage-banner');

    // Full Spectrum: drive a clear on all four faces in one revolution.
    await page.evaluate(async () => {
      const handle = window.__refraction;
      if (!handle) return;
      handle.restart('prism');
      const game = handle.game;
      const settle = async () => {
        for (let i = 0; i < 200; i += 1) {
          if (game.status !== 'resolving' && game.status !== 'turning') return;
          await new Promise((r) => setTimeout(r, 10));
        }
      };
      for (let i = 0; i < 3; i += 1) {
        const destination = { front: 'left', left: 'back', back: 'right', right: 'front' }[
          game.face
        ];
        const alongX = destination === 'front' || destination === 'back';
        for (let n = 0; n < 8; n += 1) {
          game.board.fill(alongX ? { x: n, y: 0, z: 3 } : { x: 3, y: 0, z: n });
        }
        game.shiftMeter = game.stage.linesPerTurn;
        game.status = 'awaitingTurn';
        game.chooseTurn('right');
        await settle();
      }
      // Arm the fourth and final face, then leave it for the capture to trigger.
      for (let n = 0; n < 8; n += 1) game.board.fill({ x: n, y: 0, z: 3 });
      game.shiftMeter = game.stage.linesPerTurn;
      game.status = 'awaitingTurn';
    });
    await sleep(300);
    await page.keyboard.press('ArrowRight');
    await sleep(6300); // the turn, then the bloom
    await shot('07-full-spectrum');

    if (await page.locator('.overlay').isVisible()) await shot('08-game-over');

    // M6 scenes get a fresh page: the prism aftermath above leaves the
    // renderer's stretched turn and whiteout mid-flight, which would colour
    // everything that follows.
    await page.goto(`${URL}/?debug=1&seed=xray-capture`);
    await page.waitForSelector('#app[data-ready="true"]');
    await sleep(400);

    // M6: a piece buried behind a wall. The wall hides the piece and its
    // ghost, so the occluded silhouettes carry them, and the first-contact
    // X-ray shows the stack top through the wall.
    await page.evaluate(() => {
      const handle = window.__refraction;
      if (!handle) return;
      handle.restart('xray');
      const game = handle.game;
      // A wall across the near lane, in front of everything behind it.
      for (let x = 2; x <= 5; x += 1) {
        for (let y = 0; y <= 6; y += 1) game.board.fill({ x, y, z: 7 });
      }
      // A stack behind the wall for the piece to aim at.
      game.board.fill({ x: 3, y: 0, z: 4 });
      game.board.fill({ x: 3, y: 1, z: 4 });
      game.board.fill({ x: 4, y: 0, z: 4 });
      // Park the falling piece behind the wall, above the stack. Lane 3 on the
      // front face is z = 4, the same column as the stack.
      game.active = {
        id: 'O',
        offsets: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        u: 3,
        y: 4,
        lane: 3,
      };
    });
    await sleep(200);
    await shot('09-xray-buried');

    // M6: a clear, caught twice -- once during the lit flash (bloom), once as
    // the line dissolves into spectrum-tinted debris and the environment
    // ripples.
    await page.evaluate(() => {
      const handle = window.__refraction;
      if (!handle) return;
      handle.restart('burst');
      const game = handle.game;
      // Two rows, each one O-column short: the drop completes both at once,
      // for a double clear's worth of debris and a bigger ripple.
      for (let x = 0; x < 6; x += 1) {
        game.board.fill({ x, y: 0, z: 4 });
        game.board.fill({ x, y: 1, z: 4 });
      }
      game.active = {
        id: 'O',
        offsets: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        u: 6,
        y: 10,
        lane: 3,
      };
    });
    await sleep(120);
    await page.keyboard.press('Space');
    await sleep(60);
    await shot('10-clear-glow');
    await sleep(200);
    await shot('11-clear-debris');

    // M6: the experimental piece vocabulary, dealt from the first bag.
    await page.goto(`${URL}/?debug=1&seed=exp-capture&pieces=experimental`);
    await page.waitForSelector('#app[data-ready="true"]');
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
      await page.keyboard.press('Space');
      await sleep(120);
    }
    await sleep(400);
    await shot('12-experimental');

    await browser.close();
  } finally {
    shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
