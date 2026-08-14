/**
 * The difficulty arc.
 *
 * The stage table is not just a difficulty knob: it is the schedule on which
 * the game reveals itself. Stage 1 must look like an ordinary falling-block
 * game, and depth must arrive without announcement. These tests pin that
 * schedule, because a piece leaking in early would spoil the reveal the whole
 * design is built around.
 *
 * They also pin the naming rule. Stages are numbered, not named, and never
 * named after a spectrum band -- see `describe('stage identity')` below for
 * why that is a rule and not a preference.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import { Dealer } from '@core/dealer';
import { PIECES, isPlanar, piecesForTier } from '@core/pieces';
import { createRng } from '@core/rng';
import { SPECTRUM_STOPS } from '@core/spectrum';
import {
  AUTHORED_STAGE_COUNT,
  LINES_PER_STAGE,
  STAGES,
  endlessDepth,
  gravityIntervalMs,
  isEndless,
  stageForLines,
  stageLabel,
} from '@core/stages';

/** The stage a given piece or capability first becomes available. */
const firstStageWhere = (predicate: (stage: (typeof STAGES)[number]) => boolean): number =>
  STAGES.find(predicate)?.index ?? -1;

describe('the reveal schedule', () => {
  it('shows nothing but flat pieces at stage 1', () => {
    // The first several pieces have to read as ordinary tetrominoes, or the
    // moment the board first turns lands as confusion rather than revelation.
    for (const piece of piecesForTier(STAGES[0]!.maxTier)) {
      expect(isPlanar(piece.cells)).toBe(true);
    }
  });

  it('introduces depth at stage 2 and true 3D no earlier than stage 4', () => {
    const tierOf = (id: string): number => PIECES.find((p) => p.id === id)!.tier;
    expect(STAGES[1]!.maxTier).toBe(tierOf('SCREW_L'));
    expect(firstStageWhere((stage) => stage.maxTier >= tierOf('TRIPOD'))).toBe(4);
  });

  it('never withdraws a piece once it has appeared', () => {
    for (let tier = 1; tier <= 4; tier += 1) {
      const smaller = new Set(piecesForTier(tier - 1).map((p) => p.id));
      const larger = new Set(piecesForTier(tier).map((p) => p.id));
      for (const id of smaller) expect(larger.has(id)).toBe(true);
    }
  });

  it('unlocks depth control only once the player can already read depth', () => {
    // Nudging lanes before the spectrum means anything is just noise.
    expect(firstStageWhere((stage) => stage.depthNudge)).toBe(4);
    expect(STAGES.slice(0, 3).every((stage) => !stage.depthNudge)).toBe(true);
  });
});

describe('stage identity', () => {
  /**
   * The governing rule is "position is absolute, colour is relative": a hue is
   * a claim about depth from the current camera, and about nothing else. A
   * stage called "Green" quietly makes a second claim -- that green means
   * something in the progression too -- and a player who believes both has no
   * way to tell which one a green cube is speaking. Numbering costs nothing and
   * makes no claim at all.
   */
  it('identifies stages by number and does not name them after the spectrum', () => {
    const bands = new Set(SPECTRUM_STOPS.map((stop) => stop.name.toLowerCase()));
    for (const stage of STAGES) {
      expect(stage.name).toBeUndefined();
      expect(stageLabel(stage)).toBe(`Stage ${stage.index}`);
    }
    // And if a stage ever does earn a name, it must not be a band's.
    for (const stage of STAGES) {
      if (stage.name) expect(bands.has(stage.name.toLowerCase())).toBe(false);
    }
  });

  it('numbers stages consecutively from one, into the endless tail', () => {
    STAGES.forEach((stage, i) => expect(stage.index).toBe(i + 1));
    for (let n = 0; n < 12; n += 1) {
      expect(stageForLines(n * LINES_PER_STAGE).index).toBe(n + 1);
    }
  });

  it('shows a name alongside the number rather than instead of it', () => {
    // No stage carries a name today, so this exercises the contract directly:
    // a named stage must still tell the player where in the arc they are.
    const named = { ...STAGES[3]!, name: 'Eclipse' };
    expect(stageLabel(named)).toContain('4');
    expect(stageLabel(named)).toContain('Eclipse');
  });
});

describe('the dealer respects the schedule', () => {
  it('deals only stage-appropriate pieces', () => {
    for (let tier = 1; tier <= 4; tier += 1) {
      const allowed = new Set(piecesForTier(tier).map((piece) => piece.id));
      const dealer = new Dealer(createRng(`tier-${tier}`), tier);
      for (let i = 0; i < 300; i += 1) {
        expect(allowed.has(dealer.deal().def.id)).toBe(true);
      }
    }
  });

  it('deals every lane, so cross-axis lines stay reachable', () => {
    const dealer = new Dealer(createRng('lanes'), 1);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(dealer.deal().lane);
    expect(seen.size).toBe(8);
  });

  it('brings newly unlocked pieces in promptly rather than after the old bag', () => {
    const dealer = new Dealer(createRng('unlock'), 1);
    for (let i = 0; i < 3; i += 1) dealer.deal();
    dealer.setTier(3);

    const ids = new Set<string>();
    for (let i = 0; i < 40; i += 1) ids.add(dealer.deal().def.id);
    expect(ids.has('TRIPOD') || ids.has('SCREW_L') || ids.has('SCREW_R')).toBe(true);
  });
});

describe('the arc is paced to be earned', () => {
  it('takes a substantial run to reach the last authored stage', () => {
    // Tuned in playability.test.ts: a competent agent manages 65-103 lines, so
    // the full arc sits at the top of that range rather than inside every game.
    const linesToLast = LINES_PER_STAGE * (AUTHORED_STAGE_COUNT - 1);
    expect(linesToLast).toBeGreaterThanOrEqual(80);
    expect(stageForLines(linesToLast).index).toBe(AUTHORED_STAGE_COUNT);
    expect(stageForLines(linesToLast - 1).index).toBe(AUTHORED_STAGE_COUNT - 1);
  });
});

describe('a real game follows the schedule', () => {
  it('cannot show a non-planar piece before stage 2', () => {
    const game = new Game({ seed: 'stage-one' });
    expect(game.stage.index).toBe(1);

    // Every piece the queue can offer at stage 1, plus the one in play.
    const shapes = [game.active!.offsets, ...game.preview.map((entry) => entry.def.cells)];
    for (const shape of shapes) expect(isPlanar(shape)).toBe(true);
  });

  it('speeds up as the stages climb', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const stage of STAGES) {
      const interval = gravityIntervalMs(stage);
      expect(interval).toBeLessThan(previous);
      previous = interval;
    }
    // The last authored stage is roughly seven times the pace of the first.
    expect(gravityIntervalMs(STAGES[0]!) / gravityIntervalMs(STAGES[6]!)).toBeCloseTo(7, 0);
  });

  it('turns the board more often the further in you get', () => {
    expect(STAGES[0]!.linesPerTurn).toBeGreaterThan(STAGES[6]!.linesPerTurn);
  });
});

describe('the endless tail', () => {
  const lastAuthoredLine = LINES_PER_STAGE * AUTHORED_STAGE_COUNT;

  it('begins only after the authored stages are exhausted', () => {
    expect(isEndless(stageForLines(lastAuthoredLine - 1))).toBe(false);
    expect(isEndless(stageForLines(lastAuthoredLine))).toBe(true);
    expect(stageForLines(lastAuthoredLine - 1).index).toBe(AUTHORED_STAGE_COUNT);
  });

  it('counts its own depth from one', () => {
    expect(endlessDepth(stageForLines(lastAuthoredLine - 1))).toBe(0);
    expect(endlessDepth(stageForLines(lastAuthoredLine))).toBe(1);
    expect(endlessDepth(stageForLines(lastAuthoredLine + LINES_PER_STAGE))).toBe(2);
  });

  it('just keeps counting rather than announcing a new tier', () => {
    // Nothing renames itself past the end of the table. The numbers continue,
    // which is the honest presentation: it is the same arc, still climbing.
    const first = stageForLines(lastAuthoredLine);
    expect(stageLabel(first)).toBe(`Stage ${AUTHORED_STAGE_COUNT + 1}`);
    expect(first.name).toBeUndefined();
  });

  it('keeps accelerating without ever stalling or overflowing', () => {
    let previous = gravityIntervalMs(stageForLines(lastAuthoredLine - LINES_PER_STAGE));
    for (let lines = lastAuthoredLine; lines <= lastAuthoredLine * 6; lines += LINES_PER_STAGE) {
      const interval = gravityIntervalMs(stageForLines(lines));
      expect(interval).toBeLessThan(previous);
      expect(interval).toBeGreaterThan(0);
      expect(Number.isFinite(interval)).toBe(true);
      previous = interval;
    }
  });
});
