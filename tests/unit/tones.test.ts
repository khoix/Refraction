import { describe, expect, it } from 'vitest';
import { DEPTH_LANES } from '@core/constants';
import {
  BASE_FREQUENCY,
  clearTones,
  gameOverTone,
  laneFrequency,
  lockTone,
  prismChord,
  turnSweep,
} from '../../src/audio/tones';

describe('depth is pitch', () => {
  it('rises from the near lane to the far one', () => {
    // The same direction the spectrum runs: red is the low end of the visible
    // range and violet the high end, so the sound climbs as the colour does.
    for (let lane = 1; lane < DEPTH_LANES; lane += 1) {
      expect(laneFrequency(lane)).toBeGreaterThan(laneFrequency(lane - 1));
    }
  });

  it('gives every lane its own pitch', () => {
    const pitches = new Set(
      Array.from({ length: DEPTH_LANES }, (_, lane) => laneFrequency(lane).toFixed(4))
    );
    expect(pitches.size).toBe(DEPTH_LANES);
  });

  it('stays in a sane register', () => {
    for (let lane = 0; lane < DEPTH_LANES; lane += 1) {
      const frequency = laneFrequency(lane);
      expect(frequency).toBeGreaterThan(BASE_FREQUENCY / 4);
      expect(frequency).toBeLessThan(BASE_FREQUENCY * 4);
    }
  });

  it('clamps lanes outside the board rather than producing nonsense', () => {
    expect(laneFrequency(-5)).toBe(laneFrequency(0));
    expect(laneFrequency(99)).toBe(laneFrequency(DEPTH_LANES - 1));
    expect(Number.isFinite(laneFrequency(3.4))).toBe(true);
  });
});

describe('clears', () => {
  it('plays one note per line cleared, up to four', () => {
    expect(clearTones(1, 0, 0)).toHaveLength(1);
    expect(clearTones(3, 0, 0)).toHaveLength(3);
    expect(clearTones(9, 0, 0)).toHaveLength(4);
    expect(clearTones(0, 0, 0)).toHaveLength(1);
  });

  it('climbs with each cascade step', () => {
    const first = clearTones(1, 0, 0)[0]!.frequency;
    const second = clearTones(1, 1, 0)[0]!.frequency;
    const third = clearTones(1, 2, 0)[0]!.frequency;
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('produces a rising arpeggio within one clear', () => {
    const tones = clearTones(4, 0, 0);
    for (let i = 1; i < tones.length; i += 1) {
      expect(tones[i]!.frequency).toBeGreaterThan(tones[i - 1]!.frequency);
    }
  });
});

describe('the turn', () => {
  it('sweeps opposite ways for opposite directions', () => {
    const right = turnSweep('right');
    const left = turnSweep('left');
    expect(left.from).toBeGreaterThan(left.to);
    expect(right.from).toBeLessThan(right.to);
    expect(left.from).toBe(right.to);
  });

  it('is over before the board finishes turning', () => {
    expect(turnSweep('right').duration).toBeLessThan(0.75);
  });
});

describe('Full Spectrum', () => {
  it('sounds every band at once, which is what makes it white', () => {
    const chord = prismChord();
    expect(chord).toHaveLength(DEPTH_LANES);
    expect(new Set(chord.map((tone) => tone.frequency)).size).toBe(DEPTH_LANES);
  });

  it('keeps the combined gain from clipping', () => {
    const total = prismChord().reduce((sum, tone) => sum + tone.gain, 0);
    expect(total).toBeLessThan(1);
  });

  it('rings longer than an ordinary clear', () => {
    expect(prismChord()[0]!.duration).toBeGreaterThan(clearTones(4, 0, 0)[0]!.duration);
  });
});

describe('every tone', () => {
  const all = [lockTone(0), lockTone(7), ...clearTones(4, 2, 3), ...prismChord(), gameOverTone()];

  it('is audible, finite and bounded', () => {
    for (const tone of all) {
      expect(tone.frequency).toBeGreaterThan(20);
      expect(tone.frequency).toBeLessThan(20_000);
      expect(tone.gain).toBeGreaterThan(0);
      expect(tone.gain).toBeLessThanOrEqual(0.5);
      expect(tone.duration).toBeGreaterThan(0);
      expect(tone.cutoff).toBeGreaterThan(tone.frequency / 2);
    }
  });

  it('keeps the lock sound short and quiet enough to hear over', () => {
    // It fires on every single piece, so it must never dominate.
    expect(lockTone(0).duration).toBeLessThan(0.2);
    expect(lockTone(0).gain).toBeLessThan(clearTones(1, 0, 0)[0]!.gain + 0.05);
  });
});
