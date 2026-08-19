/**
 * Persistence, as a pure data transform.
 *
 * The only rule that really matters here: **`migrate` never throws and always
 * returns something playable.** A save file is the one input the game cannot
 * validate at the source -- it is whatever was in `localStorage`, which may be
 * from an older build, a different game on the same origin, a half-finished
 * write, or a user poking at devtools. Losing a high score is a shame. Refusing
 * to boot is a bug.
 *
 * So every field is recovered independently: a corrupt `settings` block cannot
 * take the scores down with it, and an unreadable score for one mode cannot
 * take out the others. Anything unrecognised is replaced with its default and
 * the rest is kept.
 *
 * No `localStorage` in this file, and no `window`. The browser adapter lives in
 * `src/ui/storage.ts`; this is testable in milliseconds without either.
 */

import { DEFAULT_MODE_ID, MODES } from './modes';
import type { ModeId } from './modes';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'refraction.save.v1';

export interface Settings {
  readonly muted: boolean;
  /** 0 to 1. */
  readonly volume: number;
  readonly reducedMotion: boolean;
  readonly screenShake: boolean;
  readonly bloom: boolean;
  /** Turn the next-piece preview. Off is the harder option. */
  readonly spinPreview: boolean;
}

export interface ModeRecord {
  readonly bestScore: number;
  readonly bestLines: number;
  readonly bestStage: number;
  readonly runs: number;
}

export interface LifetimeStats {
  readonly runs: number;
  readonly lines: number;
  readonly turns: number;
  readonly prisms: number;
  /** Highest stage reached in any single run, in any mode. Drives unlocks. */
  readonly bestStage: number;
}

/**
 * One finished run, kept for the session log.
 *
 * Bests alone lose the shape of a sitting: a player who has just improved four
 * runs running is having a different evening from one who peaked an hour ago
 * and has been sliding since. The log is what lets the game show that.
 */
export interface SessionRun {
  readonly mode: ModeId;
  readonly score: number;
  readonly lines: number;
  readonly stage: number;
  /** Challenge code the run was played under, when it was a challenge. */
  readonly challenge?: string;
}

/** How many finished runs the session log keeps, newest first. */
export const SESSION_LOG_LIMIT = 10;

export interface SaveData {
  readonly version: number;
  readonly settings: Settings;
  readonly records: Readonly<Record<ModeId, ModeRecord>>;
  readonly stats: LifetimeStats;
  /** The last few finished runs, newest first. */
  readonly session: readonly SessionRun[];
  /** Last mode chosen, so the menu opens where the player left off. */
  readonly lastMode: ModeId;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  volume: 0.7,
  reducedMotion: false,
  screenShake: true,
  bloom: true,
  spinPreview: true,
};

const EMPTY_RECORD: ModeRecord = { bestScore: 0, bestLines: 0, bestStage: 0, runs: 0 };

const EMPTY_STATS: LifetimeStats = { runs: 0, lines: 0, turns: 0, prisms: 0, bestStage: 0 };

function emptyRecords(): Record<ModeId, ModeRecord> {
  const records = {} as Record<ModeId, ModeRecord>;
  for (const mode of MODES) records[mode.id] = EMPTY_RECORD;
  return records;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: DEFAULT_SETTINGS,
    records: emptyRecords(),
    stats: EMPTY_STATS,
    session: [],
    lastMode: DEFAULT_MODE_ID,
  };
}

/* ------------------------------------------------------------------ readers */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A finite number in range, or the fallback. Rejects NaN, Infinity, strings. */
function num(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readSettings(raw: unknown): Settings {
  if (!isObject(raw)) return DEFAULT_SETTINGS;
  return {
    muted: bool(raw['muted'], DEFAULT_SETTINGS.muted),
    volume: num(raw['volume'], DEFAULT_SETTINGS.volume, 0, 1),
    reducedMotion: bool(raw['reducedMotion'], DEFAULT_SETTINGS.reducedMotion),
    screenShake: bool(raw['screenShake'], DEFAULT_SETTINGS.screenShake),
    bloom: bool(raw['bloom'], DEFAULT_SETTINGS.bloom),
    spinPreview: bool(raw['spinPreview'], DEFAULT_SETTINGS.spinPreview),
  };
}

function readRecord(raw: unknown): ModeRecord {
  if (!isObject(raw)) return EMPTY_RECORD;
  return {
    bestScore: Math.floor(num(raw['bestScore'], 0)),
    bestLines: Math.floor(num(raw['bestLines'], 0)),
    bestStage: Math.floor(num(raw['bestStage'], 0)),
    runs: Math.floor(num(raw['runs'], 0)),
  };
}

function readRecords(raw: unknown): Record<ModeId, ModeRecord> {
  const records = emptyRecords();
  if (!isObject(raw)) return records;
  // Iterate the known modes, never the file's keys: a save naming a mode that
  // no longer exists simply loses that entry rather than reintroducing it.
  for (const mode of MODES) records[mode.id] = readRecord(raw[mode.id]);
  return records;
}

function readStats(raw: unknown, records: Record<ModeId, ModeRecord>): LifetimeStats {
  const stated = isObject(raw) ? raw : {};
  // Unlocks hang off bestStage, so it is reconciled against the per-mode
  // records rather than trusted on its own. A save that lost its stats block
  // still keeps whatever the records prove was earned.
  const provenBest = MODES.reduce((best, mode) => Math.max(best, records[mode.id].bestStage), 0);
  return {
    runs: Math.floor(num(stated['runs'], 0)),
    lines: Math.floor(num(stated['lines'], 0)),
    turns: Math.floor(num(stated['turns'], 0)),
    prisms: Math.floor(num(stated['prisms'], 0)),
    bestStage: Math.max(Math.floor(num(stated['bestStage'], 0)), provenBest),
  };
}

/**
 * The session log, dropping any entry that is not fully readable.
 *
 * A log is decoration, not a record of achievement, so a damaged entry is
 * simply discarded rather than repaired into a run that never happened.
 */
function readSession(raw: unknown): SessionRun[] {
  if (!Array.isArray(raw)) return [];
  const runs: SessionRun[] = [];
  for (const entry of raw.slice(0, SESSION_LOG_LIMIT)) {
    if (!isObject(entry)) continue;
    const mode = entry['mode'];
    if (!MODES.some((known) => known.id === mode)) continue;
    const challenge = entry['challenge'];
    runs.push({
      mode: mode as ModeId,
      score: Math.floor(num(entry['score'], 0)),
      lines: Math.floor(num(entry['lines'], 0)),
      stage: Math.floor(num(entry['stage'], 0)),
      ...(typeof challenge === 'string' && challenge.length > 0 ? { challenge } : {}),
    });
  }
  return runs;
}

function readModeId(raw: unknown): ModeId {
  return MODES.some((mode) => mode.id === raw) ? (raw as ModeId) : DEFAULT_MODE_ID;
}

/**
 * Turn anything at all into a valid save.
 *
 * Accepts a parsed object, a JSON string, `null`, or complete nonsense. Never
 * throws.
 */
export function migrate(raw: unknown): SaveData {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return defaultSave();
    }
  }
  if (!isObject(source)) return defaultSave();

  const records = readRecords(source['records']);
  return {
    version: SAVE_VERSION,
    settings: readSettings(source['settings']),
    records,
    stats: readStats(source['stats'], records),
    session: readSession(source['session']),
    lastMode: readModeId(source['lastMode']),
  };
}

/* ------------------------------------------------------------------ writers */

export interface RunOutcome {
  readonly mode: ModeId;
  readonly score: number;
  readonly lines: number;
  readonly stage: number;
  readonly turns: number;
  readonly prisms: number;
  /** Set when the run was played under a challenge code. */
  readonly challenge?: string;
}

/** Whether a finished run beat the stored best for its mode. */
export function isPersonalBest(save: SaveData, outcome: RunOutcome): boolean {
  return outcome.score > (save.records[outcome.mode]?.bestScore ?? 0);
}

/** Fold a finished run into the save. Pure: returns a new save. */
export function recordRun(save: SaveData, outcome: RunOutcome): SaveData {
  const previous = save.records[outcome.mode] ?? EMPTY_RECORD;
  const record: ModeRecord = {
    bestScore: Math.max(previous.bestScore, Math.floor(outcome.score)),
    bestLines: Math.max(previous.bestLines, Math.floor(outcome.lines)),
    bestStage: Math.max(previous.bestStage, Math.floor(outcome.stage)),
    runs: previous.runs + 1,
  };

  const logged: SessionRun = {
    mode: outcome.mode,
    score: Math.floor(outcome.score),
    lines: Math.floor(outcome.lines),
    stage: Math.floor(outcome.stage),
    ...(outcome.challenge ? { challenge: outcome.challenge } : {}),
  };

  return {
    ...save,
    session: [logged, ...save.session].slice(0, SESSION_LOG_LIMIT),
    records: { ...save.records, [outcome.mode]: record },
    stats: {
      runs: save.stats.runs + 1,
      lines: save.stats.lines + Math.floor(outcome.lines),
      turns: save.stats.turns + Math.floor(outcome.turns),
      prisms: save.stats.prisms + Math.floor(outcome.prisms),
      bestStage: Math.max(save.stats.bestStage, Math.floor(outcome.stage)),
    },
    lastMode: outcome.mode,
  };
}

export function withSettings(save: SaveData, settings: Partial<Settings>): SaveData {
  return { ...save, settings: { ...save.settings, ...settings } };
}
