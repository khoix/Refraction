import { expect, test } from '@playwright/test';

// A steady same-origin media signal makes output measurements deterministic.
// No platform-specific track codec or changing musical dynamics in the oracle.
function toneWav(): Buffer {
  const rate = 24000;
  const frames = rate * 2;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    wav.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 440) / rate) * 16384), 44 + i * 2);
  }
  return wav;
}

declare global {
  interface Window {
    __audioProbe: {
      gains: GainNode[];
      analysers: AnalyserNode[];
      context: AudioContext | null;
      rms: (bus: number) => number;
    };
  }
}

for (const phone of [false, true]) {
  test.describe(phone ? 'phone audio mixer' : 'desktop audio mixer', () => {
    test.use(
      phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}
    );
    test('attenuates actual music and SFX independently with read-only media volume', async ({
      page,
    }) => {
      await page.route('**/test-tone.wav', (route) =>
        route.fulfill({ contentType: 'audio/wav', body: toneWav() })
      );
      await page.addInitScript(() => {
        const gains: GainNode[] = [];
        const analysers: AnalyserNode[] = [];
        const probe: Window['__audioProbe'] = {
          gains,
          analysers,
          context: null,
          rms: (bus) => {
            const analyser = analysers[bus];
            if (!analyser) return 0;
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            return Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
          },
        };
        window.__audioProbe = probe;
        const createGain = AudioContext.prototype.createGain;
        AudioContext.prototype.createGain = function () {
          const gain = createGain.call(this);
          // The two persistent buses precede the short-lived effect envelopes.
          if (gains.length < 2) {
            const analyser = this.createAnalyser();
            analyser.fftSize = 2048;
            gain.connect(analyser);
            gains.push(gain);
            analysers.push(analyser);
            probe.context = this;
          }
          return gain;
        };
        const NativeAudio = window.Audio;
        window.Audio = class extends NativeAudio {
          constructor() {
            super();
            Object.defineProperty(this, 'src', {
              get: () => this.getAttribute('src'),
              set: () => this.setAttribute('src', '/test-tone.wav'),
            });
          }
        };
        // Emulate iOS's ignored element volume writes on the real audio graph.
        Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
          get: () => 1,
          set: () => undefined,
        });
      });
      await page.goto('/?debug=1');
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      await page.getByRole('button', { name: 'TAP TO PLAY' }).click();
      await page.getByRole('button', { name: 'SETTINGS', exact: true }).click();
      const set = async (name: string, value: string): Promise<void> => {
        await page.getByRole('slider', { name, exact: true }).fill(value);
      };
      await set('Master volume', '100');
      await expect
        .poll(() => page.evaluate(() => window.__audioProbe.rms(1)))
        .toBeGreaterThan(0.16);
      const fullMusic = await page.evaluate(() => window.__audioProbe.rms(1));
      await set('Music volume', '25');
      await expect
        .poll(() => page.evaluate(() => window.__audioProbe.rms(1)))
        .toBeLessThan(fullMusic * 0.3);
      expect(await page.evaluate(() => window.__audioProbe.rms(1))).toBeGreaterThan(
        fullMusic * 0.2
      );
      await page.evaluate(() => {
        const { context, gains } = window.__audioProbe;
        if (!context || !gains[0]) throw new Error('SFX bus missing');
        const signal = context.createOscillator();
        signal.connect(gains[0]);
        signal.start();
      });
      await expect
        .poll(() => page.evaluate(() => window.__audioProbe.rms(0)))
        .toBeGreaterThan(0.65);
      await set('SFX volume', '40');
      await expect.poll(() => page.evaluate(() => window.__audioProbe.rms(0))).toBeLessThan(0.31);
      expect(await page.evaluate(() => window.__audioProbe.rms(0))).toBeGreaterThan(0.25);
      expect(await page.evaluate(() => window.__audioProbe.rms(1))).toBeLessThan(fullMusic * 0.3);
      await set('Music volume', '0');
      await expect
        .poll(() => page.evaluate(() => window.__refraction?.music().playing))
        .toBe(false);
      expect(await page.evaluate(() => window.__audioProbe.rms(0))).toBeGreaterThan(0.25);
      await set('Music volume', '25');
      await expect.poll(() => page.evaluate(() => window.__refraction?.music().playing)).toBe(true);
      await page.locator('[data-field="sound"] input').uncheck();
      await expect.poll(() => page.evaluate(() => window.__audioProbe.rms(0))).toBeLessThan(0.001);
      await page.locator('[data-field="sound"] input').check();
      await expect
        .poll(() => page.evaluate(() => window.__audioProbe.rms(0)))
        .toBeGreaterThan(0.25);
      await expect(page.getByRole('slider', { name: 'Music volume', exact: true })).toHaveValue(
        '25'
      );
      await expect(page.getByRole('slider', { name: 'SFX volume', exact: true })).toHaveValue('40');
      await page.getByRole('slider', { name: 'SFX volume', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/refraction-audio-${phone ? 'phone' : 'desktop'}.png` });
      await page.reload();
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      expect(await page.evaluate(() => window.__refraction?.save().settings)).toMatchObject({
        volume: 1,
        musicVolume: 0.25,
        sfxVolume: 0.4,
        muted: false,
      });
    });
  });
}
