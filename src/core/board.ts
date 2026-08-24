/**
 * Voxel occupancy for the fixed 3D board.
 *
 * The board knows nothing about pieces, scoring or turns. It stores which cells
 * are filled, answers collision queries, and clears lines along whichever face's
 * axis it is handed.
 */

import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_HEIGHT_TOTAL, BOARD_WIDTH } from './constants';
import { columnCount, fromView, laneCount } from './projection';
import type { Cell, Face } from './types';

/** A complete line is identified by its height and its depth lane on some face. */
export interface Line {
  readonly y: number;
  readonly lane: number;
}

export class Board {
  private readonly cells: Uint8Array;

  constructor(cells?: Uint8Array) {
    this.cells = cells ?? new Uint8Array(BOARD_WIDTH * BOARD_HEIGHT_TOTAL * BOARD_DEPTH);
  }

  private static index(x: number, y: number, z: number): number {
    return (y * BOARD_DEPTH + z) * BOARD_WIDTH + x;
  }

  /** Inside the addressable volume, including the spawn buffer above the field. */
  isInside({ x, y, z }: Cell): boolean {
    return (
      x >= 0 && x < BOARD_WIDTH && z >= 0 && z < BOARD_DEPTH && y >= 0 && y < BOARD_HEIGHT_TOTAL
    );
  }

  isFilled(cell: Cell): boolean {
    if (!this.isInside(cell)) return false;
    return this.cells[Board.index(cell.x, cell.y, cell.z)] === 1;
  }

  fill(cell: Cell): void {
    if (!this.isInside(cell)) return;
    this.cells[Board.index(cell.x, cell.y, cell.z)] = 1;
  }

  clear(cell: Cell): void {
    if (!this.isInside(cell)) return;
    this.cells[Board.index(cell.x, cell.y, cell.z)] = 0;
  }

  /** Empty the whole volume. Used when a run leaves for a boardless screen. */
  clearAll(): void {
    this.cells.fill(0);
  }

  /**
   * Whether a piece cube may not occupy this cell.
   *
   * Cells above the addressable volume are deliberately NOT blocked, so a piece
   * can spawn or rotate with part of itself above the ceiling. Only the floor
   * and the four walls are solid.
   */
  isBlocked({ x, y, z }: Cell): boolean {
    if (x < 0 || x >= BOARD_WIDTH || z < 0 || z >= BOARD_DEPTH || y < 0) return true;
    if (y >= BOARD_HEIGHT_TOTAL) return false;
    return this.cells[Board.index(x, y, z)] === 1;
  }

  /** Every filled cell, for the renderer. */
  filledCells(): Cell[] {
    const result: Cell[] = [];
    for (let y = 0; y < BOARD_HEIGHT_TOTAL; y += 1) {
      for (let z = 0; z < BOARD_DEPTH; z += 1) {
        for (let x = 0; x < BOARD_WIDTH; x += 1) {
          if (this.cells[Board.index(x, y, z)] === 1) result.push({ x, y, z });
        }
      }
    }
    return result;
  }

  /** Lines complete along `face`'s horizontal axis, lowest first. */
  findCompleteLines(face: Face): Line[] {
    const width = columnCount(face);
    const lanes = laneCount(face);
    const complete: Line[] = [];

    for (let y = 0; y < BOARD_HEIGHT_TOTAL; y += 1) {
      for (let lane = 0; lane < lanes; lane += 1) {
        let full = true;
        for (let u = 0; u < width && full; u += 1) {
          if (!this.isFilled(fromView(face, { u, y, lane }))) full = false;
        }
        if (full) complete.push({ y, lane });
      }
    }
    return complete;
  }

  /**
   * Remove the given lines and let the affected columns fall.
   *
   * Gravity is per-column and naive: within each `(x, z)` column the cleared
   * heights are deleted and everything above slides down. Suspended cells stay
   * suspended -- a piece bridging two columns can legitimately leave a cell with
   * nothing beneath it, and compacting the whole column would silently destroy
   * that structure.
   *
   * Only columns inside a cleared lane are touched. The rest of the board is
   * untouched, which is what keeps a face you cannot currently see predictable.
   */
  clearLines(face: Face, lines: readonly Line[]): void {
    if (lines.length === 0) return;

    const clearedByLane = new Map<number, Set<number>>();
    for (const line of lines) {
      let heights = clearedByLane.get(line.lane);
      if (!heights) {
        heights = new Set<number>();
        clearedByLane.set(line.lane, heights);
      }
      heights.add(line.y);
    }

    const width = columnCount(face);
    for (const [lane, heights] of clearedByLane) {
      for (let u = 0; u < width; u += 1) {
        const { x, z } = fromView(face, { u, y: 0, lane });
        this.collapseColumn(x, z, heights);
      }
    }
  }

  /** Delete `clearedHeights` from one column and slide the remainder down. */
  private collapseColumn(x: number, z: number, clearedHeights: ReadonlySet<number>): void {
    let write = 0;
    for (let y = 0; y < BOARD_HEIGHT_TOTAL; y += 1) {
      if (clearedHeights.has(y)) continue;
      this.cells[Board.index(x, write, z)] = this.cells[Board.index(x, y, z)] as number;
      write += 1;
    }
    for (; write < BOARD_HEIGHT_TOTAL; write += 1) {
      this.cells[Board.index(x, write, z)] = 0;
    }
  }

  /**
   * Let every column fall to the floor, everywhere on the board.
   *
   * **This is the operation `clearLines` deliberately refuses to perform**, and
   * the two must not be confused. Ordinary gravity deletes the cleared rows and
   * slides the remainder down; it leaves suspended cells suspended, because a
   * piece bridging two columns can legitimately leave a cell with nothing
   * beneath it and compacting would silently destroy that structure. Overhangs
   * are therefore permanent, and most of what makes a board hard.
   *
   * Spectral Collapse is the exception, and it is an exception on purpose: a
   * rare, earned event that erases accumulated structure wholesale. Keeping it a
   * separate method rather than a flag on `clearLines` is what stops it becoming
   * the general behaviour by accident -- the clear-time rule is what keeps a face
   * the player cannot currently see predictable.
   *
   * Orientation-independent: gravity is along Y whatever face is being played,
   * so this needs no `Face` and behaves identically from all four.
   *
   * Returns true if anything actually moved, so a trigger on an already-settled
   * board can be reported as such rather than spending the bar for nothing.
   */
  compactAll(): boolean {
    let moved = false;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      for (let z = 0; z < BOARD_DEPTH; z += 1) {
        let write = 0;
        for (let y = 0; y < BOARD_HEIGHT_TOTAL; y += 1) {
          if (this.cells[Board.index(x, y, z)] !== 1) continue;
          if (write !== y) {
            this.cells[Board.index(x, write, z)] = 1;
            this.cells[Board.index(x, y, z)] = 0;
            moved = true;
          }
          write += 1;
        }
      }
    }
    return moved;
  }

  /** Highest occupied row, or -1 when the board is empty. */
  highestFilledY(): number {
    for (let y = BOARD_HEIGHT_TOTAL - 1; y >= 0; y -= 1) {
      for (let i = y * BOARD_DEPTH * BOARD_WIDTH; i < (y + 1) * BOARD_DEPTH * BOARD_WIDTH; i += 1) {
        if (this.cells[i] === 1) return y;
      }
    }
    return -1;
  }

  /** True once locked cells have risen into the spawn buffer. */
  isToppedOut(): boolean {
    return this.highestFilledY() >= BOARD_HEIGHT;
  }

  /**
   * Delete the highest occupied row outright, without collapsing anything.
   *
   * Used only by modes with no failure state: when the stack would top out,
   * the tallest row is taken off instead of ending the run. Nothing slides,
   * so the structure the player built underneath survives exactly as it was.
   *
   * Returns false when the board was already empty.
   */
  removeHighestRow(): boolean {
    const y = this.highestFilledY();
    if (y < 0) return false;
    this.cells.fill(0, y * BOARD_DEPTH * BOARD_WIDTH, (y + 1) * BOARD_DEPTH * BOARD_WIDTH);
    return true;
  }

  countFilled(): number {
    let total = 0;
    for (const cell of this.cells) total += cell;
    return total;
  }

  clone(): Board {
    return new Board(this.cells.slice());
  }
}
