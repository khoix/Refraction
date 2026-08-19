/**
 * The game state machine.
 *
 * Pure simulation: no DOM, no WebGL, no wall clock. `tick` is handed a fixed
 * timestep and inputs arrive as intents, so a run is entirely determined by
 * `(seed, input log)`.
 *
 * The active piece lives in **view space** -- offsets of `(u, y, lane)` on the
 * face currently being played -- and is converted to world coordinates only for
 * collision and locking. That is deliberate: a turn only ever happens between
 * pieces, so no in-flight piece is ever reinterpreted across faces, and piece
 * rotation becomes an ordinary rotation in the frame the player is looking at.
 */

import { Board } from './board';
import type { Line } from './board';
import { BOARD_HEIGHT, BOARD_HEIGHT_TOTAL } from './constants';
import { Dealer } from './dealer';
import type { DealtPiece } from './dealer';
import type { PieceCatalog, PieceDef, PieceId, RotationAxis } from './pieces';
import { PIECES_BY_ID, extent, normalize, rotate } from './pieces';
import { columnCount, fromView, laneCount, turn } from './projection';
import { createRng } from './rng';
import type { Rng } from './rng';
import type { ClearContext } from './scoring';
import { HARD_DROP_PER_CELL, SOFT_DROP_PER_CELL, clearLabel, scoreClear } from './scoring';
import type { StageConfig } from './stages';
import { LINES_PER_STAGE, stageForLines } from './stages';
import type { ModeConfig } from './modes';
import { AUTHORED_MODE_ID, modeById, modeGravity, modeStage } from './modes';
import type { Cell, Face, TurnDirection } from './types';

export type GameStatus =
  'falling' | 'awaitingTurn' | 'turning' | 'resolving' | 'paused' | 'gameOver';

/** How the player rotates the active piece. */
export type RotationKind = 'roll' | 'yaw' | 'pitch';

export interface ActivePiece {
  readonly id: PieceId;
  /** View-space offsets: x is the on-screen column, y is height, z is depth lane. */
  readonly offsets: readonly Cell[];
  readonly u: number;
  readonly y: number;
  readonly lane: number;
}

export interface GameEvent {
  readonly type: 'lock' | 'clear' | 'turn' | 'stage' | 'gameOver' | 'hold' | 'rescue';
  readonly lines?: number;
  readonly label?: string;
  readonly score?: number;
  readonly face?: Face;
  /** Which way the board turned. Present on 'turn' events; drives the camera. */
  readonly direction?: TurnDirection;
  readonly cleared?: readonly Line[];
  /** The world cells a piece just locked into. Present on 'lock' events. */
  readonly cells?: readonly Cell[];
  /** True on the clear that completed a four-face revolution. */
  readonly prism?: boolean;
  /** 0 for the initial clear of a resolution, 1+ for each cascade after it. */
  readonly cascade?: number;
  /** True when the turn itself made these lines eligible. */
  readonly refraction?: boolean;
}

export interface GameOptions {
  readonly seed: string | number;
  /** Which mode's rules apply. Defaults to Ascent, the authored arc. */
  readonly mode?: ModeConfig;
  /** Overrides the stage's own depth-nudge gating. Used by Prism and Zen. */
  readonly forceDepthNudge?: boolean;
  /**
   * Which piece vocabulary to deal from. `experimental` is the M6.5 playtest
   * bed -- non-planar pieces from stage 1, tricubes and pentacubes later --
   * and is reachable only through the `?pieces=experimental` flag.
   */
  readonly catalog?: PieceCatalog;
  /** Seconds the turn prompt waits before repeating the last direction. */
  readonly turnPromptTimeoutMs?: number;
  /** How long the board spends turning. Must match the renderer's animation. */
  readonly turnDurationMs?: number;
  /** How long a completed line is held, lit, before it is removed. */
  readonly clearFlashMs?: number;
}

const TURN_PROMPT_TIMEOUT_MS = 5000;
export const DEFAULT_TURN_DURATION_MS = 750;
export const DEFAULT_CLEAR_FLASH_MS = 170;
/**
 * The stage from which Peek stops being offered.
 *
 * Six rather than seven: the last authored stage should be played on the
 * spectrum alone, not be the first one where that is true.
 */
export const PEEK_LOCKED_FROM_STAGE = 6;
const MAX_LOCK_RESETS = 15;
const SOFT_DROP_MULTIPLIER = 20;

/** Kick offsets in view space, tried in order. Depth kicks precede vertical ones. */
const KICKS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [2, 0, 0],
  [-2, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [-1, 1, 0],
];

export class Game {
  readonly board = new Board();
  face: Face = 'front';
  status: GameStatus = 'falling';
  active: ActivePiece | null = null;

  score = 0;
  lines = 0;
  shiftMeter = 0;
  refractionChain = 0;
  /** Turns taken and Prism events closed, for the run's record. */
  turns = 0;
  prisms = 0;

  readonly mode: ModeConfig;

  private readonly rng: Rng;
  private readonly dealer: Dealer;
  private readonly options: GameOptions;

  private queue: DealtPiece[] = [];
  private heldPiece: { def: PieceDef; lane: number } | null = null;
  private holdUsed = false;

  /**
   * Lines that are complete and are being held, lit, before removal. The
   * renderer glows these; the engine removes them when the flash elapses.
   */
  clearingLines: readonly Line[] = [];
  /**
   * Lines that will be eligible the moment the board finishes turning.
   *
   * Populated when the turn starts, so the reveal can be *seen*: the lines glow
   * through the whole rotation and clear on arrival. They are found by looking
   * at the destination face, and nothing on the board has moved -- the turn only
   * changes which axis counts.
   */
  pendingClears: readonly Line[] = [];

  private gravityTimer = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private grounded = false;
  private turnPromptTimer = 0;
  private turnTimer = 0;
  private resolveTimer = 0;
  private resolveRefraction = false;
  private cascadeIndex = 0;
  private linesThisResolve = 0;
  private lastTurnDirection: TurnDirection = 'right';
  /** Status to return to on resume. Null whenever the game is not paused. */
  private statusBeforePause: GameStatus | null = null;
  private revolutionFaces = new Set<Face>();
  private events: GameEvent[] = [];

  constructor(options: GameOptions) {
    this.options = options;
    this.mode = options.mode ?? modeById(AUTHORED_MODE_ID);
    this.rng = createRng(options.seed);
    this.dealer = new Dealer(this.rng, this.stage.maxTier, options.catalog ?? 'standard');
    for (let i = 0; i < 3; i += 1) this.queue.push(this.dealer.deal());
    this.spawn();
  }

  // ---------------------------------------------------------------- accessors

  get stage(): StageConfig {
    return modeStage(this.mode, this.lines, stageForLines, LINES_PER_STAGE);
  }

  /** Cells per second right now, after the mode's own acceleration. */
  get gravity(): number {
    return modeGravity(this.mode, this.stage, this.lines);
  }

  get depthNudgeAllowed(): boolean {
    return this.options.forceDepthNudge === true || this.stage.depthNudge;
  }

  /**
   * Whether Peek is available: hold to tilt the camera and read depth from
   * parallax instead of from colour.
   *
   * A comprehension tool, and one that has to withdraw, because it supplements
   * the spectrum rather than replacing it.
   *
   * **Off in a mode with no depth colour.** In Blind Spectrum there is no colour
   * to supplement, so Peek would not be an aid to reading depth -- it would be
   * the only way to read it, and the mode's entire premise is that there isn't
   * one. The rule keys off `depthColour` rather than naming the mode, because
   * that is the actual reason.
   *
   * **Off from Stage 6.** By then the spectrum has to carry it alone; that is
   * the skill the arc exists to teach, and a tool that never withdraws teaches
   * the player to lean on it instead.
   */
  get peekAllowed(): boolean {
    return this.mode.depthColour && this.stage.index < PEEK_LOCKED_FROM_STAGE;
  }

  get held(): PieceId | null {
    return this.heldPiece?.def.id ?? null;
  }

  /** The next three pieces, nearest first. */
  get preview(): readonly DealtPiece[] {
    return this.queue;
  }

  /** Drain queued events. The renderer and audio layer consume these. */
  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** World cells occupied by the active piece. */
  activeCells(): Cell[] {
    return this.active ? this.worldCells(this.active) : [];
  }

  /** World cells the active piece would occupy if hard-dropped now. */
  ghostCells(): Cell[] {
    if (!this.active) return [];
    let piece = this.active;
    while (this.fits({ ...piece, y: piece.y - 1 })) piece = { ...piece, y: piece.y - 1 };
    return this.worldCells(piece);
  }

  /**
   * The settled cubes the falling piece is aimed at -- its first-contact
   * surface. The piece acts as a vertical flashlight: for each occupied
   * `(x, z)` column of its footprint, trace down from its lowest cube and
   * report only the topmost settled cube found. Nothing beneath that cube is
   * reported, and a column over bare floor contributes nothing.
   *
   * Derived entirely from the piece's current position, so it follows every
   * move, rotation and fall for free, and is empty the moment the piece locks.
   */
  firstContactCells(): Cell[] {
    if (this.status !== 'falling' || !this.active) return [];

    // The lowest cube of the piece in each occupied (x, z) column.
    const lowest = new Map<string, Cell>();
    for (const cell of this.worldCells(this.active)) {
      const key = `${cell.x},${cell.z}`;
      const known = lowest.get(key);
      if (!known || cell.y < known.y) lowest.set(key, cell);
    }

    const contacts: Cell[] = [];
    for (const from of lowest.values()) {
      for (let y = from.y - 1; y >= 0; y -= 1) {
        if (this.board.isFilled({ x: from.x, y, z: from.z })) {
          contacts.push({ x: from.x, y, z: from.z });
          break;
        }
      }
    }
    return contacts;
  }

  /**
   * Whether a shape fits at a view-space position on the current face.
   * Public so that placement search -- hints, tests, tuning -- can reuse the
   * engine's own collision rules instead of reimplementing them.
   */
  canPlace(offsets: readonly Cell[], u: number, y: number, lane: number): boolean {
    return this.fits({ id: 'I', offsets, u, y, lane });
  }

  /** Lowest resting height for a shape in this column and lane, or null. */
  dropHeight(offsets: readonly Cell[], u: number, lane: number): number | null {
    let y = BOARD_HEIGHT_TOTAL;
    if (!this.canPlace(offsets, u, y, lane)) return null;
    while (this.canPlace(offsets, u, y - 1, lane)) y -= 1;
    return y;
  }

  // ------------------------------------------------------------------- inputs

  moveHorizontal(direction: -1 | 1): boolean {
    return this.tryShift({ u: direction, y: 0, lane: 0 });
  }

  /** Shift the piece one depth lane. Gated until Stage 4 unless overridden. */
  nudgeDepth(direction: -1 | 1): boolean {
    if (!this.depthNudgeAllowed) return false;
    return this.tryShift({ u: 0, y: 0, lane: direction });
  }

  softDrop(): boolean {
    const moved = this.tryShift({ u: 0, y: -1, lane: 0 });
    if (moved) this.score += SOFT_DROP_PER_CELL;
    return moved;
  }

  hardDrop(): void {
    if (this.status !== 'falling' || !this.active) return;
    let distance = 0;
    while (this.fits({ ...this.active, y: this.active.y - 1 })) {
      this.active = { ...this.active, y: this.active.y - 1 };
      distance += 1;
    }
    this.score += distance * HARD_DROP_PER_CELL;
    this.lock();
  }

  /**
   * Rotate the active piece.
   *
   * `roll` spins in the screen plane, which on any face is exactly a classic
   * falling-block rotation. `yaw` and `pitch` are the two extra axes a 3D board
   * makes available.
   */
  rotatePiece(kind: RotationKind, clockwise = true): boolean {
    if (this.status !== 'falling' || !this.active) return false;
    if (kind !== 'roll' && !this.stageAllowsRotation(kind)) return false;

    const axis: RotationAxis = kind === 'roll' ? 'z' : kind === 'yaw' ? 'y' : 'x';
    const rotated = rotate([...this.active.offsets], axis, clockwise);

    for (const [du, dy, dlane] of KICKS) {
      const candidate: ActivePiece = {
        ...this.active,
        offsets: rotated,
        u: this.active.u + du,
        y: this.active.y + dy,
        lane: this.active.lane + dlane,
      };
      if (this.fits(candidate)) {
        this.active = candidate;
        this.onPieceMoved();
        return true;
      }
    }
    return false;
  }

  hold(): boolean {
    if (this.status !== 'falling' || !this.active || this.holdUsed) return false;

    const activeId = this.active.id;
    const outgoing = PIECES_BY_ID.get(activeId);
    if (!outgoing) return false;

    const incoming = this.heldPiece;
    this.heldPiece = { def: outgoing, lane: this.active.lane };

    if (incoming === null) {
      this.spawn();
    } else {
      this.place(incoming.def.id, normalize([...incoming.def.cells]), incoming.lane);
    }
    this.holdUsed = true;
    this.events.push({ type: 'hold' });
    return true;
  }

  /** Answer the Shift prompt. Ignored unless a turn is pending. */
  chooseTurn(direction: TurnDirection): boolean {
    if (this.status !== 'awaitingTurn') return false;
    this.beginTurn(direction);
    return true;
  }

  /** How far through the turn the board is, 0 to 1. */
  get turnProgress(): number {
    if (this.status !== 'turning') return 1;
    return Math.min(1, this.turnTimer / this.turnDurationMs);
  }

  private get turnDurationMs(): number {
    return this.options.turnDurationMs ?? DEFAULT_TURN_DURATION_MS;
  }

  private get clearFlashMs(): number {
    return this.options.clearFlashMs ?? DEFAULT_CLEAR_FLASH_MS;
  }

  // -------------------------------------------------------------------- clock

  /**
   * Freeze the run.
   *
   * Pause is a real engine state rather than a flag the host holds, because
   * every input path already refuses to act outside `falling` and
   * `awaitingTurn` -- so one status change closes all of them at once, and the
   * renderer can see that the game is stopped rather than inferring it.
   *
   * It consumes no simulated time and mutates nothing else, so `(seed, input
   * log)` still determines the run exactly: a log with pauses in it replays
   * identically to one without. Mid-turn and mid-cascade pauses resume into the
   * same state with their timers untouched.
   *
   * Returns false when there was nothing to pause.
   */
  pause(): boolean {
    if (this.status === 'paused' || this.status === 'gameOver') return false;
    this.statusBeforePause = this.status;
    this.status = 'paused';
    return true;
  }

  /** Resume exactly where the pause interrupted. */
  resume(): boolean {
    if (this.status !== 'paused' || this.statusBeforePause === null) return false;
    this.status = this.statusBeforePause;
    this.statusBeforePause = null;
    return true;
  }

  tick(deltaMs: number): void {
    if (this.status === 'gameOver' || this.status === 'paused') return;

    if (this.status === 'awaitingTurn') {
      this.turnPromptTimer += deltaMs;
      const timeout = this.options.turnPromptTimeoutMs ?? TURN_PROMPT_TIMEOUT_MS;
      if (this.turnPromptTimer >= timeout) this.beginTurn(this.lastTurnDirection);
      return;
    }

    if (this.status === 'turning') {
      this.turnTimer += deltaMs;
      if (this.turnTimer >= this.turnDurationMs) this.completeTurn();
      return;
    }

    if (this.status === 'resolving') {
      this.resolveTimer += deltaMs;
      // A single large tick may carry several cascade steps. Looping here keeps
      // a headless `tick(1000)` equivalent to a second of real frames.
      while (this.status === 'resolving' && this.resolveTimer >= this.clearFlashMs) {
        this.resolveTimer -= this.clearFlashMs;
        this.applyClearStep();
      }
      return;
    }

    if (!this.active) return;

    this.gravityTimer += deltaMs;
    const interval = 1000 / this.gravity;
    while (this.gravityTimer >= interval) {
      this.gravityTimer -= interval;
      if (!this.tryShift({ u: 0, y: -1, lane: 0 }, false)) break;
    }

    this.grounded = !this.fits({ ...this.active, y: this.active.y - 1 });
    if (this.grounded) {
      this.lockTimer += deltaMs;
      if (this.lockTimer >= this.stage.lockDelayMs) this.lock();
    } else {
      this.lockTimer = 0;
    }
  }

  /** Soft drop runs at a multiple of the stage's gravity. */
  softDropIntervalMs(): number {
    return 1000 / this.gravity / SOFT_DROP_MULTIPLIER;
  }

  // ------------------------------------------------------------------ internals

  private stageAllowsRotation(kind: RotationKind): boolean {
    if (kind === 'yaw') return this.stage.index >= 4 || this.options.forceDepthNudge === true;
    return this.stage.index >= 6 || this.options.forceDepthNudge === true;
  }

  private worldCells(piece: ActivePiece): Cell[] {
    return piece.offsets.map((offset) =>
      fromView(this.face, {
        u: piece.u + offset.x,
        y: piece.y + offset.y,
        lane: piece.lane + offset.z,
      })
    );
  }

  private fits(piece: ActivePiece): boolean {
    for (const offset of piece.offsets) {
      const u = piece.u + offset.x;
      const lane = piece.lane + offset.z;
      const y = piece.y + offset.y;
      if (u < 0 || u >= columnCount(this.face)) return false;
      if (lane < 0 || lane >= laneCount(this.face)) return false;
      if (this.board.isBlocked(fromView(this.face, { u, y, lane }))) return false;
    }
    return true;
  }

  private tryShift(delta: { u: number; y: number; lane: number }, countsAsMove = true): boolean {
    if (this.status !== 'falling' || !this.active) return false;
    const candidate: ActivePiece = {
      ...this.active,
      u: this.active.u + delta.u,
      y: this.active.y + delta.y,
      lane: this.active.lane + delta.lane,
    };
    if (!this.fits(candidate)) return false;
    this.active = candidate;
    if (countsAsMove) this.onPieceMoved();
    return true;
  }

  /** Movement refreshes the lock delay, up to a bounded number of times. */
  private onPieceMoved(): void {
    if (!this.grounded) return;
    if (this.lockResets >= MAX_LOCK_RESETS) return;
    this.lockResets += 1;
    this.lockTimer = 0;
  }

  private spawn(): void {
    const next = this.queue.shift();
    if (!next) return;
    this.queue.push(this.dealer.deal());
    // The dealt orientation, not the canonical one: at tier 4 a piece may
    // arrive as any of its projections.
    this.place(next.def.id, normalize([...next.cells]), next.lane);
  }

  private place(id: PieceId, offsets: Cell[], dealtLane: number): void {
    const size = extent(offsets);
    const u = Math.max(0, Math.floor((columnCount(this.face) - size.x) / 2));
    const lane = Math.min(Math.max(dealtLane, 0), laneCount(this.face) - size.z);
    // Spawn inside the visible field rather than in the buffer above it: a piece
    // hovering above the well reads as detached from the board. The buffer is
    // there to catch locked cells that end up too high, not to stage pieces in.
    const y = BOARD_HEIGHT - size.y;

    const piece: ActivePiece = { id, offsets, u, y, lane };
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.grounded = false;

    if (!this.fits(piece)) {
      // A mode with no failure state takes the top of the stack off instead of
      // ending, then places the same piece in the room that made.
      if (this.rescue(() => this.fits(piece))) {
        this.active = piece;
        return;
      }
      this.active = piece;
      this.status = 'gameOver';
      this.events.push({ type: 'gameOver' });
      return;
    }
    this.active = piece;
  }

  private lock(): void {
    if (!this.active) return;
    const cells = this.worldCells(this.active);
    for (const cell of cells) this.board.fill(cell);
    this.events.push({ type: 'lock', cells });
    this.active = null;
    this.holdUsed = false;

    this.beginResolve(false);
  }

  /**
   * Start the rotation.
   *
   * The face changes immediately -- that is what makes the other axis the live
   * one -- but nothing is cleared yet. The lines that will be eligible on
   * arrival are recorded in `pendingClears` so they can glow for the whole
   * rotation, and they are removed only when the board finishes turning. This
   * is the reveal, and it has to be visible to be worth anything.
   */
  private beginTurn(direction: TurnDirection): void {
    this.turns += 1;
    this.lastTurnDirection = direction;
    this.shiftMeter = Math.max(0, this.shiftMeter - this.stage.linesPerTurn);
    this.face = turn(this.face, direction);
    this.status = 'turning';
    this.turnTimer = 0;
    this.turnPromptTimer = 0;
    this.pendingClears = this.board.findCompleteLines(this.face);
    this.events.push({ type: 'turn', face: this.face, direction });
  }

  private completeTurn(): void {
    this.pendingClears = [];
    this.turnTimer = 0;
    this.beginResolve(true);
  }

  /**
   * Begin resolving completed lines on the current face.
   *
   * Resolution is staged rather than instantaneous: each cascade step holds its
   * completed lines lit for `clearFlashMs` before removing them, so the player
   * can see which lines went and why. The engine owns that timing, not the
   * renderer, which keeps a run reproducible from `(seed, input log)` -- a
   * headless `tick` walks through exactly the same steps.
   */
  private beginResolve(refraction: boolean): void {
    this.resolveRefraction = refraction;
    this.cascadeIndex = 0;
    this.linesThisResolve = 0;
    this.resolveTimer = 0;
    this.advanceResolve();
  }

  /** Queue the next cascade step, or finish if the board is stable. */
  private advanceResolve(): void {
    const complete = this.board.findCompleteLines(this.face);
    if (complete.length === 0) {
      this.finishResolve();
      return;
    }
    this.clearingLines = complete;
    this.status = 'resolving';
  }

  /** Remove the lines currently lit, score them, and look for a cascade. */
  private applyClearStep(): void {
    const complete = this.clearingLines;
    if (complete.length === 0) {
      this.finishResolve();
      return;
    }

    const stageBefore = this.stage.index;
    this.board.clearLines(this.face, complete);
    this.clearingLines = [];

    this.lines += complete.length;
    this.shiftMeter += complete.length;
    this.linesThisResolve += complete.length;

    let prism = false;
    if (this.resolveRefraction) {
      this.revolutionFaces.add(this.face);
      if (this.revolutionFaces.size === 4) {
        prism = true;
        this.revolutionFaces.clear();
      }
    }

    const context: ClearContext = {
      lines: complete.length,
      stage: this.stage.index,
      cascadeIndex: this.cascadeIndex,
      refraction: this.resolveRefraction,
      chain: this.resolveRefraction ? this.refractionChain + 1 : 0,
      prism,
    };
    // Mode-specific scoring: Prism weights the turn's own clears, and the flat
    // scale prices the risk each mode actually carries.
    const gained = Math.round(
      scoreClear(context) *
        this.mode.scoreScale *
        (this.resolveRefraction ? this.mode.refractionScale : 1)
    );
    this.score += gained;
    if (prism) this.prisms += 1;

    const label = clearLabel(context);
    this.events.push({
      type: 'clear',
      lines: complete.length,
      score: gained,
      cleared: complete,
      cascade: this.cascadeIndex,
      refraction: this.resolveRefraction,
      ...(prism ? { prism: true } : {}),
      ...(label ? { label } : {}),
    });

    this.cascadeIndex += 1;
    this.dealer.setTier(this.stage.maxTier);
    if (this.stage.index !== stageBefore) this.events.push({ type: 'stage' });

    this.advanceResolve();
  }

  /**
   * Make room at the top rather than ending the run.
   *
   * Only modes with `canFail: false` get this. Rows come off the top one at a
   * time and nothing below moves, so the structure the player has been building
   * is left intact -- the rescue is visibly local, not a board wipe.
   *
   * `canProceed` is the condition being rescued *for* -- room for a specific
   * piece, or simply a stack below the buffer -- because "not topped out" is
   * not the same as "the next piece fits". Rescuing only to the weaker of the
   * two would still end the run one piece later.
   *
   * Returns false if the mode can fail, or if the board ran out of rows to
   * remove without satisfying the condition (a piece that cannot fit an empty
   * board is a bug, and is allowed to end the run rather than loop forever).
   */
  private rescue(canProceed: () => boolean): boolean {
    if (this.mode.canFail) return false;
    let removed = false;
    // Bounded by the board height: `removeHighestRow` strictly lowers the
    // stack each time, so this cannot spin.
    for (let i = 0; i < BOARD_HEIGHT_TOTAL && !canProceed(); i += 1) {
      if (!this.board.removeHighestRow()) break;
      removed = true;
    }
    if (!canProceed()) return false;
    if (removed) this.events.push({ type: 'rescue' });
    return true;
  }

  /** Board is stable. Decide what happens next. */
  private finishResolve(): void {
    this.clearingLines = [];

    if (this.resolveRefraction) {
      if (this.linesThisResolve > 0) {
        this.refractionChain += 1;
      } else {
        this.refractionChain = 0;
        this.revolutionFaces.clear();
      }
    }

    if (this.board.isToppedOut() && !this.rescue(() => !this.board.isToppedOut())) {
      this.status = 'gameOver';
      this.events.push({ type: 'gameOver' });
      return;
    }

    // The meter can fill from the clears that just resolved, including the ones
    // a turn produced -- which is what lets a chain run across several faces.
    if (this.shiftMeter >= this.stage.linesPerTurn) {
      this.status = 'awaitingTurn';
      this.turnPromptTimer = 0;
      return;
    }

    this.status = 'falling';
    this.spawn();
  }
}

/** The face the player would see after turning, without performing the turn. */
export function facePreview(face: Face, direction: TurnDirection): Face {
  return turn(face, direction);
}
