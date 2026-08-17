/**
 * Pause, as an engine state.
 *
 * The plan's engine note for this milestone is the whole point of this file:
 * `GameStatus` had no `paused` state, so pause is a core state-machine change
 * "made without breaking `(seed, input log)` determinism".
 *
 * Two things therefore have to hold. Pause must genuinely stop everything —
 * gravity, the turn, a cascade in flight, and every input path — and it must
 * leave no trace: a run whose log contains pauses has to end up bit-identical
 * to the same run without them. The second is the one worth testing hardest,
 * because it is the one that would rot silently.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import type { GameStatus } from '@core/game';
import { modeById } from '@core/modes';

/**
 * Read the status across a function boundary.
 *
 * These tests drive the machine by assigning `status` directly, which narrows
 * the property's type for the rest of the block; the engine then moves it on
 * from under the narrowing. Reading through a call resets that.
 */
const statusOf = (game: Game): GameStatus => game.status;

const newGame = (seed = 'pause'): Game => new Game({ seed });

/** Everything about a run that a player could observe. */
const snapshot = (game: Game): string =>
  JSON.stringify({
    status: game.status,
    face: game.face,
    score: game.score,
    lines: game.lines,
    meter: game.shiftMeter,
    chain: game.refractionChain,
    turns: game.turns,
    active: game.active,
    board: game.board.filledCells(),
  });

describe('pause stops the run', () => {
  it('freezes gravity entirely', () => {
    const game = newGame();
    const before = game.active!.y;
    game.pause();
    for (let i = 0; i < 200; i += 1) game.tick(100);
    expect(game.active!.y).toBe(before);
  });

  it('refuses every input while it is up', () => {
    const game = newGame();
    const before = snapshot(game);
    game.pause();

    game.moveHorizontal(-1);
    game.moveHorizontal(1);
    game.nudgeDepth(1);
    game.rotatePiece('roll', true);
    game.hold();
    game.hardDrop();
    game.softDrop();

    // Every input path already refuses to act outside `falling` and
    // `awaitingTurn`, so one status change closes all of them at once.
    expect(snapshot(game)).toBe(before.replace('"falling"', '"paused"'));
  });

  it('reports itself, so the renderer need not infer it', () => {
    const game = newGame();
    expect(game.pause()).toBe(true);
    expect(game.status).toBe('paused');
  });
});

describe('resume returns to exactly where it interrupted', () => {
  it('restores a falling piece', () => {
    const game = newGame();
    const before = game.status;
    game.pause();
    game.resume();
    expect(game.status).toBe(before);
  });

  it('restores a turn in flight, with its timer untouched', () => {
    const game = newGame('mid-turn');
    game.shiftMeter = game.stage.linesPerTurn;
    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    game.tick(100);
    expect(game.status).toBe('turning');

    game.pause();
    for (let i = 0; i < 50; i += 1) game.tick(100);
    // The turn did not advance while paused, so it cannot have completed.
    expect(statusOf(game)).toBe('paused');

    game.resume();
    expect(statusOf(game)).toBe('turning');
    for (let i = 0; i < 50 && statusOf(game) === 'turning'; i += 1) game.tick(100);
    expect(statusOf(game)).not.toBe('turning');
  });

  it('restores an awaiting-turn prompt without letting it time out', () => {
    const game = newGame('prompt');
    game.shiftMeter = game.stage.linesPerTurn;
    game.status = 'awaitingTurn';

    game.pause();
    // Well past the five-second prompt timeout.
    for (let i = 0; i < 200; i += 1) game.tick(100);
    game.resume();
    expect(statusOf(game)).toBe('awaitingTurn');
  });
});

describe('pause leaves no trace on the run', () => {
  /** Play a fixed script, optionally pausing between every action. */
  const play = (withPauses: boolean): string => {
    const game = new Game({ seed: 'determinism' });
    const settle = (): void => {
      for (let i = 0; i < 60 && game.status !== 'falling' && game.status !== 'gameOver'; i += 1) {
        game.tick(100);
      }
    };
    const breathe = (): void => {
      if (!withPauses) return;
      game.pause();
      // Time passes while paused. If any of it leaked into the simulation,
      // the two runs would diverge here.
      for (let i = 0; i < 20; i += 1) game.tick(100);
      game.resume();
    };

    for (let piece = 0; piece < 30 && game.status !== 'gameOver'; piece += 1) {
      breathe();
      if (game.status === 'awaitingTurn') {
        game.chooseTurn(piece % 2 === 0 ? 'left' : 'right');
        settle();
        continue;
      }
      game.moveHorizontal(piece % 3 === 0 ? -1 : 1);
      breathe();
      game.rotatePiece('roll', true);
      game.hardDrop();
      settle();
      // Ordinary time, in both runs alike.
      game.tick(16.67);
    }
    return snapshot(game);
  };

  it('produces a bit-identical run whether or not it was paused', () => {
    expect(play(true)).toBe(play(false));
  });

  it('is idempotent, so a double press cannot lose the return state', () => {
    const game = newGame();
    game.pause();
    expect(game.pause()).toBe(false);
    game.resume();
    expect(game.status).toBe('falling');
  });

  it('does nothing on resume when it was never paused', () => {
    const game = newGame();
    expect(game.resume()).toBe(false);
    expect(game.status).toBe('falling');
  });
});

describe('pause does not rescue a lost run', () => {
  it('cannot be used to escape game over', () => {
    const game = new Game({ seed: 'over', mode: modeById('ascent') });
    for (let y = 0; y < 20; y += 1) {
      for (let x = 1; x < 8; x += 1) {
        for (let z = 0; z < 8; z += 1) game.board.fill({ x, y, z });
      }
    }
    game.hardDrop();
    for (let i = 0; i < 100 && game.status !== 'gameOver'; i += 1) game.tick(200);
    expect(game.status).toBe('gameOver');
    expect(game.pause()).toBe(false);
    expect(game.status).toBe('gameOver');
  });
});
