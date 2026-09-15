import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Audio } from '../../src/audio/audio';
import { Music } from '../../src/audio/music';

class Media extends EventTarget {
  src = '';
  loop = false;
  preload = '';
  paused = true;
  // Reproduce iOS: element volume writes have no effect.
  get volume(): number {
    return 1;
  }
  set volume(_value: number) {
    /* hardware controlled */
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn();
  load = vi.fn();
}

class Gain {
  gain = {
    value: 1,
    setTargetAtTime: vi.fn((value: number) => {
      this.gain.value = value;
    }),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}
class Context {
  static latest: Context;
  currentTime = 0;
  state = 'running';
  destination = {};
  gains: Gain[] = [];
  sources: {
    element: Media;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  constructor() {
    Context.latest = this;
  }
  createGain(): Gain {
    const gain = new Gain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource(element: Media) {
    const source = { element, connect: vi.fn(), disconnect: vi.fn() };
    this.sources.push(source);
    return source;
  }
  close = vi.fn(async () => undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    Audio: Media,
    AudioContext: Context,
    matchMedia: () => ({ matches: false }),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function playing(): { audio: Audio; context: Context } {
  const audio = new Audio();
  audio.setVolume(0.7);
  audio.setMusicCatalog({ id: 'theme', url: '/theme.mp4' }, []);
  audio.resume();
  audio.playTheme();
  vi.advanceTimersByTime(1400);
  return { audio, context: Context.latest };
}

describe('independent audio buses', () => {
  it('attenuates intermediate music levels even when media volume is read-only', () => {
    const { audio, context } = playing();
    const [sfx, music] = context.gains;
    expect(music?.gain.value).toBeCloseTo(0.35);
    audio.setMusicVolume(0.2);
    expect(music?.gain.value).toBeCloseTo(0.07);
    expect(sfx?.gain.value).toBeCloseTo(0.7);
    audio.setSfxVolume(0.3);
    expect(sfx?.gain.value).toBeCloseTo(0.21);
    expect(music?.gain.value).toBeCloseTo(0.07);
    audio.setVolume(0.5);
    expect(sfx?.gain.value).toBeCloseTo(0.15);
    expect(music?.gain.value).toBeCloseTo(0.05);
    expect(context.sources[0]?.connect).toHaveBeenCalledWith(music);
    audio.dispose();
  });

  it('pauses at zero and restores both stored channel levels after mute', () => {
    const { audio, context } = playing();
    audio.setMusicVolume(0.4);
    audio.setSfxVolume(0.2);
    audio.setMuted(true);
    expect(audio.musicPlaying).toBe(false);
    expect(context.gains.map((g) => g.gain.value)).toEqual([0, 0]);
    audio.setMuted(false);
    expect(audio.musicPlaying).toBe(true);
    expect(context.gains[0]?.gain.value).toBeCloseTo(0.14);
    expect(context.gains[1]?.gain.value).toBeCloseTo(0.14);
    audio.setMusicVolume(0);
    expect(audio.musicPlaying).toBe(false);
    expect(context.gains[0]?.gain.value).toBeCloseTo(0.14);
    audio.setMusicVolume(0.4);
    expect(audio.musicPlaying).toBe(true);
    audio.dispose();
  });

  it('keeps transport hold when volume or mute changes', () => {
    const { audio } = playing();
    audio.pauseMusic();
    audio.setVolume(0.8);
    audio.setMusicVolume(0.5);
    audio.setMuted(true);
    audio.setMuted(false);
    expect(audio.musicPlaying).toBe(false);
    audio.resumeMusic();
    expect(audio.musicPlaying).toBe(true);
    audio.dispose();
  });

  it('connects tracks loaded after unlock and releases replaced sources', () => {
    const context = new Context();
    const music = new Music();
    music.connect(context as unknown as AudioContext);
    music.connect(context as unknown as AudioContext);
    music.load('/first.mp4');
    music.play();
    vi.advanceTimersByTime(1400);
    const first = context.sources[0];
    music.load('/second.mp4');
    expect(first?.disconnect).toHaveBeenCalledOnce();
    expect(first?.element.pause).toHaveBeenCalled();
    expect(context.sources).toHaveLength(2);
    expect(context.gains).toHaveLength(1);
    music.dispose();
    expect(context.sources[1]?.disconnect).toHaveBeenCalledOnce();
    expect(context.gains[0]?.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
