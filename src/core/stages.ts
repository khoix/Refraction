/**
 * The Red -> Violet difficulty arc, plus the endless Ultraviolet tier.
 *
 * Values come from section 5.2 and section 7 of the design spec.
 */

export interface StageConfig {
  /** 1-based stage number. */
  readonly index: number;
  readonly name: string;
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
  {
    index: 1,
    name: 'Red',
    gravity: 1.0,
    lockDelayMs: 500,
    linesPerTurn: 5,
    maxTier: 1,
    depthNudge: false,
  },
  {
    index: 2,
    name: 'Orange',
    gravity: 1.4,
    lockDelayMs: 500,
    linesPerTurn: 5,
    maxTier: 2,
    depthNudge: false,
  },
  {
    index: 3,
    name: 'Yellow',
    gravity: 2.0,
    lockDelayMs: 500,
    linesPerTurn: 4,
    maxTier: 2,
    depthNudge: false,
  },
  {
    index: 4,
    name: 'Green',
    gravity: 2.8,
    lockDelayMs: 450,
    linesPerTurn: 4,
    maxTier: 3,
    depthNudge: true,
  },
  {
    index: 5,
    name: 'Blue',
    gravity: 3.8,
    lockDelayMs: 450,
    linesPerTurn: 4,
    maxTier: 3,
    depthNudge: true,
  },
  {
    index: 6,
    name: 'Indigo',
    gravity: 5.2,
    lockDelayMs: 400,
    linesPerTurn: 3,
    maxTier: 4,
    depthNudge: true,
  },
  {
    index: 7,
    name: 'Violet',
    gravity: 7.0,
    lockDelayMs: 350,
    linesPerTurn: 3,
    maxTier: 4,
    depthNudge: true,
  },
] as const;

/** Cleared lines required to advance one stage. */
export const LINES_PER_STAGE = 10;

export const ULTRAVIOLET_NAME = 'Ultraviolet';

/**
 * Stage configuration for a given cleared-line total.
 *
 * Past Violet the arc continues into Ultraviolet, where gravity keeps climbing
 * 15% per stage and the meter tightens to two lines.
 */
export function stageForLines(lines: number): StageConfig {
  const index = Math.floor(lines / LINES_PER_STAGE) + 1;
  const last = STAGES[STAGES.length - 1] as StageConfig;
  if (index <= STAGES.length) return STAGES[index - 1] as StageConfig;

  const beyond = index - STAGES.length;
  return {
    index,
    name: `${ULTRAVIOLET_NAME} ${beyond}`,
    gravity: last.gravity * Math.pow(1.15, beyond),
    lockDelayMs: 300,
    linesPerTurn: 2,
    maxTier: 4,
    depthNudge: true,
  };
}

/** Milliseconds per gravity step at this stage. */
export function gravityIntervalMs(stage: StageConfig): number {
  return 1000 / stage.gravity;
}
