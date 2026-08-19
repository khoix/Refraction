/**
 * Streamed music, played as media rather than through the Web Audio graph.
 *
 * ## Why this is not a `MediaElementAudioSourceNode`
 *
 * It was one, and on mobile it was silent. The symptom was specific and worth
 * recording, because it is the kind that looks like nothing is happening: Safari
 * showed the tab as producing audio -- so something *was* playing -- but nothing
 * was audible and neither the tab's mute nor the game's volume changed that.
 *
 * Routing an `<audio>` element through `createMediaElementSource` takes its
 * output off the media path and onto the Web Audio path. Those are not the same
 * thing on iOS. Web Audio output is treated as *ambient* audio: the hardware
 * silent switch kills it, while a plain media element plays like a video and is
 * not affected. The same routing is also the long-standing WebKit bug where a
 * source node fed from a `blob:` URL yields silence downstream while the element
 * itself reports playing -- which matches the symptom exactly.
 *
 * Both failure modes come from the same architectural choice, so the fix is to
 * stop making it. The element plays itself. Nothing about music touches the
 * `AudioContext` any more.
 *
 * ## Keeping the player's settings in charge
 *
 * The rule that mattered was never "music goes through `master`" -- it was that
 * mute and volume reach the music. That still holds, by a different mechanism:
 * `Audio` pushes its level here whenever it changes, and this applies it to the
 * element.
 *
 * With one platform caveat that has to be designed around rather than papered
 * over. **iOS ignores `volume` on a media element** -- it is read-only there,
 * because volume belongs to the hardware. So the slider genuinely cannot attenuate
 * music on an iPhone, and pretending otherwise would be a control that lies.
 * Muting is therefore implemented as a *pause*, not as a zero volume: pausing
 * works on every platform, so the one setting that must be obeyed always is.
 *
 * ## Streamed, not decoded
 *
 * `tracks.ts` has the arithmetic. Short version: decoding the theme costs about
 * fifty megabytes of resident float32 for a 1.8 MB file, and the element streams
 * the compressed bytes instead. The trade is that a `MediaElement` loop is not
 * sample-exact, so there is a small seam at the wrap.
 */

/** Music sits under the effects; a lock or a clear has to cut through it. */
const MUSIC_LEVEL = 0.5;
/** Long enough to read as the room coming up, not as a track being switched on. */
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 500;
/** Fade granularity. Fine enough to be smooth, coarse enough to be free. */
const FADE_STEP_MS = 40;
/** Below this the element is paused rather than played very quietly. */
const SILENT = 0.001;

export class Music {
  private element: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  /** Whether the player should be hearing music right now. */
  private wanted = false;
  /** Master level from `Audio`: volume, already folded with mute. */
  private level = 1;
  /** Where the fade currently is, 0 to 1. */
  private fade = 0;
  private fadeTimer: ReturnType<typeof setInterval> | undefined;
  /** Set when the element reports it cannot play the source at all. */
  private failure: string | null = null;

  /**
   * Take the fetched bytes.
   *
   * An object URL rather than the original network URL: the preloader has
   * already spent the bytes, and pointing the element back at the server would
   * risk a second transfer on any cache the browser has decided not to keep.
   */
  load(blob: Blob): void {
    this.release();
    this.objectUrl = URL.createObjectURL(blob);
    const element = new window.Audio();
    element.src = this.objectUrl;
    element.loop = true;
    element.preload = 'auto';
    // A source the platform cannot decode fails here rather than silently
    // playing nothing, which is the difference between a bug we can see and one
    // we cannot.
    element.addEventListener('error', () => {
      const code = element.error?.code;
      this.failure = `media error ${code ?? 'unknown'}`;
    });
    this.element = element;
    this.apply();
  }

  /** True once there is a track loaded. */
  get ready(): boolean {
    return this.element !== null;
  }

  /**
   * Whether the element is actually running.
   *
   * Read from the element rather than from `wanted`, so it reports what the
   * browser is doing and not what this class asked for.
   */
  get playing(): boolean {
    return this.element !== null && !this.element.paused;
  }

  /** What went wrong, if the platform refused the source. */
  get error(): string | null {
    return this.failure;
  }

  /** Master level, already folded with mute, from `Audio`. */
  setLevel(level: number): void {
    this.level = Math.min(1, Math.max(0, level));
    this.applyVolume();
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

  /**
   * The host drives this from the frame loop, off the current screen rather than
   * off the events that change it -- an event can be missed and a state cannot.
   * So it runs sixty times a second and has to be genuinely idempotent.
   */
  private want(playing: boolean): void {
    if (this.wanted === playing) return;
    this.wanted = playing;
    this.apply();
  }

  private apply(): void {
    const element = this.element;
    if (!element) return;

    if (this.fadeTimer !== undefined) clearInterval(this.fadeTimer);
    const span = this.wanted ? FADE_IN_MS : FADE_OUT_MS;
    const step = FADE_STEP_MS / span;
    const target = this.wanted ? 1 : 0;

    this.fadeTimer = setInterval(() => {
      this.fade =
        target > this.fade
          ? Math.min(target, this.fade + step)
          : Math.max(target, this.fade - step);
      this.applyVolume();
      if (this.fade === target) {
        if (this.fadeTimer !== undefined) clearInterval(this.fadeTimer);
        this.fadeTimer = undefined;
      }
    }, FADE_STEP_MS);

    this.applyVolume();
  }

  /**
   * Push the level at the element, and start or stop it.
   *
   * Pausing at silence is what makes mute work where `volume` does not, and it
   * also means a muted game is not quietly decoding a track nobody can hear.
   */
  private applyVolume(): void {
    const element = this.element;
    if (!element) return;

    const target = this.level * MUSIC_LEVEL * this.fade;
    // Assigning is a no-op on iOS rather than an error; the pause below is what
    // carries the setting there.
    element.volume = Math.min(1, Math.max(0, target));

    if (target <= SILENT) {
      if (!element.paused) element.pause();
      return;
    }
    if (element.paused) {
      // Rejects when the browser has not accepted a gesture yet. Not worth
      // reporting -- the next call tries again.
      void element.play().catch(() => undefined);
    }
  }

  private release(): void {
    if (this.fadeTimer !== undefined) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    this.fade = 0;
    this.failure = null;
    this.element?.pause();
    this.element = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  dispose(): void {
    this.release();
    this.wanted = false;
  }
}
