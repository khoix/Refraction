import { expect, test } from '@playwright/test';
import type { OrthographicCamera } from 'three';
import type { VoxelLayer } from '../../src/render/voxels';
for (const reduced of [false, true]) {
  test(`Shift preserves construction, lens and exact settlement (reduced=${reduced})`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.goto(`/?debug=1&mode=ascent&seed=shift-safety&reducedMotion=${reduced ? 1 : 0}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const result = await page.evaluate(() => {
      const { game: g, renderer: r } = window.__refraction!;
      const internal = r as unknown as {
        camera: OrthographicCamera;
        lockedPlain: VoxelLayer;
        renderedElevation: number;
      };
      g.board.clearAll();
      for (let z = 0; z < 8; z++) g.board.fill({ x: z, y: z % 3, z });
      g.active = null;
      g.status = 'paused';
      r.snapToFace('front');
      r.render(g, 1000);
      const mesh = internal.lockedPlain.mesh;
      const sample = () => ({
        lens: [...internal.camera.projectionMatrix.elements],
        matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
        version: mesh.instanceMatrix.version,
        colours: Array.from(mesh.instanceColor!.array.slice(0, mesh.count * 3)),
        yaw: r.yaw,
        flatness: r.flatness,
        elevation: internal.renderedElevation,
        turning: r.isTurning,
      });
      const initial = sample(),
        frames = [];
      for (const direction of ['right', 'right', 'left', 'left'] as const) {
        r.startTurn(direction);
        for (let i = 0; i < 10; i++) {
          r.render(g, 75);
          frames.push(sample());
        }
      }
      return { initial, frames, orthographic: internal.camera.isOrthographicCamera };
    });
    expect(result.orthographic).toBe(true);
    expect(result.initial.matrices).toHaveLength(128);
    for (const frame of result.frames) {
      expect(frame.lens).toEqual(result.initial.lens);
      expect(frame.matrices).toEqual(result.initial.matrices);
      expect(frame.version).toBe(result.initial.version);
    }
    expect(result.frames[4]!.colours).not.toEqual(result.initial.colours);
    for (const step of [9, 19, 29, 39]) {
      expect(result.frames[step]!.elevation).toBe(0);
      expect(result.frames[step]!.flatness).toBe(1);
      expect(result.frames[step]!.turning).toBe(false);
    }
    expect(result.frames.at(-1)!.colours).toEqual(result.initial.colours);
    expect(result.frames.at(-1)!.yaw).toBe(0);
  });
}
