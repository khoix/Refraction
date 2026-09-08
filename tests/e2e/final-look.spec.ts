import { expect, test } from '@playwright/test';
import type { OrthographicCamera } from 'three';
import type { VoxelLayer } from '../../src/render/voxels';

for (const reduced of [false, true]) {
  test(`final examination continues from mid-Shift (reduced=${reduced})`, async ({ page }) => {
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto(`/?debug=1&mode=ascent&seed=final-look&reducedMotion=${reduced ? 1 : 0}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const result = await page.evaluate(() => {
      const { game, renderer } = window.__refraction!;
      const internal = renderer as unknown as {
        camera: OrthographicCamera;
        lockedPlain: VoxelLayer;
        renderedElevation: number;
      };
      game.active = null;
      game.status = 'paused';
      for (let z = 0; z < 8; z++) game.board.fill({ x: z, y: z, z });
      renderer.startTurn('right');
      renderer.render(game, 300);
      const sample = () => ({
        yaw: renderer.yaw,
        elevation: internal.renderedElevation,
        lens: [...internal.camera.projectionMatrix.elements],
        matrices: Array.from(internal.lockedPlain.mesh.instanceMatrix.array.slice(0, 8 * 16)),
      });
      const before = sample();
      renderer.setFinalLook(true);
      renderer.render(game, 0);
      const entry = sample();
      for (let i = 0; i < 120; i++) renderer.render(game, 1000 / 60);
      const arrived = sample();
      for (let i = 0; i < 120; i++) renderer.render(game, 1000 / 60);
      const later = sample();
      renderer.setFinalLook(false);
      renderer.snapToFace('front');
      renderer.render(game, 0);
      return {
        before,
        entry,
        arrived,
        later,
        reset: sample(),
        orthographic: internal.camera.isOrthographicCamera,
      };
    });
    expect(result.orthographic).toBe(true);
    expect(result.entry).toEqual(result.before);
    expect(result.arrived.elevation).toBe(22);
    expect(result.later.lens).toEqual(result.arrived.lens);
    if (reduced) expect(result.later).toEqual(result.arrived);
    else expect(result.later.yaw).toBeGreaterThan(result.arrived.yaw);
    expect(result.reset.yaw).toBe(0);
    expect(result.reset.elevation).toBe(0);
    expect(result.reset.lens).toEqual(result.before.lens);
  });
}
