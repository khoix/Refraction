/**
 * Playability guard.
 *
 * The Lane Dealer is the most consequential gap filled in the design spec: the
 * player has no depth control before Stage 4, so pieces arrive in lanes chosen
 * for them. That is a real risk -- if lines turn out to be impractical to
 * complete, the game does not work at all, and no amount of rendering saves it.
 *
 * This drives the engine with a greedy placement search and asserts that a
 * competent player clears lines at a healthy rate. It is a design test, not a
 * unit test: it fails if a rules change quietly makes the game unplayable.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import { normalize, rotate } from '@core/pieces';
import { columnCount, fromView } from '@core/projection';
import type { Cell } from '@core/types';

interface Placement {
  readonly u: number;
  readonly y: number;
  readonly offsets: Cell[];
  readonly cost: number;
}

/** Count cells with a gap directly beneath them -- the thing good players avoid. */
function countHoles(cells: readonly Cell[], filled: ReadonlySet<string>): number {
  let holes = 0;
  for (const cell of cells) {
    for (let y = cell.y - 1; y >= 0; y -= 1) {
      if (filled.has(`${cell.x},${y},${cell.z}`)) break;
      holes += 1;
    }
  }
  return holes;
}

/** Greedy search over rotations and columns for the current piece. */
function bestPlacement(game: Game): Placement | null {
  const piece = game.active;
  if (!piece) return null;
  let best: Placement | null = null;

  for (let rolls = 0; rolls < 4; rolls += 1) {
    let offsets = normalize([...piece.offsets]);
    for (let i = 0; i < rolls; i += 1) offsets = rotate(offsets, 'z');

    for (let u = 0; u < columnCount(game.face); u += 1) {
      const y = game.dropHeight(offsets, u, piece.lane);
      if (y === null) continue;

      const board = game.board.clone();
      const cells = offsets.map((offset) =>
        fromView(game.face, {
          u: u + offset.x,
          y: y + offset.y,
          lane: piece.lane + offset.z,
        })
      );
      for (const cell of cells) board.fill(cell);

      const filled = new Set(board.filledCells().map((c) => `${c.x},${c.y},${c.z}`));
      const lines = board.findCompleteLines(game.face).length;
      const cost =
        countHoles(board.filledCells(), filled) * 6 +
        board.highestFilledY() * 1.2 -
        lines * 40 +
        y * 0.6;

      if (!best || cost < best.cost) best = { u, y, offsets, cost };
    }
  }
  return best;
}

interface RunResult {
  readonly pieces: number;
  readonly lines: number;
  readonly score: number;
  readonly turns: number;
  /** Highest stage the run reached. */
  readonly stage: number;
}

function playGreedily(seed: string, maxPieces: number, catalog?: 'experimental'): RunResult {
  const game = new Game(catalog ? { seed, catalog } : { seed });
  let pieces = 0;
  let turns = 0;

  // Turns and clears resolve over time, so the agent has to run the clock the
  // same way a player would rather than assuming instant resolution.
  const settle = (): void => {
    for (let i = 0; i < 400; i += 1) {
      if (game.status !== 'resolving' && game.status !== 'turning') return;
      game.tick(200);
    }
  };

  while (game.status !== 'gameOver' && pieces < maxPieces) {
    if (game.status === 'awaitingTurn') {
      game.chooseTurn(turns % 2 === 0 ? 'right' : 'left');
      turns += 1;
      settle();
      continue;
    }
    const best = bestPlacement(game);
    if (!best || !game.active) break;
    game.active = { ...game.active, offsets: best.offsets, u: best.u, y: best.y };
    game.hardDrop();
    settle();
    pieces += 1;
  }

  return {
    pieces,
    lines: game.lines,
    score: game.score,
    turns,
    stage: game.stage.index,
  };
}

// These run hundreds of full placement searches, and coverage instrumentation
// roughly doubles that. The generous timeout is the cost of testing the design
// rather than a single function.
const SIMULATION_TIMEOUT_MS = 60_000;

describe('a competent player can actually play this', () => {
  const seeds = ['alpha', 'beta'];

  it(
    'clears lines at a healthy rate despite having no depth control',
    () => {
      for (const seed of seeds) {
        const result = playGreedily(seed, 200);
        // Roughly 0.3 lines per piece in tuning runs. The floor is set well
        // below that so ordinary balance changes do not trip it, but a change
        // that makes lines impractical to complete will.
        expect(result.lines / result.pieces).toBeGreaterThan(0.12);
        expect(result.lines).toBeGreaterThan(20);
      }
    },
    SIMULATION_TIMEOUT_MS
  );

  it(
    'reaches the Shift meter and turns the board repeatedly',
    () => {
      expect(playGreedily('turns', 200).turns).toBeGreaterThan(3);
    },
    SIMULATION_TIMEOUT_MS
  );

  it(
    'climbs the stage arc rather than stalling at the start',
    () => {
      // The arc only means anything if ordinary play actually travels it. Two
      // hundred pieces should carry a competent player several stages in.
      const result = playGreedily('arc', 200);
      expect(result.stage).toBeGreaterThanOrEqual(3);
      console.log(`arc: ${result.pieces} pieces, ${result.lines} lines, stage ${result.stage}`);
    },
    SIMULATION_TIMEOUT_MS
  );

  it(
    'scores meaningfully rather than accumulating drop points alone',
    () => {
      // Hard drops alone could not reach this; it requires real clears.
      expect(playGreedily('scoring', 150).score).toBeGreaterThan(10_000);
    },
    SIMULATION_TIMEOUT_MS
  );

  it(
    'stays playable under the experimental piece vocabulary',
    () => {
      // The M6.5 playtest bed: non-planar pieces from stage 1, a tricube, and
      // pentacubes later. The floor is set below the standard catalogue's --
      // the experiment is allowed to be harder -- but a vocabulary the agent
      // cannot clear lines with at all has failed its first criterion, before
      // any human plays it. The log line is the measurement for the write-up.
      for (const seed of ['exp-alpha', 'exp-beta']) {
        const result = playGreedily(seed, 200, 'experimental');
        console.log(
          `experimental ${seed}: ${result.pieces} pieces, ${result.lines} lines, ` +
            `stage ${result.stage}, ${result.turns} turns`
        );
        expect(result.lines / Math.max(1, result.pieces)).toBeGreaterThan(0.08);
        expect(result.lines).toBeGreaterThan(12);
      }
    },
    SIMULATION_TIMEOUT_MS
  );
});
