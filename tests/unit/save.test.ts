/**
 * Persistence.
 *
 * The exit criterion for this milestone is that "a corrupt or outdated save is
 * recovered from, never crashed on", so most of this file is hostile input.
 * `migrate` is the one function in the codebase that takes genuinely unknown
 * data -- whatever happened to be in `localStorage` -- and it has exactly one
 * hard rule: it never throws, and it always returns something playable.
 */

import { describe, expect, it } from 'vitest';
import { MODES } from '@core/modes';
import {
  DEFAULT_SETTINGS,
  SAVE_VERSION,
  SESSION_LOG_LIMIT,
  defaultSave,
  isPersonalBest,
  migrate,
  recordRun,
  withSettings,
} from '@core/save';
import type { RunOutcome, SaveData } from '@core/save';

const outcome = (overrides: Partial<RunOutcome> = {}): RunOutcome => ({
  mode: 'ascent',
  score: 1000,
  lines: 12,
  stage: 2,
  turns: 3,
  prisms: 0,
  ...overrides,
});

/** Every property the rest of the game reads off a save, present and sane. */
function expectPlayable(save: SaveData): void {
  expect(save.version).toBe(SAVE_VERSION);
  expect(typeof save.settings.muted).toBe('boolean');
  expect(save.settings.volume).toBeGreaterThanOrEqual(0);
  expect(save.settings.volume).toBeLessThanOrEqual(1);
  expect(MODES.some((mode) => mode.id === save.lastMode)).toBe(true);
  for (const mode of MODES) {
    const record = save.records[mode.id];
    expect(record).toBeDefined();
    expect(Number.isFinite(record.bestScore)).toBe(true);
    expect(record.bestScore).toBeGreaterThanOrEqual(0);
  }
  expect(Number.isFinite(save.stats.bestStage)).toBe(true);
}

describe('a fresh save', () => {
  it('is playable and empty', () => {
    const save = defaultSave();
    expectPlayable(save);
    expect(save.stats.runs).toBe(0);
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('has a record slot for every mode', () => {
    expect(Object.keys(defaultSave().records).sort()).toEqual(MODES.map((m) => m.id).sort());
  });
});

describe('migrate never crashes', () => {
  const hostile: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a bare string', 'not json at all'],
    ['truncated json', '{"settings":{"muted":tr'],
    ['an array', [1, 2, 3]],
    ['json null', 'null'],
    ['an empty object', {}],
    ['a string of json array', '[]'],
    ['settings of the wrong type', { settings: 'loud' }],
    ['records of the wrong type', { records: 7 }],
    ['stats of the wrong type', { stats: [] }],
    ['nested nulls', { settings: null, records: null, stats: null, lastMode: null }],
    ['NaN volume', { settings: { volume: NaN } }],
    ['Infinity score', { records: { ascent: { bestScore: Infinity } } }],
    ['negative everything', { records: { ascent: { bestScore: -5, runs: -3 } } }],
    ['a mode that no longer exists', { records: { atlantis: { bestScore: 99 } } }],
    ['lastMode naming a dead mode', { lastMode: 'atlantis' }],
    ['a function-shaped payload', { settings: { muted: {} } }],
    ['deeply wrong nesting', { records: { ascent: [1, 2] } }],
  ];

  for (const [label, input] of hostile) {
    it(`survives ${label}`, () => {
      const save = migrate(input);
      expectPlayable(save);
    });
  }

  it('keeps what it can rather than discarding the whole file', () => {
    // The settings block is nonsense but the scores are fine. Losing the scores
    // as collateral would be the easy implementation and the wrong one.
    const save = migrate({
      settings: 'corrupt',
      records: { ascent: { bestScore: 5000, bestLines: 40, bestStage: 3, runs: 2 } },
    });
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
    expect(save.records.ascent.bestScore).toBe(5000);
    expect(save.records.ascent.runs).toBe(2);
  });

  it('drops a mode that no longer exists instead of resurrecting it', () => {
    const save = migrate({ records: { atlantis: { bestScore: 99 } } });
    expect(Object.keys(save.records).sort()).toEqual(MODES.map((m) => m.id).sort());
  });

  it('clamps rather than trusting out-of-range numbers', () => {
    const save = migrate({
      settings: { volume: 40 },
      records: { ascent: { bestScore: -100, runs: -2 } },
    });
    expect(save.settings.volume).toBe(1);
    expect(save.records.ascent.bestScore).toBe(0);
    expect(save.records.ascent.runs).toBe(0);
  });

  it('accepts a JSON string as readily as an object', () => {
    const written = JSON.stringify(recordRun(defaultSave(), outcome({ score: 777 })));
    expect(migrate(written).records.ascent.bestScore).toBe(777);
  });

  it('round-trips a real save without losing anything', () => {
    const original = withSettings(recordRun(defaultSave(), outcome({ score: 4200 })), {
      volume: 0.25,
      bloom: false,
    });
    expect(migrate(JSON.stringify(original))).toEqual(original);
  });

  it('stamps the current version onto an older file', () => {
    expect(migrate({ version: 1, records: {} }).version).toBe(SAVE_VERSION);
  });
});

describe('unlock state cannot be lost by a damaged stats block', () => {
  it('rebuilds the best stage from the per-mode records', () => {
    // Unlocks hang off `bestStage`. If a torn write loses the stats block, a
    // player who has already earned Blind Spectrum must not have it taken back.
    const save = migrate({
      stats: 'gone',
      records: { prism: { bestScore: 10, bestLines: 3, bestStage: 6, runs: 1 } },
    });
    expect(save.stats.bestStage).toBe(6);
  });

  it('takes the higher of the stated and the proven best', () => {
    const stated = migrate({
      stats: { bestStage: 9 },
      records: { prism: { bestStage: 4 } },
    });
    expect(stated.stats.bestStage).toBe(9);
  });
});

describe('recording a run', () => {
  it('keeps the best of each measure rather than the latest', () => {
    let save = recordRun(defaultSave(), outcome({ score: 5000, lines: 40, stage: 5 }));
    save = recordRun(save, outcome({ score: 100, lines: 2, stage: 1 }));

    expect(save.records.ascent.bestScore).toBe(5000);
    expect(save.records.ascent.bestLines).toBe(40);
    expect(save.records.ascent.bestStage).toBe(5);
    expect(save.records.ascent.runs).toBe(2);
  });

  it('accumulates lifetime totals rather than replacing them', () => {
    let save = recordRun(defaultSave(), outcome({ lines: 10, turns: 2, prisms: 1 }));
    save = recordRun(save, outcome({ lines: 5, turns: 3, prisms: 0 }));

    expect(save.stats.runs).toBe(2);
    expect(save.stats.lines).toBe(15);
    expect(save.stats.turns).toBe(5);
    expect(save.stats.prisms).toBe(1);
  });

  it('keeps modes apart', () => {
    let save = recordRun(defaultSave(), outcome({ mode: 'ascent', score: 900 }));
    save = recordRun(save, outcome({ mode: 'zen', score: 50 }));

    expect(save.records.ascent.bestScore).toBe(900);
    expect(save.records.zen.bestScore).toBe(50);
    expect(save.records.prism.runs).toBe(0);
  });

  it('remembers the mode last played, so the menu opens where it left off', () => {
    expect(recordRun(defaultSave(), outcome({ mode: 'flatland' })).lastMode).toBe('flatland');
  });

  it('does not mutate the save it was given', () => {
    const before = defaultSave();
    const snapshot = JSON.parse(JSON.stringify(before)) as SaveData;
    recordRun(before, outcome({ score: 9999 }));
    expect(before).toEqual(snapshot);
  });

  it('recognises a personal best only when it is one', () => {
    const save = recordRun(defaultSave(), outcome({ score: 1000 }));
    expect(isPersonalBest(save, outcome({ score: 1001 }))).toBe(true);
    expect(isPersonalBest(save, outcome({ score: 1000 }))).toBe(false);
    expect(isPersonalBest(save, outcome({ score: 10 }))).toBe(false);
    // A first run in an untouched mode counts, as long as it scored at all.
    expect(isPersonalBest(save, outcome({ mode: 'zen', score: 1 }))).toBe(true);
  });
});

describe('settings', () => {
  it('patches only what it is given', () => {
    const save = withSettings(defaultSave(), { muted: true });
    expect(save.settings.muted).toBe(true);
    expect(save.settings.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('leaves scores and stats alone', () => {
    const played = recordRun(defaultSave(), outcome({ score: 321 }));
    expect(withSettings(played, { bloom: false }).records).toEqual(played.records);
  });
});

describe('the session log', () => {
  it('keeps the last few runs, newest first', () => {
    let save = defaultSave();
    for (let i = 1; i <= 3; i += 1) save = recordRun(save, outcome({ score: i * 100 }));
    expect(save.session.map((run) => run.score)).toEqual([300, 200, 100]);
  });

  it('is capped, so a long sitting cannot grow the save without bound', () => {
    let save = defaultSave();
    for (let i = 0; i < SESSION_LOG_LIMIT + 8; i += 1) {
      save = recordRun(save, outcome({ score: i }));
    }
    expect(save.session).toHaveLength(SESSION_LOG_LIMIT);
    // The newest survived and the oldest fell off.
    expect(save.session[0]!.score).toBe(SESSION_LOG_LIMIT + 7);
  });

  it('remembers the challenge a run was played under', () => {
    const save = recordRun(defaultSave(), outcome({ challenge: 'A1B2C3D' }));
    expect(save.session[0]!.challenge).toBe('A1B2C3D');
  });

  it('omits the code entirely for an ordinary run', () => {
    const save = recordRun(defaultSave(), outcome());
    expect(save.session[0]!.challenge).toBeUndefined();
  });

  it('drops a damaged entry rather than inventing a run', () => {
    // A log is decoration, not a record of achievement. Repairing a broken
    // entry would put a run on the board that never happened.
    const save = migrate({
      session: [
        { mode: 'ascent', score: 500, lines: 4, stage: 1 },
        { mode: 'atlantis', score: 999 },
        'nonsense',
        { score: 12 },
      ],
    });
    expect(save.session).toHaveLength(1);
    expect(save.session[0]!.score).toBe(500);
  });

  it('survives a session that is not an array at all', () => {
    expectPlayable(migrate({ session: 'gone' }));
    expect(migrate({ session: 'gone' }).session).toEqual([]);
  });
});
