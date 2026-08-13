/**
 * Deterministic random number generation.
 *
 * Every source of randomness in the game -- the piece bag, the depth-lane
 * dealer, cosmetic jitter -- draws from a seeded stream. That makes runs
 * reproducible from `(seed, input log)`, which is what lets the test suite
 * replay whole games headlessly and diff the outcome.
 *
 * SplitMix32: small, fast, and good enough for a puzzle game's bag shuffling.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, bound). */
  int(bound: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle, in place, returning the same array. */
  shuffle<T>(items: T[]): T[];
  /** Current internal state, for snapshotting a run mid-flight. */
  getState(): number;
  /** Restore a previously captured state. */
  setState(state: number): void;
  /** A new independent stream derived from this one. */
  fork(): Rng;
}

/** Hash an arbitrary string into a 32-bit seed, so seeds can be human-friendly. */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };

  const rng: Rng = {
    next: () => nextUint32() / 0x100000000,
    int: (bound: number) => {
      if (!Number.isInteger(bound) || bound <= 0) {
        throw new RangeError(`rng.int bound must be a positive integer, got ${bound}`);
      }
      return nextUint32() % bound;
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('rng.pick requires a non-empty array');
      return items[rng.int(items.length)] as T;
    },
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        const a = items[i] as T;
        items[i] = items[j] as T;
        items[j] = a;
      }
      return items;
    },
    getState: () => state,
    setState: (next: number) => {
      state = next >>> 0;
    },
    fork: () => createRng(nextUint32()),
  };

  return rng;
}
