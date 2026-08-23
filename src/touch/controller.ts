/**
 * Pointer plumbing for the touch scheme.
 *
 * Thin: listens, asks GestureRecogniser what samples mean, applies intents.
 * Touch and pen only — mouse keeps the keyboard/mouse game.
 */

import type { Game } from '@core/game';
import type { Action } from '../keymap';
import { GestureRecogniser } from './gestures';
import type { Sample, TouchIntent, TouchLayout, TouchScheme } from './gestures';

/** Legacy strip height; unused for full profile (no strip). Kept for Flatland docs. */
export const STRIP_HEIGHT_PX = 84;

export function stripTopPx(viewportHeight: number): number {
  return viewportHeight - STRIP_HEIGHT_PX;
}

export interface TouchHandlers {
  readonly accepts: () => boolean;
  readonly allowsAction?: (action: Action) => boolean;
  readonly onInteract: () => void;
  readonly onTurn: (direction: 'left' | 'right') => void;
  readonly wellRect: () => { left: number; top: number; width: number; height: number };
  /** roll = Flatland; full = wedge + swipe scheme. */
  readonly scheme: () => TouchScheme;
  readonly sensitivity: () => number;
  readonly onPeek: (held: boolean) => void;
}

export class TouchController {
  private readonly recogniser = new GestureRecogniser();
  private readonly pointers = new Map<number, PointerEvent>();
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

  cancel(): void {
    this.recogniser.cancel();
    this.pointers.clear();
  }

  private touchLike(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private layout(): TouchLayout {
    const well = this.handlers.wellRect();
    const scheme = this.handlers.scheme();
    const sensitivity = Math.max(0.1, this.handlers.sensitivity());
    return {
      well,
      stripTop: null,
      columns: 8,
      pxPerColumn: Math.max(1, well.width / 8 / sensitivity),
      scheme,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  private sample(event: PointerEvent): Sample {
    return { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
  }

  private begin(event: PointerEvent): void {
    if (!this.touchLike(event)) return;
    this.handlers.onInteract();
    if (!this.handlers.accepts()) return;
    this.pointers.set(event.pointerId, event);
    this.element.setPointerCapture?.(event.pointerId);
    this.apply(this.recogniser.begin(this.sample(event), this.layout()));
  }

  private move(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, event);
    this.apply(this.recogniser.move(this.sample(event), this.layout()));
  }

  private end(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    this.apply(this.recogniser.end(this.sample(event), this.layout()));
  }

  private apply(intents: readonly TouchIntent[]): void {
    if (intents.length === 0) return;
    const game = this.game();
    if (!this.handlers.accepts()) return;

    if (game.status === 'awaitingTurn') {
      for (const intent of intents) {
        if (intent.kind !== 'columnStep' || intent.steps === 0) continue;
        const action = intent.steps < 0 ? 'moveRight' : 'moveLeft';
        if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) return;
        this.handlers.onTurn(intent.steps < 0 ? 'right' : 'left');
        return;
      }
      return;
    }

    for (const intent of intents) {
      switch (intent.kind) {
        case 'columnStep': {
          const action = intent.steps < 0 ? 'moveLeft' : 'moveRight';
          if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) break;
          this.stepHorizontal(intent.steps);
          break;
        }
        case 'laneStep': {
          const action = intent.steps < 0 ? 'nudgeNearer' : 'nudgeDeeper';
          if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) break;
          this.stepLane(intent.steps);
          break;
        }
        case 'softDrop':
          if (this.handlers.allowsAction && !this.handlers.allowsAction('softDrop')) break;
          game.softDrop();
          break;
        case 'hardDrop':
          if (this.handlers.allowsAction && !this.handlers.allowsAction('hardDrop')) break;
          game.hardDrop();
          break;
        case 'peek':
          this.handlers.onPeek(intent.held && game.peekAllowed);
          break;
        case 'rotate': {
          const action =
            intent.axis === 'roll'
              ? intent.clockwise
                ? 'rollClock'
                : 'rollAnti'
              : intent.axis === 'yaw'
                ? intent.clockwise
                  ? 'yawClock'
                  : 'yawAnti'
                : intent.clockwise
                  ? 'pitchUp'
                  : 'pitchDown';
          if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) {
            if (
              intent.axis === 'pitch' &&
              !intent.clockwise &&
              this.handlers.allowsAction('hardDrop')
            ) {
              game.hardDrop();
            }
            break;
          }
          game.rotatePiece(intent.axis, intent.clockwise);
          break;
        }
      }
    }
  }

  private stepHorizontal(steps: number): void {
    const game = this.game();
    if (!game.active || game.status !== 'falling' || steps === 0) return;
    const direction = steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      if (!game.moveHorizontal(direction)) return;
    }
  }

  private stepLane(steps: number): void {
    const game = this.game();
    if (!game.active || game.status !== 'falling' || steps === 0) return;
    const direction = steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i += 1) {
      if (!game.nudgeDepth(direction)) return;
    }
  }
}
