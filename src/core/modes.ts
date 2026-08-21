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
 * Which rotation axes a mode permits.
 *
 * `all` is the game as designed: roll in the screen plane, plus yaw and pitch,
 * which are the two extra axes a three-dimensional board makes available.
 *
 * `roll` restricts a mode to the screen plane entirely. It exists because
 * Flatland's promise -- planar pieces, depth purely a property of where you put
 * them -- was not actually true: yaw on a flat I-piece turns four columns in one
 * lane into one column across four lanes, taking the piece out of the screen
 * plane and straight past the thing the mode is supposed to isolate.
 *
 * It is also what lets touch drop the field/strip split. The split exists to
 * carry three rotation axes, and a mode that has one does not need to spend a
 * strip of an eighteen-row well on it.
 */
export type RotationPolicy = 'roll' | 'all';

/**
 * When the depth nudge becomes available.
 *
 * One field rather than two booleans. `forceDepthNudge` could only ever turn the
 * nudge on early; the inverse was missing, so a mode could start below the stage
 * that unlocks it but could not withhold it outright -- and adding a second
 * boolean for that would have created a pair that can contradict each other.
 */
export type DepthNudgePolicy = 'never' | 'byStage' | 'always';

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

/** How many pips the mode card shows for difficulty. Matches the table length. */
export const MODE_DIFFICULTY_MAX = 6;

export interface ModeConfig {
  readonly id: ModeId;
  readonly name: string;
  /** One line, shown on the mode card. */
  readonly blurb: string;
  /**
   * How demanding the mode is, 1..`MODE_DIFFICULTY_MAX`.
   *
   * Presentation only — the engine never reads it. Shown as a pip rating on the
   * mode card, and kept in lockstep with `MODES` display order.
   */
  readonly difficulty: number;
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
  /**
   * Which rotation axes the mode permits.
   *
   * Read by the engine, by the key map -- which must not advertise a key the
   * engine ignores -- and by the touch layer, which drops its movement strip
   * when there is only one axis to carry.
   */
  readonly rotation: RotationPolicy;
  /**
   * When the depth nudge becomes available. Folded into the stage's own
   * `depthNudge` boolean by `withOverrides`, so the engine keeps reading one
   * flag and the policy lives here.
   */
  readonly depthNudge: DepthNudgePolicy;
  /**
   * Whether the mode offers Spectral Collapse.
   *
   * On everywhere today, including Flatland. Kept as a mode-table field so a
   * mode can still withhold the gauge, the key row and the gesture without a
   * special case in the UI.
   */
  readonly spectralCollapse: boolean;
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
  rotation: 'all',
  depthNudge: 'byStage',
  spectralCollapse: true,
  canFail: true,
  depthColour: true,
  refractionScale: 1,
  scoreScale: 1,
  unlock: null,
} as const;

/**
 * Display order is difficulty ascending: Flatland first, Blind Spectrum last.
 *
 * The menu iterates this table, so the order here is the order on the card grid.
 * Colour accents for that ramp live in `app.css` keyed off each card's
 * `data-mode` — deliberately not the spectrum stops, which still mean depth.
 */
export const MODES: readonly ModeConfig[] = [
  {
    ...base,
    id: 'flatland',
    name: 'Flatland',
    blurb: 'Flat pieces only. The board still turns.',
    difficulty: 1,
    // Nothing but planar pieces, so every cube of a piece shares one lane and
    // depth is purely a property of where you put it. Pure projection reading.
    maxTier: 1,
    startStage: 2,
    // Roll alone, and no depth nudge ever. Both follow from the mode's own
    // promise: the piece never leaves the screen plane, so its lane changes only
    // when the board turns. Yaw and the nudge are the two ways a player could
    // move a piece through depth directly, and a mode about reading projection
    // cannot offer either.
    rotation: 'roll',
    depthNudge: 'never',
  },
  {
    ...base,
    id: 'zen',
    name: 'Zen',
    blurb: 'No failure. Build and turn for as long as you like.',
    difficulty: 2,
    startStage: 2,
    pinStage: true,
    depthNudge: 'always',
    canFail: false,
    // Nothing is at stake, so a Zen score cannot stand beside a real one.
    scoreScale: 0.25,
  },
  {
    ...base,
    id: 'ascent',
    name: 'Ascent',
    blurb: 'The full arc. Starts flat and teaches itself.',
    difficulty: 3,
  },
  {
    ...base,
    id: 'endless',
    name: 'Endless',
    blurb: 'Everything unlocked, accelerating without end.',
    difficulty: 4,
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
    depthNudge: 'always',
  },
  {
    ...base,
    id: 'prism',
    name: 'Prism',
    blurb: 'The board turns constantly. Chains are everything.',
    difficulty: 5,
    startStage: 3,
    linesPerTurn: 2,
    depthNudge: 'always',
    refractionScale: 2,
  },
  {
    ...base,
    id: 'blindSpectrum',
    name: 'Blind Spectrum',
    blurb: 'No depth colour. Read the structure from memory.',
    difficulty: 6,
    startStage: 4,
    depthNudge: 'always',
    depthColour: false,
    // Playing without the depth channel is the hardest thing the game asks of
    // anyone, and the score should say so.
    scoreScale: 1.5,
    unlock: {
      bestStage: 5,
      description: 'Reach stage 5 in any mode',
    },
  },
] as const;

export const MODES_BY_ID: ReadonlyMap<ModeId, ModeConfig> = new Map(
  MODES.map((mode) => [mode.id, mode])
);

/**
 * The mode a new player meets, and the fallback for an unknown id.
 *
 * Flatland rather than Ascent. It deals planar pieces only, so depth is purely a
 * property of where a piece is put rather than of its own shape -- the gentlest
 * possible first contact with the one idea the whole game rests on. It is
 * unlocked from the start, so nothing else has to move.
 */
export const DEFAULT_MODE_ID: ModeId = 'flatland';

/**
 * The engine's own default when a `Game` is constructed without a mode: the
 * authored arc.
 *
 * Deliberately **not** `DEFAULT_MODE_ID`. The two were one constant and it hid a
 * real distinction: what a player is offered first is a question about teaching,
 * and what the rules do when nobody says otherwise is a question about the
 * reference implementation. Sharing one value meant moving the player-facing
 * default silently rewrote what every `new Game({ seed })` in the test suite was
 * testing -- two of them started failing, correctly, because a game that had
 * been the full arc became a capped one.
 */
export const AUTHORED_MODE_ID: ModeId = 'ascent';

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
    ...(mode.depthNudge === 'always'
      ? { depthNudge: true }
      : mode.depthNudge === 'never'
        ? { depthNudge: false }
        : {}),
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
