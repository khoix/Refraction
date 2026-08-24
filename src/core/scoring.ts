/**
 * Scoring, from section 6 of the design spec.
 *
 * The multipliers are what make building across faces pay: an ordinary clear is
 * worth its base value, the same clear triggered by a turn is worth double, and
 * a chain sustained through a full revolution pays a Prism bonus.
 */

/** Base value by number of lines cleared in one resolution step. */
export const LINE_BASE: readonly number[] = [0, 100, 300, 700, 1500];

/** Refraction Chain multiplier is capped so a long run cannot run away. */
export const MAX_CHAIN_MULTIPLIER = 6;

export const PRISM_MULTIPLIER = 8;
export const PRISM_BONUS = 10_000;

export const SOFT_DROP_PER_CELL = 1;
export const HARD_DROP_PER_CELL = 2;

export interface ClearContext {
  /** How many lines cleared in this step. */
  readonly lines: number;
  /** 1-based stage number. */
  readonly stage: number;
  /** 0 for the initial clear, 1+ for each cascade that follows. */
  readonly cascadeIndex: number;
  /** True when the turn itself made these lines eligible. */
  readonly refraction: boolean;
  /** Consecutive turns that have each produced a clear, including this one. */
  readonly chain: number;
  /** True when the chain has now covered all four faces in one revolution. */
  readonly prism: boolean;
}

/** Base value for a number of lines, extrapolating past four. */
export function baseValue(lines: number): number {
  if (lines <= 0) return 0;
  if (lines < LINE_BASE.length) return LINE_BASE[lines] as number;
  const top = LINE_BASE[LINE_BASE.length - 1] as number;
  return top + (lines - (LINE_BASE.length - 1)) * top;
}

export function chainMultiplier(chain: number): number {
  if (chain <= 0) return 1;
  return Math.min(chain + 1, MAX_CHAIN_MULTIPLIER);
}

export function cascadeMultiplier(cascadeIndex: number): number {
  return 1 + 0.5 * Math.max(0, cascadeIndex);
}

/** Points for one clear resolution step. */
export function scoreClear(context: ClearContext): number {
  if (context.lines <= 0) return 0;

  let score = baseValue(context.lines) * Math.max(1, context.stage);
  if (context.refraction) score *= 2;
  score *= chainMultiplier(context.chain);
  score *= cascadeMultiplier(context.cascadeIndex);
  if (context.prism) score = score * PRISM_MULTIPLIER + PRISM_BONUS;

  return Math.round(score);
}

/** Escalating on-screen label for a clear, or null when it is unremarkable. */
export function clearLabel(context: ClearContext): string | null {
  if (context.prism) return 'FULL SPECTRUM';
  if (context.chain >= 3) return `PRISM CHAIN x${chainMultiplier(context.chain)}`;
  if (context.refraction) return `REFRACTION x${chainMultiplier(context.chain)}`;
  if (context.cascadeIndex > 0) return `CASCADE x${cascadeMultiplier(context.cascadeIndex)}`;
  return null;
}
