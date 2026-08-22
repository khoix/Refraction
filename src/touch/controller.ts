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

/**
 * Where the movement strip starts, in viewport coordinates.
 *
 * **Anchored to the bottom of the window, not to the bottom of the well.** It
 * used to sit directly under the board, which is where the Shift meter also
 * wants to be -- measured on a Pixel 7 the meter ran 679 to 723 and the strip
 * 669 to 753, so the thumb rested squarely on the one readout that says when the
 * board is about to turn. The bottom of the window is where a thumb goes anyway,
 * and it leaves the space under the board free for the meter.
 *
 * Exported because the HUD needs the same number to keep the meter clear of it.
 * Two places computing "where the strip starts" from the same inputs is how they
 * end up disagreeing by a few pixels and nobody notices until a thumb covers
 * something.
 */
export function stripTopPx(viewportHeight: number): number {
  return viewportHeight - STRIP_HEIGHT_PX;
}

export interface TouchHandlers {
  /** Whether the engine should see this at all. False while a menu is up. */
  readonly accepts: () => boolean;
  /** Browsers refuse to start audio outside a user gesture. */
  readonly onInteract: () => void;
  readonly onTurn: (direction: 'left' | 'right') => void;
  /** Where the well currently is on screen, in CSS pixels. */
  readonly wellRect: () => { left: number; top: number; width: number; height: number };
  /**
   * Whether the mode in play needs the field/strip split.
   *
   * A function rather than a flag because the mode changes with the run, and the
   * controller outlives it.
   */
  readonly hasStrip: () => boolean;
  /**
   * The player's touch sensitivity, as a multiplier on how far a drag has to
   * travel. Read per gesture, so changing it in settings takes effect at once.
   */
  readonly sensitivity: () => number;
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
    // A mode that permits only roll has nothing for the split to carry, so it
    // gets no strip at all: drag anywhere to move, tap anywhere to roll. See
    // `TouchLayout.stripTop`.
    const stripTop = this.handlers.hasStrip() ? stripTopPx(window.innerHeight) : null;
    const columns = 8;
    /*
     * One column of travel is one column of the well, divided by the player's
     * sensitivity.
     *
     * The well's own column width is the honest default: a drag the width of one
     * cube moves the piece one cube, so the piece keeps pace with the thumb even
     * though it is no longer tied to where the thumb is. It is a setting because
     * the right distance depends on the hand and the phone -- a comfortable
     * thumb arc on a small screen is four columns at 1:1 and the whole board at
     * twice that.
     */
    const sensitivity = Math.max(0.1, this.handlers.sensitivity());
    return {
      well,
      stripTop,
      columns,
      pxPerColumn: Math.max(1, well.width / columns / sensitivity),
    };
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
    // is not falling. Direction is inverted from the keyboard: a swipe pulls
    // the board the way the finger moves (swipe left → right face comes
    // forward), which matches how people drag a physical object.
    if (game.status === 'awaitingTurn') {
      for (const intent of intents) {
        if (intent.kind !== 'columnStep' || intent.steps === 0) continue;
        this.handlers.onTurn(intent.steps < 0 ? 'right' : 'left');
        return;
      }
      return;
    }

    for (const intent of intents) {
      switch (intent.kind) {
        case 'columnStep':
          this.step(intent.steps);
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
   * Step the piece sideways, one column at a time.
   *
   * One at a time rather than by assignment, because each step goes through the
   * engine's collision check -- a drag across a wall stops at the wall instead of
   * tunnelling through it.
   *
   * **A refused step is simply dropped, and that is enough.** Pressing into a
   * wall does not build a debt the player has to work off before the piece comes
   * back, because the recogniser reports the *change* since the last sample
   * rather than a running target: a finger held against the wall emits nothing,
   * and the first sample that moves the other way emits one step the other way.
   *
   * That was not obvious, and an explicit re-anchor was written here first, on
   * the reasoning that travel spent against a wall would otherwise be banked. It
   * would be -- under an absolute target. Under deltas it never accumulates, and
   * the test written to prove the re-anchor necessary passed just as well with
   * it removed, which is what showed it was doing nothing.
   */
  private step(steps: number): void {
    const game = this.game();
    if (!game.active || game.status !== 'falling' || steps === 0) return;

    const direction = steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      if (!game.moveHorizontal(direction)) return;
    }
  }
}
