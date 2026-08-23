import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTAL_PIECES,
  PIECES,
  PIECES_BY_ID,
  extent,
  isConnected,
  isPlanar,
  normalize,
  orientations,
  piecesForTier,
  rotate,
  shapeKey,
} from '@core/pieces';
import type { Cell } from '@core/types';

describe('the catalogue', () => {
  it('holds the eight free tetracubes', () => {
    expect(PIECES).toHaveLength(8);
    expect(new Set(PIECES.map((p) => p.id)).size).toBe(8);
  });

  it('gives every piece exactly four connected cubes', () => {
    for (const piece of PIECES) {
      expect(piece.cells).toHaveLength(4);
      expect(isConnected(piece.cells)).toBe(true);
    }
  });

  it('splits into five planar and three non-planar pieces', () => {
    const planar = PIECES.filter((p) => isPlanar(p.cells));
    expect(planar.map((p) => p.id).sort()).toEqual(['I', 'L', 'O', 'S', 'T']);
    expect(PIECES.length - planar.length).toBe(3);
  });

  it('has no two pieces that are rotations of each other', () => {
    const seen = new Map<string, string>();
    for (const piece of PIECES) {
      for (const orientation of orientations(piece.cells)) {
        const key = shapeKey(orientation);
        const owner = seen.get(key);
        expect(owner ?? piece.id).toBe(piece.id);
        seen.set(key, piece.id);
      }
    }
  });

  it('treats the two screws as genuinely distinct chiralities', () => {
    const left = PIECES_BY_ID.get('SCREW_L');
    const right = PIECES_BY_ID.get('SCREW_R');
    const leftKeys = new Set(orientations(left!.cells).map(shapeKey));
    expect(leftKeys.has(shapeKey(right!.cells))).toBe(false);
  });

  it('unlocks pieces by tier, cumulatively', () => {
    expect(
      piecesForTier(1)
        .map((p) => p.id)
        .sort()
    ).toEqual(['I', 'L', 'O', 'S', 'T']);
    expect(piecesForTier(2)).toHaveLength(7);
    expect(piecesForTier(4)).toHaveLength(8);
    expect(piecesForTier(1).every((p) => isPlanar(p.cells))).toBe(true);
  });
});

describe('the experimental catalogue', () => {
  it('keeps every piece connected, at three to five cubes', () => {
    for (const piece of EXPERIMENTAL_PIECES) {
      expect(isConnected(piece.cells)).toBe(true);
      expect(piece.cells.length).toBeGreaterThanOrEqual(3);
      expect(piece.cells.length).toBeLessThanOrEqual(5);
    }
  });

  it('introduces non-planar geometry at tier 1, which is its whole point', () => {
    const tierOne = piecesForTier(1, 'experimental');
    expect(tierOne.some((piece) => !isPlanar(piece.cells))).toBe(true);
  });

  it('deals only non-planar pentacubes', () => {
    for (const piece of EXPERIMENTAL_PIECES) {
      if (piece.cells.length === 5) expect(isPlanar(piece.cells)).toBe(false);
    }
  });

  it('never leaks into the standard catalogue', () => {
    // The experiment must not change the shipped game: the default deal at
    // every tier is exactly the eight free tetracubes, as before.
    const standardIds = new Set(PIECES.map((piece) => piece.id));
    for (let tier = 1; tier <= 4; tier += 1) {
      for (const piece of piecesForTier(tier)) {
        expect(standardIds.has(piece.id)).toBe(true);
      }
    }
    expect(piecesForTier(4)).toHaveLength(8);
  });

  it('registers every experimental piece for by-id lookup, e.g. hold', () => {
    for (const piece of EXPERIMENTAL_PIECES) {
      expect(PIECES_BY_ID.get(piece.id)?.cells.length).toBe(piece.cells.length);
    }
    // Shared ids keep their canonical (standard) tier in the lookup.
    expect(PIECES_BY_ID.get('TRIPOD')?.tier).toBe(3);
  });
});

describe('rotation', () => {
  it('returns to the original shape after four turns about any axis', () => {
    for (const piece of PIECES) {
      for (const axis of ['x', 'y', 'z'] as const) {
        let cells: Cell[] = normalize([...piece.cells]);
        for (let i = 0; i < 4; i += 1) cells = rotate(cells, axis);
        expect(shapeKey(cells)).toBe(shapeKey(piece.cells));
      }
    }
  });

  it('is reversible', () => {
    for (const piece of PIECES) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const there = rotate([...piece.cells], axis, true);
        expect(shapeKey(rotate(there, axis, false))).toBe(shapeKey(piece.cells));
      }
    }
  });

  it('preserves cube count and connectivity', () => {
    for (const piece of PIECES) {
      for (const orientation of orientations(piece.cells)) {
        expect(orientation).toHaveLength(4);
        expect(isConnected(orientation)).toBe(true);
      }
    }
  });

  it('never yields more than the 24 proper rotations', () => {
    for (const piece of PIECES) {
      const count = orientations(piece.cells).length;
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(24);
    }
  });

  it('gives the symmetric pieces fewer orientations than the chiral ones', () => {
    expect(orientations(PIECES_BY_ID.get('O')!.cells).length).toBeLessThan(
      orientations(PIECES_BY_ID.get('SCREW_L')!.cells).length
    );
  });
});

describe('the tier-2 correction', () => {
  it('proves a single cube cannot be pushed one lane without breaking the piece', () => {
    // The design spec originally described tier 2 as a planar tetracube with one
    // cube pushed a lane forward or back. Every such push disconnects the piece:
    // the moved cube differs from each remaining cube in two coordinates at
    // once, so it shares a face with none of them. This is why the screws fill
    // that tier instead.
    const planar = PIECES.filter((piece) => isPlanar(piece.cells));
    expect(planar.length).toBeGreaterThan(0);

    let connectedResults = 0;
    for (const piece of planar) {
      const cells = normalize([...piece.cells]);
      for (let index = 0; index < cells.length; index += 1) {
        for (const delta of [-1, 1]) {
          const pushed = cells.map((c, i) =>
            i === index ? { x: c.x, y: c.y, z: c.z + delta } : c
          );
          if (isConnected(pushed)) connectedResults += 1;
        }
      }
    }
    expect(connectedResults).toBe(0);
  });
});

describe('helpers', () => {
  it('normalises to the origin and a stable order', () => {
    const shifted = [
      { x: 5, y: 3, z: 2 },
      { x: 4, y: 3, z: 2 },
    ];
    expect(normalize(shifted)).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
  });

  it('measures bounding-box extent', () => {
    expect(extent(PIECES_BY_ID.get('I')!.cells)).toEqual({ x: 4, y: 1, z: 1 });
    expect(extent(PIECES_BY_ID.get('O')!.cells)).toEqual({ x: 2, y: 2, z: 1 });
  });

  it('rejects disconnected and empty shapes', () => {
    expect(isConnected([])).toBe(false);
    expect(
      isConnected([
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ])
    ).toBe(false);
  });
});
