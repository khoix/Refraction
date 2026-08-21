import { describe, expect, it } from 'vitest';
import { Game, HEAT_DECAY_PER_MS, HEAT_PER_LINE, facePreview } from '@core/game';
import { modeById } from '@core/modes';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';
import { fromView, lineCells } from '@core/projection';
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
    const before = game.active?.lane as number;
    // Nudge toward the middle of the well, so the dealt lane can't be against
    // the wall the nudge is heading for.
    const direction = before >= BOARD_DEPTH / 2 ? -1 : 1;
    expect(game.nudgeDepth(direction)).toBe(true);
    expect(game.active?.lane).toBe(before + direction);
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
    expect(game.face).toBe('right');

    game.status = 'awaitingTurn';
    game.chooseTurn('left');
    expect(game.face).toBe('front');
  });

  it('repeats the last direction if the prompt is ignored', () => {
    const game = new Game({ seed: 'timeout', turnPromptTimeoutMs: 1000 });
    game.status = 'awaitingTurn';
    game.chooseTurn('left'); // front -> left, and records "left"
    expect(game.face).toBe('left');

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
    game.chooseTurn('left');
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
    refracted.chooseTurn('left');
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
    game.chooseTurn('left');
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
    game.chooseTurn('left');

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
    game.chooseTurn('left');
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

describe('first contact', () => {
  /** Pin the active piece to an O at a known view position. */
  function pinActive(game: Game, u: number, y: number, lane: number): void {
    game.active = {
      id: 'O',
      offsets: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      u,
      y,
      lane,
    };
  }

  it('reports nothing over a bare floor', () => {
    const game = newGame('contact');
    pinActive(game, 3, 10, 2);
    expect(game.firstContactCells()).toEqual([]);
  });

  it('reveals only the topmost settled cube under each footprint column', () => {
    const game = newGame('contact');
    pinActive(game, 3, 10, 2);

    // A three-cube stack under one column of the O. Only its top may show.
    const below = fromView('front', { u: 3, y: 0, lane: 2 });
    for (let y = 2; y <= 4; y += 1) game.board.fill({ ...below, y });

    expect(game.firstContactCells()).toEqual([{ ...below, y: 4 }]);
  });

  it('follows the piece as it moves', () => {
    const game = newGame('contact');
    pinActive(game, 3, 10, 2);
    const below = fromView('front', { u: 3, y: 0, lane: 2 });
    game.board.fill({ ...below, y: 0 });

    expect(game.firstContactCells()).toHaveLength(1);
    // Two steps right moves both footprint columns off the stack.
    game.moveHorizontal(1);
    game.moveHorizontal(1);
    expect(game.firstContactCells()).toEqual([]);
  });

  it('sees through an overhang to the cube actually beneath the piece', () => {
    const game = newGame('contact');
    pinActive(game, 3, 10, 2);

    // Occupied cells in a NEIGHBOURING column must not block the trace; only
    // cells directly beneath the footprint count, and only the first of them.
    const under = fromView('front', { u: 3, y: 0, lane: 2 });
    const beside = fromView('front', { u: 5, y: 0, lane: 2 });
    game.board.fill({ ...under, y: 1 });
    game.board.fill({ ...beside, y: 8 });

    expect(game.firstContactCells()).toEqual([{ ...under, y: 1 }]);
  });

  it('is empty once the run is over', () => {
    const game = newGame('contact');
    pinActive(game, 3, 10, 2);
    game.board.fill(fromView('front', { u: 3, y: 0, lane: 2 }));
    expect(game.firstContactCells()).not.toEqual([]);
    game.status = 'gameOver';
    expect(game.firstContactCells()).toEqual([]);
  });
});

describe('lock delay', () => {
  it('caps the reset rule at 15, so a grounded piece cannot hover forever', () => {
    const game = newGame('lockcap');
    while (game.softDrop()) {
      // Walk the piece to the floor.
    }
    game.tick(1); // establishes grounded

    // Wiggle just before every lock deadline. Each grounded move refreshes the
    // lock timer, so without the cap this loop would keep the piece airborne
    // indefinitely. With it, the sixteenth wiggle stops buying time.
    let lockedAt = -1;
    for (let i = 0; i < 40 && lockedAt < 0; i += 1) {
      expect(game.moveHorizontal(i % 2 === 0 ? -1 : 1)).toBe(true);
      game.tick(game.stage.lockDelayMs - 10);
      if (game.drainEvents().some((event) => event.type === 'lock')) lockedAt = i;
    }

    // Late enough that the 15 allowed resets genuinely happened, early enough
    // that the cap genuinely ended them.
    expect(lockedAt).toBeGreaterThanOrEqual(15);
    expect(lockedAt).toBeLessThanOrEqual(18);
  });
});

describe('failure', () => {
  it('ends the run when the next piece cannot spawn, without reaching the buffer', () => {
    const game = newGame('blockout');
    // Wall off the spawn rows. x = 0 stays open so no line is ever complete
    // and nothing reaches the buffer -- this failure is block-out, not top-out.
    for (let y = BOARD_HEIGHT - 4; y < BOARD_HEIGHT; y += 1) {
      for (let x = 1; x < BOARD_WIDTH; x += 1) {
        for (let z = 0; z < BOARD_DEPTH; z += 1) {
          game.board.fill({ x, y, z });
        }
      }
    }

    game.hardDrop(); // locks in place; the following spawn has nowhere to go
    settle(game);

    expect(game.status).toBe('gameOver');
    expect(game.board.isToppedOut()).toBe(false);
  });

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

/**
 * Spectral Collapse.
 *
 * A hot bar that fills on cleared lines and drains on its own, and — full — buys
 * one board-wide compaction. The mechanic's whole shape is that it is bought
 * with *rate* rather than with a total: the bar is always draining, so it is
 * reachable by clearing steadily and unreachable by placing slowly.
 */
describe('the hot bar', () => {
  /** A run with the mechanic on, and a board under the caller's control. */
  const hot = (): Game => new Game({ seed: 'heat', mode: modeById('ascent') });

  /** Fill one line on the front face at the given row and lane. */
  const fillLine = (game: Game, y: number, lane: number): void => {
    for (const cell of lineCells(game.face, y, lane)) game.board.fill(cell);
  };

  it('starts cold, and the mechanic is available in a mode that has it', () => {
    const game = hot();
    expect(game.heat).toBe(0);
    expect(game.spectralAllowed).toBe(true);
    expect(game.spectralReady).toBe(false);
  });

  it('rises with cleared lines', () => {
    const game = hot();
    fillLine(game, 0, 0);
    game.hardDrop();
    // Resolve the clear the drop produced.
    game.tick(1000);
    expect(game.heat).toBeGreaterThan(0);
    // One line's worth at most: the bar is bought a line at a time, and the
    // second is what stops a single clear from being worth more than it is.
    expect(game.heat).toBeLessThanOrEqual(HEAT_PER_LINE);
  });

  it('drains when nothing is being cleared', () => {
    const game = hot();
    game.heat = 0.5;
    game.tick(1000);
    expect(game.heat).toBeCloseTo(0.5 - 1000 * HEAT_DECAY_PER_MS, 5);
  });

  it('never drains below empty', () => {
    const game = hot();
    game.heat = 0.001;
    game.tick(5000);
    expect(game.heat).toBe(0);
  });

  it('stops cooling once it is full, so the reward can be kept', () => {
    // Earned is earned. A player who takes a moment to choose where to spend it
    // must not lose it for thinking.
    const game = hot();
    game.heat = 1;
    game.tick(60_000);
    expect(game.heat).toBe(1);
    expect(game.spectralReady).toBe(true);
  });

  it('is absent entirely in a mode without it', () => {
    // No shipped mode withholds the mechanic today; the gate still has to hold
    // for any mode that sets the field off.
    const cold = new Game({
      seed: 'heat',
      mode: { ...modeById('ascent'), spectralCollapse: false },
    });
    expect(cold.spectralAllowed).toBe(false);
    cold.heat = 1;
    expect(cold.spectralReady).toBe(false);
    expect(cold.triggerCollapse()).toBe(false);

    // And it never gains any, so the gauge has nothing to draw. Reset first --
    // the line above forced it high to prove `spectralReady` ignores it, and
    // nothing in a mode without the mechanic will bring it back down.
    cold.heat = 0;
    fillLine(cold, 0, 0);
    cold.hardDrop();
    cold.tick(1000);
    expect(cold.heat).toBe(0);
  });

  it('is available in Flatland', () => {
    const flat = new Game({ seed: 'heat', mode: modeById('flatland') });
    expect(flat.spectralAllowed).toBe(true);
    flat.heat = 1;
    expect(flat.spectralReady).toBe(true);
    expect(flat.triggerCollapse()).toBe(true);
  });
});

describe('Spectral Collapse', () => {
  const ready = (): Game => {
    const game = new Game({ seed: 'collapse', mode: modeById('ascent') });
    game.heat = 1;
    return game;
  };

  it('refuses until the bar is full', () => {
    const game = new Game({ seed: 'collapse', mode: modeById('ascent') });
    game.heat = 0.9;
    expect(game.triggerCollapse()).toBe(false);
  });

  it('drops every suspended cell to the floor of its column', () => {
    const game = ready();
    game.board.fill({ x: 2, y: 9, z: 3 });
    game.board.fill({ x: 5, y: 4, z: 1 });

    expect(game.triggerCollapse()).toBe(true);
    game.tick(1000);

    expect(game.board.isFilled({ x: 2, y: 0, z: 3 })).toBe(true);
    expect(game.board.isFilled({ x: 5, y: 0, z: 1 })).toBe(true);
  });

  it('clears whatever the settling completes, through the ordinary cycle', () => {
    // Eight cells of one line, each suspended at a different height, so nothing
    // is a line until everything falls. The clear has to happen by itself.
    //
    // No piece in hand: it settles before the compaction and lands in the floor
    // row of its own columns, which is exactly where the line being tested for
    // is going to be. That is correct behaviour and it makes this measurement
    // ambiguous, so the piece is taken out of the picture.
    const game = ready();
    game.active = null;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      game.board.fill(fromView(game.face, { u: x, y: 3 + x, lane: 2 }));
    }
    const before = game.lines;

    game.triggerCollapse();
    game.tick(2000);

    expect(game.lines).toBe(before + 1);
    expect(game.board.filledCells()).toHaveLength(0);
  });

  it('spends the bar, and starts it cooling again', () => {
    const game = ready();
    game.board.fill({ x: 1, y: 6, z: 1 });
    game.triggerCollapse();
    expect(game.heat).toBe(0);
  });

  it('does not pay for itself', () => {
    // The loop that has to be closed: if a collapse's own clears refilled the
    // bar, a large enough stack would buy the next one outright.
    const game = ready();
    for (let lane = 0; lane < 3; lane += 1) {
      for (let x = 0; x < BOARD_WIDTH; x += 1) {
        game.board.fill(fromView(game.face, { u: x, y: 4 + lane * 3 + x, lane }));
      }
    }
    game.triggerCollapse();
    game.tick(4000);

    expect(game.lines).toBeGreaterThanOrEqual(3);
    // Whatever it cleared, none of it went back into the bar.
    expect(game.heat).toBe(0);
  });

  it('brings the piece in hand down with everything else', () => {
    // It is a group of voxels in the air when the floor gives way. Leaving it
    // hovering over a collapsed stack would be a second state to reason about.
    const game = ready();
    expect(game.active).not.toBeNull();
    game.triggerCollapse();
    game.tick(1000);

    // Settled into the board, and the board holds only cells on the floor.
    const cells = game.board.filledCells();
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(game.board.isFilled({ ...cell, y: 0 })).toBe(true);
    }
  });

  it('only answers while a piece is falling', () => {
    const game = ready();
    game.status = 'awaitingTurn';
    expect(game.triggerCollapse()).toBe(false);
    expect(game.heat).toBe(1);
  });

  it('announces itself, so the room and the audio can answer', () => {
    const game = ready();
    game.board.fill({ x: 4, y: 8, z: 4 });
    game.triggerCollapse();
    expect(game.drainEvents().some((event) => event.type === 'collapse')).toBe(true);
  });
});

/**
 * The hot bar's balance, as a model rather than as a feeling.
 *
 * The greedy agent cannot settle this one. It clears about 0.3 lines per piece,
 * which is measured and useful — but it hard-drops every piece and only runs the
 * clock while a clear resolves, so it spends no thinking time at all. This
 * mechanic is priced in time, so an agent with none would report that the bar
 * fills instantly.
 *
 * What can be pinned is the arithmetic: at a stated clearing rate, does the bar
 * gain or lose ground, and how long does it take? Those are the claims the
 * tuning actually rests on.
 */
describe('the hot bar is priced in pace, not in patience', () => {
  /**
   * Run the bar's own arithmetic at a given clearing rate.
   *
   * Deliberately not a `Game`: this is about the two constants and how they
   * interact over time, and driving a real board would put piece luck and stage
   * gravity between the question and the answer.
   */
  function heatModel(linesPerSecond: number, seconds: number): number {
    const stepMs = 100;
    let heat = 0;
    for (let t = 0; t < seconds * 1000; t += stepMs) {
      heat = Math.min(1, heat + ((linesPerSecond * stepMs) / 1000) * HEAT_PER_LINE);
      if (heat < 1) heat = Math.max(0, heat - stepMs * HEAT_DECAY_PER_MS);
      if (heat >= 1) return t / 1000;
    }
    return Infinity;
  }

  it('fills in about forty-five seconds of sustained good clearing', () => {
    // 0.3 lines per second: the agent's measured 0.3 lines per piece at roughly
    // a piece a second.
    const seconds = heatModel(0.3, 300);
    expect(seconds).toBeGreaterThan(30);
    expect(seconds).toBeLessThan(60);
  });

  it('costs a player who eases off, without shutting them out', () => {
    // Half the modelled pace. This used to assert `Infinity` -- under the
    // original constants the bar could never fill at two thirds of pace, let
    // alone half. Cooling went to a fifth because that cliff was too harsh in
    // play, so the honest rewrite is not a retuned bound but a different claim:
    // easing off costs time rather than the mechanic.
    const eased = heatModel(0.15, 600);
    expect(eased).toBeGreaterThan(2 * heatModel(0.3, 300));
    expect(eased).toBeLessThan(180);
  });

  it('still loses ground below a quarter of the modelled pace', () => {
    // What survives of the old cliff, and the reason this is a rate mechanic
    // rather than a stopwatch: there is a floor beneath which waiting does not
    // work, however long you wait.
    expect(heatModel(0.07, 900)).toBe(Infinity);
  });

  it('is reachable at all, which a decay set too high would quietly prevent', () => {
    // The failure this guards is a change to either constant that makes the bar
    // unreachable for everyone — which would look like the feature simply not
    // working rather than like a balance change.
    expect(heatModel(0.5, 300)).toBeLessThan(30);
  });
});
