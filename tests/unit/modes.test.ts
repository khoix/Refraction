/**
 * The six modes.
 *
 * A mode is configuration, not code, so these tests are mostly about the
 * *shape* of the configuration: that no mode is a duplicate of another, that
 * every override actually reaches the engine, and that the two modes the spec
 * described almost identically are in fact different games.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import {
  AUTHORED_MODE_ID,
  CONTINUOUS_GRAVITY_STEP,
  DEFAULT_MODE_ID,
  MODES,
  isUnlocked,
  modeById,
  modeGravity,
  modeStage,
} from '@core/modes';
import { LINES_PER_STAGE, STAGES, stageForLines } from '@core/stages';
import { BOARD_HEIGHT } from '@core/constants';
import { isPlanar } from '@core/pieces';

const stageOf = (mode: (typeof MODES)[number], lines: number) =>
  modeStage(mode, lines, stageForLines, LINES_PER_STAGE);

describe('the mode table', () => {
  it('offers the six modes the design calls for', () => {
    expect(MODES.map((mode) => mode.id)).toEqual([
      'ascent',
      'endless',
      'prism',
      'flatland',
      'blindSpectrum',
      'zen',
    ]);
  });

  it('gives every mode a name and a blurb the menu can show', () => {
    for (const mode of MODES) {
      expect(mode.name.length).toBeGreaterThan(0);
      expect(mode.blurb.length).toBeGreaterThan(0);
      expect(mode.startStage).toBeGreaterThanOrEqual(1);
      expect(mode.startStage).toBeLessThanOrEqual(STAGES.length);
    }
  });

  it('has no two modes with identical rules', () => {
    // Two modes that configure the engine the same way are one mode with two
    // names, and the menu would be lying about the choice.
    const seen = new Map<string, string>();
    for (const mode of MODES) {
      const { id, name, blurb, ...rules } = mode;
      void name;
      void blurb;
      const key = JSON.stringify(rules);
      expect(seen.has(key), `${id} duplicates ${seen.get(key) ?? ''}`).toBe(false);
      seen.set(key, id);
    }
  });

  it('falls back to the mode a new player would get, for anything unrecognised', () => {
    // A bad `?mode=` in a shared link, or a save written by a future version.
    // Either way the player should land where a new player lands, not on
    // whichever mode the engine happens to treat as its reference.
    expect(modeById(null).id).toBe(DEFAULT_MODE_ID);
    expect(modeById('nonsense').id).toBe(DEFAULT_MODE_ID);
    expect(modeById('prism').id).toBe('prism');
  });
});

describe('Ascent and Endless are different games', () => {
  const ascent = modeById('ascent');
  const endless = modeById('endless');

  it('starts Ascent flat and Endless already open', () => {
    expect(stageOf(ascent, 0).maxTier).toBe(1);
    expect(stageOf(endless, 0).maxTier).toBe(4);
    expect(stageOf(ascent, 0).depthNudge).toBe(false);
    expect(stageOf(endless, 0).depthNudge).toBe(true);
  });

  it('climbs the table in Ascent and holds it in Endless', () => {
    expect(stageOf(ascent, 0).index).toBe(1);
    expect(stageOf(ascent, LINES_PER_STAGE * 3).index).toBe(4);
    // Endless pins its stage, so the table never moves under it.
    const pinned = stageOf(endless, 0).index;
    expect(stageOf(endless, LINES_PER_STAGE * 9).index).toBe(pinned);
  });

  it('opens Endless at a pace a person can start at, not stage 6 speed', () => {
    // It pins a late stage for its *content*; the gravity scale walks the
    // *speed* back to roughly where the arc's midpoint sits.
    const opening = modeGravity(endless, stageOf(endless, 0), 0);
    expect(opening).toBeLessThan(STAGES[5]!.gravity);
    expect(opening).toBeCloseTo(STAGES[3]!.gravity, 0);
  });

  it('accelerates Endless per line rather than per stage', () => {
    const first = modeGravity(endless, stageOf(endless, 0), 0);
    const later = modeGravity(endless, stageOf(endless, 20), 20);
    expect(later).toBeCloseTo(first * Math.pow(CONTINUOUS_GRAVITY_STEP, 20), 5);
    expect(later).toBeGreaterThan(first);
  });

  it('never compounds both curves at once', () => {
    // A mode that both climbed the stage table and compounded per line would
    // multiply two independently tuned curves into something nobody tuned.
    for (const mode of MODES) {
      expect(mode.continuousGravity && !mode.pinStage).toBe(false);
    }
  });

  it('leaves Ascent gravity exactly as the stage table specifies', () => {
    for (let lines = 0; lines < LINES_PER_STAGE * 7; lines += LINES_PER_STAGE) {
      const stage = stageOf(ascent, lines);
      expect(modeGravity(ascent, stage, lines)).toBe(stage.gravity);
    }
  });
});

describe('mode overrides reach the stage', () => {
  it('caps Flatland at planar pieces however far the run goes', () => {
    const flatland = modeById('flatland');
    for (let lines = 0; lines < LINES_PER_STAGE * 10; lines += LINES_PER_STAGE) {
      expect(stageOf(flatland, lines).maxTier).toBe(1);
    }
  });

  it('turns the board twice as often in Prism', () => {
    const prism = modeById('prism');
    const ascent = modeById('ascent');
    expect(stageOf(prism, 0).linesPerTurn).toBe(2);
    expect(stageOf(prism, 0).linesPerTurn).toBeLessThan(stageOf(ascent, 0).linesPerTurn);
  });

  it('offsets a mode that starts partway along the table', () => {
    const prism = modeById('prism');
    // Prism starts at stage 3, so its first line sits where Ascent's 30th does.
    expect(stageOf(prism, 0).index).toBe(3);
    expect(stageOf(prism, LINES_PER_STAGE).index).toBe(4);
  });

  it('never lets an override raise a cap the stage table has not reached', () => {
    // maxTier is a ceiling, not a floor: a mode may restrict the schedule but
    // must not smuggle a piece in ahead of it.
    for (const mode of MODES) {
      if (mode.maxTier === null || mode.pinStage) continue;
      for (let lines = 0; lines < LINES_PER_STAGE * 8; lines += LINES_PER_STAGE) {
        const offset = (mode.startStage - 1) * LINES_PER_STAGE;
        expect(stageOf(mode, lines).maxTier).toBeLessThanOrEqual(
          stageForLines(lines + offset).maxTier
        );
      }
    }
  });
});

describe('unlocks', () => {
  it('opens five modes immediately and holds Blind Spectrum back', () => {
    const open = MODES.filter((mode) => isUnlocked(mode, 0));
    expect(open.map((mode) => mode.id)).not.toContain('blindSpectrum');
    expect(open).toHaveLength(MODES.length - 1);
  });

  it('opens Blind Spectrum once the requirement is met', () => {
    const blind = modeById('blindSpectrum');
    const required = blind.unlock?.bestStage ?? 0;
    expect(isUnlocked(blind, required - 1)).toBe(false);
    expect(isUnlocked(blind, required)).toBe(true);
  });

  it('states its requirement in words, so a locked card can explain itself', () => {
    for (const mode of MODES) {
      if (!mode.unlock) continue;
      expect(mode.unlock.description.length).toBeGreaterThan(0);
    }
  });
});

describe('a real game honours its mode', () => {
  it('deals only flat pieces in Flatland, deep into the run', () => {
    const game = new Game({ seed: 'flat', mode: modeById('flatland') });
    for (const entry of game.preview) expect(isPlanar(entry.def.cells)).toBe(true);
    expect(isPlanar(game.active!.offsets)).toBe(true);

    // And it still cannot introduce one later, however far the stage climbs.
    game.lines = LINES_PER_STAGE * 9;
    expect(game.stage.maxTier).toBe(1);
  });

  it('allows depth control from the first piece in Zen', () => {
    expect(new Game({ seed: 'zen', mode: modeById('zen') }).depthNudgeAllowed).toBe(true);
    expect(new Game({ seed: 'asc', mode: modeById('ascent') }).depthNudgeAllowed).toBe(false);
  });

  it('reports gravity through the mode rather than the raw stage', () => {
    const endless = new Game({ seed: 'g', mode: modeById('endless') });
    const before = endless.gravity;
    const stageBefore = endless.stage.index;
    endless.lines = 30;
    expect(endless.gravity).toBeGreaterThan(before);
    // The stage did not move; only the mode's own acceleration did.
    expect(endless.stage.index).toBe(stageBefore);
  });

  it('defaults to the authored arc when no mode is given', () => {
    // Named, not taken from whichever constant happens to be handy. This test
    // asserted `DEFAULT_MODE_ID` while its name said Ascent, so it agreed with
    // itself right up until the player-facing default moved to Flatland and a
    // game built with no mode quietly became a tier-capped one.
    expect(AUTHORED_MODE_ID).toBe('ascent');
    expect(new Game({ seed: 'default' }).mode.id).toBe(AUTHORED_MODE_ID);
    expect(new Game({ seed: 'default' }).stage.index).toBe(1);
  });

  it('offers a new player Flatland, and it is open from the start', () => {
    // A different question from the one above: what the rules do when nobody
    // says otherwise, against what a player is handed first. Flatland deals
    // planar pieces only, so depth is purely a property of where a piece is put
    // -- the gentlest first contact with the idea the game rests on. It would be
    // a poor default if it were locked.
    expect(DEFAULT_MODE_ID).toBe('flatland');
    const flatland = modeById(DEFAULT_MODE_ID);
    expect(flatland.unlock).toBeNull();
    expect(flatland.maxTier).toBe(1);
  });
});

describe('Zen cannot end', () => {
  /**
   * Fill the board to `height`, leaving column x=0 empty.
   *
   * The gap matters: a solid flood completes lines instead, and the run
   * dissolves into cascades rather than reaching the overflow this is meant to
   * test. With one column open no line can ever complete, so the only way out
   * is the top-out path.
   */
  const floodTo = (game: Game, height: number): void => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 1; x < 8; x += 1) {
        for (let z = 0; z < 8; z += 1) game.board.fill({ x, y, z });
      }
    }
  };

  /** Run the clock until the board settles, or give up. */
  const settle = (game: Game): void => {
    for (let i = 0; i < 200; i += 1) {
      if (game.status === 'falling' || game.status === 'gameOver') return;
      game.tick(200);
    }
  };

  it('takes the top off the stack instead of ending the run', () => {
    const game = new Game({ seed: 'zen-overflow', mode: modeById('zen') });
    floodTo(game, 20);
    game.hardDrop();
    settle(game);

    expect(game.status).not.toBe('gameOver');
    expect(game.board.isToppedOut()).toBe(false);
    expect(game.active).not.toBeNull();
  });

  it('says so, rather than letting rows vanish unexplained', () => {
    const game = new Game({ seed: 'zen-event', mode: modeById('zen') });
    floodTo(game, 20);
    const events: string[] = [];
    game.hardDrop();
    for (let i = 0; i < 200; i += 1) {
      events.push(...game.drainEvents().map((event) => event.type));
      if (game.status === 'falling' || game.status === 'gameOver') break;
      game.tick(200);
    }
    events.push(...game.drainEvents().map((event) => event.type));
    expect(events).toContain('rescue');
  });

  it('trims from the top and leaves the structure below untouched', () => {
    const game = new Game({ seed: 'zen-local', mode: modeById('zen') });
    floodTo(game, 20);
    game.hardDrop();
    settle(game);

    // The floor survived; only rows near the ceiling were taken.
    expect(game.board.isFilled({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(game.board.isFilled({ x: 1, y: 5, z: 0 })).toBe(true);
    expect(game.board.highestFilledY()).toBeLessThan(BOARD_HEIGHT);
  });

  it('still ends the run in a mode that can fail', () => {
    const game = new Game({ seed: 'ascent-overflow', mode: modeById('ascent') });
    floodTo(game, 20);
    game.hardDrop();
    settle(game);
    expect(game.status).toBe('gameOver');
  });
});

describe('run statistics', () => {
  it('counts the turns a run took', () => {
    const game = new Game({ seed: 'turns', mode: modeById('prism') });
    expect(game.turns).toBe(0);
    game.shiftMeter = game.stage.linesPerTurn;
    game.status = 'awaitingTurn';
    game.chooseTurn('right');
    expect(game.turns).toBe(1);
  });
});

describe('mode-specific scoring', () => {
  /** Score one identical clear under a given mode. */
  const scoreOneLine = (id: Parameters<typeof modeById>[0]): number => {
    const game = new Game({ seed: 'score', mode: modeById(id) });
    for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
    const before = game.score;
    game.hardDrop();
    for (let i = 0; i < 100 && game.status !== 'falling'; i += 1) game.tick(100);
    return game.score - before;
  };

  it('prices the risk each mode actually carries', () => {
    // Zen cannot be lost, so a Zen score must not stand beside a real one.
    expect(modeById('zen').scoreScale).toBeLessThan(1);
    // Blind Spectrum is the hardest thing the game asks of anyone.
    expect(modeById('blindSpectrum').scoreScale).toBeGreaterThan(1);
    expect(modeById('ascent').scoreScale).toBe(1);
  });

  it('applies the scale to a real clear, not just the table', () => {
    const ascent = scoreOneLine('ascent');
    const zen = scoreOneLine('zen');
    expect(ascent).toBeGreaterThan(0);
    expect(zen).toBeGreaterThan(0);
    expect(zen).toBeLessThan(ascent);
  });

  it("weights the turn's own clears in Prism and nowhere else", () => {
    expect(modeById('prism').refractionScale).toBeGreaterThan(1);
    for (const mode of MODES) {
      if (mode.id === 'prism') continue;
      expect(mode.refractionScale).toBe(1);
    }
  });

  it('never scores a mode at zero, however gentle', () => {
    for (const mode of MODES) expect(mode.scoreScale).toBeGreaterThan(0);
  });
});
