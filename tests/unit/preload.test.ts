/**
 * The loading bar's promises.
 *
 * A progress bar is a claim made to the player, and the ways one lies are all
 * cheap to write and invisible in a screenshot: it sits at 100% while bytes are
 * still arriving, it jumps backwards when an estimate is corrected, it stops
 * short of full forever because something 404'd. Each test here is one of those
 * claims, stated as a property rather than as a shape.
 *
 * No DOM anywhere: `preload` deals in `fetch`, `Blob` and `AbortController`,
 * which is why it lives outside `src/ui` and can be tested in the node
 * environment the rest of the unit suite runs in.
 */

import { describe, expect, it } from 'vitest';
import { preload } from '../../src/assets/preload';

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(7);

/** A response whose body arrives in `count` chunks, pulled on demand. */
function chunked(
  count: number,
  size: number,
  headers: Record<string, string> = {},
  onPull?: (delivered: number) => void
): Response {
  let delivered = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered >= count) {
        controller.close();
        return;
      }
      delivered += 1;
      onPull?.(delivered);
      controller.enqueue(bytes(size));
    },
  });
  return new Response(stream, { headers });
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * A body on a clock, which errors when its fetch signal aborts.
 *
 * Both halves matter. The pacing is what separates "slow" from "stalled", and
 * the abort listener is what a real fetch body does when its signal fires --
 * without it, an abort is simply ignored and the read runs to completion. A fake
 * missing that listener cannot tell a timeout that fires from one that does not,
 * which is a test that passes whatever the timeout does.
 */
function paced(
  signal: AbortSignal,
  options: { chunks: number; size: number; gapMs: number; headers?: Record<string, string> }
): Response {
  let delivered = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
    async pull(controller) {
      await sleep(options.gapMs);
      if (delivered >= options.chunks) {
        // Never closes when there is nothing to deliver: this is the connection
        // that has gone quiet rather than the one that has finished.
        if (options.chunks === 0) await new Promise<void>(() => undefined);
        controller.close();
        return;
      }
      delivered += 1;
      controller.enqueue(bytes(options.size));
    },
  });
  return new Response(stream, options.headers ? { headers: options.headers } : {});
}

describe('preload', () => {
  it('starts at empty, ends at full, and never goes backwards', async () => {
    const fractions: number[] = [];
    const loaded = await preload([{ id: 'theme', url: '/theme.webm', bytes: 400 }], {
      fetch: async () => chunked(4, 100, { 'content-length': '400' }),
      onProgress: (progress) => fractions.push(progress.fraction),
    });

    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1] as number);
    }
    expect(loaded[0]?.blob?.size).toBe(400);
    expect(loaded[0]?.error).toBeUndefined();
  });

  it('does not read full until the bytes are actually in', async () => {
    // The server understates the length -- a stale manifest, a proxy that
    // re-encoded, a `Content-Length` for the compressed form. Either estimate
    // can be wrong, and the bar must not announce completion on the strength of
    // one: `received / expected` passes 1 here well before the body ends.
    const samples: { fraction: number; delivered: number }[] = [];
    let delivered = 0;
    await preload([{ id: 'theme', url: '/theme.webm', bytes: 400 }], {
      fetch: async () =>
        chunked(4, 100, { 'content-length': '200' }, (n) => {
          delivered = n;
        }),
      onProgress: (progress) => samples.push({ fraction: progress.fraction, delivered }),
    });

    const full = samples.filter((sample) => sample.fraction === 1);
    expect(full).toHaveLength(1);
    // The one sample that reads full arrived after every chunk had been handed
    // over. A bar that reached 1 on chunk two would fail here.
    expect(full[0]?.delivered).toBe(4);
  });

  it('finishes the bar when an asset fails, and says which one', async () => {
    const fractions: number[] = [];
    const loaded = await preload(
      [
        { id: 'theme', url: '/theme.webm', bytes: 400 },
        { id: 'missing', url: '/gone.webm', bytes: 400 },
      ],
      {
        fetch: async (input) =>
          String(input).includes('gone')
            ? new Response('', { status: 404 })
            : chunked(4, 100, { 'content-length': '400' }),
        onProgress: (progress) => fractions.push(progress.fraction),
      }
    );

    // The player gets the game without the music, not a door that never opens.
    expect(fractions.at(-1)).toBe(1);
    expect(loaded.find((asset) => asset.id === 'theme')?.blob).toBeInstanceOf(Blob);
    const missing = loaded.find((asset) => asset.id === 'missing');
    expect(missing?.blob).toBeNull();
    expect(missing?.error).toContain('404');
  });

  it('weights each asset by its declared size, not by its turn', async () => {
    // A small asset finishing first must move the bar by its share. Counting
    // assets instead of bytes would put this at a half.
    const fractions: number[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = preload(
      [
        { id: 'small', url: '/small', bytes: 100 },
        { id: 'large', url: '/large', bytes: 900 },
      ],
      {
        fetch: async (input) => {
          if (String(input).includes('small')) return chunked(1, 100, { 'content-length': '100' });
          await held;
          return chunked(1, 900, { 'content-length': '900' });
        },
        onProgress: (progress) => fractions.push(progress.fraction),
      }
    );

    await sleep(20);
    expect(fractions.at(-1)).toBeCloseTo(0.1, 5);

    release();
    await pending;
    expect(fractions.at(-1)).toBe(1);
  });

  it('reports each step once', async () => {
    // The understated length again, because it is the fixture that produces
    // repeats: once an asset's share is held at the cap, every further chunk
    // computes the same fraction. Emitting those would write the same width to
    // the bar over and over.
    const fractions: number[] = [];
    await preload([{ id: 'theme', url: '/theme.webm', bytes: 400 }], {
      fetch: async () => chunked(4, 100, { 'content-length': '200' }),
      onProgress: (progress) => fractions.push(progress.fraction),
    });

    expect(new Set(fractions).size).toBe(fractions.length);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1] as number);
    }
  });

  it('gives up on silence rather than on elapsed time', async () => {
    // Five chunks twenty milliseconds apart is a hundred milliseconds of
    // transfer against a fifty millisecond timeout. A deadline would kill it;
    // a stall timeout re-arms on every chunk and lets it through. This is the
    // slow connection that most needs the patience.
    const loaded = await preload([{ id: 'slow', url: '/slow', bytes: 500 }], {
      timeoutMs: 50,
      fetch: async (_input, init) =>
        paced(init?.signal as AbortSignal, {
          chunks: 5,
          size: 100,
          gapMs: 20,
          headers: { 'content-length': '500' },
        }),
    });

    expect(loaded[0]?.error).toBeUndefined();
    expect(loaded[0]?.blob?.size).toBe(500);
  });

  it('abandons a transfer that has gone quiet', async () => {
    const loaded = await preload([{ id: 'dead', url: '/dead', bytes: 500 }], {
      timeoutMs: 40,
      fetch: async (_input, init) =>
        paced(init?.signal as AbortSignal, { chunks: 0, size: 100, gapMs: 5 }),
    });

    expect(loaded[0]?.blob).toBeNull();
    expect(loaded[0]?.error).toBe('timed out');
  });
});
