/**
 * Choosing an encoding.
 *
 * This is the decision that made the game silent on a phone while playing fine
 * on the laptop next to it, so it is worth testing at the level of "what does
 * this device say" rather than by loading a file and listening. Each case here
 * is a real class of browser.
 */

import { describe, expect, it } from 'vitest';
import { THEME, playableSource } from '../../src/audio/tracks';
import type { Track } from '../../src/audio/tracks';

const WEBM = 'audio/webm; codecs="opus"';
const MP4 = 'audio/mp4; codecs="mp4a.40.2"';

const track: Track = {
  id: 'test',
  title: 'Test',
  sources: [
    { url: '/a.webm', mime: WEBM },
    { url: '/a.m4a', mime: MP4 },
  ],
  bytes: 1000,
  seconds: 10,
};

/** A browser that answers `answers[mime]`, and `''` for anything else. */
const says =
  (answers: Record<string, string>) =>
  (mime: string): string =>
    answers[mime] ?? '';

describe('playableSource', () => {
  it('takes the preferred encoding when the browser is sure of it', () => {
    const source = playableSource(track, says({ [WEBM]: 'probably', [MP4]: 'probably' }));
    expect(source?.mime).toBe(WEBM);
  });

  it('prefers certainty over the manifest order', () => {
    // Safari's shape: hedging about WebM, sure about MP4. Following the order
    // here would hand it the encoding it is least confident about, which is the
    // one most likely to end in silence.
    const source = playableSource(track, says({ [WEBM]: 'maybe', [MP4]: 'probably' }));
    expect(source?.mime).toBe(MP4);
  });

  it('falls back to the alternate when the preferred one is refused outright', () => {
    const source = playableSource(track, says({ [MP4]: 'probably' }));
    expect(source?.mime).toBe(MP4);
  });

  it('answers null when the device can play none of them', () => {
    // Mobile WebKit with no alternate shipped. Null rather than the first
    // source: a caller that fetches two megabytes it cannot decode has spent
    // the bandwidth and still has no music.
    expect(playableSource(track, says({}))).toBeNull();
  });

  it('uses the order among equally hedged answers', () => {
    const source = playableSource(track, says({ [WEBM]: 'maybe', [MP4]: 'maybe' }));
    expect(source?.mime).toBe(WEBM);
  });

  it('ships a theme whose every source declares its codec', () => {
    // `canPlayType` on a bare container answers 'maybe' for almost anything, so
    // a mime without a codec parameter silently disables the whole mechanism.
    expect(THEME.sources.length).toBeGreaterThan(0);
    for (const source of THEME.sources) {
      expect(source.mime).toMatch(/codecs=/);
      expect(source.url).toBeTruthy();
    }
  });
});
