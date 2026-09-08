import { describe, expect, it } from 'vitest';
import { acquireVoxelGeometry, releaseVoxelGeometry } from '../../src/render/voxel-geometry';
import { createGelMaterial } from '../../src/render/gel';
describe('production voxel form', () => {
  it('keeps the unit envelope and triangle budget with a firmer bevel', () => {
    const classic = acquireVoxelGeometry();
    const board = acquireVoxelGeometry('board');
    classic.computeBoundingBox();
    board.computeBoundingBox();
    expect(board.boundingBox).toEqual(classic.boundingBox);
    expect(board.getAttribute('position').count).toBe(classic.getAttribute('position').count);
    expect(board.getAttribute('position').array).not.toEqual(
      classic.getAttribute('position').array
    );
    releaseVoxelGeometry();
    releaseVoxelGeometry('board');
  });
  it('does not introduce transmission, metalness or environment reflections', () => {
    const material = createGelMaterial();
    expect(material.transmission).toBe(0);
    expect(material.metalness).toBe(0);
    expect(material.envMap).toBeNull();
    expect(material.envMapIntensity).toBe(0);
    material.dispose();
  });
});
