import type { BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/core/board';
import { VoxelLayer, EdgeLayer } from '../../src/render/voxels';
import { PiecePreview } from '../../src/render/preview';
import { CellSnapshot } from '../../src/render/cell-snapshot';

describe('render invalidation', () => {
  it('detects in-place edits and replacement arrays by value', () => {
    const snapshot = new CellSnapshot();
    const cells = [{x:1,y:2,z:3}];
    snapshot.capture(cells);
    expect(snapshot.matches([{x:1,y:2,z:3}])).toBe(true);
    cells[0]!.z = 4;
    expect(snapshot.matches(cells)).toBe(false);
    expect(snapshot.matches([])).toBe(false);
  });

  it('skips unchanged uploads but invalidates colour, transform and mode independently', () => {
    const layer = new VoxelLayer();
    const cells = [{x:1,y:2,z:3}];
    layer.update(cells,0);
    const matrix = layer.mesh.instanceMatrix;
    const colour = layer.mesh.instanceColor!;
    const versions = [matrix.version, colour.version];
    layer.update([{...cells[0]!}],0);
    expect([matrix.version, colour.version]).toEqual(versions);
    layer.update(cells,45);
    expect(matrix.version).toBe(versions[0]);
    expect(colour.version).toBeGreaterThan(versions[1]!);
    const yawColour = colour.version;
    layer.update(cells,45,0.78);
    expect(matrix.version).toBeGreaterThan(versions[0]!);
    expect(colour.version).toBe(yawColour);
    layer.setDepthColour(false); layer.update(cells,45,0.78);
    expect(colour.version).toBeGreaterThan(yawColour);
    cells[0]!.x = 2; const before = matrix.version;
    layer.update(cells,45,0.78); expect(matrix.version).toBeGreaterThan(before);
    expect(matrix.updateRanges).toEqual([{start:0,count:16}]);
    layer.update([],45); expect(layer.mesh.count).toBe(0);
    layer.update(cells,45); expect(layer.mesh.count).toBe(1);
    layer.dispose();
  });

  it('keeps shared geometry alive until the last owner releases it', () => {
    const a=new VoxelLayer(), b=new VoxelLayer();
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
    let disposals=0; a.mesh.geometry.addEventListener('dispose',()=>disposals++);
    a.dispose(); expect(disposals).toBe(0);
    b.update([{x:0,y:0,z:0}],0); b.dispose(); expect(disposals).toBe(1);
    a.dispose(); expect(disposals).toBe(1);
  });

  it('caches silhouette uploads without ignoring face or cell mutations', () => {
    const layer=new EdgeLayer(); const cells=[{x:0,y:0,z:0}];
    layer.update(cells,'front',0);
    const attribute=layer.lines.geometry.getAttribute('position') as BufferAttribute;
    const version=attribute.version;
    layer.update(cells,'front',0); expect(attribute.version).toBe(version);
    layer.update(cells,'right',90); expect(attribute.version).toBeGreaterThan(version);
    const turned=attribute.version; cells[0]!.y=2;
    layer.update(cells,'right',90); expect(attribute.version).toBeGreaterThan(turned);
    layer.dispose();
  });

  it('spins the preview without rewriting its piece', () => {
    const preview=new PiecePreview();
    preview.setPiece([{x:0,y:0,z:0},{x:1,y:0,z:0}],3); preview.update(16);
    const mesh=preview.scene.children.find(child=>'instanceMatrix' in child) as VoxelLayer['mesh'];
    const version=mesh.instanceMatrix.version;
    preview.update(100); expect(mesh.instanceMatrix.version).toBe(version);
    preview.setPiece([{x:0,y:0,z:0}],6); preview.update(16);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(version);
    expect(mesh.count).toBe(1); preview.dispose();
  });

  it('invalidates for each board mutation including collapse and rescue', () => {
    const b=new Board(); const cell={x:0,y:3,z:0};
    let revision=b.revision; b.fill(cell); expect(b.revision).toBeGreaterThan(revision);
    revision=b.revision; b.fill(cell); expect(b.revision).toBe(revision);
    b.compactAll(); expect(b.revision).toBeGreaterThan(revision);
    revision=b.revision; b.clearLines('front',[{y:0,lane:7}]); expect(b.revision).toBeGreaterThan(revision);
    b.fill(cell); revision=b.revision; b.removeHighestRow(); expect(b.revision).toBeGreaterThan(revision);
    b.fill(cell); revision=b.revision; b.clear(cell); expect(b.revision).toBeGreaterThan(revision);
    b.fill(cell); revision=b.revision; b.clearAll(); expect(b.revision).toBeGreaterThan(revision);
  });
});
