import { describe, expect, it } from 'vitest';
import { BOARD_DEPTH, BOARD_HEIGHT_TOTAL, BOARD_WIDTH } from '@core/constants';
import {
  FACES,
  FACE_YAW,
  columnCount,
  depthAxis,
  depthParameterAtYaw,
  fromView,
  horizontalAxis,
  isInsideFootprint,
  laneCount,
  lineCells,
  oppositeFace,
  toView,
  turn,
  turnYawDelta,
} from '@core/projection';
import { laneToDepthParameter } from '@core/spectrum';
import type { Cell, Face } from '@core/types';

/** Every world cell in the board footprint at a single height. */
function footprintCells(y = 0): Cell[] {
  const cells: Cell[] = [];
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    for (let z = 0; z < BOARD_DEPTH; z += 1) {
      cells.push({ x, y, z });
    }
  }
  return cells;
}

describe('face ring', () => {
  it('turning left walks front -> left -> back -> right -> front', () => {
    let face: Face = 'front';
    const visited: Face[] = [face];
    for (let i = 0; i < 4; i += 1) {
      face = turn(face, 'left');
      visited.push(face);
    }
    expect(visited).toEqual(['front', 'left', 'back', 'right', 'front']);
  });

  it('turning right walks front -> right -> back -> left -> front', () => {
    let face: Face = 'front';
    const visited: Face[] = [face];
    for (let i = 0; i < 4; i += 1) {
      face = turn(face, 'right');
      visited.push(face);
    }
    expect(visited).toEqual(['front', 'right', 'back', 'left', 'front']);
  });

  it('left and right turns undo each other', () => {
    for (const face of FACES) {
      expect(turn(turn(face, 'right'), 'left')).toBe(face);
      expect(turn(turn(face, 'left'), 'right')).toBe(face);
    }
  });

  it('opposite faces are two turns apart in either direction', () => {
    for (const face of FACES) {
      expect(oppositeFace(face)).toBe(turn(turn(face, 'left'), 'left'));
      expect(oppositeFace(oppositeFace(face))).toBe(face);
    }
  });

  it('yaw deltas match the destination, not a world-spin', () => {
    // Left from front is yaw 270, which is -90 from 0; right is +90.
    expect(turnYawDelta('left')).toBe(-90);
    expect(turnYawDelta('right')).toBe(90);
  });
});

describe('face bases', () => {
  it('every face is 8 columns wide and 8 lanes deep', () => {
    for (const face of FACES) {
      expect(columnCount(face)).toBe(BOARD_WIDTH);
      expect(laneCount(face)).toBe(BOARD_DEPTH);
    }
  });

  it('the horizontal and depth axes are always different', () => {
    for (const face of FACES) {
      expect(horizontalAxis(face)).not.toBe(depthAxis(face));
    }
  });

  it('matches the design table of screen horizontal axes', () => {
    // front: +X, left: +Z, back: -X, right: -Z
    expect(toView('front', { x: 0, y: 0, z: 0 }).u).toBe(0);
    expect(toView('front', { x: 7, y: 0, z: 0 }).u).toBe(7);

    expect(toView('left', { x: 0, y: 0, z: 0 }).u).toBe(0);
    expect(toView('left', { x: 0, y: 0, z: 7 }).u).toBe(7);

    expect(toView('back', { x: 0, y: 0, z: 0 }).u).toBe(7);
    expect(toView('back', { x: 7, y: 0, z: 0 }).u).toBe(0);

    expect(toView('right', { x: 0, y: 0, z: 0 }).u).toBe(7);
    expect(toView('right', { x: 0, y: 0, z: 7 }).u).toBe(0);
  });
});

describe('projection invariants', () => {
  it('screen Y always equals world Y', () => {
    for (const face of FACES) {
      for (let y = 0; y < BOARD_HEIGHT_TOTAL; y += 1) {
        expect(toView(face, { x: 3, y, z: 5 }).y).toBe(y);
      }
    }
  });

  it('toView and fromView are exact inverses everywhere', () => {
    for (const face of FACES) {
      for (const cell of footprintCells(4)) {
        expect(fromView(face, toView(face, cell))).toEqual(cell);
      }
    }
  });

  it('projects the whole footprint onto every (column, lane) pair exactly once', () => {
    for (const face of FACES) {
      const seen = new Set<string>();
      for (const cell of footprintCells()) {
        const view = toView(face, cell);
        seen.add(`${view.u},${view.lane}`);
      }
      expect(seen.size).toBe(BOARD_WIDTH * BOARD_DEPTH);
    }
  });

  it('opposite faces mirror columns', () => {
    for (const face of FACES) {
      const other = oppositeFace(face);
      for (const cell of footprintCells()) {
        expect(toView(other, cell).u).toBe(columnCount(face) - 1 - toView(face, cell).u);
      }
    }
  });

  it('opposite faces invert depth lanes', () => {
    for (const face of FACES) {
      const other = oppositeFace(face);
      for (const cell of footprintCells()) {
        expect(toView(other, cell).lane).toBe(laneCount(face) - 1 - toView(face, cell).lane);
      }
    }
  });

  it('a face and its neighbour never share the same horizontal axis', () => {
    for (const face of FACES) {
      expect(horizontalAxis(turn(face, 'right'))).not.toBe(horizontalAxis(face));
      expect(horizontalAxis(turn(face, 'left'))).not.toBe(horizontalAxis(face));
    }
  });
});

describe('lines', () => {
  it('a line holds one cell per column and stays in a single lane', () => {
    for (const face of FACES) {
      const cells = lineCells(face, 2, 3);
      expect(cells).toHaveLength(BOARD_WIDTH);
      expect(new Set(cells.map((c) => toView(face, c).u)).size).toBe(BOARD_WIDTH);
      for (const cell of cells) {
        expect(toView(face, cell).lane).toBe(3);
        expect(cell.y).toBe(2);
        expect(isInsideFootprint(cell)).toBe(true);
      }
    }
  });

  it('a front-facing line reads edge-on from the side', () => {
    // All eight cells of a front line share one Z, so from the left face they
    // collapse onto a single on-screen column.
    const cells = lineCells('front', 0, 0);
    const columns = new Set(cells.map((cell) => toView('left', cell).u));
    expect(columns.size).toBe(1);
  });

  it('the same line is playable from the opposite face', () => {
    const front = lineCells('front', 5, 2)
      .map((c) => `${c.x},${c.y},${c.z}`)
      .sort();
    const back = lineCells('back', 5, laneCount('back') - 1 - 2)
      .map((c) => `${c.x},${c.y},${c.z}`)
      .sort();
    expect(back).toEqual(front);
  });
});

describe('continuous depth', () => {
  it('reproduces discrete lane depths at each face yaw', () => {
    for (const face of FACES) {
      for (const cell of footprintCells()) {
        const view = toView(face, cell);
        const expected = laneToDepthParameter(view.lane, laneCount(face));
        expect(depthParameterAtYaw(cell.x, cell.z, FACE_YAW[face])).toBeCloseTo(expected, 10);
      }
    }
  });

  it('is continuous through a turn', () => {
    let previous = depthParameterAtYaw(1, 6, 0);
    for (let yaw = 1; yaw <= 90; yaw += 1) {
      const current = depthParameterAtYaw(1, 6, yaw);
      expect(Math.abs(current - previous)).toBeLessThan(0.05);
      previous = current;
    }
  });

  it('inverts across opposite faces', () => {
    for (const cell of footprintCells()) {
      const front = depthParameterAtYaw(cell.x, cell.z, FACE_YAW.front);
      const back = depthParameterAtYaw(cell.x, cell.z, FACE_YAW.back);
      expect(front + back).toBeCloseTo(1, 10);
    }
  });
});

describe('footprint bounds', () => {
  it('rejects cells outside the board', () => {
    expect(isInsideFootprint({ x: -1, y: 0, z: 0 })).toBe(false);
    expect(isInsideFootprint({ x: 0, y: 0, z: BOARD_DEPTH })).toBe(false);
    expect(isInsideFootprint({ x: BOARD_WIDTH - 1, y: 99, z: 0 })).toBe(true);
  });
});
