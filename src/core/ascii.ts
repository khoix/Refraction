/**
 * Text rendering of the board, for tests and debugging.
 *
 * Being able to print any face as a string is what makes the projection
 * testable by inspection: build a structure on one face, print all four, and
 * the mirroring and depth relationships are visible at a glance.
 */

import type { Board } from './board';
import { BOARD_HEIGHT } from './constants';
import { columnCount, fromView, laneCount } from './projection';
import type { Cell, Face } from './types';

export interface AsciiOptions {
  /** Rows to draw, from the floor up. Defaults to the visible field height. */
  readonly height?: number;
  /** Character for an empty column. */
  readonly empty?: string;
}

/**
 * Render a face with each cell showing the depth lane of its nearest filled
 * cube, so the text carries the same information the spectrum colour does.
 */
export function renderFace(board: Board, face: Face, options: AsciiOptions = {}): string {
  const height = options.height ?? BOARD_HEIGHT;
  const empty = options.empty ?? '.';
  const width = columnCount(face);
  const lanes = laneCount(face);
  const rows: string[] = [];

  for (let y = height - 1; y >= 0; y -= 1) {
    let row = '';
    for (let u = 0; u < width; u += 1) {
      let glyph = empty;
      for (let lane = 0; lane < lanes; lane += 1) {
        if (board.isFilled(fromView(face, { u, y, lane }))) {
          glyph = String(lane);
          break;
        }
      }
      row += glyph;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** Render a face as a plain silhouette: filled or not, ignoring depth. */
export function renderSilhouette(board: Board, face: Face, options: AsciiOptions = {}): string {
  return renderFace(board, face, options).replace(/[0-7]/g, '#');
}

/** Render a single depth lane of a face, ignoring everything in front of it. */
export function renderLane(
  board: Board,
  face: Face,
  lane: number,
  options: AsciiOptions = {}
): string {
  const height = options.height ?? BOARD_HEIGHT;
  const empty = options.empty ?? '.';
  const width = columnCount(face);
  const rows: string[] = [];

  for (let y = height - 1; y >= 0; y -= 1) {
    let row = '';
    for (let u = 0; u < width; u += 1) {
      row += board.isFilled(fromView(face, { u, y, lane })) ? '#' : empty;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** Parse an ASCII lane drawing into world cells, for building test fixtures. */
export function cellsFromLane(face: Face, lane: number, drawing: string): Cell[] {
  const rows = drawing
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);

  const cells: Cell[] = [];
  rows.forEach((row, rowIndex) => {
    const y = rows.length - 1 - rowIndex;
    [...row].forEach((glyph, u) => {
      if (glyph !== '.' && glyph !== ' ') cells.push(fromView(face, { u, y, lane }));
    });
  });
  return cells;
}
