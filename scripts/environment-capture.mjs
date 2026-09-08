/** Focused production environment captures; fixed audit seed and held RAF clock.
 * Build first, then run this script with a new output directory.
 * Numerical palette/readability assertions remain authoritative.
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] ?? 'captures/environment');
if (existsSync(out)) throw new Error('Use a new output directory');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  ...(existsSync(process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium')
    ? { executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' }
    : {}),
});
const server = spawn('npm', ['run', 'preview'], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 1500));
const results = [];
const url = 'http://127.0.0.1:4173/?debug=1&seed=visual-audit';
async function open(profile) {
  const context = await browser.newContext(profile);
  await context.addInitScript(() => {
    let seed = 1234567;
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let queue = new Map(),
      id = 0,
      now;
    window.requestAnimationFrame = (cb) => {
      queue.set(++id, cb);
      return id;
    };
    window.cancelAnimationFrame = (key) => queue.delete(key);
    window.auditAdvance = (frames = 1) => {
      now ??= window.performance.now();
      const renderer = window.__refraction?.renderer.renderer;
      const draw = renderer?.render;
      for (let i = 0; i < frames; i++) {
        if (renderer) renderer.render = i === frames - 1 ? draw : () => {};
        now += 1000 / 60;
        const pending = queue;
        queue = new Map();
        for (const cb of pending.values()) cb(now);
      }
    };
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('#app[data-ready="true"]');
  return { context, page };
}
async function advance(page, frames = 1) {
  await page.evaluate((n) => window.auditAdvance(n), frames);
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}.png`), timeout: 120000 });
  console.log(name);
}
async function setup(page, mode = 'ascent', height = 0, buried = false) {
  await page.evaluate(
    ({ mode, height, buried }) => {
      const h = window.__refraction;
      h.play(mode, 'visual-audit');
      h.renderer.setPeek(false);
      const g = h.game;
      g.board.clearAll();
      for (let y = 0; y < height; y++)
        for (let z = 0; z < 8; z++)
          for (let x = 0; x < 8; x++) {
            if ((x * 3 + z * 5 + y) % 7 < 4) g.board.fill({ x, y, z });
          }
      if (buried)
        for (let y = 0; y < 12; y++)
          for (let z = 1; z < 8; z++) for (let x = 2; x < 6; x++) g.board.fill({ x, y, z });
      g.active = {
        id: 'O',
        offsets: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        u: 3,
        y: 15,
        lane: buried ? 7 : 3,
      };
      g.status = 'paused';
    },
    { mode, height, buried }
  );
  await advance(page, 60);
}
try {
  const { page, context } = await open({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await advance(page);
  await page.getByRole('button', { name: 'TAP TO PLAY', exact: true }).click({ force: true });
  await advance(page, 60);
  await shot(page, 'title');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click({ force: true });
  await advance(page, 12);
  await shot(page, 'modes');
  await setup(page);
  await shot(page, 'fresh-active');
  await setup(page, 'ascent', 8);
  await shot(page, 'populated');
  await page.evaluate(() => window.__refraction.renderer.startTurn('right'));
  await advance(page, 22);
  await shot(page, 'mid-shift');
  await setup(page, 'ascent', 7, true);
  await shot(page, 'buried-landing');
  await setup(page, 'ascent', 7);
  await page.evaluate(() => {
    const { game: g, renderer: r } = window.__refraction;
    r.clearEffect([{ y: 3, lane: 3 }], g.face, false, false);
  });
  await advance(page, 3);
  await shot(page, 'clear');
  results.push(
    await page.evaluate(() => {
      const r = window.__refraction.renderer;
      const states = r.scene.children.map((c) => c.visible);
      r.scene.children.forEach((c) => {
        c.visible = c === r.environment.group;
      });
      r.renderer.info.reset();
      r.renderer.render(r.scene, r.camera);
      const result = { ...r.renderer.info.render };
      r.scene.children.forEach((c, i) => {
        c.visible = states[i];
      });
      return result;
    })
  );
  writeFileSync(resolve(out, 'measurements.json'), JSON.stringify({ results, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  await context.close();
} finally {
  await browser.close();
  server.kill();
}
