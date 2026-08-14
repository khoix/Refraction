/**
 * The Red -> Violet arc.
 *
 * The stage table is not just a difficulty knob: it is the schedule on which
 * the game reveals itself. Stage 1 must look like an ordinary falling-block
 * game, and depth must arrive without announcement. These tests pin that
 * schedule, because a piece leaking in early would spoil the reveal the whole
 * design is built around.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import { Dealer } from '@core/dealer';
import { PIECES, isPlanar, piecesForTier } from '@core/pieces';
import { createRng } from '@core/rng';
import {
  LINES_PER_STAGE,
  NAMED_STAGE_COUNT,
  STAGES,
  gravityIntervalMs,
  isUltraviolet,
  stageDepthParameter,
  stageForLines,
  ultravioletDepth,
} from '@core/stages';

describe('the reveal schedule', () => {
  it('shows nothing but flat pieces at stage 1', () => {
    // The first several pieces have to read as ordinary tetrominoes, or the
    // moment the board first turns lands as confusion rather than revelation.
    for (const piece of piecesForTier(STAGES[0]!.maxTier)) {
      expect(isPlanar(piece.cells)).toBe(true);
    }
  });

  it('introduces depth at Orange and true 3D no earlier than Green', () => {
    const tierOf = (id: string): number => PIECES.find((p) => p.id === id)!.tier;
    expect(STAGES[1]!.maxTier).toBe(tierOf('SCREW_L'));
    expect(STAGES[1]!.name).toBe('Orange');

    const firstTripodStage = STAGES.find((stage) => stage.maxTier >= tierOf('TRIPOD'));
    expect(firstTripodStage?.name).toBe('Green');
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
    const firstNudge = STAGES.find((stage) => stage.depthNudge);
    expect(firstNudge?.name).toBe('Green');
    expect(STAGES.slice(0, 3).every((stage) => !stage.depthNudge)).toBe(true);
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
  it('takes a substantial run to reach Violet', () => {
    // Tuned in playability.test.ts: a competent agent manages 65-103 lines, so
    // the full arc sits at the top of that range rather than inside every game.
    const linesToViolet = LINES_PER_STAGE * (NAMED_STAGE_COUNT - 1);
    expect(linesToViolet).toBeGreaterThanOrEqual(80);
    expect(stageForLines(linesToViolet).name).toBe('Violet');
    expect(stageForLines(linesToViolet - 1).name).toBe('Indigo');
  });
});

describe('a real game follows the schedule', () => {
  it('cannot show a non-planar piece before Orange', () => {
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
    // Violet is roughly seven times the pace of Red.
    expect(gravityIntervalMs(STAGES[0]!) / gravityIntervalMs(STAGES[6]!)).toBeCloseTo(7, 0);
  });

  it('turns the board more often the further in you get', () => {
    expect(STAGES[0]!.linesPerTurn).toBeGreaterThan(STAGES[6]!.linesPerTurn);
  });
});

describe('Ultraviolet', () => {
  const lastNamedLine = LINES_PER_STAGE * NAMED_STAGE_COUNT;

  it('begins only after Violet is complete', () => {
    expect(isUltraviolet(stageForLines(lastNamedLine - 1))).toBe(false);
    expect(isUltraviolet(stageForLines(lastNamedLine))).toBe(true);
    expect(stageForLines(lastNamedLine - 1).name).toBe('Violet');
  });

  it('numbers its tiers from one', () => {
    expect(ultravioletDepth(stageForLines(lastNamedLine - 1))).toBe(0);
    expect(ultravioletDepth(stageForLines(lastNamedLine))).toBe(1);
    expect(ultravioletDepth(stageForLines(lastNamedLine + LINES_PER_STAGE))).toBe(2);
  });

  it('keeps accelerating without ever stalling or overflowing', () => {
    let previous = gravityIntervalMs(stageForLines(lastNamedLine - LINES_PER_STAGE));
    for (let lines = lastNamedLine; lines <= lastNamedLine * 6; lines += LINES_PER_STAGE) {
      const interval = gravityIntervalMs(stageForLines(lines));
      expect(interval).toBeLessThan(previous);
      expect(interval).toBeGreaterThan(0);
      expect(Number.isFinite(interval)).toBe(true);
      previous = interval;
    }
  });
});

describe('stage colour', () => {
  it('maps the seven named stages across the whole spectrum', () => {
    expect(stageDepthParameter(1)).toBe(0);
    expect(stageDepthParameter(NAMED_STAGE_COUNT)).toBe(1);
    for (let index = 2; index <= NAMED_STAGE_COUNT; index += 1) {
      expect(stageDepthParameter(index)).toBeGreaterThan(stageDepthParameter(index - 1));
    }
  });

  it('clamps rather than running off the end of the ramp', () => {
    expect(stageDepthParameter(0)).toBe(0);
    expect(stageDepthParameter(99)).toBe(1);
  });
});
