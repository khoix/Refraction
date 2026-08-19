/**
 * Streamed music, routed through the same master gain as everything else.
 *
 * Kept apart from `Audio` because the two have almost nothing in common. The
 * effects are synthesised on demand from `tones.ts` -- an oscillator, a filter,
 * a gain envelope, all of it disposable. Music is one long stream that has to be
 * started, faded, held across screens and stopped again, and it is the only part
 * of the audio system with a lifetime longer than a note.
 *
 * ## Through `master`, never past it
 *
 * The connection is `element -> source -> fade -> master -> destination`, and
 * that ordering is the whole reason this class takes the destination gain
 * instead of the context. Mute and volume are implemented as `master.gain`, so
 * anything that reaches `context.destination` by another route is a channel the
 * player's settings do not control. An `<audio>` element left to play on its own
 * would be exactly that: music that keeps going after the player mutes the game.
 * Its own `volume` is left at 1 throughout; the graph does the work.
 *
 * ## Why an element and not a buffer
 *
 * `tracks.ts` has the arithmetic. Short version: decoding the theme costs about
 * fifty megabytes of resident float32 for a 1.8 MB file, and the element streams
 * the compressed bytes instead. The trade is that a `MediaElement` loop is not
 * sample-exact, so there is a small seam at the wrap.
 *
 * ## Ordering is not guaranteed
 *
 * The blob arrives when the network says so and the context exists only once the
 * player has touched something, and neither waits for the other -- a fast
 * connection lands the track before the tap, a slow one after. So `load`,
 * `attach` and `play` may arrive in any order: each records what it knows and
 * asks whether the other two have happened yet. `wanted` is what carries an
 * early `play` across to whichever of the other two completes last.
 */

/** Music sits under the effects; a lock or a clear has to cut through it. */
const MUSIC_LEVEL = 0.5;
/** Long enough to read as the room coming up, not as a track being switched on. */
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 500;

export class Music {
  private element: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private context: AudioContext | null = null;
  private destination: GainNode | null = null;
  private fade: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  /** Whether the player should be hearing music right now. */
  private wanted = false;
  /**
   * Whether the graph has been driven to match `wanted`.
   *
   * The host calls `play` and `stop` from the frame loop, off the current screen,
   * rather than from the events that change screens -- the same choice the
   * game-over panel makes, and for the same reason: an event can be missed and a
   * state cannot. That makes both methods run sixty times a second, so they have
   * to be genuinely idempotent and not merely re-entrant. Without this flag each
   * call would restart the fade from wherever the last frame's ramp had reached,
   * and the ramp would converge on the target without ever arriving.
   *
   * False also covers "asked for, but not possible yet" -- no track, or no
   * context -- so the next call retries instead of assuming it succeeded.
   */
  private applied = false;
  /** Pending pause at the end of a fade-out, cancelled if play returns first. */
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Take the fetched bytes.
   *
   * An object URL rather than the original network URL: the preloader has
   * already spent the bytes, and pointing the element back at the server would
   * risk a second transfer on any cache the browser has decided not to keep.
   * The blob is the copy we know exists.
   */
  load(blob: Blob): void {
    this.release();
    this.objectUrl = URL.createObjectURL(blob);
    const element = new window.Audio();
    element.src = this.objectUrl;
    element.loop = true;
    element.preload = 'auto';
    // The graph owns the level. See the note above.
    element.volume = 1;
    this.element = element;
    this.connect();
    if (this.wanted) this.play();
  }

  /**
   * Join the graph. Called once the context exists, which is once the player has
   * made a gesture.
   */
  attach(context: AudioContext, destination: GainNode): void {
    if (this.context === context && this.destination === destination) return;
    this.context = context;
    this.destination = destination;
    this.source = null;
    this.fade = null;
    this.connect();
    if (this.wanted) this.play();
  }

  /** Wire the element into the context, once both exist. */
  private connect(): void {
    const { element, context, destination } = this;
    if (!element || !context || !destination || this.source) return;
    // One source node per element for the element's whole life -- a second call
    // for the same element throws, which is why `load` builds a fresh one.
    this.source = context.createMediaElementSource(element);
    this.fade = context.createGain();
    this.fade.gain.value = 0;
    this.source.connect(this.fade).connect(destination);
    // A new graph has none of the old one's scheduled values on it.
    this.applied = false;
  }

  /** True once there is a track loaded and a graph to play it through. */
  get ready(): boolean {
    return this.element !== null && this.source !== null;
  }

  /**
   * Whether the element is actually running.
   *
   * Read from the element rather than from `wanted`, so it reports what the
   * browser is doing and not what this class asked for. A hook that echoed the
   * intent back would agree with itself in every case, including the ones worth
   * catching.
   */
  get playing(): boolean {
    return this.element !== null && !this.element.paused;
  }

  play(): void {
    this.want(true);
  }

  /**
   * Fade out and pause.
   *
   * Paused rather than reset: the position is kept, so dipping into the mode
   * grid and back does not restart the track from the top.
   */
  stop(): void {
    this.want(false);
  }

  private want(playing: boolean): void {
    if (this.wanted === playing && this.applied) return;
    this.wanted = playing;
    this.apply();
  }

  /** Drive the graph to match `wanted`, if there is a graph yet. */
  private apply(): void {
    const { element, context, fade } = this;
    if (!element || !context || !fade) {
      // Not an error: the track or the context is still on its way. Left
      // unapplied so the next call tries again.
      this.applied = false;
      return;
    }

    if (this.pauseTimer !== undefined) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }

    const now = context.currentTime;
    const seconds = (this.wanted ? FADE_IN_MS : FADE_OUT_MS) / 1000;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(this.wanted ? MUSIC_LEVEL : 0, now + seconds);

    if (this.wanted) {
      // Rejects when the browser has not accepted a gesture yet. Not worth
      // reporting -- it stays unapplied, so the next call tries again.
      void element.play().catch(() => {
        this.applied = false;
      });
    } else {
      // Pausing on the same frame the ramp starts would cut the fade off at its
      // first sample, which is a click.
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = undefined;
        if (!this.wanted) element.pause();
      }, FADE_OUT_MS + 60);
    }

    this.applied = true;
  }

  /** Drop the element and the object URL, without touching the context. */
  private release(): void {
    if (this.pauseTimer !== undefined) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    this.source?.disconnect();
    this.fade?.disconnect();
    this.source = null;
    this.fade = null;
    this.applied = false;
    this.element?.pause();
    this.element = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  dispose(): void {
    this.release();
    this.wanted = false;
    this.context = null;
    this.destination = null;
  }
}
