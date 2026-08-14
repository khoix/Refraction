/**
 * The piece bag and the Lane Dealer.
 *
 * Two independent shuffled bags. The piece bag is the familiar guarantee that
 * you see every shape before any repeats. The lane bag does the same job for
 * depth: it is what makes cross-axis lines reachable at all, since the player
 * has no depth control before Stage 4.
 */

import { DEPTH_LANES } from './constants';
import type { PieceDef } from './pieces';
import { piecesForTier } from './pieces';
import type { Rng } from './rng';

export class Bag<T> {
  private remaining: T[] = [];

  constructor(
    private readonly rng: Rng,
    private source: () => T[]
  ) {}

  /** Swap the underlying pool, e.g. when a new piece tier unlocks. */
  setSource(source: () => T[]): void {
    this.source = source;
    this.remaining = [];
  }

  take(): T {
    if (this.remaining.length === 0) {
      this.remaining = this.rng.shuffle([...this.source()]);
    }
    return this.remaining.pop() as T;
  }
}

/** A piece as dealt: what shape, and which depth lane it anchors to. */
export interface DealtPiece {
  readonly def: PieceDef;
  readonly lane: number;
}

export class Dealer {
  private readonly pieces: Bag<PieceDef>;
  private readonly lanes: Bag<number>;
  private tier: number;

  constructor(rng: Rng, tier: number) {
    this.tier = tier;
    this.pieces = new Bag(rng.fork(), () => piecesForTier(this.tier));
    this.lanes = new Bag(rng.fork(), () => Array.from({ length: DEPTH_LANES }, (_, i) => i));
  }

  /**
   * Raise the piece tier. The current bag is discarded so newly unlocked shapes
   * appear promptly rather than waiting out the remainder of the old bag.
   */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.pieces.setSource(() => piecesForTier(this.tier));
  }

  deal(): DealtPiece {
    return { def: this.pieces.take(), lane: this.lanes.take() };
  }
}
