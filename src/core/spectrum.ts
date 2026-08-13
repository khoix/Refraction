/**
 * The spectrum depth system.
 *
 * Depth -- and only depth -- drives colour. A cube's colour is recomputed every
 * frame from its distance to the camera, so the same cube reads red from one
 * face and violet from the opposite one without ever moving.
 *
 * The ramp is defined in OKLCH and converted to sRGB. Interpolating in a
 * perceptual space matters here: a naive RGB or HSV lerp produces muddy,
 * uneven bands mid-turn, and the whole design depends on the player reading
 * small depth differences at a glance.
 */

import type { Rgb } from './types';

export interface SpectrumStop {
  readonly name: string;
  /** Position on the near-to-far ramp, 0..1. */
  readonly t: number;
  /** OKLCH lightness, 0..1 */
  readonly l: number;
  /** OKLCH chroma */
  readonly c: number;
  /** OKLCH hue in degrees */
  readonly h: number;
}

/** How many named bands the ramp is divided into. */
export const SPECTRUM_BAND_COUNT = 7;

const bandPosition = (index: number): number => index / (SPECTRUM_BAND_COUNT - 1);

/**
 * The seven named bands, near to far. These are what the HUD, the accessibility
 * readouts and the banded colour mode use, and the continuous ramp is
 * guaranteed to pass exactly through each one.
 */
export const SPECTRUM_STOPS: readonly SpectrumStop[] = [
  { name: 'Red', t: bandPosition(0), l: 0.635, c: 0.2, h: 28 },
  { name: 'Orange', t: bandPosition(1), l: 0.745, c: 0.178, h: 58 },
  { name: 'Yellow', t: bandPosition(2), l: 0.875, c: 0.168, h: 95 },
  { name: 'Green', t: bandPosition(3), l: 0.795, c: 0.168, h: 150 },
  { name: 'Blue', t: bandPosition(4), l: 0.66, c: 0.15, h: 252 },
  { name: 'Indigo', t: bandPosition(5), l: 0.53, c: 0.185, h: 289 },
  { name: 'Violet', t: bandPosition(6), l: 0.495, c: 0.21, h: 322 },
] as const;

/**
 * Unnamed control points that shape the path between named bands.
 *
 * Green sits at hue 150 and Blue at 252. Interpolating straight between them
 * races through cyan at a chroma that leaves the sRGB gamut, which shows up as
 * a visible kink mid-turn. Pinning an explicit lower-chroma cyan waypoint keeps
 * the whole ramp inside the gamut and evenly paced. It is deliberately unnamed:
 * the game still speaks in seven bands.
 */
const RAMP_WAYPOINTS: readonly Omit<SpectrumStop, 'name'>[] = [
  { t: 0.5833, l: 0.76, c: 0.118, h: 202 },
] as const;

const RAMP_POINTS: readonly Omit<SpectrumStop, 'name'>[] = [...SPECTRUM_STOPS, ...RAMP_WAYPOINTS]
  .map(({ t, l, c, h }) => ({ t, l, c, h }))
  .sort((a, b) => a.t - b.t);

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** OKLab -> linear sRGB. */
function oklabToLinearSrgb(lightness: number, a: number, b: number): [number, number, number] {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear sRGB channel -> gamma-encoded sRGB channel. */
function encodeSrgbChannel(value: number): number {
  const v = clamp01(value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const GAMUT_EPSILON = 1e-6;

function linearSrgbInGamut([r, g, b]: [number, number, number]): boolean {
  return (
    r >= -GAMUT_EPSILON &&
    r <= 1 + GAMUT_EPSILON &&
    g >= -GAMUT_EPSILON &&
    g <= 1 + GAMUT_EPSILON &&
    b >= -GAMUT_EPSILON &&
    b <= 1 + GAMUT_EPSILON
  );
}

/**
 * Largest chroma at this lightness and hue that still fits in sRGB.
 *
 * Clamping channels individually is the obvious approach and it is wrong here:
 * it distorts hue and introduces a visible seam wherever the ramp leaves the
 * gamut, which is exactly the artefact that would make a player misread depth.
 * Reducing chroma keeps hue and lightness intact and keeps the ramp continuous.
 */
function gamutMapChroma(l: number, c: number, hRadians: number): number {
  const cos = Math.cos(hRadians);
  const sin = Math.sin(hRadians);
  const fits = (chroma: number): boolean =>
    linearSrgbInGamut(oklabToLinearSrgb(l, chroma * cos, chroma * sin));

  if (fits(c)) return c;

  let low = 0;
  let high = c;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** Convert an OKLCH triple to gamma-encoded sRGB, gamut-mapped by chroma. */
export function oklchToRgb(l: number, c: number, hDegrees: number): Rgb {
  const lightness = clamp01(l);
  const h = (hDegrees * Math.PI) / 180;
  const chroma = gamutMapChroma(lightness, Math.max(0, c), h);
  const [lr, lg, lb] = oklabToLinearSrgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  return { r: encodeSrgbChannel(lr), g: encodeSrgbChannel(lg), b: encodeSrgbChannel(lb) };
}

/**
 * Continuous spectrum colour for a normalised depth.
 * `t` = 0 is nearest the camera (red), `t` = 1 is farthest (violet).
 */
export function depthColor(t: number): Rgb {
  const clamped = clamp01(t);
  let index = 0;
  while (index < RAMP_POINTS.length - 2 && clamped > (RAMP_POINTS[index + 1] as SpectrumStop).t) {
    index += 1;
  }
  const a = RAMP_POINTS[index] as SpectrumStop;
  const b = RAMP_POINTS[index + 1] as SpectrumStop;
  const span = b.t - a.t;
  const frac = span === 0 ? 0 : (clamped - a.t) / span;
  return oklchToRgb(lerp(a.l, b.l, frac), lerp(a.c, b.c, frac), lerp(a.h, b.h, frac));
}

/** Which of the seven named bands a normalised depth falls into. */
export function bandIndex(t: number): number {
  const scaled = clamp01(t) * (SPECTRUM_BAND_COUNT - 1);
  return Math.min(Math.round(scaled), SPECTRUM_BAND_COUNT - 1);
}

/** Band name for a normalised depth, e.g. for HUD readouts and screen readers. */
export function bandName(t: number): string {
  return (SPECTRUM_STOPS[bandIndex(t)] as SpectrumStop).name;
}

/** Hard-quantised colour, used by the high-contrast / banded accessibility mode. */
export function depthColorBanded(t: number): Rgb {
  const stop = SPECTRUM_STOPS[bandIndex(t)] as SpectrumStop;
  return oklchToRgb(stop.l, stop.c, stop.h);
}

/** Normalised depth for a discrete lane index. */
export function laneToDepthParameter(lane: number, laneCount: number): number {
  if (laneCount <= 1) return 0;
  return clamp01(lane / (laneCount - 1));
}

/**
 * Apparent-size multiplier for a cube at normalised depth `t`.
 * Near cubes are drawn slightly larger than far ones so silhouettes stay
 * readable and stacked cubes never fully hide the ones behind them.
 */
export const NEAR_CUBE_SCALE = 1;
export const FAR_CUBE_SCALE = 0.74;

export function depthScale(t: number): number {
  return lerp(NEAR_CUBE_SCALE, FAR_CUBE_SCALE, clamp01(t));
}

/** `#rrggbb` for a normalised depth. */
export function depthColorHex(t: number): string {
  return rgbToHex(depthColor(t));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number): string =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
