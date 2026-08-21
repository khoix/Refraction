import { describe, expect, it } from 'vitest';
import {
  SFX,
  SPECTRAL_COLLAPSE,
  SPECTRAL_COLLAPSE_IMMINENT,
  playableSfxSource,
} from '../../src/audio/sfx';

const WEBM = 'audio/webm; codecs="opus"';
const MP4 = 'audio/mp4; codecs="mp4a.40.2"';

const says =
  (answers: Record<string, string>) =>
  (mime: string): string =>
    answers[mime] ?? '';

describe('SFX catalogue', () => {
  it('ships both Spectral Collapse samples', () => {
    expect(SFX.map((clip) => clip.id)).toEqual([
      SPECTRAL_COLLAPSE_IMMINENT.id,
      SPECTRAL_COLLAPSE.id,
    ]);
    for (const clip of [SPECTRAL_COLLAPSE_IMMINENT, SPECTRAL_COLLAPSE]) {
      expect(clip.sources[0]?.url.length).toBeGreaterThan(0);
      expect(clip.bytes).toBeGreaterThan(0);
    }
  });
});

describe('playableSfxSource', () => {
  it('takes WebM when the browser is sure of it', () => {
    const source = playableSfxSource(SPECTRAL_COLLAPSE, says({ [WEBM]: 'probably' }));
    expect(source?.mime).toBe(WEBM);
  });

  it('answers null when the device can play none of the encodings', () => {
    expect(playableSfxSource(SPECTRAL_COLLAPSE_IMMINENT, says({ [MP4]: 'probably' }))).toBeNull();
  });
});
