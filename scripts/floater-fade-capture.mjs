/** Focused production check of ordinary/hero floater boundary coverage.
 * Build first. Starts production on 4173; pass a new output directory.
 */
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.argv[2]);
if (existsSync(out)) throw Error('Use a new output directory');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const server = spawn('npm', ['run', 'preview'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const errors = [],
  measurements = [];
try {
  for (const mode of ['playing', 'over']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto('http://127.0.0.1:4173/?debug=1&mode=ascent&seed=fade-check');
    await page.waitForSelector('#app[data-ready="true"]');
    await page.evaluate((mode) => {
      const h = window.__refraction,
        g = h.game,
        r = h.renderer;
      g.status = 'paused';
      g.board.clearAll();
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) g.board.fill({ x, y, z: x % 8 });
      r.render(g, 0);
      if (mode === 'over') {
        r.setFinalLook(true);
        r.render(g, 1800);
      }
      const field = r.environment.group.children.find((c) => c.userData.floaters);
      window.fadeField = field;
      window.fadeTargets = field.userData.floaters;
    }, mode);
    for (const kind of ['ordinary', 'hero'])
      for (const t of [0, 0.04, 0.065, 0.287, 0.5, 1]) {
        const m = await page.evaluate(
          ({ t, kind }) => {
            const { renderer: r, game: g } = window.__refraction,
              field = window.fadeField;
            const target = window.fadeTargets[kind === 'hero' ? 0 : 1];
            for (const v of window.fadeTargets) v.visible = false;
            field.userData.floaters = [target];
            target.userData.size = 1.7;
            target.userData.home = -2;
            target.userData.bob = 0;
            const x = 7 + (1.7 * Math.sqrt(3)) / 2 + 7 * t,
              a = (r.yaw * Math.PI) / 180;
            target.position.set(x * Math.cos(a), -2, -x * Math.sin(a));
            r.render(g, 0);
            const instances = field.userData.instances;
            return {
              t,
              kind,
              visible: target.visible,
              opacity:
                kind === 'hero'
                  ? target.material.opacity
                  : (instances.geometry.getAttribute('roomOpacity')?.getX(0) ?? null),
            };
          },
          { t, kind }
        );
        measurements.push({ mode, ...m });
        await page.screenshot({ path: resolve(out, mode + '-' + kind + '-' + t + '.png') });
      }
    await page.close();
  }
} finally {
  writeFileSync(
    resolve(out, 'measurements.json'),
    JSON.stringify({ measurements, errors }, null, 2)
  );
  await browser.close();
  server.kill();
}
