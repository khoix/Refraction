/**
 * What the game sounds like, as pure data.
 *
 * The decisions -- which pitch, which envelope, how loud -- live here, with no
 * WebAudio in sight, so they can be reasoned about and tested. `audio.ts` is
 * the thin layer that actually makes noise.
 *
 * The central idea mirrors the visual one: **depth is pitch**. A cube's lane
 * chooses its note, so the board sounds the way it looks, and a player who is
 * still learning to read the spectrum gets a second, redundant channel for it.
 */

import { DEPTH_LANES } from '@core/constants';

/** Semitone offsets of a minor pentatonic scale, which has no harsh intervals. */
const PENTATONIC = [0, 3, 5, 7, 10] as const;

/** A4. Everything is derived from here. */
export const BASE_FREQUENCY = 440;

export interface ToneSpec {
  /** Hertz. */
  readonly frequency: number;
  /** Seconds. */
  readonly duration: number;
  /** Peak gain, 0..1. */
  readonly gain: number;
  readonly type: OscillatorType;
  /** Low-pass cutoff in hertz. */
  readonly cutoff: number;
}

function semitone(steps: number): number {
  return BASE_FREQUENCY * Math.pow(2, steps / 12);
}

/**
 * Pitch for a depth lane.
 *
 * Near lanes are low and far lanes are high. That direction is a choice, and it
 * is the one that matches the spectrum: red sits at the low end of the visible
 * range and violet at the high end, so the sound rises exactly as the colour
 * does. Lanes walk the pentatonic scale so no two adjacent lanes clash.
 */
export function laneFrequency(lane: number, laneCount = DEPTH_LANES): number {
  const clamped = Math.min(Math.max(Math.round(lane), 0), laneCount - 1);
  const octave = Math.floor(clamped / PENTATONIC.length);
  const degree = PENTATONIC[clamped % PENTATONIC.length] as number;
  return semitone(degree + octave * 12 - 12);
}

/** A piece coming to rest. Short, soft, pitched by its nearest lane. */
export function lockTone(lane: number): ToneSpec {
  return {
    frequency: laneFrequency(lane),
    duration: 0.12,
    gain: 0.16,
    type: 'triangle',
    cutoff: 2600,
  };
}

/**
 * A line clearing. Louder and longer the more lines went at once, and brighter
 * with each cascade step so a chain audibly climbs.
 */
export function clearTones(lines: number, cascade: number, lane: number): ToneSpec[] {
  const lift = Math.min(cascade, 4) * 2;
  const count = Math.min(Math.max(lines, 1), 4);
  return Array.from({ length: count }, (_, i) => ({
    frequency: laneFrequency(lane + i * 2) * Math.pow(2, lift / 12),
    duration: 0.26 + 0.05 * i,
    gain: 0.14,
    type: 'sine' as OscillatorType,
    cutoff: 5200,
  }));
}

/** The board turning: a filtered sweep, direction-coloured. */
export function turnSweep(direction: 'left' | 'right'): {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly gain: number;
} {
  const low = semitone(-24);
  const high = semitone(-5);
  return {
    from: direction === 'right' ? high : low,
    to: direction === 'right' ? low : high,
    duration: 0.62,
    gain: 0.1,
  };
}

/**
 * Full Spectrum. Every band at once, which is the audible form of the same
 * metaphor the visuals use: the whole spectrum together makes white.
 */
export function prismChord(): ToneSpec[] {
  return Array.from({ length: DEPTH_LANES }, (_, lane) => ({
    frequency: laneFrequency(lane),
    duration: 1.5,
    gain: 0.075,
    type: 'sine' as OscillatorType,
    cutoff: 7000,
  }));
}

/** The run ending. A single low fall. */
export function gameOverTone(): ToneSpec {
  return {
    frequency: semitone(-29),
    duration: 1.1,
    gain: 0.18,
    type: 'sawtooth',
    cutoff: 900,
  };
}
