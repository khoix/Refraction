/**
 * The music manifest.
 *
 * One entry per piece of music that ships. URLs come from `?url` imports rather
 * than hand-written paths, so files are content-hashed and emitted by the
 * bundler: a track that is renamed or removed breaks the build instead of
 * 404-ing in front of a player, and a cached copy is never a stale one.
 *
 * ## More than one encoding of the same music
 *
 * WebM/Opus is the right primary: it is the format whose loop metadata is exact
 * and whose bitrate goes furthest. It is not universal. Safari only learned
 * Opus-in-WebM recently and mobile WebKit is further behind than the desktop, so
 * a track that plays perfectly on a laptop can be undecodable on the phone next
 * to it -- and a media element that cannot decode its source does not announce
 * itself, it simply never makes a sound.
 *
 * So a track is a *list* of encodings and the browser is asked which it can
 * play. Alternates are discovered by glob rather than imported one by one: drop
 * `Blockfall Skyline (Theme).m4a` next to the `.webm` and it is picked up with
 * no code change, and while no such file exists the glob matches nothing and
 * nothing extra is emitted.
 *
 * To make one:
 *
 *     ffmpeg -i "Blockfall Skyline (Theme).webm" -c:a aac -b:a 128k \
 *            -movflags +faststart "Blockfall Skyline (Theme).m4a"
 *
 * ## Streamed, not decoded
 *
 * `bytes` and `seconds` are recorded because both are load-bearing.
 *
 * `bytes` gives the preloader a denominator before the first response header
 * arrives, so the progress bar starts at a true zero rather than jumping once
 * `Content-Length` shows up. Being wrong for an alternate encoding costs
 * smoothness and never correctness.
 *
 * `seconds` is why this is played through an `<audio>` element rather than
 * decoded into an `AudioBuffer`. Decoded audio is float32 at the context's rate:
 * 137 seconds of stereo at 48 kHz is about 53 MB resident, for a file that is
 * 1.8 MB on disk.
 */

import themeWebm from './tracks/Blockfall Skyline (Theme).webm?url';
import blockDriftWebm from './tracks/Block Drift.webm?url';
import blockfallReduxWebm from './tracks/Blockfall Redux.webm?url';
import colorfulShoresWebm from './tracks/Colorful Shores.webm?url';
import stackUpWebm from './tracks/Stack Up.webm?url';
import turnItOutWebm from './tracks/Turn It Out.webm?url';

/** One encoding of one track. */
export interface Source {
  readonly url: string;
  /** Passed to `canPlayType`, so it carries the codec as well as the container. */
  readonly mime: string;
}

export interface Track {
  readonly id: string;
  /** Shown to the player. The file name is an implementation detail. */
  readonly title: string;
  /** Credited on the in-run LCD. */
  readonly artist: string;
  /** Encodings in preference order, best first. */
  readonly sources: readonly Source[];
  /** Approximate size, for progress before `Content-Length` is known. */
  readonly bytes: number;
  readonly seconds: number;
}

const WEBM_OPUS = 'audio/webm; codecs="opus"';
const MP4_AAC = 'audio/mp4; codecs="mp4a.40.2"';

/**
 * Alternate encodings, if any have been added.
 *
 * Keyed by path. Matches nothing today, which is exactly what it should do until
 * someone drops a file in.
 */
const alternates = import.meta.glob('./tracks/*.m4a', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function alternate(name: string): Source[] {
  const url = alternates[`./tracks/${name}.m4a`];
  return url ? [{ url, mime: MP4_AAC }] : [];
}

function track(
  id: string,
  title: string,
  file: string,
  url: string,
  bytes: number,
  seconds: number,
  artist = 'Refraction'
): Track {
  return {
    id,
    title,
    artist,
    sources: [{ url, mime: WEBM_OPUS }, ...alternate(file)],
    bytes,
    seconds,
  };
}

/** The menu theme. Loops on the main menu; the boot gate stays silent. */
export const THEME: Track = track(
  'theme',
  'Blockfall Skyline',
  'Blockfall Skyline (Theme)',
  themeWebm,
  1_922_887,
  137.2
);

/**
 * Everything that is not the theme.
 *
 * A run draws from this pool at random, one track after another, until the
 * player is back on a menu screen.
 */
export const GAMEPLAY: readonly Track[] = [
  track('block-drift', 'Block Drift', 'Block Drift', blockDriftWebm, 1_856_389, 139.9),
  track('blockfall-redux', 'Blockfall Redux', 'Blockfall Redux', blockfallReduxWebm, 1_599_926, 114.0),
  track('colorful-shores', 'Colorful Shores', 'Colorful Shores', colorfulShoresWebm, 1_778_825, 128.0),
  track('stack-up', 'Stack Up', 'Stack Up', stackUpWebm, 1_364_633, 108.4),
  track('turn-it-out', 'Turn It Out', 'Turn It Out', turnItOutWebm, 1_396_870, 109.8),
];

/** Every track the front door pulls down. */
export const TRACKS: readonly Track[] = [THEME, ...GAMEPLAY];

/** Look up a catalogue entry by id. */
export function trackById(id: string): Track | undefined {
  return TRACKS.find((entry) => entry.id === id);
}

/** What a browser says about a MIME type: `''`, `'maybe'` or `'probably'`. */
export type CanPlay = (mime: string) => string;

/** The real probe. A detached element, created once per call and thrown away. */
function browserCanPlay(): CanPlay | null {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('audio');
  return (mime) => probe.canPlayType(mime);
}

/**
 * The encoding this browser says it can play, or null if it says none of them.
 *
 * The three-valued answer is worth honouring rather than collapsing to a
 * boolean: a browser that is *sure* about one encoding and hedging about another
 * should be given the one it is sure about, whatever the preference order says.
 * Only among equally-confident answers does the order decide.
 *
 * Null is a real answer and callers must handle it. Returning the first source
 * regardless would turn "this device can play none of these" into silence with
 * no explanation -- which is the exact failure this whole arrangement exists to
 * prevent, and the one that made the game mute on a phone while working on a
 * laptop.
 *
 * `canPlay` is injectable because the alternative is a decision that can only be
 * exercised inside a browser, and this one is worth testing directly: every
 * branch of it corresponds to a device someone is holding.
 */
export function playableSource(track: Track, canPlay?: CanPlay): Source | null {
  const rank = canPlay ?? browserCanPlay();
  // No DOM at all: not a browser, so nothing is playing anyway. Answer with the
  // preferred encoding rather than null, so a caller on the server sees the
  // manifest's intent instead of a false negative.
  if (!rank) return track.sources[0] ?? null;
  return (
    track.sources.find((source) => rank(source.mime) === 'probably') ??
    track.sources.find((source) => rank(source.mime) === 'maybe') ??
    null
  );
}
