/**
 * The tetracube catalogue.
 *
 * A piece is a set of integer cube offsets. There are exactly eight free
 * tetracubes: five planar (the familiar tetrominoes, with J/L and S/Z merged
 * because a 180-degree turn about the long axis is a legal rotation in 3D) and
 * three non-planar (a tripod and the two mirror-image screws).
 */

import type { Cell, HorizontalAxis } from './types';

export type PieceId =
  | 'I'
  | 'O'
  | 'L'
  | 'T'
  | 'S'
  | 'TRIPOD'
  | 'SCREW_L'
  | 'SCREW_R'
  // Experimental vocabulary, dealt only from the experimental catalogue.
  | 'V3'
  | 'HOOK5'
  | 'TWIST5'
  | 'CROSS5';

/** Which piece vocabulary a run deals from. */
export type PieceCatalog = 'standard' | 'experimental';

/** Rotation axis in world space. Y is the board's vertical axis. */
export type RotationAxis = HorizontalAxis | 'y';

export interface PieceDef {
  readonly id: PieceId;
  /** Difficulty tier at which this piece starts appearing. */
  readonly tier: 1 | 2 | 3 | 4;
  readonly cells: readonly Cell[];
}

const cell = (x: number, y: number, z: number): Cell => ({ x, y, z });

/**
 * Tier assignment.
 *
 * The design spec originally described tier 2 as "a planar tetracube with one
 * cube pushed one lane forward or back". That construction is impossible: a
 * cube moved from (x, y, 0) to (x, y, 1) shares a face with none of the
 * remaining cells, because every one of them differs from it in two coordinates
 * at once. It always disconnects the piece -- see the test that proves it.
 *
 * The screws are what that tier actually wants. Each is a familiar planar piece
 * with a single cube bent out of plane, which is exactly the "mostly familiar,
 * one or two cubes shifted" feel the proposal describes, and they are genuine
 * tetracubes rather than an impossible construction.
 */
export const PIECES: readonly PieceDef[] = [
  { id: 'I', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(3, 0, 0)] },
  { id: 'O', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0), cell(1, 1, 0)] },
  { id: 'L', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(2, 1, 0)] },
  { id: 'T', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(1, 1, 0)] },
  { id: 'S', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(1, 1, 0), cell(2, 1, 0)] },
  // The screws are four-cube chains in which every turn is perpendicular to the
  // one before, making a quarter-helix. The two differ only in handedness: no
  // rotation maps one onto the other, only a reflection, which is why both exist
  // as separate pieces in 3D where J/L and S/Z do not.
  { id: 'SCREW_R', tier: 2, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(1, 1, 0), cell(1, 1, 1)] },
  { id: 'SCREW_L', tier: 2, cells: [cell(0, 0, 1), cell(1, 0, 1), cell(1, 1, 1), cell(1, 1, 0)] },
  // The tripod is a single cube with three mutually perpendicular arms. It is
  // achiral, and it is the piece that cannot be read from any single face.
  { id: 'TRIPOD', tier: 3, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0), cell(0, 0, 1)] },
];

/**
 * The experimental vocabulary, behind the `?pieces=experimental` flag.
 *
 * A playtest bed, not a rules change: it moves unmistakably non-planar pieces
 * to stage 1 so the game asserts its spatial identity immediately, raises the
 * non-planar proportion overall, and tries other voxel counts -- a tricube, and
 * three pentacubes chosen for interesting multi-face projections. Every entry
 * is judged by the criteria in PLAN M6.5, measured with the greedy agent in
 * `playability.test.ts` rather than by eye. Whatever earns its place graduates
 * into the standard catalogue with its own tier; the rest is deleted.
 */
export const EXPERIMENTAL_PIECES: readonly PieceDef[] = [
  // The familiar planar five stay, but the screws join them at tier 1: depth
  // arrives with the very first bag instead of waiting for stage 2.
  { id: 'I', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(3, 0, 0)] },
  { id: 'O', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0), cell(1, 1, 0)] },
  { id: 'L', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(2, 1, 0)] },
  { id: 'T', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(1, 1, 0)] },
  { id: 'S', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(1, 1, 0), cell(2, 1, 0)] },
  { id: 'SCREW_R', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(1, 1, 0), cell(1, 1, 1)] },
  { id: 'SCREW_L', tier: 1, cells: [cell(0, 0, 1), cell(1, 0, 1), cell(1, 1, 1), cell(1, 1, 0)] },
  // A tricube: small enough to rescue a bad board, and its L-projection is the
  // same from every face, which makes it a gentle first non-tetracube.
  { id: 'V3', tier: 1, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0)] },
  { id: 'TRIPOD', tier: 2, cells: [cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0), cell(0, 0, 1)] },
  // Pentacubes, all non-planar, all asymmetric on purpose: an L whose tip bends
  // away from the camera, a chiral staircase, and a T with a foot behind it.
  {
    id: 'HOOK5',
    tier: 3,
    cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(2, 0, 1), cell(2, 1, 1)],
  },
  {
    id: 'TWIST5',
    tier: 3,
    cells: [cell(0, 0, 0), cell(1, 0, 0), cell(1, 1, 0), cell(1, 1, 1), cell(2, 1, 1)],
  },
  {
    id: 'CROSS5',
    tier: 3,
    cells: [cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0), cell(1, 1, 0), cell(1, 0, 1)],
  },
];

/**
 * Every piece either catalogue can produce, for by-id lookups such as hold.
 * Standard entries win for the ids both catalogues share, so shared pieces
 * keep their canonical tier when looked up by id.
 */
export const PIECES_BY_ID: ReadonlyMap<PieceId, PieceDef> = new Map(
  [...EXPERIMENTAL_PIECES, ...PIECES].map((piece) => [piece.id, piece])
);

/** Pieces available at a given difficulty tier. */
export function piecesForTier(tier: number, catalog: PieceCatalog = 'standard'): PieceDef[] {
  const source = catalog === 'experimental' ? EXPERIMENTAL_PIECES : PIECES;
  return source.filter((piece) => piece.tier <= tier);
}

/** Translate a shape so its minimum corner sits at the origin. */
export function normalize(cells: readonly Cell[]): Cell[] {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const minZ = Math.min(...cells.map((c) => c.z));
  return cells
    .map((c) => cell(c.x - minX, c.y - minY, c.z - minZ))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
}

/** Canonical string for a normalised shape, for set membership and comparison. */
export function shapeKey(cells: readonly Cell[]): string {
  return normalize(cells)
    .map((c) => `${c.x},${c.y},${c.z}`)
    .join('|');
}

/**
 * Rotate 90 degrees about a world axis.
 *
 * The result is re-normalised to the origin, which means four successive turns
 * about one axis always return the original shape.
 */
export function rotate(cells: readonly Cell[], axis: RotationAxis, clockwise = true): Cell[] {
  const sign = clockwise ? 1 : -1;
  const turned = cells.map((c) => {
    switch (axis) {
      case 'x':
        return cell(c.x, -sign * c.z, sign * c.y);
      case 'y':
        return cell(sign * c.z, c.y, -sign * c.x);
      case 'z':
        return cell(-sign * c.y, sign * c.x, c.z);
    }
  });
  return normalize(turned);
}

/** Every distinct orientation reachable by rotation. At most 24. */
export function orientations(cells: readonly Cell[]): Cell[][] {
  const seen = new Map<string, Cell[]>();
  const queue: Cell[][] = [normalize(cells)];
  seen.set(shapeKey(cells), queue[0] as Cell[]);

  while (queue.length > 0) {
    const current = queue.pop() as Cell[];
    for (const axis of ['x', 'y', 'z'] as const) {
      const next = rotate(current, axis);
      const key = shapeKey(next);
      if (!seen.has(key)) {
        seen.set(key, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
}

/** Face-connectivity: every cube reachable from every other through shared faces. */
export function isConnected(cells: readonly Cell[]): boolean {
  if (cells.length === 0) return false;
  const keys = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
  const start = cells[0] as Cell;
  const stack: Cell[] = [start];
  const visited = new Set<string>([`${start.x},${start.y},${start.z}`]);

  const neighbours = (c: Cell): Cell[] => [
    cell(c.x + 1, c.y, c.z),
    cell(c.x - 1, c.y, c.z),
    cell(c.x, c.y + 1, c.z),
    cell(c.x, c.y - 1, c.z),
    cell(c.x, c.y, c.z + 1),
    cell(c.x, c.y, c.z - 1),
  ];

  while (stack.length > 0) {
    for (const next of neighbours(stack.pop() as Cell)) {
      const key = `${next.x},${next.y},${next.z}`;
      if (keys.has(key) && !visited.has(key)) {
        visited.add(key);
        stack.push(next);
      }
    }
  }
  return visited.size === cells.length;
}

/** True when every cube shares one plane -- i.e. the piece is flat. */
export function isPlanar(cells: readonly Cell[]): boolean {
  const distinct = (values: number[]): number => new Set(values).size;
  return (
    distinct(cells.map((c) => c.x)) === 1 ||
    distinct(cells.map((c) => c.y)) === 1 ||
    distinct(cells.map((c) => c.z)) === 1
  );
}

/** Bounding box extent of a shape. */
export function extent(cells: readonly Cell[]): Cell {
  const normalised = normalize(cells);
  return cell(
    Math.max(...normalised.map((c) => c.x)) + 1,
    Math.max(...normalised.map((c) => c.y)) + 1,
    Math.max(...normalised.map((c) => c.z)) + 1
  );
}
