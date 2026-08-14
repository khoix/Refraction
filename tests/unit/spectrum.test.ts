import { describe, expect, it } from 'vitest';
import {
  SPECTRUM_BAND_COUNT,
  SPECTRUM_STOPS,
  bandIndex,
  bandName,
  depthColor,
  depthColorBanded,
  depthColorHex,
  laneToDepthParameter,
  oklchToRgb,
  rgbToHex,
} from '@core/spectrum';
import type { Rgb } from '@core/types';

const channels = ({ r, g, b }: Rgb): number[] => [r, g, b];

const distance = (a: Rgb, b: Rgb): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

describe('spectrum ramp', () => {
  it('defines seven bands, near to far', () => {
    expect(SPECTRUM_BAND_COUNT).toBe(7);
    expect(SPECTRUM_STOPS.map((s) => s.name)).toEqual([
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Blue',
      'Indigo',
      'Violet',
    ]);
  });

  it('hue increases monotonically from red to violet', () => {
    for (let i = 1; i < SPECTRUM_STOPS.length; i += 1) {
      expect(SPECTRUM_STOPS[i]!.h).toBeGreaterThan(SPECTRUM_STOPS[i - 1]!.h);
    }
  });

  it('spaces the named bands evenly along the ramp', () => {
    SPECTRUM_STOPS.forEach((stop, index) => {
      expect(stop.t).toBeCloseTo(index / (SPECTRUM_BAND_COUNT - 1), 10);
    });
  });

  it('keeps every channel in gamut across the whole ramp', () => {
    for (let i = 0; i <= 200; i += 1) {
      for (const channel of channels(depthColor(i / 200))) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
        expect(Number.isFinite(channel)).toBe(true);
      }
    }
  });

  it('reads red at the near end and violet at the far end', () => {
    const near = depthColor(0);
    expect(near.r).toBeGreaterThan(near.g);
    expect(near.r).toBeGreaterThan(near.b);

    const far = depthColor(1);
    expect(far.b).toBeGreaterThan(far.g);
    expect(far.r).toBeGreaterThan(far.g); // violet keeps a red component
  });

  it('reads yellow in the middle of the ramp', () => {
    const yellow = depthColor(2 / (SPECTRUM_BAND_COUNT - 1));
    expect(yellow.r).toBeGreaterThan(0.7);
    expect(yellow.g).toBeGreaterThan(0.7);
    expect(yellow.b).toBeLessThan(yellow.g);
  });

  it('clamps out-of-range depths instead of throwing', () => {
    expect(depthColor(-5)).toEqual(depthColor(0));
    expect(depthColor(5)).toEqual(depthColor(1));
  });

  it('changes smoothly, with no visible seams at band boundaries', () => {
    const step = 1 / 512;
    let maxDelta = 0;
    for (let t = 0; t + step <= 1; t += step) {
      maxDelta = Math.max(maxDelta, distance(depthColor(t), depthColor(t + step)));
    }
    expect(maxDelta).toBeLessThan(0.03);
  });

  it('passes exactly through every named band', () => {
    for (const stop of SPECTRUM_STOPS) {
      expect(depthColor(stop.t)).toEqual(oklchToRgb(stop.l, stop.c, stop.h));
    }
  });

  it('maps out-of-gamut chroma to the gamut boundary rather than clipping channels', () => {
    // Two impossible chromas at the same lightness and hue must land on the same
    // boundary colour. Per-channel clipping would instead return two different
    // colours, both with a distorted hue.
    for (const hue of [28, 95, 150, 202, 252, 322]) {
      expect(rgbToHex(oklchToRgb(0.7, 0.5, hue))).toBe(rgbToHex(oklchToRgb(0.7, 0.9, hue)));
    }
  });

  it('is a genuine gradient, not seven flat plateaus', () => {
    const samples = Array.from({ length: 64 }, (_, i) => depthColorHex(i / 63));
    expect(new Set(samples).size).toBeGreaterThan(50);
  });

  it('is deterministic', () => {
    expect(depthColor(0.42)).toEqual(depthColor(0.42));
  });
});

describe('bands', () => {
  it('maps each stop to its own band', () => {
    for (let i = 0; i < SPECTRUM_BAND_COUNT; i += 1) {
      expect(bandIndex(i / (SPECTRUM_BAND_COUNT - 1))).toBe(i);
    }
  });

  it('names bands for HUD and screen-reader output', () => {
    expect(bandName(0)).toBe('Red');
    expect(bandName(1)).toBe('Violet');
  });

  it('banded mode snaps to exact stop colours', () => {
    const stop = SPECTRUM_STOPS[3]!;
    expect(depthColorBanded(3 / 6)).toEqual(oklchToRgb(stop.l, stop.c, stop.h));
  });

  it('banded mode yields exactly seven distinct colours', () => {
    const seen = new Set<string>();
    for (let i = 0; i <= 200; i += 1) {
      seen.add(rgbToHex(depthColorBanded(i / 200)));
    }
    expect(seen.size).toBe(SPECTRUM_BAND_COUNT);
  });
});

describe('lane mapping', () => {
  it('spreads eight lanes evenly across the ramp', () => {
    expect(laneToDepthParameter(0, 8)).toBe(0);
    expect(laneToDepthParameter(7, 8)).toBe(1);
    expect(laneToDepthParameter(3, 8)).toBeCloseTo(3 / 7, 10);
  });

  it('degrades safely for a single-lane board', () => {
    expect(laneToDepthParameter(0, 1)).toBe(0);
  });
});

describe('hex output', () => {
  it('formats six-digit lowercase hex', () => {
    expect(depthColorHex(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe('#ffffff');
  });

  it('clamps out-of-gamut input', () => {
    expect(rgbToHex({ r: 2, g: -1, b: 0.5 })).toBe('#ff0080');
  });
});
