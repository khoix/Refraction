import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '@core/rng';

describe('createRng', () => {
  it('produces identical streams for identical seeds', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const left = Array.from({ length: 64 }, () => a.next());
    const right = Array.from({ length: 64 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 32 }, createRng(1).next);
    const b = Array.from({ length: 32 }, createRng(2).next);
    expect(a).not.toEqual(b);
  });

  it('accepts string seeds', () => {
    expect(Array.from({ length: 8 }, createRng('refraction').next)).toEqual(
      Array.from({ length: 8 }, createRng(hashSeed('refraction')).next)
    );
  });

  it('emits floats in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is not obviously biased', () => {
    const rng = createRng(99);
    const buckets = new Array<number>(10).fill(0);
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      const bucket = Math.floor(rng.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    const expected = samples / 10;
    const tolerance = expected * 0.25;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(expected - tolerance);
      expect(count).toBeLessThan(expected + tolerance);
    }
  });
});

describe('int', () => {
  it('stays within [0, bound)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(8);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(8);
    }
  });

  it('covers every value of a small range', () => {
    const rng = createRng(4);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(rng.int(8));
    expect(seen.size).toBe(8);
  });

  it('rejects invalid bounds', () => {
    const rng = createRng(5);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(-1)).toThrow(RangeError);
    expect(() => rng.int(2.5)).toThrow(RangeError);
  });
});

describe('pick and shuffle', () => {
  it('picks only from the given array', () => {
    const rng = createRng(6);
    const items = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
    for (let i = 0; i < 200; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('rejects picking from an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });

  it('shuffles into a permutation of the input', () => {
    const rng = createRng(8);
    const source = [0, 1, 2, 3, 4, 5, 6, 7];
    const shuffled = rng.shuffle([...source]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
  });

  it('actually reorders', () => {
    const rng = createRng(8);
    const source = Array.from({ length: 16 }, (_, i) => i);
    let moved = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      const shuffled = rng.shuffle([...source]);
      if (shuffled.some((value, index) => value !== index)) moved += 1;
    }
    expect(moved).toBe(20);
  });
});

describe('state and forking', () => {
  it('resumes an identical stream from a captured state', () => {
    const rng = createRng(11);
    for (let i = 0; i < 10; i += 1) rng.next();
    const state = rng.getState();
    const expected = Array.from({ length: 10 }, () => rng.next());

    rng.setState(state);
    expect(Array.from({ length: 10 }, () => rng.next())).toEqual(expected);
  });

  it('forks independent but reproducible substreams', () => {
    const parentA = createRng(21);
    const parentB = createRng(21);
    const childA = parentA.fork();
    const childB = parentB.fork();

    expect(Array.from({ length: 16 }, childA.next)).toEqual(
      Array.from({ length: 16 }, childB.next)
    );
    expect(Array.from({ length: 8 }, parentA.next)).not.toEqual(
      Array.from({ length: 8 }, childA.next)
    );
  });
});

describe('hashSeed', () => {
  it('is stable and returns an unsigned 32-bit integer', () => {
    const hash = hashSeed('prism');
    expect(hash).toBe(hashSeed('prism'));
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it('separates similar seeds', () => {
    expect(hashSeed('prism')).not.toBe(hashSeed('prisn'));
    expect(hashSeed('')).not.toBe(hashSeed('a'));
  });
});
