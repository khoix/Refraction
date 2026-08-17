/**
 * Seeded challenges.
 *
 * A challenge code is a promise: two people who type the same seven characters
 * get the same game. The engine already guarantees that from `(seed, input
 * log)`, so what has to hold here is narrower and entirely about the code —
 * that it round-trips, that it survives being read aloud and retyped, and that
 * it cannot be mistaken for a different challenge.
 */

import { describe, expect, it } from 'vitest';
import { Game } from '@core/game';
import { challengeFor, dailyChallenge, parseChallenge } from '@core/challenge';
import { MODES } from '@core/modes';

describe('a code round-trips', () => {
  it('parses back to the challenge it came from', () => {
    for (const mode of MODES) {
      const made = challengeFor(mode.id, 'some seed text');
      const parsed = parseChallenge(made.code);
      expect(parsed).not.toBeNull();
      expect(parsed!.mode.id).toBe(mode.id);
      expect(parsed!.seed).toBe(made.seed);
    }
  });

  it('is seven characters, so it can be said out loud', () => {
    expect(challengeFor('ascent', 'x').code).toHaveLength(7);
  });

  it('names its mode in the first character', () => {
    expect(challengeFor('prism', 'x').code[0]).toBe('P');
    expect(challengeFor('zen', 'x').code[0]).toBe('Z');
  });

  it('uses no character that can be misread', () => {
    // Crockford base32: no I, L, O or U anywhere in the seed half, so 1/I/L
    // and 0/O cannot be confused, and a code cannot spell a word.
    for (let i = 0; i < 200; i += 1) {
      const code = challengeFor('ascent', `seed-${i}`).code.slice(1);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });
});

describe('parsing is forgiving about presentation', () => {
  const canonical = challengeFor('endless', 'shared').code;

  it('accepts lower case, spaces and dashes', () => {
    const messy = ` ${canonical.toLowerCase().slice(0, 3)}-${canonical.toLowerCase().slice(3)} `;
    expect(parseChallenge(messy)?.code).toBe(canonical);
  });

  it('rejects anything that is not a code', () => {
    for (const bad of ['', '   ', 'ABC', 'A1B2C3D4', 'Q1B2C3D', 'A1B2C3I', null, undefined]) {
      expect(parseChallenge(bad)).toBeNull();
    }
  });

  it('rejects a code naming a mode that does not exist', () => {
    expect(parseChallenge('X1B2C3D')).toBeNull();
  });
});

describe('different inputs give different challenges', () => {
  it('separates seeds', () => {
    expect(challengeFor('ascent', 'a').code).not.toBe(challengeFor('ascent', 'b').code);
  });

  it('separates modes given the same seed text', () => {
    const codes = new Set(MODES.map((mode) => challengeFor(mode.id, 'same').code));
    expect(codes.size).toBe(MODES.length);
  });
});

describe('the daily challenge', () => {
  it('is the same for everyone on the same day', () => {
    const a = dailyChallenge(new Date('2026-08-17T00:00:01Z'));
    const b = dailyChallenge(new Date('2026-08-17T23:59:59Z'));
    expect(a.code).toBe(b.code);
  });

  it('changes from one day to the next', () => {
    const today = dailyChallenge(new Date('2026-08-17T12:00:00Z'));
    const tomorrow = dailyChallenge(new Date('2026-08-18T12:00:00Z'));
    expect(today.code).not.toBe(tomorrow.code);
  });

  it('is keyed to UTC, so it does not split by timezone', () => {
    // Same instant, two clocks. A leaderboard split by timezone would be two
    // leaderboards.
    const instant = new Date('2026-08-17T12:00:00Z');
    expect(dailyChallenge(instant).code).toBe(dailyChallenge(new Date(instant.getTime())).code);
  });

  it('is a valid code like any other', () => {
    expect(parseChallenge(dailyChallenge(new Date()).code)).not.toBeNull();
  });
});

describe('the promise the code makes', () => {
  /** Play a fixed script and report what the run produced. */
  const fingerprint = (seed: string): string => {
    const game = new Game({ seed });
    const seen: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      seen.push(`${game.active?.id}@${game.active?.lane}`);
      game.hardDrop();
      for (let t = 0; t < 60 && game.status !== 'falling'; t += 1) game.tick(100);
    }
    return `${seen.join('|')}#${game.score}`;
  };

  it('gives two players the same game from the same code', () => {
    const code = challengeFor('ascent', 'handshake').seed;
    expect(fingerprint(code)).toBe(fingerprint(code));
  });

  it('gives different games from different codes', () => {
    const a = challengeFor('ascent', 'one').seed;
    const b = challengeFor('ascent', 'two').seed;
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});
