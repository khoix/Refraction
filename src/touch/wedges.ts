/**
 * Full-profile rotate tap zones — normalized polygon partition.
 *
 * Shared by the gesture recogniser and the settings diagram so hit-testing and
 * the overlay cannot drift. Geometry is the authored mobile touch-zone map:
 * point-in-polygon on normalized (0..1) coordinates, not rectangular hitboxes.
 */

import type { Action } from '../keymap';

export type Point = readonly [number, number];

export type WedgeId = 'pitchUp' | 'pitchDown' | 'yawAnti' | 'yawClock' | 'rollAnti' | 'rollClock';

export type ZoneId =
  | 'Q_TOP_LEFT'
  | 'E_TOP_RIGHT'
  | 'W'
  | 'A'
  | 'DEAD_ZONE'
  | 'D'
  | 'S'
  | 'Q_BOTTOM_LEFT'
  | 'E_BOTTOM_RIGHT';

export const WEDGE_ACTION: Readonly<Record<WedgeId, Action>> = {
  pitchUp: 'pitchUp',
  pitchDown: 'pitchDown',
  yawAnti: 'yawAnti',
  yawClock: 'yawClock',
  rollAnti: 'rollAnti',
  rollClock: 'rollClock',
};

/** Zone → gameplay wedge (dead zone is omitted). */
export const ZONE_TO_WEDGE: Readonly<Partial<Record<ZoneId, WedgeId>>> = {
  Q_TOP_LEFT: 'rollAnti',
  Q_BOTTOM_LEFT: 'rollAnti',
  E_TOP_RIGHT: 'rollClock',
  E_BOTTOM_RIGHT: 'rollClock',
  W: 'pitchUp',
  A: 'yawAnti',
  D: 'yawClock',
  S: 'pitchDown',
};

/**
 * Authored polygons in normalized coordinates (0,0 top-left → 1,1 bottom-right).
 *
 * Order of `ZONE_ORDER` is the deterministic boundary rule: the first polygon
 * that contains a point wins, so a touch exactly on a shared edge maps to one
 * zone only.
 */
export const ZONE_POLYGONS: Readonly<Record<ZoneId, readonly Point[]>> = {
  DEAD_ZONE: [
    [0.39, 0.42],
    [0.61, 0.42],
    [0.61, 0.58],
    [0.39, 0.58],
  ],
  Q_TOP_LEFT: [
    [0.0, 0.0],
    [0.35, 0.0],
    [0.17, 0.17],
    [0.0, 0.33],
  ],
  E_TOP_RIGHT: [
    [0.65, 0.0],
    [1.0, 0.0],
    [1.0, 0.33],
    [0.83, 0.17],
  ],
  W: [
    [0.35, 0.0],
    [0.65, 0.0],
    [0.83, 0.17],
    [0.61, 0.42],
    [0.39, 0.42],
    [0.17, 0.17],
  ],
  A: [
    [0.0, 0.33],
    [0.17, 0.17],
    [0.39, 0.42],
    [0.39, 0.58],
    [0.17, 0.83],
    [0.0, 0.67],
  ],
  D: [
    [0.61, 0.42],
    [0.83, 0.17],
    [1.0, 0.33],
    [1.0, 0.67],
    [0.83, 0.83],
    [0.61, 0.58],
  ],
  S: [
    [0.39, 0.58],
    [0.61, 0.58],
    [0.83, 0.83],
    [0.65, 1.0],
    [0.35, 1.0],
    [0.17, 0.83],
  ],
  Q_BOTTOM_LEFT: [
    [0.0, 0.67],
    [0.17, 0.83],
    [0.35, 1.0],
    [0.0, 1.0],
  ],
  E_BOTTOM_RIGHT: [
    [1.0, 0.67],
    [1.0, 1.0],
    [0.65, 1.0],
    [0.83, 0.83],
  ],
};

/** Boundary priority: dead first, then corners, then cardinals. */
export const ZONE_ORDER: readonly ZoneId[] = [
  'DEAD_ZONE',
  'Q_TOP_LEFT',
  'E_TOP_RIGHT',
  'Q_BOTTOM_LEFT',
  'E_BOTTOM_RIGHT',
  'W',
  'A',
  'D',
  'S',
];

export interface WedgeLayout {
  readonly width: number;
  readonly height: number;
}

export function wedgeLayout(width: number, height: number): WedgeLayout {
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Ray-casting point-in-polygon. Includes boundary points: a vertex or edge
 * hit counts as inside so the partition has no gaps at shared edges (combined
 * with ZONE_ORDER for uniqueness).
 */
export function pointInPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  // On-vertex / on-edge → inside (deterministic with ZONE_ORDER).
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, ay] = polygon[i] as Point;
    if (ax === x && ay === y) return true;
    const [bx, by] = polygon[(i + 1) % polygon.length] as Point;
    if (pointOnSegment(x, y, ax, ay, bx, by)) return true;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i] as Point;
    const [xj, yj] = polygon[j] as Point;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): boolean {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < 0) return false;
  const lenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  return dot <= lenSq + 1e-9;
}

/** Classify a normalized point (0..1). Null = dead zone or outside all polys. */
export function classifyNormalized(x: number, y: number): ZoneId | null {
  const nx = Math.min(1, Math.max(0, x));
  const ny = Math.min(1, Math.max(0, y));
  for (const id of ZONE_ORDER) {
    if (pointInPolygon(nx, ny, ZONE_POLYGONS[id])) return id;
  }
  return null;
}

/**
 * Which wedge contains pixel (px, py) in a touch area of `layout` size.
 * Null inside the dead zone (or unclassified).
 */
export function hitWedge(px: number, py: number, layout: WedgeLayout): WedgeId | null {
  const zone = classifyNormalized(px / layout.width, py / layout.height);
  if (!zone || zone === 'DEAD_ZONE') return null;
  return ZONE_TO_WEDGE[zone] ?? null;
}

/** Label placement for diagrams (normalized centroids of each zone). */
export const ZONE_LABEL_AT: Readonly<Partial<Record<ZoneId, Point>>> = {
  Q_TOP_LEFT: [0.12, 0.1],
  E_TOP_RIGHT: [0.88, 0.1],
  W: [0.5, 0.14],
  A: [0.1, 0.5],
  DEAD_ZONE: [0.5, 0.5],
  D: [0.9, 0.5],
  S: [0.5, 0.88],
  Q_BOTTOM_LEFT: [0.12, 0.9],
  E_BOTTOM_RIGHT: [0.88, 0.9],
};

/** SVG polygon `points` attribute for a zone in a 0..100 viewBox. */
export function zoneSvgPoints(id: ZoneId): string {
  return ZONE_POLYGONS[id].map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
}
