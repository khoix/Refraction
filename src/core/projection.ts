/**
 * The projection contract.
 *
 * This module is the single source of truth for how the fixed 3D board maps onto
 * the 2D playfield the player is currently looking at. Everything else in the
 * game -- movement, line detection, colouring, the renderer's camera -- derives
 * from here, so that the geometry can never disagree with itself.
 *
 * Invariants (enforced by tests in tests/unit/projection.test.ts):
 *
 *  1. Screen Y always equals world Y. Turning never moves a block vertically.
 *  2. Screen X maps to +X, +Z, -X or -Z depending on the active face.
 *  3. Opposite faces produce exactly mirrored columns.
 *  4. Opposite faces produce exactly inverted depth lanes.
 *  5. toView / fromView are inverses for every cell on every face.
 *
 * Camera convention: the camera sits at `center + R * (sin(yaw), 0, cos(yaw))`
 * looking at the board centre with world +Y up. That makes the on-screen right
 * vector `(cos(yaw), 0, -sin(yaw))`.
 */

import { BOARD_DEPTH, BOARD_WIDTH } from './constants';
import type { Cell, Face, HorizontalAxis, TurnDirection, ViewCell } from './types';

/** All faces in fixed order. Index order is not the turn order -- see TURN_ORDER. */
export const FACES: readonly Face[] = ['front', 'left', 'back', 'right'] as const;

/** Camera yaw, in degrees, for each face. */
export const FACE_YAW: Readonly<Record<Face, number>> = {
  front: 0,
  right: 90,
  back: 180,
  left: 270,
};

/**
 * A turn direction names the face the player is choosing: turning left brings
 * the face on the player's LEFT to the front, turning right the one on their
 * right. Repeated left turns walk front -> left -> back -> right -> front;
 * repeated right turns run the same ring backwards.
 *
 * It was the other way round originally -- "right" meant "spin the world
 * right", which delivered the LEFT face -- and playtesting was unambiguous
 * about it: players read the prompt as pointing at a destination, not at a
 * spin. The name now means what the player thinks it means.
 */
const TURN_ORDER: readonly Face[] = ['front', 'left', 'back', 'right'] as const;

interface FaceBasis {
  /** World axis that becomes the on-screen horizontal axis. */
  readonly uAxis: HorizontalAxis;
  /** Whether the horizontal axis runs right-to-left on screen. */
  readonly uFlip: boolean;
  /** World axis that becomes depth (distance from the camera). */
  readonly laneAxis: HorizontalAxis;
  /** Whether lane 0 (nearest) is at the high end of the lane axis. */
  readonly laneFlip: boolean;
}

/**
 * Derived from the camera convention above:
 *   front (yaw 0):   right = +x, camera on +z  -> near = high z
 *   left  (yaw 270): right = +z, camera on -x  -> near = low x
 *   back  (yaw 180): right = -x, camera on -z  -> near = low z
 *   right (yaw 90):  right = -z, camera on +x  -> near = high x
 */
const FACE_BASIS: Readonly<Record<Face, FaceBasis>> = {
  front: { uAxis: 'x', uFlip: false, laneAxis: 'z', laneFlip: true },
  left: { uAxis: 'z', uFlip: false, laneAxis: 'x', laneFlip: false },
  back: { uAxis: 'x', uFlip: true, laneAxis: 'z', laneFlip: false },
  right: { uAxis: 'z', uFlip: true, laneAxis: 'x', laneFlip: true },
};

const AXIS_EXTENT: Readonly<Record<HorizontalAxis, number>> = {
  x: BOARD_WIDTH,
  z: BOARD_DEPTH,
};

/** The world axis that the player's left/right controls move along on `face`. */
export function horizontalAxis(face: Face): HorizontalAxis {
  return FACE_BASIS[face].uAxis;
}

/** The world axis that reads as depth (and therefore colour) on `face`. */
export function depthAxis(face: Face): HorizontalAxis {
  return FACE_BASIS[face].laneAxis;
}

/** Number of on-screen columns on `face`. Equal for all faces by construction. */
export function columnCount(face: Face): number {
  return AXIS_EXTENT[FACE_BASIS[face].uAxis];
}

/** Number of depth lanes on `face`. Equal for all faces by construction. */
export function laneCount(face: Face): number {
  return AXIS_EXTENT[FACE_BASIS[face].laneAxis];
}

/** The face reached by choosing `direction` from `face`. */
export function turn(face: Face, direction: TurnDirection): Face {
  const index = TURN_ORDER.indexOf(face);
  const step = direction === 'left' ? 1 : -1;
  const next = (index + step + TURN_ORDER.length) % TURN_ORDER.length;
  return TURN_ORDER[next] as Face;
}

/** The face directly across the board from `face`. */
export function oppositeFace(face: Face): Face {
  return turn(turn(face, 'right'), 'right');
}

/**
 * Shortest signed yaw delta, in degrees, to get from `from` to `to` by turning
 * in `direction`. Always +/-90 for a single turn; used to drive the camera so
 * the animation spins the way the player asked rather than the short way round.
 */
export function turnYawDelta(direction: TurnDirection): number {
  // Choosing the left-hand face orbits the camera towards -yaw (front at 0,
  // left at 270); choosing the right-hand face orbits towards +yaw.
  return direction === 'left' ? -90 : 90;
}

function applyFlip(value: number, extent: number, flip: boolean): number {
  return flip ? extent - 1 - value : value;
}

/** Project a world cell into the viewing frame of `face`. */
export function toView(face: Face, cell: Cell): ViewCell {
  const basis = FACE_BASIS[face];
  const uRaw = basis.uAxis === 'x' ? cell.x : cell.z;
  const laneRaw = basis.laneAxis === 'x' ? cell.x : cell.z;
  return {
    u: applyFlip(uRaw, AXIS_EXTENT[basis.uAxis], basis.uFlip),
    y: cell.y,
    lane: applyFlip(laneRaw, AXIS_EXTENT[basis.laneAxis], basis.laneFlip),
  };
}

/** Recover the world cell that projects to `view` on `face`. Inverse of toView. */
export function fromView(face: Face, view: ViewCell): Cell {
  const basis = FACE_BASIS[face];
  const uWorld = applyFlip(view.u, AXIS_EXTENT[basis.uAxis], basis.uFlip);
  const laneWorld = applyFlip(view.lane, AXIS_EXTENT[basis.laneAxis], basis.laneFlip);
  const x = basis.uAxis === 'x' ? uWorld : laneWorld;
  const z = basis.uAxis === 'z' ? uWorld : laneWorld;
  return { x, y: view.y, z };
}

/**
 * Continuous depth for a possibly non-integer world position, as seen from an
 * arbitrary camera yaw. Returns 0 at the nearest lane centre and 1 at the
 * farthest, which is exactly the parameter the spectrum ramp consumes. Values
 * outside [0, 1] are possible mid-turn and are the caller's to clamp.
 *
 * This is what keeps colour honest during the turn animation: the same function
 * evaluated at a face's exact yaw reproduces that face's discrete lane index.
 */
export function depthParameterAtYaw(x: number, z: number, yawDegrees: number): number {
  const yaw = (yawDegrees * Math.PI) / 180;
  const cx = (BOARD_WIDTH - 1) / 2;
  const cz = (BOARD_DEPTH - 1) / 2;
  // Distance from the camera, measured along the view direction. The camera sits
  // toward (sin(yaw), 0, cos(yaw)), so projecting onto that vector and negating
  // gives a value that grows with distance.
  const along = (x - cx) * Math.sin(yaw) + (z - cz) * Math.cos(yaw);
  const halfSpan = (BOARD_WIDTH - 1) / 2;
  if (halfSpan === 0) return 0;
  return (halfSpan - along) / (2 * halfSpan);
}

/** Every world cell forming the line at (`y`, `lane`) on `face`. */
export function lineCells(face: Face, y: number, lane: number): Cell[] {
  const width = columnCount(face);
  const cells: Cell[] = [];
  for (let u = 0; u < width; u += 1) {
    cells.push(fromView(face, { u, y, lane }));
  }
  return cells;
}

/** True when `cell` lies inside the board footprint (Y is checked by the board). */
export function isInsideFootprint(cell: Cell): boolean {
  return cell.x >= 0 && cell.x < BOARD_WIDTH && cell.z >= 0 && cell.z < BOARD_DEPTH;
}
