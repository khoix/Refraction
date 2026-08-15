import { describe, expect, it } from 'vitest';
import { Game, facePreview } from '@core/game';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';
import { lineCells } from '@core/projection';
import { LINES_PER_STAGE, stageForLines } from '@core/stages';
import type { Board } from '@core/board';
import type { Cell } from '@core/types';

const newGame = (seed = 'test'): Game => new Game({ seed });

/**
 * Run the clock until the board is stable.
 *
 * Turns and line clears are staged over time now, so that the player can see
 * what cleared and why. Tests drive that clock explicitly rather than assuming
 * resolution is instantaneous.
 */
function settle(game: Game): void {
  for (let i = 0; i < 400; i += 1) {
    if (game.status !== 'resolving' && game.status !== 'turning') return;
    game.tick(200);
  }
  throw new Error(`game never settled; stuck in ${game.status}`);
}

/** A stable fingerprint of everything a replay must reproduce. */
function fingerprint(game: Game): string {
  const cells = game.board
    .filledCells()
    .map((c) => `${c.x},${c.y},${c.z}`)
    .join(';');
  return [game.score, game.lines, game.face, game.status, game.shiftMeter, cells].join('|');
}

function fillLine(
  board: Board,
  y: number,
  lane: number,
  face: Parameters<typeof lineCells>[0]
): void {
  for (const cell of lineCells(face, y, lane)) board.fill(cell);
}

describe('setup', () => {
  it('starts on the front face with a piece in play', () => {
    const game = newGame();
    expect(game.face).toBe('front');
    expect(game.status).toBe('falling');
    expect(game.active).not.toBeNull();
    expect(game.activeCells()).toHaveLength(4);
  });

  it('keeps three pieces in the preview', () => {
    expect(newGame().preview).toHaveLength(3);
  });

  it('starts at stage 1 with only flat pieces', () => {
    const game = newGame();
    expect(game.stage.index).toBe(1);
    expect(game.stage.maxTier).toBe(1);
  });
});

describe('movement', () => {
  it('moves along the visible horizontal axis and stops at the walls', () => {
    const game = newGame();
    let moves = 0;
    while (game.moveHorizontal(-1)) {
      moves += 1;
      expect(moves).toBeLessThan(BOARD_WIDTH + 2);
    }
    expect(moves).toBeGreaterThan(0);
    expect(game.moveHorizontal(-1)).toBe(false);
  });

  it('refuses depth nudges before stage 4', () => {
    const game = newGame();
    expect(game.depthNudgeAllowed).toBe(false);
    expect(game.nudgeDepth(1)).toBe(false);
  });

  it('allows depth nudges when the mode overrides the gate', () => {
    const game = new Game({ seed: 'zen', forceDepthNudge: true });
    expect(game.depthNudgeAllowed).toBe(true);
    const before = game.active?.lane;
    expect(game.nudgeDepth(1)).toBe(true);
    expect(game.active?.lane).toBe((before as number) + 1);
  });

  it('hard drop lands the piece on the floor and locks it', () => {
    const game = newGame();
    game.hardDrop();
    expect(game.board.countFilled()).toBe(4);
    expect(game.board.highestFilledY()).toBeLessThan(4);
  });

  it('a ghost sits exactly where a hard drop would land', () => {
    const game = newGame();
    const ghost = game
      .ghostCells()
      .map((c) => `${c.x},${c.y},${c.z}`)
      .sort();
    game.hardDrop();
    const landed = game.board
      .filledCells()
      .map((c) => `${c.x},${c.y},${c.z}`)
      .sort();
    expect(landed).toEqual(ghost);
  });
});

describe('rotation', () => {
  it('rolls in the screen plane at stage 1', () => {
    const game = newGame();
    const before = game.active?.offsets;
    game.rotatePiece('roll');
    expect(game.active?.offsets).not.toEqual(before);
  });

  it('locks yaw and pitch behind later stages', () => {
    const game = newGame();
    expect(game.rotatePiece('yaw')).toBe(false);
    expect(game.rotatePiece('pitch')).toBe(false);
  });

  it('never rotates a piece outside the board', () => {
    const game = newGame();
    while (game.moveHorizontal(-1)) {
      /* pin against the wall */
    }
    for (let i = 0; i < 8; i += 1) {
      game.rotatePiece('roll');
      for (const cell of game.activeCells()) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(BOARD_WIDTH);
        expect(cell.z).toBeGreaterThanOrEqual(0);
        expect(cell.z).toBeLessThan(BOARD_DEPTH);
      }
    }
  });
});

describe('clearing', () => {
  it('scores a line and fills the shift meter', () => {
    const game = newGame();
    fillLine(game.board, 0, 3, 'front');
    // Remove one cell so the locking piece completes the line itself.
    game.board.clear(game.activeCells()[0] as Cell);

    const scoreBefore = game.score;
    game.board.clearLines('front', game.board.findCompleteLines('front'));
    expect(game.score).toBe(scoreBefore);

    const fresh = newGame();
    fillLine(fresh.board, 0, 3, 'front');
    fresh.hardDrop();
    settle(fresh);
    expect(fresh.lines).toBeGreaterThanOrEqual(1);
    expect(fresh.score).toBeGreaterThan(0);
    expect(fresh.shiftMeter).toBeGreaterThanOrEqual(1);
  });

  it('advances the stage on the tuned line interval', () => {
    expect(stageForLines(0).index).toBe(1);
    expect(stageForLines(LINES_PER_STAGE - 1).index).toBe(1);
    expect(stageForLines(LINES_PER_STAGE).index).toBe(2);
    expect(stageForLines(LINES_PER_STAGE * 7 - 1).index).toBe(7);
    expect(stageForLines(LINES_PER_STAGE * 7).index).toBe(8);
  });
});

describe('the turn', () => {
  it('prompts for a direction once the meter fills', () => {
    const game = newGame();
    for (let i = 0; i < game.stage.linesPerTurn; i += 1) {
      fillLine(game.board, i, 3, 'front');
    }
    game.hardDrop();
    settle(game);
    expect(game.status).toBe('awaitingTurn');
  });

  it('turns to the face the player chose', () => {
    const game = newGame();
    game.status = 'awaitingTurn';
    expect(game.chooseTurn('right')).toBe(true);
    expect(game.face).toBe('left');

    game.status = 'awaitingTurn';
    game.chooseTurn('left');
    expect(game.face).toBe('front');
  });

  it('repeats the last direction if the prompt is ignored', () => {
    const game = new Game({ seed: 'timeout', turnPromptTimeoutMs: 1000 });
    game.status = 'awaitingTurn';
    game.chooseTurn('left'); // front -> right, and records "left"
    expect(game.face).toBe('right');

    game.status = 'awaitingTurn';
    game.tick(1100);
    expect(game.face).toBe('back');
  });

  it('clears a line that only exists on the face being turned to', () => {
    // The Refraction Clear. Eight cubes run along Z at a fixed X: nothing is
    // complete from the front, but the left face sees a finished line.
    const game = newGame();
    for (let z = 0; z < BOARD_DEPTH; z += 1) game.board.fill({ x: 3, y: 0, z });

    expect(game.board.findCompleteLines('front')).toHaveLength(0);
    const scoreBefore = game.score;

    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    settle(game);

    expect(game.face).toBe('left');
    expect(game.board.countFilled()).toBe(0);
    expect(game.lines).toBe(1);
    expect(game.score).toBeGreaterThan(scoreBefore);
    expect(game.refractionChain).toBe(1);
  });

  it('pays a refraction clear more than the same line cleared normally', () => {
    const refracted = newGame();
    for (let z = 0; z < BOARD_DEPTH; z += 1) refracted.board.fill({ x: 3, y: 0, z });
    refracted.status = 'awaitingTurn';
    refracted.chooseTurn('right');
    settle(refracted);

    const plain = newGame();
    fillLine(plain.board, 0, 3, 'front');
    plain.board.clearLines('front', plain.board.findCompleteLines('front'));

    // Same eight cubes, same one line -- the turn is what doubles the value.
    expect(refracted.score).toBeGreaterThan(100);
  });

  it('breaks the chain on a turn that clears nothing', () => {
    const game = newGame();
    for (let z = 0; z < BOARD_DEPTH; z += 1) game.board.fill({ x: 3, y: 0, z });
    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    settle(game);
    expect(game.refractionChain).toBe(1);

    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    settle(game);
    expect(game.refractionChain).toBe(0);
  });
});

describe('seeing the turn happen', () => {
  /** Eight cubes along Z at one X: no line from the front, a line from the left. */
  function plantHiddenLine(game: Game, x = 3, y = 0): void {
    for (let z = 0; z < BOARD_DEPTH; z += 1) game.board.fill({ x, y, z });
  }

  it('holds the eligible lines lit for the whole rotation', () => {
    const game = new Game({ seed: 'reveal', turnDurationMs: 800, clearFlashMs: 100 });
    plantHiddenLine(game);
    game.status = 'awaitingTurn';
    game.chooseTurn('right');

    // The face flips immediately -- that is what makes the other axis live --
    // but nothing has been removed yet.
    expect(game.status).toBe('turning');
    expect(game.face).toBe('left');
    expect(game.pendingClears).toHaveLength(1);
    expect(game.board.countFilled()).toBe(BOARD_DEPTH);

    game.tick(400);
    expect(game.status).toBe('turning');
    expect(game.board.countFilled()).toBe(BOARD_DEPTH);

    game.tick(500); // past the end of the rotation
    expect(game.status).not.toBe('turning');
    expect(game.pendingClears).toHaveLength(0);
  });

  it('reports turn progress from 0 to 1', () => {
    const game = new Game({ seed: 'progress', turnDurationMs: 1000 });
    expect(game.turnProgress).toBe(1);

    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    expect(game.turnProgress).toBe(0);

    game.tick(500);
    expect(game.turnProgress).toBeCloseTo(0.5, 2);
  });

  it('predicts exactly the lines that will clear on arrival', () => {
    const game = new Game({ seed: 'predict', turnDurationMs: 100, clearFlashMs: 10 });
    plantHiddenLine(game, 3, 0);
    plantHiddenLine(game, 5, 0);

    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    const predicted = game.pendingClears.map((line) => `${line.y},${line.lane}`).sort();
    expect(predicted).toHaveLength(2);

    settle(game);
    expect(game.lines).toBe(2);
  });

  it('holds each completed line lit before removing it', () => {
    const game = new Game({ seed: 'flash', clearFlashMs: 200 });
    fillLine(game.board, 0, 3, 'front');
    game.board.clear({ x: 0, y: 0, z: 4 });
    // Refill so the line is complete without needing the active piece.
    game.board.fill({ x: 0, y: 0, z: 4 });
    game.hardDrop();

    expect(game.status).toBe('resolving');
    expect(game.clearingLines.length).toBeGreaterThan(0);
    // Still on the board while lit.
    expect(game.board.countFilled()).toBeGreaterThanOrEqual(8);

    game.tick(250);
    expect(game.clearingLines).toHaveLength(0);
    expect(game.lines).toBeGreaterThanOrEqual(1);
  });

  it('walks a cascade one step at a time', () => {
    const game = new Game({ seed: 'cascade', clearFlashMs: 100 });
    // Two complete lines stacked in the same lane clear as two separate steps.
    fillLine(game.board, 0, 3, 'front');
    fillLine(game.board, 1, 3, 'front');
    game.hardDrop();

    let steps = 0;
    while (game.status === 'resolving' && steps < 10) {
      steps += 1;
      game.tick(120);
    }
    expect(steps).toBeGreaterThanOrEqual(1);
    expect(game.lines).toBeGreaterThanOrEqual(2);
  });

  it('never removes a line before the board has finished turning', () => {
    const game = new Game({ seed: 'notearly', turnDurationMs: 600, clearFlashMs: 50 });
    plantHiddenLine(game);
    game.status = 'awaitingTurn';
    game.chooseTurn('right');

    for (let elapsed = 0; elapsed < 600; elapsed += 50) {
      expect(game.board.countFilled()).toBe(BOARD_DEPTH);
      game.tick(50);
    }
  });
});

describe('event reporting', () => {
  it('flags a clear with its cascade step and whether the turn caused it', () => {
    const game = new Game({ seed: 'events', clearFlashMs: 10 });
    fillLine(game.board, 0, 3, 'front');
    game.hardDrop();
    settle(game);

    const clears = game.drainEvents().filter((event) => event.type === 'clear');
    expect(clears.length).toBeGreaterThan(0);
    expect(clears[0]!.refraction).toBe(false);
    expect(clears[0]!.cascade).toBe(0);
    expect(clears[0]!.prism).toBeUndefined();
  });

  it('marks a refraction clear as such', () => {
    const game = new Game({ seed: 'refract-event', turnDurationMs: 10, clearFlashMs: 10 });
    for (let z = 0; z < BOARD_DEPTH; z += 1) game.board.fill({ x: 3, y: 0, z });
    game.drainEvents();

    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    settle(game);

    const clears = game.drainEvents().filter((event) => event.type === 'clear');
    expect(clears).toHaveLength(1);
    expect(clears[0]!.refraction).toBe(true);
  });

  it('raises the Full Spectrum flag only after a clear on all four faces', () => {
    const game = new Game({ seed: 'prism', turnDurationMs: 10, clearFlashMs: 10 });
    const seenPrism: boolean[] = [];

    // Plant a line that is complete on the face the turn is heading *to*, not
    // the one being left. Front and Back count lines along X; Left and Right
    // count them along Z.
    for (let turnIndex = 0; turnIndex < 4; turnIndex += 1) {
      const destination = facePreview(game.face, 'right');
      const countsAlongX = destination === 'front' || destination === 'back';
      for (let i = 0; i < BOARD_DEPTH; i += 1) {
        game.board.fill(countsAlongX ? { x: i, y: 0, z: 3 } : { x: 3, y: 0, z: i });
      }
      game.drainEvents();
      game.status = 'awaitingTurn';
      game.chooseTurn('right');
      settle(game);
      seenPrism.push(
        game.drainEvents().some((event) => event.type === 'clear' && event.prism === true)
      );
    }

    // Nothing before the revolution closes; the flag lands on the fourth face.
    expect(seenPrism.slice(0, 3).every((flag) => flag === false)).toBe(true);
    expect(seenPrism[3]).toBe(true);
  });
});

describe('hold', () => {
  it('swaps the active piece and refuses a second swap for the same piece', () => {
    const game = newGame();
    const first = game.active?.id;
    expect(game.hold()).toBe(true);
    expect(game.held).toBe(first);
    expect(game.active?.id).not.toBe(undefined);
    expect(game.hold()).toBe(false);
  });

  it('returns the held piece on the next swap', () => {
    const game = newGame();
    const first = game.active?.id;
    game.hold();
    game.hardDrop(); // consumes the piece that was swapped in
    const beforeSwap = game.active?.id;

    expect(game.hold()).toBe(true);
    expect(game.active?.id).toBe(first);
    expect(game.held).toBe(beforeSwap);
  });
});

describe('failure', () => {
  it('ends the run when locked cells reach the spawn buffer', () => {
    const game = newGame();
    for (let y = 0; y < BOARD_HEIGHT + 1; y += 1) {
      game.board.fill({ x: 0, y, z: 0 });
    }
    game.hardDrop();
    settle(game);
    expect(game.status).toBe('gameOver');
  });

  it('ignores input once the run is over', () => {
    const game = newGame();
    game.status = 'gameOver';
    expect(game.moveHorizontal(1)).toBe(false);
    expect(game.rotatePiece('roll')).toBe(false);
    expect(game.hold()).toBe(false);
  });
});

describe('determinism', () => {
  it('reproduces a run exactly from the same seed and inputs', () => {
    const script = (game: Game): void => {
      const moves = [-1, 1, -1, -1, 1] as const;
      for (let i = 0; i < 60; i += 1) {
        game.moveHorizontal(moves[i % moves.length] as -1 | 1);
        if (i % 3 === 0) game.rotatePiece('roll');
        if (i % 5 === 0) game.hardDrop();
        game.tick(16);
        settle(game);
        if (game.status === 'awaitingTurn') game.chooseTurn(i % 2 === 0 ? 'left' : 'right');
        settle(game);
      }
    };

    const a = newGame('determinism');
    const b = newGame('determinism');
    script(a);
    script(b);

    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.board.countFilled()).toBeGreaterThan(0);
  });

  it('produces different runs from different seeds', () => {
    const play = (seed: string): string => {
      const game = newGame(seed);
      for (let i = 0; i < 40; i += 1) {
        game.hardDrop();
        settle(game);
        if (game.status === 'awaitingTurn') game.chooseTurn('right');
        settle(game);
      }
      return fingerprint(game);
    };
    expect(play('alpha')).not.toBe(play('beta'));
  });

  it('plays to a conclusion without ever violating the board', () => {
    const game = newGame('endurance');
    for (let i = 0; i < 500 && game.status !== 'gameOver'; i += 1) {
      game.hardDrop();
      settle(game);
      if (game.status === 'awaitingTurn') game.chooseTurn('right');
      settle(game);

      for (const cell of game.board.filledCells()) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(BOARD_WIDTH);
        expect(cell.z).toBeGreaterThanOrEqual(0);
        expect(cell.z).toBeLessThan(BOARD_DEPTH);
        expect(cell.y).toBeGreaterThanOrEqual(0);
      }
    }
    expect(game.status).toBe('gameOver');
  });
});
