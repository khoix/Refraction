import { describe, expect, it } from 'vitest';
import { Board } from '@core/board';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_HEIGHT_TOTAL, BOARD_WIDTH } from '@core/constants';
import { fromView, lineCells, toView } from '@core/projection';
import { cellsFromLane, renderFace, renderLane, renderSilhouette } from '@core/ascii';
import type { Face } from '@core/types';

const FACES: Face[] = ['front', 'left', 'back', 'right'];

/** Fill an entire line on `face` at the given height and lane. */
function fillLine(board: Board, face: Face, y: number, lane: number): void {
  for (const cell of lineCells(face, y, lane)) board.fill(cell);
}

describe('occupancy', () => {
  it('starts empty', () => {
    const board = new Board();
    expect(board.countFilled()).toBe(0);
    expect(board.highestFilledY()).toBe(-1);
    expect(board.isToppedOut()).toBe(false);
  });

  it('fills and clears individual cells', () => {
    const board = new Board();
    board.fill({ x: 2, y: 3, z: 4 });
    expect(board.isFilled({ x: 2, y: 3, z: 4 })).toBe(true);
    board.clear({ x: 2, y: 3, z: 4 });
    expect(board.isFilled({ x: 2, y: 3, z: 4 })).toBe(false);
  });

  it('ignores writes outside the volume rather than corrupting neighbours', () => {
    const board = new Board();
    board.fill({ x: -1, y: 0, z: 0 });
    board.fill({ x: BOARD_WIDTH, y: 0, z: 0 });
    board.fill({ x: 0, y: BOARD_HEIGHT_TOTAL, z: 0 });
    expect(board.countFilled()).toBe(0);
  });

  it('treats the walls and floor as solid but leaves the ceiling open', () => {
    const board = new Board();
    expect(board.isBlocked({ x: -1, y: 5, z: 0 })).toBe(true);
    expect(board.isBlocked({ x: BOARD_WIDTH, y: 5, z: 0 })).toBe(true);
    expect(board.isBlocked({ x: 0, y: 5, z: -1 })).toBe(true);
    expect(board.isBlocked({ x: 0, y: 5, z: BOARD_DEPTH })).toBe(true);
    expect(board.isBlocked({ x: 0, y: -1, z: 0 })).toBe(true);
    // Pieces may extend above the ceiling while spawning or rotating.
    expect(board.isBlocked({ x: 0, y: BOARD_HEIGHT_TOTAL + 3, z: 0 })).toBe(false);
  });

  it('reports top-out only once cells reach the spawn buffer', () => {
    const board = new Board();
    board.fill({ x: 0, y: BOARD_HEIGHT - 1, z: 0 });
    expect(board.isToppedOut()).toBe(false);
    board.fill({ x: 0, y: BOARD_HEIGHT, z: 0 });
    expect(board.isToppedOut()).toBe(true);
  });
});

describe('line detection', () => {
  it('needs all eight cells of a line', () => {
    const board = new Board();
    for (let x = 0; x < BOARD_WIDTH - 1; x += 1) board.fill({ x, y: 0, z: 3 });
    expect(board.findCompleteLines('front')).toHaveLength(0);

    board.fill({ x: BOARD_WIDTH - 1, y: 0, z: 3 });
    expect(board.findCompleteLines('front')).toEqual([
      { y: 0, lane: toView('front', { x: 0, y: 0, z: 3 }).lane },
    ]);
  });

  it('finds lines on every face', () => {
    for (const face of FACES) {
      const board = new Board();
      fillLine(board, face, 2, 5);
      expect(board.findCompleteLines(face)).toEqual([{ y: 2, lane: 5 }]);
    }
  });

  it('does not see a cross-axis line from the current face', () => {
    // Eight cells running along Z at a fixed X: invisible as a line from the
    // front, already complete from the left. This is the Refraction Clear.
    const board = new Board();
    for (let z = 0; z < BOARD_DEPTH; z += 1) board.fill({ x: 3, y: 0, z });

    expect(board.findCompleteLines('front')).toHaveLength(0);
    expect(board.findCompleteLines('left')).toEqual([{ y: 0, lane: 3 }]);
  });

  it('sees the same physical line from the opposite face at the mirrored lane', () => {
    const board = new Board();
    fillLine(board, 'front', 4, 2);
    expect(board.findCompleteLines('front')).toEqual([{ y: 4, lane: 2 }]);
    expect(board.findCompleteLines('back')).toEqual([{ y: 4, lane: BOARD_DEPTH - 1 - 2 }]);
  });
});

describe('clearing and gravity', () => {
  it('removes exactly eight cells and touches only that lane', () => {
    const board = new Board();
    fillLine(board, 'front', 0, 3);
    const bystander = fromView('front', { u: 0, y: 0, lane: 6 });
    board.fill(bystander);

    expect(board.countFilled()).toBe(9);
    board.clearLines('front', [{ y: 0, lane: 3 }]);

    expect(board.countFilled()).toBe(1);
    expect(board.isFilled(bystander)).toBe(true);
  });

  it('drops the cells above a cleared line by one', () => {
    const board = new Board();
    const lane = toView('front', { x: 0, y: 0, z: 3 }).lane;
    fillLine(board, 'front', 0, lane);
    board.fill({ x: 2, y: 5, z: 3 });

    board.clearLines('front', [{ y: 0, lane }]);

    expect(board.isFilled({ x: 2, y: 5, z: 3 })).toBe(false);
    expect(board.isFilled({ x: 2, y: 4, z: 3 })).toBe(true);
  });

  it('preserves overhangs instead of compacting columns', () => {
    // A cube suspended with a gap beneath it must keep its gap. Fully compacting
    // the column would silently destroy structures that bridge two columns.
    const board = new Board();
    const lane = toView('front', { x: 0, y: 0, z: 3 }).lane;
    fillLine(board, 'front', 0, lane);
    board.fill({ x: 2, y: 3, z: 3 }); // gap at y=1,2 beneath it

    board.clearLines('front', [{ y: 0, lane }]);

    expect(board.isFilled({ x: 2, y: 2, z: 3 })).toBe(true);
    expect(board.isFilled({ x: 2, y: 1, z: 3 })).toBe(false);
    expect(board.isFilled({ x: 2, y: 0, z: 3 })).toBe(false);
  });

  it('clears several lines at once and shifts by the number removed below', () => {
    const board = new Board();
    const lane = toView('front', { x: 0, y: 0, z: 3 }).lane;
    fillLine(board, 'front', 0, lane);
    fillLine(board, 'front', 1, lane);
    board.fill({ x: 4, y: 6, z: 3 });

    board.clearLines('front', [
      { y: 0, lane },
      { y: 1, lane },
    ]);

    expect(board.countFilled()).toBe(1);
    expect(board.isFilled({ x: 4, y: 4, z: 3 })).toBe(true);
  });

  it('is a no-op when handed no lines', () => {
    const board = new Board();
    board.fill({ x: 1, y: 1, z: 1 });
    board.clearLines('front', []);
    expect(board.isFilled({ x: 1, y: 1, z: 1 })).toBe(true);
  });

  it('cascades to a fixed point', () => {
    // Two complete lines stacked with a third that only completes after the
    // first two are removed and the remainder falls.
    const board = new Board();
    const lane = toView('front', { x: 0, y: 0, z: 3 }).lane;
    fillLine(board, 'front', 0, lane);
    fillLine(board, 'front', 5, lane);

    let iterations = 0;
    for (;;) {
      const complete = board.findCompleteLines('front');
      if (complete.length === 0) break;
      board.clearLines('front', complete);
      iterations += 1;
      expect(iterations).toBeLessThan(10);
    }
    expect(board.countFilled()).toBe(0);
  });
});

describe('ascii rendering', () => {
  it('draws a front line as a full row and the side view as a single column', () => {
    const board = new Board();
    fillLine(board, 'front', 0, 3);

    const front = renderSilhouette(board, 'front', { height: 2 }).split('\n');
    expect(front[1]).toBe('########');

    const left = renderSilhouette(board, 'left', { height: 2 }).split('\n');
    expect((left[1]?.match(/#/g) ?? []).length).toBe(1);
  });

  it('renders a single lane in isolation', () => {
    const board = new Board();
    board.fill(fromView('front', { u: 0, y: 0, lane: 2 }));
    expect(renderLane(board, 'front', 2, { height: 1 })).toBe('#.......');
    expect(renderLane(board, 'front', 3, { height: 1 })).toBe('........');
  });

  it('labels each column with the depth of its nearest cube', () => {
    const board = new Board();
    board.fill(fromView('front', { u: 0, y: 0, lane: 5 }));
    board.fill(fromView('front', { u: 1, y: 0, lane: 2 }));
    // Nearest wins, exactly as the renderer draws it.
    board.fill(fromView('front', { u: 1, y: 0, lane: 6 }));
    expect(renderFace(board, 'front', { height: 1 })).toBe('52......');
  });

  it('round-trips a lane drawing back into world cells', () => {
    const drawing = ['#..#', '....'].join('\n');
    const cells = cellsFromLane('front', 4, drawing);
    const board = new Board();
    for (const cell of cells) board.fill(cell);
    expect(renderLane(board, 'front', 4, { height: 2 })).toBe('#..#....\n........');
  });
});
