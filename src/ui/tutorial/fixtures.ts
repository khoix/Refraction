/**
 * Board and mode fixtures for the tutorial.
 *
 * Player-facing copy never names Flatland; these configs are the silent rule
 * context for Act 1 (planar) and Act 2 (multi-lane pieces).
 */

import { BOARD_DEPTH } from '@core/constants';
import type { ModeConfig } from '@core/modes';
import { modeById } from '@core/modes';
import { fromView, lineCells } from '@core/projection';
import type { Cell, Face } from '@core/types';

const flatland = modeById('flatland');
const ascent = modeById('ascent');

/** Slow planar rules: one clear fills the Shift meter. */
export const TUTORIAL_ACT1_MODE: ModeConfig = {
  ...flatland,
  id: 'flatland',
  linesPerTurn: 1,
  gravityScale: 0.35,
  spectralCollapse: false,
  canFail: false,
};

/** Multi-lane pieces with depth controls unlocked. */
export const TUTORIAL_ACT2_MODE: ModeConfig = {
  ...ascent,
  id: 'ascent',
  startStage: 4,
  pinStage: true,
  linesPerTurn: 5,
  gravityScale: 0.35,
  depthNudge: 'always',
  rotation: 'all',
  spectralCollapse: false,
  canFail: false,
  maxTier: 2,
};

/** Spectral Collapse on, for the coda gauge. */
export const TUTORIAL_ACT3_MODE: ModeConfig = {
  ...ascent,
  id: 'ascent',
  startStage: 2,
  pinStage: true,
  gravityScale: 0.35,
  spectralCollapse: true,
  canFail: false,
  maxTier: 1,
  depthNudge: 'never',
  rotation: 'roll',
};

export const TUTORIAL_ACT1_SEED = 'tutorial-act1';
export const TUTORIAL_ACT2_SEED = 'tutorial-act2';
export const TUTORIAL_ACT3_SEED = 'tutorial-act3';

/** Diagonal ridge that puts the full spectrum on the front face. */
export function spectrumStack(face: Face = 'front'): Cell[] {
  const cells: Cell[] = [];
  for (let lane = 0; lane < BOARD_DEPTH; lane += 1) {
    cells.push(fromView(face, { u: lane, y: 0, lane }));
  }
  return cells;
}

/**
 * Narrow 2-wide near wall in front of a deeper landing — the drop-channel
 * x-ray opens a readable column of glass onto the pad behind.
 */
export function buildXrayDemo(face: Face = 'front'): {
  cells: Cell[];
  pieceLane: number;
  pieceU: number;
} {
  const cells: Cell[] = [];
  const u0 = 3;
  const u1 = 4;
  for (let y = 0; y < 8; y += 1) {
    cells.push(fromView(face, { u: u0, y, lane: 1 }));
    cells.push(fromView(face, { u: u1, y, lane: 1 }));
  }
  for (let y = 0; y < 2; y += 1) {
    cells.push(fromView(face, { u: u0, y, lane: 6 }));
    cells.push(fromView(face, { u: u1, y, lane: 6 }));
  }
  return { cells, pieceLane: 4, pieceU: u0 };
}

/**
 * Tall near wall (solid silhouette) with a deeper lane only partly filled —
 * a full-looking front can still hide depth holes.
 */
export function laneClearDemo(face: Face = 'front'): {
  cells: Cell[];
  gapU: number;
  completeLane: number;
  gapLane: number;
  y: number;
} {
  const y = 0;
  const nearLane = 2;
  const deepLane = 5;
  const gapU = 3;
  const cells: Cell[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (const [u, cell] of [...lineCells(face, row, nearLane)].entries()) {
      if (row === y && u === gapU) continue;
      cells.push(cell);
    }
  }
  // Deeper lane on the floor: incomplete so the silhouette is a lie.
  for (const cell of [...lineCells(face, y, deepLane)].filter((_, u) => u < 5)) {
    cells.push(cell);
  }
  return { cells, gapU, completeLane: deepLane, gapLane: nearLane, y };
}

/** Full line along Z at fixed X — clears when the board Shifts onto that face. */
export function hiddenRefractionLine(x = 3, y = 0): Cell[] {
  const cells: Cell[] = [];
  for (let z = 0; z < BOARD_DEPTH; z += 1) cells.push({ x, y, z });
  return cells;
}

/** Seven of eight cells on a face line; player drops into the gap. */
export function almostCompleteFrontLine(
  face: Face = 'front',
  y = 0,
  lane = 4,
  gapU = 3
): Cell[] {
  return [...lineCells(face, y, lane)].filter((_, u) => u !== gapU);
}
