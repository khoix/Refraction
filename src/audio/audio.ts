/**
 * WebAudio plumbing.
 *
 * Deliberately thin: synthesised decisions live in `tones.ts`, sampled clips in
 * `sfx.ts`. This file turns either into sound, and handles the two awkward facts
 * of browser audio -- a context cannot start until the user has interacted, and
 * it can be suspended out from under you at any time.
 */

import type { ToneSpec } from './tones';
import {
  clearTones,
  clickTone,
  gameOverTone,
  hoverTone,
  lockTone,
  prismChord,
  SPECTRAL_READY_PULSE,
  spectralCollapseTones,
  spectralReadyTones,
  turnSweep,
} from './tones';
import { Music } from './music';
import { SPECTRAL_COLLAPSE, SPECTRAL_COLLAPSE_IMMINENT } from './sfx';

/** A playable catalogue entry handed over after preload. */
export interface MusicTrack {
  readonly id: string;
  readonly url: string;
}

/** A sampled effect waiting to be decoded into an `AudioBuffer`. */
export interface SfxTrack {
  readonly id: string;
  readonly url: string;
}

type MusicBed = 'theme' | 'gameplay';

export class Audio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * Music does *not* go through the master gain.
   *
   * It used to, and on mobile that made it silent -- routing a media element
   * into the Web Audio graph turns it into ambient audio, which iOS treats
   * differently from media. `music.ts` has the full account. The rule that
   * mattered was that mute and volume reach the music, and that is preserved by
   * pushing the level at it from `applyGain` instead.
   */
  private readonly music = new Music();
  private theme: MusicTrack | null = null;
  private gameplay: MusicTrack[] = [];
  private bed: MusicBed | null = null;
  private currentId: string | null = null;
  /** When set, gameplay stays on this catalogue id (tutorial: Block Drift). */
  private pinnedId: string | null = null;
  /** Sampled clips, keyed by catalogue id, once decoded. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** URLs still waiting on a live context (or a decode in flight). */
  private pendingSfx: readonly SfxTrack[] = [];
  private decoding: Promise<void> | null = null;
  /**
   * Player held the bed via the LCD. The frame loop still asks for gameplay
   * every tick; without this flag that ask would un-pause immediately.
   */
  private held = false;
  private enabled = true;
  /**
   * Kept separately from `enabled` so muting never destroys the level the
   * player set. Unmuting returns to exactly where they left it.
   */
  private level = 0.7;
  /** Injectable so a suite can pin the shuffle without stubbing Math. */
  private readonly pick: (count: number) => number;

  constructor(options: { pick?: (count: number) => number } = {}) {
    this.pick = options.pick ?? ((count) => Math.floor(Math.random() * count));
  }

  /**
   * Create the context. Must be called from inside a user gesture, or browsers
   * will refuse to start it. Safe to call repeatedly.
   */
  resume(): void {
    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.gainValue;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    void this.decodePendingSfx();
  }

  /**
   * Declare this page's audio as playback rather than ambient.
   *
   * iOS decides whether the hardware silent switch applies by what kind of audio
   * it thinks the page is making, and its guess for a page using Web Audio is
   * "ambient" -- which is right for a notification blip and wrong for a game,
   * whose sound a player has deliberately turned on. Safari 16.4 added this to
   * say so explicitly.
   *
   * Called at boot rather than inside the gesture: it describes the page, not a
   * playback attempt. Absent everywhere but recent WebKit, hence the guard.
   */
  static declarePlayback(): void {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  }

  // -------------------------------------------------------------------- music

  /**
   * Hand over whatever the preloader managed to fetch.
   *
   * Theme is prepared immediately so the front door has something to start on
   * the first gesture. Gameplay URLs stay as a pool until a run asks for one.
   */
  setMusicCatalog(theme: MusicTrack | null, gameplay: readonly MusicTrack[]): void {
    this.theme = theme;
    this.gameplay = [...gameplay];
    this.bed = null;
    this.currentId = null;
    this.pinnedId = null;
    this.held = false;
    if (theme) {
      this.music.load(theme.url, { loop: true });
      this.bed = 'theme';
      this.currentId = theme.id;
    }
  }

  /**
   * Hand over sampled effects. Decodes once an `AudioContext` exists; safe to
   * call before the first gesture — decode waits for `resume`.
   */
  setSfxCatalog(clips: readonly SfxTrack[]): void {
    this.pendingSfx = clips.filter((clip) => !this.buffers.has(clip.id));
    void this.decodePendingSfx();
  }

  private async decodePendingSfx(): Promise<void> {
    if (!this.context || this.pendingSfx.length === 0) return;
    if (this.decoding) {
      await this.decoding;
      // Anything catalogued while the first batch ran still needs decoding.
      return this.decodePendingSfx();
    }
    const context = this.context;
    const batch = this.pendingSfx;
    this.pendingSfx = [];
    this.decoding = (async () => {
      await Promise.all(
        batch.map(async (clip) => {
          try {
            const response = await fetch(clip.url);
            if (!response.ok) return;
            const data = await response.arrayBuffer();
            // `decodeAudioData` may detach the buffer; copy so a retry is possible.
            const buffer = await context.decodeAudioData(data.slice(0));
            this.buffers.set(clip.id, buffer);
          } catch {
            // Sampled SFX are optional: the synthesised fallback still fires.
          }
        })
      );
    })();
    try {
      await this.decoding;
    } finally {
      this.decoding = null;
    }
  }

  /**
   * Loop the menu theme.
   *
   * Idempotent: the frame loop calls this every tick while a theme screen is up,
   * so a second call must not restart the track.
   */
  playTheme(): void {
    if (!this.theme) return;
    this.pinnedId = null;
    this.held = false;
    if (this.bed === 'theme' && this.music.ready) {
      this.music.play();
      return;
    }
    this.bed = 'theme';
    this.currentId = this.theme.id;
    this.music.load(this.theme.url, { loop: true });
    this.music.play();
  }

  /**
   * Play a random non-theme track, then another when it ends, and so on.
   *
   * Stays on the current pick across frames; only a bed change or an `ended`
   * event advances the pool. A player hold from the LCD is honoured here so the
   * frame loop cannot un-pause behind their back.
   */
  playGameplay(): void {
    if (this.gameplay.length === 0) return;
    if (this.held) return;
    if (this.pinnedId) {
      this.playPinnedGameplay(this.pinnedId);
      return;
    }
    if (this.bed === 'gameplay' && this.music.ready) {
      this.music.play();
      return;
    }
    this.bed = 'gameplay';
    this.startGameplayTrack();
  }

  /**
   * Loop one gameplay track until `clearGameplayPin` / a theme bed.
   * Used by the tutorial so the lesson stays on Block Drift.
   */
  playPinnedGameplay(id: string): void {
    const track = this.gameplay.find((entry) => entry.id === id);
    if (!track) return;
    this.held = false;
    this.pinnedId = id;
    if (this.bed === 'gameplay' && this.currentId === id && this.music.ready) {
      this.music.play();
      return;
    }
    this.bed = 'gameplay';
    this.currentId = id;
    this.music.load(track.url, { loop: true });
    this.music.play();
  }

  /** Return gameplay to the shuffled pool. */
  clearGameplayPin(): void {
    this.pinnedId = null;
  }

  /** Fade out. The title uses this; a later screen will pick a bed again. */
  stopMusic(): void {
    this.held = false;
    this.pinnedId = null;
    this.bed = null;
    this.music.stop();
  }

  /** LCD pause — keeps the bed so resume continues the same track. */
  pauseMusic(): void {
    this.held = true;
    this.music.hold();
  }

  /** Undo an LCD pause. */
  resumeMusic(): void {
    if (!this.held) return;
    this.held = false;
    if (this.bed === 'gameplay' || this.bed === 'theme') this.music.unhold();
  }

  /** Toggle an LCD pause. Returns whether the bed should read as playing. */
  toggleMusicPause(): boolean {
    if (this.held || !this.music.playing) {
      this.resumeMusic();
      return true;
    }
    this.pauseMusic();
    return false;
  }

  /** Skip to another gameplay track. Starts playing even if the bed was held. */
  nextGameplayTrack(): void {
    if (this.gameplay.length === 0) return;
    if (this.pinnedId) {
      this.playPinnedGameplay(this.pinnedId);
      return;
    }
    this.held = false;
    this.bed = 'gameplay';
    this.startGameplayTrack();
  }

  /** Which catalogue entry is loaded, if any. */
  get musicTrackId(): string | null {
    return this.currentId;
  }

  /** True while the LCD (or equivalent) is holding the bed paused. */
  get musicHeld(): boolean {
    return this.held;
  }

  get musicReady(): boolean {
    return this.music.ready;
  }

  get musicPlaying(): boolean {
    return this.music.playing;
  }

  /** What the platform said when it refused the track, if it did. */
  get musicError(): string | null {
    return this.music.error;
  }

  private startGameplayTrack(): void {
    const next = this.chooseGameplay();
    if (!next) return;
    this.currentId = next.id;
    this.music.load(next.url, {
      loop: false,
      onEnded: () => {
        if (this.bed === 'gameplay') this.startGameplayTrack();
      },
    });
    this.music.play();
  }

  private chooseGameplay(): MusicTrack | null {
    if (this.gameplay.length === 0) return null;
    const pool =
      this.gameplay.length > 1 && this.currentId
        ? this.gameplay.filter((track) => track.id !== this.currentId)
        : this.gameplay;
    return pool[this.pick(pool.length)] ?? null;
  }

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    this.applyGain();
  }

  get volume(): number {
    return this.level;
  }

  /** Master level, 0 to 1. Independent of mute. */
  setVolume(volume: number): void {
    this.level = Math.min(Math.max(volume, 0), 1);
    this.applyGain();
  }

  private get gainValue(): number {
    return this.enabled ? this.level : 0;
  }

  private applyGain(): void {
    // Music is not downstream of `master`, so it is told separately. Same
    // number, two destinations.
    this.music.setLevel(this.gainValue);
    if (this.master) this.master.gain.value = this.gainValue;
  }

  toggleMute(): boolean {
    this.setMuted(this.enabled);
    return this.muted;
  }

  private play(spec: ToneSpec, delay = 0): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(spec.cutoff, start);

    // A short attack and an exponential tail. Exponential because a linear fade
    // to zero is audible as a click at the end of every note.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);

    oscillator.connect(filter).connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + spec.duration + 0.02);
  }

  /** Play a decoded sample through the master bus. Returns false if unavailable. */
  private playSample(id: string, gain = 1): boolean {
    const context = this.context;
    const master = this.master;
    const buffer = this.buffers.get(id);
    if (!context || !master || !this.enabled || !buffer) return false;

    const source = context.createBufferSource();
    const level = context.createGain();
    source.buffer = buffer;
    level.gain.value = gain;
    source.connect(level).connect(master);
    source.start(context.currentTime);
    return true;
  }

  lock(lane: number): void {
    this.play(lockTone(lane));
  }

  clear(lines: number, cascade: number, lane: number): void {
    clearTones(lines, cascade, lane).forEach((spec, index) => this.play(spec, index * 0.045));
  }

  turn(direction: 'left' | 'right'): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) return;

    const sweep = turnSweep(direction);
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(sweep.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(sweep.to, start + sweep.duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(sweep.gain, start + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sweep.duration);

    oscillator.connect(filter).connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + sweep.duration + 0.02);
  }

  prism(): void {
    prismChord().forEach((spec, index) => this.play(spec, index * 0.035));
  }

  /** Hot bar crossed full — collapse is available. */
  spectralReady(): void {
    if (this.playSample(SPECTRAL_COLLAPSE_IMMINENT.id)) return;
    // Sample still decoding, refused by the platform, or never catalogued.
    spectralReadyTones().forEach((spec, index) => this.play(spec, index * SPECTRAL_READY_PULSE));
  }

  /** Spectral Collapse spent — the stack gives way. */
  spectralCollapse(): void {
    if (this.playSample(SPECTRAL_COLLAPSE.id)) return;
    spectralCollapseTones().forEach((spec, index) => this.play(spec, index * 0.06));
  }

  gameOver(): void {
    this.play(gameOverTone());
  }

  /** Menu / HUD: cursor entered a live control. */
  hover(): void {
    this.play(hoverTone());
  }

  /** Menu / HUD: a button was pressed. */
  click(): void {
    this.play(clickTone());
  }

  dispose(): void {
    this.music.dispose();
    this.buffers.clear();
    this.pendingSfx = [];
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
