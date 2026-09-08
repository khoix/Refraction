import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { fitCamera, positionCamera, shiftReveal, shiftYawProgress } from '../../src/render/scene';
describe('Shift choreography', () => {
  it('arrives exactly without overshoot and mirrors both directions', () => {
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const yaw = shiftYawProgress(i / 100);
      expect(yaw).toBeGreaterThanOrEqual(previous);
      expect(yaw).toBeLessThanOrEqual(1);
      expect(yaw + shiftYawProgress(1 - i / 100)).toBeCloseTo(1, 10);
      previous = yaw;
    }
    expect(shiftReveal(0)).toBe(0);
    expect(shiftReveal(1)).toBe(0);
  });
  it('examines its corner for at least 200ms of the unchanged 750ms interval', () => {
    let count = 0;
    for (let ms = 0; ms < 750; ms++) {
      const yaw = 90 * shiftYawProgress(ms / 750);
      if (yaw >= 22.5 && yaw <= 67.5) {
        count++;
        expect(shiftReveal(ms / 750)).toBe(1);
      }
    }
    expect(count).toBeGreaterThanOrEqual(200);
  });
  it('has no lift or settlement velocity snap', () => {
    const dt = 0.0001;
    for (const curve of [shiftReveal, shiftYawProgress]) {
      expect(Math.abs((curve(dt) - curve(0)) / dt)).toBeLessThan(0.001);
      expect(Math.abs((curve(1) - curve(1 - dt)) / dt)).toBeLessThan(0.001);
    }
  });
  it('keeps the lens fixed and unit spans identical across depth at every face', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 200);
    fitCamera(camera, 1440 / 900);
    const lens = camera.projectionMatrix.clone();
    for (let face = 0; face < 4; face++)
      for (let step = 0; step <= 20; step++) {
        positionCamera(
          camera,
          face * 90 + 90 * shiftYawProgress(step / 20),
          12 * shiftReveal(step / 20)
        );
        camera.updateMatrixWorld();
        expect(camera.projectionMatrix).toEqual(lens);
        const spans = [-3.5, 0, 3.5].map((z) => {
          const a = new Vector3(-0.5, 0, z).project(camera),
            b = new Vector3(0.5, 0, z).project(camera);
          return Math.hypot(b.x - a.x, b.y - a.y);
        });
        expect(spans[0]).toBeCloseTo(spans[1]!, 10);
        expect(spans[2]).toBeCloseTo(spans[1]!, 10);
      }
  });
});
