/**
 * Row-brightness profile of a rendered frame.
 *
 * For anything that is a horizontal feature: the floor lattice, a banner, the
 * Shift meter. A full-frame capture shows you *that* something is there; this
 * says how bright it is and whether it is one hard row or a spread — which is
 * the difference between a grid seen at an angle and the same grid seen
 * edge-on, clipping to white.
 *
 *   node scripts/row-profile.mjs [mode]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const MODE = process.argv[2] ?? 'flatland';
const URL = 'http://127.0.0.1:4173';
const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
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
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
});
const { defaultBrowserType: _ignored, ...phone } = devices['Pixel 7'];
const context = await browser.newContext({ ...phone });
const page = await context.newPage();
await page.goto(`${URL}/?debug=1&seed=rows`);
await page.waitForSelector('#app[data-ready="true"]');
await page.evaluate((id) => window.__refraction?.play(id, 'rows'), MODE);
await sleep(600);

/**
 * The brightest rows, and the sharpest local spike.
 *
 * A spike is a row far brighter than the rows three away on either side, which
 * is what a hard line is. Smooth gradients score near zero by it.
 */
const profile = async (label) => {
  const found = await page.evaluate(() => {
    const source = document.querySelector('canvas.stage');
    const scratch = document.createElement('canvas');
    scratch.width = source.width;
    scratch.height = source.height;
    const context2d = scratch.getContext('2d');
    context2d.drawImage(source, 0, 0);
    const { data } = context2d.getImageData(0, 0, scratch.width, scratch.height);

    const means = [];
    for (let y = 0; y < scratch.height; y += 1) {
      let sum = 0;
      let n = 0;
      for (let x = 0; x < scratch.width; x += 4) {
        const i = (y * scratch.width + x) * 4;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n += 1;
      }
      means.push(sum / n);
    }

    let spike = 0;
    let spikeAt = 0;
    for (let y = 3; y < means.length - 3; y += 1) {
      const around = (means[y - 3] + means[y + 3]) / 2;
      if (means[y] - around > spike) {
        spike = means[y] - around;
        spikeAt = y;
      }
    }
    const ranked = means.map((mean, y) => ({ y, mean })).sort((a, b) => b.mean - a.mean);
    return {
      spike: Math.round(spike * 10) / 10,
      spikeAt,
      brightest: ranked.slice(0, 3).map((r) => ({ y: r.y, mean: Math.round(r.mean * 10) / 10 })),
    };
  });
  console.log(label, JSON.stringify(found));
};

await profile('SETTLED');
// Peek adds eight degrees of elevation and nothing else, which is enough to
// take a horizontal plane off edge-on.
await page.keyboard.down('KeyP');
await sleep(500);
await profile('PEEKED ');
await page.keyboard.up('KeyP');

await browser.close();
process.exit(0);
