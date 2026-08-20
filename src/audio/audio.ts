/**
 * WebAudio plumbing.
 *
 * Deliberately thin: every decision about what to play lives in `tones.ts`.
 * This file only turns a `ToneSpec` into sound, and handles the two awkward
 * facts of browser audio -- a context cannot start until the user has
 * interacted, and it can be suspended out from under you at any time.
 */

import type { ToneSpec } from './tones';
import { clearTones, gameOverTone, lockTone, prismChord, turnSweep } from './tones';
import { Music } from './music';

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
  private enabled = true;
  /**
   * Kept separately from `enabled` so muting never destroys the level the
   * player set. Unmuting returns to exactly where they left it.
   */
  private level = 0.7;

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

  /** Hand over a fetched track. Starts playing if music was already asked for. */
  loadMusic(blob: Blob): void {
    this.music.load(blob);
  }

  /** Idempotent, so callers may drive it from state rather than from an event. */
  playMusic(): void {
    this.music.play();
  }

  stopMusic(): void {
    this.music.stop();
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

  gameOver(): void {
    this.play(gameOverTone());
  }

  dispose(): void {
    this.music.dispose();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
