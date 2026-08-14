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
import type { PieceDef, PieceId, RotationAxis } from './pieces';
import { PIECES_BY_ID, extent, normalize, rotate } from './pieces';
import { columnCount, fromView, laneCount, turn } from './projection';
import { createRng } from './rng';
import type { Rng } from './rng';
import type { ClearContext } from './scoring';
import { HARD_DROP_PER_CELL, SOFT_DROP_PER_CELL, clearLabel, scoreClear } from './scoring';
import type { StageConfig } from './stages';
import { gravityIntervalMs, stageForLines } from './stages';
import type { Cell, Face, TurnDirection } from './types';

export type GameStatus = 'falling' | 'awaitingTurn' | 'gameOver';

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
  readonly type: 'lock' | 'clear' | 'turn' | 'stage' | 'gameOver' | 'hold';
  readonly lines?: number;
  readonly label?: string;
  readonly score?: number;
  readonly face?: Face;
  /** Which way the board turned. Present on 'turn' events; drives the camera. */
  readonly direction?: TurnDirection;
  readonly cleared?: readonly Line[];
}

export interface GameOptions {
  readonly seed: string | number;
  /** Overrides the stage's own depth-nudge gating. Used by Prism and Zen. */
  readonly forceDepthNudge?: boolean;
  /** Seconds the turn prompt waits before repeating the last direction. */
  readonly turnPromptTimeoutMs?: number;
}

const TURN_PROMPT_TIMEOUT_MS = 5000;
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

  private readonly rng: Rng;
  private readonly dealer: Dealer;
  private readonly options: GameOptions;

  private queue: { def: PieceDef; lane: number }[] = [];
  private heldPiece: { def: PieceDef; lane: number } | null = null;
  private holdUsed = false;

  private gravityTimer = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private grounded = false;
  private turnPromptTimer = 0;
  private lastTurnDirection: TurnDirection = 'right';
  private revolutionFaces = new Set<Face>();
  private events: GameEvent[] = [];

  constructor(options: GameOptions) {
    this.options = options;
    this.rng = createRng(options.seed);
    this.dealer = new Dealer(this.rng, this.stage.maxTier);
    for (let i = 0; i < 3; i += 1) this.queue.push(this.dealer.deal());
    this.spawn();
  }

  // ---------------------------------------------------------------- accessors

  get stage(): StageConfig {
    return stageForLines(this.lines);
  }

  get depthNudgeAllowed(): boolean {
    return this.options.forceDepthNudge === true || this.stage.depthNudge;
  }

  get held(): PieceId | null {
    return this.heldPiece?.def.id ?? null;
  }

  /** The next three pieces, nearest first. */
  get preview(): readonly { def: PieceDef; lane: number }[] {
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
    this.performTurn(direction);
    return true;
  }

  // -------------------------------------------------------------------- clock

  tick(deltaMs: number): void {
    if (this.status === 'gameOver') return;

    if (this.status === 'awaitingTurn') {
      this.turnPromptTimer += deltaMs;
      const timeout = this.options.turnPromptTimeoutMs ?? TURN_PROMPT_TIMEOUT_MS;
      if (this.turnPromptTimer >= timeout) this.performTurn(this.lastTurnDirection);
      return;
    }

    if (!this.active) return;

    this.gravityTimer += deltaMs;
    const interval = gravityIntervalMs(this.stage);
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
    return gravityIntervalMs(this.stage) / SOFT_DROP_MULTIPLIER;
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
    this.place(next.def.id, normalize([...next.def.cells]), next.lane);
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
      this.active = piece;
      this.status = 'gameOver';
      this.events.push({ type: 'gameOver' });
      return;
    }
    this.active = piece;
  }

  private lock(): void {
    if (!this.active) return;
    for (const cell of this.worldCells(this.active)) this.board.fill(cell);
    this.events.push({ type: 'lock' });
    this.active = null;
    this.holdUsed = false;

    this.resolveClears(false);

    if (this.board.isToppedOut()) {
      this.status = 'gameOver';
      this.events.push({ type: 'gameOver' });
      return;
    }

    if (this.shiftMeter >= this.stage.linesPerTurn) {
      this.status = 'awaitingTurn';
      this.turnPromptTimer = 0;
      return;
    }

    this.spawn();
  }

  private performTurn(direction: TurnDirection): void {
    this.lastTurnDirection = direction;
    this.shiftMeter = Math.max(0, this.shiftMeter - this.stage.linesPerTurn);
    this.face = turn(this.face, direction);
    this.status = 'falling';
    this.turnPromptTimer = 0;
    this.events.push({ type: 'turn', face: this.face, direction });

    const cleared = this.resolveClears(true);
    if (cleared > 0) {
      this.refractionChain += 1;
    } else {
      this.refractionChain = 0;
      this.revolutionFaces.clear();
    }

    if (this.board.isToppedOut()) {
      this.status = 'gameOver';
      this.events.push({ type: 'gameOver' });
      return;
    }
    this.spawn();
  }

  /**
   * Clear every complete line on the current face, then cascade until stable.
   * Returns the total number of lines removed.
   */
  private resolveClears(refraction: boolean): number {
    let cascadeIndex = 0;
    let totalLines = 0;
    const stageBefore = this.stage.index;

    for (;;) {
      const complete = this.board.findCompleteLines(this.face);
      if (complete.length === 0) break;

      this.board.clearLines(this.face, complete);
      totalLines += complete.length;
      this.lines += complete.length;
      this.shiftMeter += complete.length;

      let prism = false;
      if (refraction) {
        this.revolutionFaces.add(this.face);
        if (this.revolutionFaces.size === 4) {
          prism = true;
          this.revolutionFaces.clear();
        }
      }

      const context: ClearContext = {
        lines: complete.length,
        stage: this.stage.index,
        cascadeIndex,
        refraction,
        chain: refraction ? this.refractionChain + 1 : 0,
        prism,
      };
      const gained = scoreClear(context);
      this.score += gained;

      const label = clearLabel(context);
      this.events.push({
        type: 'clear',
        lines: complete.length,
        score: gained,
        cleared: complete,
        ...(label ? { label } : {}),
      });

      cascadeIndex += 1;
    }

    this.dealer.setTier(this.stage.maxTier);
    if (this.stage.index !== stageBefore) {
      this.events.push({ type: 'stage' });
    }
    return totalLines;
  }
}

/** The face the player would see after turning, without performing the turn. */
export function facePreview(face: Face, direction: TurnDirection): Face {
  return turn(face, direction);
}
