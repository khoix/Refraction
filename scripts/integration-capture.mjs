/** Final integration supplement to the retained environment captures.
 * Build first, then: node scripts/integration-capture.mjs <new-output-dir>
 * Reuses visual-audit's seed, board fixtures, RAF clock and measurement method.
 * No image hashes: numerical palette/readability tests remain authoritative.
 */
import { spawn } from 'node:child_process';
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2] ?? 'captures/integration');
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
const errors = [];
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
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
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
async function metric(page, name) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  const data = await page.evaluate((name) => {
    const h = window.__refraction,
      r = h.renderer;
    const gl = r.renderer.getContext();
    let uploads = 0,
      bytes = 0;
    const original = gl.bufferSubData.bind(gl);
    gl.bufferSubData = (...args) => {
      uploads++;
      bytes += args[4] ? args[4] * args[2].BYTES_PER_ELEMENT : (args[2]?.byteLength ?? 0);
      return original(...args);
    };
    const times = [],
      draws = [];
    const info = r.renderer.info;
    info.autoReset = false;
    for (let i = 0; i < 90; i++) {
      info.reset();
      const start = window.performance.now();
      r.render(h.game, name === 'turn' ? 0 : 1000 / 60);
      times.push(window.performance.now() - start);
      draws.push({ ...info.render });
    }
    gl.bufferSubData = original;
    info.autoReset = true;
    times.sort((a, b) => a - b);
    return {
      cpuRenderMs: { p50: times[45], p95: times[85], max: times[89] },
      drawCalls: draws[45].calls,
      triangles: draws[45].triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      uploadsPerFrame: uploads / 90,
      uploadBytesPerFrame: bytes / 90,
      well: r.wellScreenRect(),
      gpu: gl.getParameter(gl.RENDERER),
    };
  }, name);
  const after = await cdp.send('Performance.getMetrics');
  const values = (x) => Object.fromEntries(x.metrics.map((m) => [m.name, m.value]));
  const a = values(after),
    b = values(before);
  results.push({
    name,
    ...data,
    scriptMs: (a.ScriptDuration - b.ScriptDuration) * 1000,
    taskMs: (a.TaskDuration - b.TaskDuration) * 1000,
    heapDelta: a.JSHeapUsedSize - b.JSHeapUsedSize,
  });
  writeFileSync(resolve(out, 'metrics.json'), JSON.stringify(results, null, 2));
  console.log(name, JSON.stringify(results.at(-1)));
  await cdp.detach();
}

try {
  const { page, context } = await open({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await advance(page);
  await page.getByRole('button', { name: 'TAP TO PLAY', exact: true }).click({ force: true });
  await advance(page, 60);
  await metric(page, 'title');
  await setup(page);
  await metric(page, 'falling');
  await setup(page, 'ascent', 15);
  await metric(page, 'dense');
  await setup(page, 'ascent', 7, true);
  await metric(page, 'xray');
  await setup(page, 'ascent', 8);
  await shot(page, 'settled-before');
  await page.evaluate(() => {
    const g = window.__refraction.game;
    g.status = 'awaitingTurn';
    g.shiftMeter = g.stage.linesPerTurn;
  });
  await advance(page);
  await page.keyboard.press('ArrowRight');
  for (const [name, frames] of [
    ['early', 10],
    ['mid', 12],
    ['late', 12],
    ['destination', 12],
  ]) {
    await advance(page, frames);
    await shot(page, name);
  }
  await setup(page, 'ascent', 7);
  await page.evaluate(() => window.__refraction.renderer.startPrism());
  await advance(page, 12);
  await shot(page, 'prism');
  await metric(page, 'prism');
  await advance(page, 180);
  await shot(page, 'prism-recovered');
  await setup(page, 'blindSpectrum', 8);
  await shot(page, 'blind');
  await setup(page, 'ascent', 16);
  await page.evaluate(() => {
    const g = window.__refraction.game;
    g.active = null;
    g.status = 'gameOver';
  });
  await advance(page, 120);
  await shot(page, 'game-over');
  await context.close();
  for (const orientation of ['portrait', 'landscape']) {
    const { page, context } = await open({
      ...devices['Pixel 7'],
      viewport:
        orientation === 'portrait' ? { width: 412, height: 839 } : { width: 863, height: 360 },
      deviceScaleFactor: 1,
    });
    for (const mode of ['flatland', 'ascent']) {
      await setup(page, mode, 5);
      await shot(page, orientation + '-' + mode);
      await metric(page, orientation + '-' + mode);
    }
    await setup(page, 'ascent', 7, true);
    await shot(page, orientation + '-buried');
    await page.evaluate(() => window.__refraction.renderer.startTurn('right'));
    await advance(page, 22);
    await shot(page, orientation + '-turn');
    await setup(page);
    await page.evaluate(() => (window.__refraction.game.status = 'falling'));
    await page.keyboard.press('Escape');
    await advance(page);
    await shot(page, orientation + '-pause');
    await context.close();
  }
  const reduced = await open({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await reduced.page.goto(url + '&reducedMotion=1');
  await reduced.page.waitForSelector('#app[data-ready="true"]');
  await setup(reduced.page, 'ascent', 7);
  await reduced.page.evaluate(() => window.__refraction.renderer.startPrism());
  await advance(reduced.page, 12);
  await shot(reduced.page, 'reduced-prism');
  await setup(reduced.page, 'ascent', 7);
  await reduced.page.evaluate(() => window.__refraction.renderer.startCollapse());
  await advance(reduced.page, 3);
  await shot(reduced.page, 'reduced-collapse');
  await reduced.context.close();
} finally {
  writeFileSync(resolve(out, 'errors.json'), JSON.stringify(errors, null, 2));
  await browser.close();
  server.kill();
}
