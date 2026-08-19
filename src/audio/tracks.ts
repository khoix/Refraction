/**
 * The music manifest.
 *
 * One entry per piece of music that ships. The URL comes from a `?url` import
 * rather than a hand-written path, so the file is content-hashed and emitted by
 * the bundler: a track that is renamed or removed breaks the build instead of
 * 404-ing in front of a player, and a cached copy is never a stale one.
 *
 * ## Only what plays today
 *
 * Six tracks sit in `tracks/`; one is imported. An `import.meta.glob` would pick
 * all six up in a line, and would also emit all six into `dist` -- nine and a
 * half megabytes of assets for the one that is currently reachable. Imports are
 * added here as the music that uses them lands.
 *
 * ## Streamed, not decoded
 *
 * `bytes` and `seconds` are recorded because both are load-bearing.
 *
 * `bytes` gives the preloader a denominator before the first response header
 * arrives, so the progress bar starts at a true zero rather than jumping once
 * `Content-Length` shows up.
 *
 * `seconds` is why this is played through an `<audio>` element rather than
 * decoded into an `AudioBuffer`. Decoded audio is float32 at the context's rate:
 * 137 seconds of stereo at 48 kHz is about 53 MB resident, for a file that is
 * 1.8 MB on disk. That is not a price a phone should pay for menu music, so the
 * element streams it and the compressed bytes are all that is held.
 *
 * The cost of that choice is the loop seam -- a `MediaElement` loop is not
 * sample-exact the way a buffer loop is. Accepted deliberately, and only for
 * music: it is the wrong trade for a sound effect, where the buffer is small and
 * the timing is the point.
 */

import themeUrl from './tracks/Blockfall Skyline (Theme).webm?url';

export interface Track {
  readonly id: string;
  /** Shown to the player. The file name is an implementation detail. */
  readonly title: string;
  readonly url: string;
  /** Approximate size, for progress before `Content-Length` is known. */
  readonly bytes: number;
  readonly seconds: number;
}

/** The menu theme. Plays on the front door and stops when a run begins. */
export const THEME: Track = {
  id: 'theme',
  title: 'Blockfall Skyline',
  url: themeUrl,
  bytes: 1_922_887,
  seconds: 137.2,
};
