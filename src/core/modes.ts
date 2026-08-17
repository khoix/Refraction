/**
 * The six modes.
 *
 * A mode is pure configuration -- a set of overrides on top of the stage table
 * -- so the engine has exactly one code path and modes cannot introduce rules
 * of their own by accident. Everything here is data, and every rule it implies
 * is unit-tested without a browser.
 *
 * The spec described **Ascent** as "primary progression" and **Endless** as
 * "score attack, continuously increasing speed" [GAP], which as written are the
 * same mode. They are separated here by what they do with *content*:
 *
 * - **Ascent** is the authored arc. It starts at stage 1 and reveals the game
 *   on schedule -- flat pieces, then screws, then the tripod, then depth
 *   control -- climbing the stage table in steps.
 * - **Endless** starts past the reveal with everything already unlocked, pins
 *   the stage table, and accelerates smoothly and without end instead. Nothing
 *   new ever arrives; only the pace changes.
 *
 * One is the game. The other is the treadmill.
 */

import { STAGES } from './stages';
import type { StageConfig } from './stages';

export type ModeId = 'ascent' | 'endless' | 'prism' | 'flatland' | 'blindSpectrum' | 'zen';

/**
 * What a player has to do to open a mode.
 *
 * Kept as data rather than a predicate so it can be *shown* to the player on
 * the locked card. A requirement nobody can read is just a wall.
 */
export interface UnlockRule {
  /** Highest stage reached in any single run, across all modes. */
  readonly bestStage: number;
  /** Shown on the locked mode card. */
  readonly description: string;
}

export interface ModeConfig {
  readonly id: ModeId;
  readonly name: string;
  /** One line, shown on the mode card. */
  readonly blurb: string;
  /** Stage the run begins at. */
  readonly startStage: number;
  /**
   * Hold the stage fixed instead of climbing the table. Modes that pin either
   * accelerate by another route (Endless) or deliberately do not (Zen).
   */
  readonly pinStage: boolean;
  /** Multiplier on the stage table's gravity. */
  readonly gravityScale: number;
  /**
   * Gravity compounds per cleared line rather than per stage. This is how
   * Endless accelerates once its stage is pinned.
   */
  readonly continuousGravity: boolean;
  /** Fixed Shift meter length, or null to follow the stage table. */
  readonly linesPerTurn: number | null;
  /** Hard cap on piece tier, or null to follow the stage table's schedule. */
  readonly maxTier: number | null;
  /** Depth Nudge available from the first piece. */
  readonly forceDepthNudge: boolean;
  /** Whether the run can end. False only for Zen. */
  readonly canFail: boolean;
  /** Whether cubes are drawn in depth colour at all. False for Blind Spectrum. */
  readonly depthColour: boolean;
  /** Extra multiplier on clears the turn itself made eligible. */
  readonly refractionScale: number;
  /**
   * Flat multiplier on every clear.
   *
   * Modes are not equally dangerous, and a scoreboard that ignores that would
   * rank a Zen session above a real run. Risk is what is being paid for.
   */
  readonly scoreScale: number;
  /** Null when the mode is available from the start. */
  readonly unlock: UnlockRule | null;
}

/** Gravity growth per cleared line when `continuousGravity` is set. */
export const CONTINUOUS_GRAVITY_STEP = 1.015;

const base = {
  startStage: 1,
  pinStage: false,
  gravityScale: 1,
  continuousGravity: false,
  linesPerTurn: null,
  maxTier: null,
  forceDepthNudge: false,
  canFail: true,
  depthColour: true,
  refractionScale: 1,
  scoreScale: 1,
  unlock: null,
} as const;

export const MODES: readonly ModeConfig[] = [
  {
    ...base,
    id: 'ascent',
    name: 'Ascent',
    blurb: 'The full arc. Starts flat and teaches itself.',
  },
  {
    ...base,
    id: 'endless',
    name: 'Endless',
    blurb: 'Everything unlocked, accelerating without end.',
    /*
     * Endless pins **stage 6's content** -- the first stage where every piece
     * tier is available and depth control is in the player's hands -- and then
     * scales its gravity back to roughly stage 4's pace so it opens at a speed
     * a person can actually start at. From there `continuousGravity` does all
     * the accelerating.
     *
     * Starting at stage 4 outright would be gentler but would withhold tier 4
     * forever, since a pinned stage never advances to unlock it -- which is
     * exactly the "everything unlocked" promise this mode makes.
     */
    startStage: 6,
    pinStage: true,
    gravityScale: 0.54,
    continuousGravity: true,
    forceDepthNudge: true,
  },
  {
    ...base,
    id: 'prism',
    name: 'Prism',
    blurb: 'The board turns constantly. Chains are everything.',
    startStage: 3,
    linesPerTurn: 2,
    forceDepthNudge: true,
    refractionScale: 2,
  },
  {
    ...base,
    id: 'flatland',
    name: 'Flatland',
    blurb: 'Flat pieces only. The board still turns.',
    // Nothing but planar pieces, so every cube of a piece shares one lane and
    // depth is purely a property of where you put it. Pure projection reading.
    maxTier: 1,
    startStage: 2,
  },
  {
    ...base,
    id: 'blindSpectrum',
    name: 'Blind Spectrum',
    blurb: 'No depth colour. Read the structure from memory.',
    startStage: 4,
    forceDepthNudge: true,
    depthColour: false,
    // Playing without the depth channel is the hardest thing the game asks of
    // anyone, and the score should say so.
    scoreScale: 1.5,
    unlock: {
      bestStage: 5,
      description: 'Reach stage 5 in any mode',
    },
  },
  {
    ...base,
    id: 'zen',
    name: 'Zen',
    blurb: 'No failure. Build and turn for as long as you like.',
    startStage: 2,
    pinStage: true,
    forceDepthNudge: true,
    canFail: false,
    // Nothing is at stake, so a Zen score cannot stand beside a real one.
    scoreScale: 0.25,
  },
] as const;

export const MODES_BY_ID: ReadonlyMap<ModeId, ModeConfig> = new Map(
  MODES.map((mode) => [mode.id, mode])
);

export const DEFAULT_MODE_ID: ModeId = 'ascent';

/** Look up a mode, falling back to Ascent for anything unrecognised. */
export function modeById(id: string | null | undefined): ModeConfig {
  return MODES_BY_ID.get(id as ModeId) ?? (MODES_BY_ID.get(DEFAULT_MODE_ID) as ModeConfig);
}

/** Whether a mode is playable given the best stage ever reached. */
export function isUnlocked(mode: ModeConfig, bestStage: number): boolean {
  return mode.unlock === null || bestStage >= mode.unlock.bestStage;
}

/**
 * The stage a run is at, given its mode and cleared lines.
 *
 * `stageForLines` walks the authored table from line zero; a mode that starts
 * partway along it simply offsets its line count, so there is no second
 * progression system to keep in step with the first.
 */
export function modeStage(
  mode: ModeConfig,
  lines: number,
  stageForLines: (lines: number) => StageConfig,
  linesPerStage: number
): StageConfig {
  const pinned = STAGES[mode.startStage - 1] as StageConfig;
  if (mode.pinStage) return withOverrides(mode, pinned);
  const offset = (mode.startStage - 1) * linesPerStage;
  return withOverrides(mode, stageForLines(lines + offset));
}

/** Apply the mode's flat overrides to a stage from the table. */
function withOverrides(mode: ModeConfig, stage: StageConfig): StageConfig {
  return {
    ...stage,
    ...(mode.linesPerTurn !== null ? { linesPerTurn: mode.linesPerTurn } : {}),
    ...(mode.maxTier !== null ? { maxTier: Math.min(stage.maxTier, mode.maxTier) } : {}),
    ...(mode.forceDepthNudge ? { depthNudge: true } : {}),
  };
}

/**
 * Cells per second for a mode at a given stage and line count.
 *
 * A mode either climbs the stage table or compounds per line -- never both, or
 * the two curves would multiply into something nobody tuned.
 */
export function modeGravity(mode: ModeConfig, stage: StageConfig, lines: number): number {
  const scaled = stage.gravity * mode.gravityScale;
  if (!mode.continuousGravity) return scaled;
  return scaled * Math.pow(CONTINUOUS_GRAVITY_STEP, Math.max(0, lines));
}
