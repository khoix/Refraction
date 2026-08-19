/**
 * Fetch a set of assets up front, reporting honest progress.
 *
 * The front door exists to do two things at once: capture the first user gesture
 * (an `AudioContext` cannot start without one) and use the time that gesture is
 * being waited for to pull down anything large. This is the second half. It
 * knows nothing about music, screens or the game -- it takes URLs and byte
 * estimates and returns blobs.
 *
 * ## What "honest" means here
 *
 * Three properties, each of which a naive loading bar gets wrong.
 *
 * **It starts at a true zero and ends at a true one.** Progress is a weighted
 * sum over the declared sizes, and an asset's share only reaches its full weight
 * when that asset has actually finished -- mid-download it is capped just below,
 * so the bar cannot sit at 100% while bytes are still arriving. That is the
 * failure mode that teaches players a progress bar is decoration.
 *
 * **It moves once per step, and only forwards.** Emissions are filtered to
 * strictly increasing values. The sum happens to be monotonic already -- each
 * asset's denominator is fixed when its headers land, before any progress for it
 * is reported, so no share can shrink -- and the filter is what turns that from
 * something true of today's arithmetic into something the consumer may rely on.
 * What it actually removes is repeats: once an asset's share is held at the cap
 * below, every further chunk computes the same fraction, and forwarding those
 * would write the same width to the bar a hundred times over.
 *
 * **It always finishes.** A failed asset resolves its whole share and reports
 * the error; it does not stall the bar and it does not reject. The game is
 * playable without music, so a CDN having a bad afternoon must cost the player
 * the soundtrack and nothing else. There is no path here that leaves a player
 * looking at a bar that will never fill.
 *
 * ## The timeout is a stall timeout
 *
 * Not a deadline for the whole transfer. A total deadline punishes exactly the
 * connection that needs the most patience: a slow link making steady progress is
 * working, and killing it at fifteen seconds turns a long wait into no music at
 * all. The timer is re-armed on every chunk, so it only fires when nothing has
 * arrived for `timeoutMs` -- which is the condition actually worth giving up on.
 */

/** Something to fetch before the game starts. */
export interface Asset {
  readonly id: string;
  readonly url: string;
  /**
   * Approximate size in bytes.
   *
   * Used as the asset's weight in the overall total, and as the denominator for
   * its own progress until `Content-Length` supplies a real one. Being wrong
   * costs smoothness, never correctness: the bar still ends at exactly 1.
   */
  readonly bytes: number;
}

export interface Progress {
  /** Weighted bytes accounted for so far. */
  readonly loaded: number;
  /** Sum of every asset's declared size. */
  readonly total: number;
  /** `loaded / total`, clamped and monotonic. */
  readonly fraction: number;
}

export interface LoadedAsset {
  readonly id: string;
  /** Null when the asset could not be fetched. */
  readonly blob: Blob | null;
  /** Present only on failure. */
  readonly error?: string;
}

export interface PreloadOptions {
  /** Injectable for tests. Defaults to the global. */
  readonly fetch?: typeof globalThis.fetch;
  /** How long a transfer may go without delivering a byte. */
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: Progress) => void;
}

/** Twenty seconds of total silence from the network, not twenty seconds total. */
export const DEFAULT_STALL_MS = 20_000;

/**
 * An asset's share is held just below its full weight until it has finished, so
 * "the bar is full" and "the download is done" cannot come apart.
 */
const ALMOST = 0.999;

function describe(error: unknown, timedOut: boolean): string {
  if (timedOut) return 'timed out';
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function preload(
  assets: readonly Asset[],
  options: PreloadOptions = {}
): Promise<LoadedAsset[]> {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stallMs = options.timeoutMs ?? DEFAULT_STALL_MS;
  const report = options.onProgress;

  // A zero-byte declaration would take an asset out of the total entirely and
  // let the bar reach full before it arrived.
  const weights = assets.map((asset) => Math.max(1, asset.bytes));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  /** Fraction of each asset's own weight that is accounted for. */
  const share = assets.map(() => 0);

  let highest = -1;
  const emit = (): void => {
    if (!report) return;
    let loaded = 0;
    for (let i = 0; i < assets.length; i += 1) {
      loaded += (weights[i] ?? 0) * (share[i] ?? 0);
    }
    const fraction = total > 0 ? Math.min(1, loaded / total) : 1;
    if (fraction <= highest) return;
    highest = fraction;
    report({ loaded: Math.round(loaded), total, fraction });
  };

  // An empty bar before anything has been asked for, rather than a bar that
  // appears already part-full on the first response.
  emit();

  const fetchOne = async (asset: Asset, index: number): Promise<Blob> => {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, stallMs);
    };

    arm();
    try {
      const response = await request(asset.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const declared = Number(response.headers.get('content-length'));
      const expected =
        Number.isFinite(declared) && declared > 0 ? declared : Math.max(1, asset.bytes);
      const type = response.headers.get('content-type') ?? '';

      // Not every environment exposes a body stream -- a synthetic response in a
      // test, or a browser that has served this from cache in one piece. Without
      // one there is nothing to count, so the asset simply completes.
      const body = response.body;
      if (!body) return await response.blob();

      const reader = body.getReader();
      const chunks: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        arm();
        if (!step.value) continue;
        chunks.push(step.value as BlobPart);
        received += step.value.byteLength;
        share[index] = Math.min(ALMOST, received / expected);
        emit();
      }
      return new Blob(chunks, { type });
    } catch (error) {
      throw new Error(describe(error, timedOut));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return Promise.all(
    assets.map(async (asset, index): Promise<LoadedAsset> => {
      try {
        const blob = await fetchOne(asset, index);
        share[index] = 1;
        emit();
        return { id: asset.id, blob };
      } catch (error) {
        // A missing asset resolves its share rather than holding the bar short
        // of full forever. The caller decides what to do without it.
        share[index] = 1;
        emit();
        return { id: asset.id, blob: null, error: describe(error, false) };
      }
    })
  );
}
