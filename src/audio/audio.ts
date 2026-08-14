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

export class Audio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;

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
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = this.enabled ? 1 : 0;
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
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
