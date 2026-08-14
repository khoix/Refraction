/**
 * The difficulty arc: seven authored stages, then an endless tail.
 *
 * Values come from section 5.2 and section 7 of the design spec.
 *
 * Stages are identified by number and nothing else. They were once named for
 * the spectrum bands -- Red through Violet -- and that was a mistake: the
 * spectrum means depth from the current camera, and only that. A stage called
 * "Green" invites the player to look for green blocks, or to believe green
 * matters somewhere else in the rules. Nothing about stage four is green.
 *
 * A stage may carry a `name`, but only when it has an identity worth naming --
 * a rule of its own, a new piece class, a board condition. None of the seven
 * does yet, so none of them has one.
 */

export interface StageConfig {
  /** 1-based stage number. This is the stage's identity. */
  readonly index: number;
  /**
   * Optional name, for a stage with a genuinely distinct identity: its own
   * rule, piece class, rotation behaviour or board condition. A name has to
   * tell the player something the number does not. Never a spectrum band.
   */
  readonly name?: string;
  /** Cells the active piece falls per second. */
  readonly gravity: number;
  /** How long a grounded piece may sit before locking. */
  readonly lockDelayMs: number;
  /** Cleared lines needed to fill the Shift meter. */
  readonly linesPerTurn: number;
  /** Highest piece tier that may appear. */
  readonly maxTier: number;
  /** Whether the player may shift a piece between depth lanes. */
  readonly depthNudge: boolean;
}

export const STAGES: readonly StageConfig[] = [
  { index: 1, gravity: 1.0, lockDelayMs: 500, linesPerTurn: 5, maxTier: 1, depthNudge: false },
  { index: 2, gravity: 1.4, lockDelayMs: 500, linesPerTurn: 5, maxTier: 2, depthNudge: false },
  { index: 3, gravity: 2.0, lockDelayMs: 500, linesPerTurn: 4, maxTier: 2, depthNudge: false },
  { index: 4, gravity: 2.8, lockDelayMs: 450, linesPerTurn: 4, maxTier: 3, depthNudge: true },
  { index: 5, gravity: 3.8, lockDelayMs: 450, linesPerTurn: 4, maxTier: 3, depthNudge: true },
  { index: 6, gravity: 5.2, lockDelayMs: 400, linesPerTurn: 3, maxTier: 4, depthNudge: true },
  { index: 7, gravity: 7.0, lockDelayMs: 350, linesPerTurn: 3, maxTier: 4, depthNudge: true },
] as const;

/**
 * Cleared lines required to advance one stage.
 *
 * Tuned against the greedy agent in `playability.test.ts`. At ten, a competent
 * run reached the last authored stage inside a single game and spent most of
 * its length past the end of the arc, which made finishing the arc routine
 * rather than an achievement. At fifteen the full arc is 90 lines, which sits
 * at the top of what that agent manages -- so the end of the arc is reachable
 * but has to be earned, and the endless tail is genuinely the far end.
 */
export const LINES_PER_STAGE = 15;

/** How many stages are authored by hand, before the endless tail. */
export const AUTHORED_STAGE_COUNT = STAGES.length;

/**
 * Stage configuration for a given cleared-line total.
 *
 * Past the last authored stage the arc continues indefinitely, gravity climbing
 * 15% per stage and the meter tightening to two lines. The numbering simply
 * keeps going; there is no separate tier to announce.
 */
export function stageForLines(lines: number): StageConfig {
  const index = Math.floor(lines / LINES_PER_STAGE) + 1;
  const last = STAGES[STAGES.length - 1] as StageConfig;
  if (index <= STAGES.length) return STAGES[index - 1] as StageConfig;

  const beyond = index - STAGES.length;
  return {
    index,
    gravity: last.gravity * Math.pow(1.15, beyond),
    lockDelayMs: 300,
    linesPerTurn: 2,
    maxTier: 4,
    depthNudge: true,
  };
}

/** True once the run has passed the last authored stage. */
export function isEndless(stage: StageConfig): boolean {
  return stage.index > AUTHORED_STAGE_COUNT;
}

/** How far into the endless tail a stage is, 1-based. Zero before it. */
export function endlessDepth(stage: StageConfig): number {
  return Math.max(0, stage.index - AUTHORED_STAGE_COUNT);
}

/**
 * How a stage is written on screen.
 *
 * The number is the identity. A name, if a stage ever earns one, is shown
 * alongside it rather than instead of it, so the player never loses track of
 * where they are in the arc.
 */
export function stageLabel(stage: StageConfig): string {
  return stage.name ? `Stage ${stage.index} — ${stage.name}` : `Stage ${stage.index}`;
}

/** Milliseconds per gravity step at this stage. */
export function gravityIntervalMs(stage: StageConfig): number {
  return 1000 / stage.gravity;
}
