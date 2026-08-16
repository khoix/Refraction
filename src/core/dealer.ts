/**
 * The piece bag and the Lane Dealer.
 *
 * Pieces come from a shuffled bag -- the familiar guarantee that you see every
 * shape before any repeats.
 *
 * Lanes deliberately do not. A lane bag swept the spectrum too evenly: eight
 * deals, eight colours, and the depth assignment read as ROYGBIV on a loop.
 * Lanes are now a free seeded draw, which clusters and leaves gaps the way
 * genuine randomness does, with a single guard: a lane that has not appeared
 * for a while has its weight climb steeply until it is dealt. Balance is a
 * floor, not a levelling force -- nothing pushes the counts toward even, the
 * floor only keeps cross-axis lines reachable on every lane, which is what the
 * dealer exists to do (the player has no depth control before Stage 4).
 */

import { DEPTH_LANES } from './constants';
import type { PieceCatalog, PieceDef, PieceId } from './pieces';
import { normalize, orientations, piecesForTier } from './pieces';
import type { Rng } from './rng';
import type { Cell } from './types';

/**
 * Deals a lane hasn't appeared for before its weight starts climbing. Below
 * this the draw is free. The expected gap on a free draw over 8 lanes is 8;
 * by 24 the lane is conspicuously overdue and the boost takes over.
 */
export const LANE_STARVATION_GAP = 24;

/** How steeply an overdue lane's weight climbs, per deal past the gap. */
const STARVATION_RAMP = 4;

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

/**
 * The free lane draw with the starvation floor.
 *
 * Every lane weighs 1 until it has been absent for `LANE_STARVATION_GAP`
 * deals; past that its weight multiplies by `STARVATION_RAMP` for every
 * further deal it misses, so an overdue lane is all but certain within a few
 * more deals. Below the floor the draw is genuinely free: repeats, clusters
 * and dry spells are the intended texture, not defects.
 */
export class LaneDealer {
  /** Deals since each lane last appeared. */
  private readonly gaps = new Array<number>(DEPTH_LANES).fill(0);

  constructor(private readonly rng: Rng) {}

  take(): number {
    let total = 0;
    const weights = this.gaps.map((gap) => {
      const weight =
        gap < LANE_STARVATION_GAP ? 1 : Math.pow(STARVATION_RAMP, gap - LANE_STARVATION_GAP + 1);
      total += weight;
      return weight;
    });

    let roll = this.rng.next() * total;
    let lane = DEPTH_LANES - 1;
    for (let i = 0; i < weights.length; i += 1) {
      roll -= weights[i] as number;
      if (roll < 0) {
        lane = i;
        break;
      }
    }

    for (let i = 0; i < this.gaps.length; i += 1) {
      this.gaps[i] = i === lane ? 0 : (this.gaps[i] as number) + 1;
    }
    return lane;
  }
}

/** A piece as dealt: what shape, which depth lane, and its spawn orientation. */
export interface DealtPiece {
  readonly def: PieceDef;
  readonly lane: number;
  /**
   * The orientation the piece spawns in. Canonical below tier 4; at tier 4 a
   * random orientation is dealt so a familiar silhouette can arrive as any of
   * its projections -- the "projection ambiguity" of the design spec's
   * complex tier.
   */
  readonly cells: readonly Cell[];
}

/** Every distinct orientation of each piece, computed once. */
const ORIENTATIONS_BY_ID = new Map<PieceId, readonly Cell[][]>();
function orientationsFor(def: PieceDef): readonly Cell[][] {
  let known = ORIENTATIONS_BY_ID.get(def.id);
  if (!known) {
    known = orientations(def.cells);
    ORIENTATIONS_BY_ID.set(def.id, known);
  }
  return known;
}

export class Dealer {
  private readonly pieces: Bag<PieceDef>;
  private readonly lanes: LaneDealer;
  private readonly orientationRng: Rng;
  private tier: number;

  constructor(
    rng: Rng,
    tier: number,
    private readonly catalog: PieceCatalog = 'standard'
  ) {
    this.tier = tier;
    this.pieces = new Bag(rng.fork(), () => piecesForTier(this.tier, this.catalog));
    this.lanes = new LaneDealer(rng.fork());
    this.orientationRng = rng.fork();
  }

  /**
   * Raise the piece tier. The current bag is discarded so newly unlocked shapes
   * appear promptly rather than waiting out the remainder of the old bag.
   */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.pieces.setSource(() => piecesForTier(this.tier, this.catalog));
  }

  deal(): DealtPiece {
    const def = this.pieces.take();
    const cells =
      this.tier >= 4
        ? normalize([...this.orientationRng.pick(orientationsFor(def))])
        : normalize([...def.cells]);
    return { def, lane: this.lanes.take(), cells };
  }
}
