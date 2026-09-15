/**
 * Streamed music with Web Audio gain control. The media element stays at unity:
 * iOS ignores element.volume, so attenuation and fades belong to a GainNode.
 *
 * Keep same-origin network URLs (not blob URLs) for WebKit's media/range loader,
 * and keep Audio.declarePlayback() before the gesture-created context so recent
 * iOS treats the graph as playback. The old direct-media workaround avoided a
 * silent graph but left every nonzero volume equally loud on iPhones.
 * Streaming still avoids decoding an entire music track into resident PCM.
 */

import { touchPrimary } from '../touch/primary';

/** Music sits under the effects; a lock or a clear has to cut through it. */
const MUSIC_LEVEL = 0.5;
/** Long enough to read as the room coming up, not as a track being switched on. */
const FADE_IN_MS = 1200;
const FADE_OUT_MS = 500;
/** Fade granularity. Fine enough to be smooth, coarse enough to be free. */
const FADE_STEP_MS = 40;
/** Below this the element is paused rather than played very quietly. */
const SILENT = 0.001;

export interface LoadOptions {
  /** Theme loops; a run advances to the next pick when a track ends. */
  readonly loop?: boolean;
  /** Fired once when a non-looping track reaches its end. */
  readonly onEnded?: () => void;
}

export class Music {
  private element: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private holding = false;
  /** Whether the player should be hearing music right now. */
  private wanted = false;
  /** Master level from `Audio`: volume, already folded with mute. */
  private level = 1;
  /** Where the fade currently is, 0 to 1. */
  private fade = 0;
  private fadeTimer: ReturnType<typeof setInterval> | undefined;
  /** Set when the element reports it cannot play the source at all. */
  private failure: string | null = null;
  private endedHandler: (() => void) | null = null;
  private currentUrl: string | null = null;

  /**
   * Point the element at the track.
   *
   * **The network URL, not an object URL over the fetched bytes.** It was a blob
   * originally, on the reasoning that the preloader had already spent the bytes
   * and pointing back at the server risked a second transfer. That reasoning is
   * fine and the choice was still wrong: WebKit serves media elements through a
   * loader that expects byte-range requests, and `blob:` sources are a
   * long-standing weak spot there — a track that plays on every desktop browser
   * can silently never start on an iPhone. A static file from the same origin is
   * the boring path that every browser handles.
   *
   * The preload keeps its two real jobs: it fills the loading bar honestly, and
   * it warms the HTTP cache so the element usually reads from disk rather than
   * the network. Losing that race costs a re-fetch; losing the blob race costs
   * all the music.
   */
  load(url: string, options: LoadOptions = {}): void {
    this.release();
    const element = new window.Audio();
    element.src = url;
    element.loop = options.loop ?? true;
    element.preload = 'auto';
    // A source the platform cannot decode fails here rather than silently
    // playing nothing, which is the difference between a bug we can see and one
    // we cannot.
    element.addEventListener('error', () => {
      const code = element.error?.code;
      this.failure = `media error ${code ?? 'unknown'}`;
    });
    if (options.onEnded) {
      this.endedHandler = options.onEnded;
      element.addEventListener('ended', options.onEnded);
    }
    this.element = element;
    this.connectSource();
    this.currentUrl = url;
    this.apply();
  }

  /** Attach once to the gesture-unlocked shared context, before or after load. */
  connect(context: AudioContext): void {
    if (this.context === context) return;
    this.context = context;
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(context.destination);
    this.connectSource();
    this.applyVolume();
  }

  private connectSource(): void {
    if (!this.context || !this.gain || !this.element || this.source) return;
    this.source = this.context.createMediaElementSource(this.element);
    this.source.connect(this.gain);
    this.element.volume = 1;
  }

  /** True once there is a track loaded. */
  get ready(): boolean {
    return this.element !== null;
  }

  /** The URL currently pointed at the element, if any. */
  get url(): string | null {
    return this.currentUrl;
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
   * LCD transport pause, retaining the position and full fade level. A settings
   * change must not undo this explicit hold. Historically this also avoided
   * mobile element-volume freezing; gain control now bypasses that property.
   */
  hold(): void {
    this.wanted = false;
    this.holding = true;
    if (this.fadeTimer !== undefined) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    this.fade = 1;
    this.element?.pause();
  }

  /** Undo a transport hold. Restarts at full level on the same element. */
  unhold(): void {
    this.wanted = true;
    this.holding = false;
    if (this.fadeTimer !== undefined) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    this.fade = 1;
    this.applyVolume();
  }

  /**
   * The host drives this from the frame loop, off the current screen rather than
   * off the events that change it -- an event can be missed and a state cannot.
   * So it runs sixty times a second and has to be genuinely idempotent.
   */
  private want(playing: boolean): void {
    if (this.wanted === playing) return;
    this.wanted = playing;
    this.holding = false;
    this.apply();
  }

  private apply(): void {
    const element = this.element;
    if (!element) return;

    if (this.fadeTimer !== undefined) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
    const target = this.wanted ? 1 : 0;

    // Preserve the existing immediate phone transport. Desktop keeps its bed
    // fades; both now attenuate through the gain rather than element.volume.
    if (touchPrimary()) {
      this.fade = target;
      this.applyVolume();
      return;
    }

    const span = this.wanted ? FADE_IN_MS : FADE_OUT_MS;
    const step = FADE_STEP_MS / span;

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

  /** Apply gain, pausing at silence to avoid decoding an inaudible stream. */
  private applyVolume(): void {
    const element = this.element;
    if (!element) return;

    const target = this.level * MUSIC_LEVEL * this.fade;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.015);
    } else {
      // Compatibility path for browsers without Web Audio; normal playback
      // attaches the graph in the first gesture before music starts.
      element.volume = Math.min(1, Math.max(0, target));
    }

    if (target <= SILENT || this.holding) {
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
    if (this.element && this.endedHandler) {
      this.element.removeEventListener('ended', this.endedHandler);
    }
    this.endedHandler = null;
    this.fade = 0;
    this.failure = null;
    this.element?.pause();
    this.source?.disconnect();
    this.source = null;
    this.element?.removeAttribute('src');
    this.element?.load();
    this.element = null;
    this.holding = false;
    this.currentUrl = null;
  }

  dispose(): void {
    this.release();
    this.gain?.disconnect();
    this.gain = null;
    this.context = null;
    this.wanted = false;
  }
}
