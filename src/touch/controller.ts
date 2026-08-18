/**
 * Pointer plumbing for the touch scheme.
 *
 * The thin half: it listens, asks `GestureRecogniser` what the samples mean, and
 * applies the answer to the game. Everything about how a gesture feels lives in
 * the recogniser, which is pure and unit-tested; nothing here decides anything.
 *
 * Only touch and pen reach this. A mouse keeps the keyboard game: dragging a
 * piece with a cursor is worse than pressing an arrow key, and a laptop with a
 * touchscreen should not have its behaviour changed by whichever input the
 * player happened to use last.
 */

import type { Game } from '@core/game';
import { GestureRecogniser } from './gestures';
import type { Sample, TouchIntent, TouchLayout } from './gestures';

/**
 * Height of the movement strip, in CSS pixels.
 *
 * A thumb needs about 44; this is comfortably over that, because the strip is
 * where the hand rests for the whole game and a target that has to be aimed at
 * is a target that will be missed.
 */
export const STRIP_HEIGHT_PX = 84;

export interface TouchHandlers {
  /** Whether the engine should see this at all. False while a menu is up. */
  readonly accepts: () => boolean;
  /** Browsers refuse to start audio outside a user gesture. */
  readonly onInteract: () => void;
  readonly onTurn: (direction: 'left' | 'right') => void;
  /** Where the well currently is on screen, in CSS pixels. */
  readonly wellRect: () => { left: number; top: number; width: number; height: number };
}

export class TouchController {
  private readonly recogniser = new GestureRecogniser();
  private pointer: number | null = null;
  private readonly onDown: (event: PointerEvent) => void;
  private readonly onMove: (event: PointerEvent) => void;
  private readonly onUp: (event: PointerEvent) => void;

  constructor(
    private readonly element: HTMLElement,
    private readonly game: () => Game,
    private readonly handlers: TouchHandlers
  ) {
    this.onDown = (event) => this.begin(event);
    this.onMove = (event) => this.move(event);
    this.onUp = (event) => this.end(event);
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointercancel', this.onUp);
  }

  /** Forget any gesture in progress. Used when a menu takes over. */
  cancel(): void {
    this.recogniser.cancel();
    this.pointer = null;
  }

  private touchLike(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private layout(): TouchLayout {
    const well = this.handlers.wellRect();
    // The strip prefers the space below the well, so the hand never covers the
    // board. Where the window is too short for that -- a phone in landscape --
    // it overlaps the bottom of the well rather than disappearing, because a
    // game with no way to move the piece is worse than one with an obstructed
    // view of its floor.
    const below = window.innerHeight - (well.top + well.height);
    const stripTop =
      below >= STRIP_HEIGHT_PX
        ? well.top + well.height
        : Math.max(well.top, window.innerHeight - STRIP_HEIGHT_PX);
    return { well, stripTop, columns: 8 };
  }

  private sample(event: PointerEvent): Sample {
    return { x: event.clientX, y: event.clientY, t: event.timeStamp };
  }

  private begin(event: PointerEvent): void {
    if (!this.touchLike(event)) return;
    this.handlers.onInteract();
    if (!this.handlers.accepts()) return;
    this.pointer = event.pointerId;
    this.element.setPointerCapture?.(event.pointerId);
    this.recogniser.begin(this.sample(event), this.layout());
  }

  private move(event: PointerEvent): void {
    if (this.pointer !== event.pointerId) return;
    this.apply(this.recogniser.move(this.sample(event), this.layout()));
  }

  private end(event: PointerEvent): void {
    if (this.pointer !== event.pointerId) return;
    this.pointer = null;
    this.apply(this.recogniser.end(this.sample(event), this.layout()));
  }

  private apply(intents: readonly TouchIntent[]): void {
    if (intents.length === 0) return;
    const game = this.game();
    if (!this.handlers.accepts()) return;

    // The turn prompt borrows the strip: while the board is waiting to be
    // turned, a sideways drag chooses the face rather than moving a piece that
    // is not falling. It is the same gesture meaning the same thing it means on
    // a keyboard, where Left and Right do double duty in exactly this state.
    if (game.status === 'awaitingTurn') {
      for (const intent of intents) {
        if (intent.kind !== 'column') continue;
        const middle = this.layout().columns / 2;
        this.handlers.onTurn(intent.column < middle ? 'left' : 'right');
        return;
      }
      return;
    }

    for (const intent of intents) {
      switch (intent.kind) {
        case 'column':
          this.moveToColumn(intent.column);
          break;
        case 'softDrop':
          game.softDrop();
          break;
        case 'hardDrop':
          game.hardDrop();
          break;
        case 'rotate':
          game.rotatePiece(intent.axis, intent.clockwise);
          break;
      }
    }
  }

  /**
   * Walk the piece to the column under the finger.
   *
   * Absolute rather than accumulated, which is the whole point of dragging: the
   * column under the finger is the column the piece is in, not a running total
   * of how far the finger has travelled. It is also the claim the game already
   * makes about everything else -- position is absolute.
   *
   * The piece is centred on the target rather than aligned by its left edge, so
   * a wide piece sits under the thumb instead of beside it.
   */
  private moveToColumn(column: number): void {
    const game = this.game();
    const piece = game.active;
    if (!piece || game.status !== 'falling') return;

    const spans = piece.offsets.map((offset) => offset.x);
    const width = Math.max(...spans) - Math.min(...spans) + 1;
    const target = column - Math.floor((width - 1) / 2);

    // Step rather than assign: each step goes through the collision check, so a
    // drag across a wall stops at the wall instead of tunnelling through it.
    for (let guard = 0; guard < 16; guard += 1) {
      const current = game.active?.u;
      if (current === undefined || current === target) return;
      if (!game.moveHorizontal(current < target ? 1 : -1)) return;
    }
  }
}
