/**
 * Sampled sound effects.
 *
 * Same shape as the music manifest, on a smaller scale: URLs come from `?url`
 * imports so a renamed or missing file breaks the build, and approximate sizes
 * feed the front-door progress bar. Playback goes through the Web Audio graph
 * (decoded `AudioBuffer`), not a media element, so mute and volume reach these
 * the same way they reach the synthesised tones.
 */

import imminentWebm from './sfx/spectral_collapse_imminent.webm?url';
import collapseWebm from './sfx/collapse.webm?url';

const WEBM_OPUS = 'audio/webm; codecs="opus"';

export interface SfxSource {
  readonly url: string;
  readonly mime: string;
}

export interface SfxClip {
  readonly id: string;
  /** Encodings in preference order, best first. */
  readonly sources: readonly SfxSource[];
  /** Approximate size, for progress before `Content-Length` is known. */
  readonly bytes: number;
  readonly seconds: number;
}

export const SPECTRAL_COLLAPSE_IMMINENT: SfxClip = {
  id: 'spectral-collapse-imminent',
  sources: [{ url: imminentWebm, mime: WEBM_OPUS }],
  bytes: 36_950,
  seconds: 3.045,
};

export const SPECTRAL_COLLAPSE: SfxClip = {
  id: 'spectral-collapse',
  sources: [{ url: collapseWebm, mime: WEBM_OPUS }],
  bytes: 27_325,
  seconds: 2.684,
};

/** Every sampled effect the front door pulls down. */
export const SFX: readonly SfxClip[] = [SPECTRAL_COLLAPSE_IMMINENT, SPECTRAL_COLLAPSE];

export type CanPlay = (mime: string) => string;

function browserCanPlay(): CanPlay | null {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('audio');
  return (mime) => probe.canPlayType(mime);
}

/**
 * The encoding this browser says it can play, or null if it says none.
 *
 * Same decision as `playableSource` for music: prefer certainty, then order.
 */
export function playableSfxSource(clip: SfxClip, canPlay?: CanPlay): SfxSource | null {
  const rank = canPlay ?? browserCanPlay();
  if (!rank) return clip.sources[0] ?? null;
  return (
    clip.sources.find((source) => rank(source.mime) === 'probably') ??
    clip.sources.find((source) => rank(source.mime) === 'maybe') ??
    null
  );
}
