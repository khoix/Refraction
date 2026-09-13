import { expect, test } from '@playwright/test';
import type { Group, Mesh } from 'three';
import type { Environment } from '../../src/render/environment';

for (const finalLook of [false, true]) {
  test(`floater boundary fades without a black silhouette (gameOver=${finalLook})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto('/?debug=1&mode=ascent&seed=floater-fade');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const results = await page.evaluate((finalLook) => {
      const { game, renderer } = window.__refraction!;
      game.status = 'paused';
      renderer.render(game, 0);
      if (finalLook) {
        renderer.setFinalLook(true);
        renderer.render(game, 1800);
      }
      const environment = (renderer as unknown as { environment: Environment }).environment;
      const field = environment.group.children.find((c) => c.userData['floaters']) as Group;
      const floaters = field.userData['floaters'] as Mesh[];
      const canvas = document.querySelector('canvas.stage') as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d')!;
      const pixels = () => {
        ctx.drawImage(canvas, 0, 0);
        return ctx.getImageData(0, 0, copy.width, copy.height).data;
      };
      const samples = [];
      for (const target of [floaters[0]!, floaters[1]!]) {
        for (const t of [0, 0.04, 0.065, 0.5]) {
          field.userData['floaters'] = [];
          for (const floater of floaters) floater.visible = false;
          renderer.render(game, 0);
          const hidden = pixels();
          field.userData['floaters'] = [target];
          target.userData['size'] = 1.7;
          target.userData['home'] = -2;
          target.userData['bob'] = 0;
          const x = 7 + (1.7 * Math.sqrt(3)) / 2 + 7 * t;
          const yaw = (renderer.yaw * Math.PI) / 180;
          target.position.set(x * Math.cos(yaw), -2, -x * Math.sin(yaw));
          renderer.render(game, 0);
          const shown = pixels();
          let max = 0;
          for (let i = 0; i < shown.length; i++) {
            if (i % 4 !== 3) max = Math.max(max, Math.abs(shown[i]! - hidden[i]!));
          }
          samples.push({ t, max });
        }
      }
      return samples;
    }, finalLook);
    for (const { t, max } of results) {
      // At the old 1% visibility cutoff the opaque black cube changed pixels
      // sharply. A near-zero coverage cube must approach the empty backdrop.
      if (t < 0.1) expect(max).toBeLessThanOrEqual(3);
      else expect(max).toBeGreaterThan(3);
    }
    expect(errors).toEqual([]);
  });
}
