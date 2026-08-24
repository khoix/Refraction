/**
 * Seeded challenges.
 *
 * A challenge is a `(mode, seed)` pair the player can carry around as a short
 * string. Two people entering the same code get bit-identical runs -- the same
 * pieces, in the same lanes, in the same orientations -- because the engine is
 * already fully determined by `(seed, input log)`. Nothing new has to be
 * guaranteed here; the code is just a way of naming a seed out loud.
 *
 * The daily challenge is the same machinery with the date as the seed, so it
 * needs no server, no clock authority, and no storage: every copy of the game
 * derives the same code for the same day on its own.
 *
 * Pure: no clock of its own, no storage, no DOM. The caller supplies the date.
 */

import { MODES, modeById } from './modes';
import type { ModeConfig, ModeId } from './modes';

export interface Challenge {
  readonly mode: ModeConfig;
  readonly seed: string;
  /** The shareable code this challenge round-trips through. */
  readonly code: string;
}

/**
 * Alphabet for the seed half of a code.
 *
 * Crockford base32: no `I`, `L`, `O` or `U`, so a code cannot be misread
 * between 1/I/L or 0/O, and cannot accidentally spell anything.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Short prefixes, so a code names its mode without spelling it out. */
const MODE_CODE: Record<ModeId, string> = {
  ascent: 'A',
  endless: 'E',
  prism: 'P',
  flatland: 'F',
  blindSpectrum: 'B',
  zen: 'Z',
};

const MODE_BY_CODE = new Map<string, ModeId>(
  Object.entries(MODE_CODE).map(([id, code]) => [code, id as ModeId])
);

/** Deterministic 32-bit hash. Same construction as the RNG's seeding. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Render a 32-bit value as six base32 characters. */
function encodeSeed(value: number): string {
  let remaining = value >>> 0;
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out = (ALPHABET[remaining % 32] as string) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

/**
 * Build a challenge from a mode and any seed text.
 *
 * The seed stored on the challenge is the *code itself*, not the text handed
 * in. That is what makes a code round-trip: decoding a code cannot recover the
 * original text, so the run has to be seeded by something the code determines.
 */
export function challengeFor(mode: ModeId, seedText: string): Challenge {
  const code = `${MODE_CODE[mode] ?? 'A'}${encodeSeed(hash(`${mode}:${seedText}`))}`;
  return { mode: modeById(mode), seed: code, code };
}

/**
 * Parse a code back into a challenge, or null if it is not one.
 *
 * Deliberately forgiving about presentation -- case, spaces and dashes are all
 * stripped -- because a code is something people read aloud and retype.
 */
export function parseChallenge(raw: string | null | undefined): Challenge | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (cleaned.length !== 7) return null;

  const modeId = MODE_BY_CODE.get(cleaned[0] as string);
  if (!modeId) return null;
  for (const character of cleaned.slice(1)) {
    if (!ALPHABET.includes(character)) return null;
  }
  return { mode: modeById(modeId), seed: cleaned, code: cleaned };
}

/**
 * The challenge for a given day, in UTC.
 *
 * UTC rather than local time so that "today's challenge" names the same run
 * everywhere -- a leaderboard split by timezone would be two leaderboards.
 */
export function dailyChallenge(now: Date, mode: ModeId = 'ascent'): Challenge {
  const day = now.toISOString().slice(0, 10);
  return challengeFor(mode, `daily:${day}`);
}

/** Every mode a challenge code may name. */
export function challengeModes(): readonly ModeConfig[] {
  return MODES;
}
