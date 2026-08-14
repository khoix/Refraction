/**
 * Keyboard input.
 *
 * Translates key events into game intents. Repeat handling (DAS/ARR) lives here
 * rather than in the engine so the engine stays a pure function of its inputs.
 */

import type { Game } from '@core/game';

/** Delayed auto shift: hold before a move starts repeating. */
export const DAS_MS = 150;
/** Auto repeat rate: interval between repeats once shifting. */
export const ARR_MS = 33;

export interface InputHandlers {
  readonly onRestart: () => void;
  readonly onTurn: (direction: 'left' | 'right') => void;
  /** Any key at all. Browsers refuse to start audio outside a user gesture. */
  readonly onInteract: () => void;
  readonly onToggleMute: () => void;
}

interface RepeatState {
  held: boolean;
  elapsed: number;
  repeating: boolean;
}

export class InputController {
  private readonly left: RepeatState = { held: false, elapsed: 0, repeating: false };
  private readonly right: RepeatState = { held: false, elapsed: 0, repeating: false };
  private softDropHeld = false;
  private softDropElapsed = 0;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;

  constructor(
    private readonly game: () => Game,
    private readonly handlers: InputHandlers
  ) {
    this.onKeyDown = (event) => this.handleDown(event);
    this.onKeyUp = (event) => this.handleUp(event);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private handleDown(event: KeyboardEvent): void {
    const game = this.game();
    this.handlers.onInteract();

    if (event.code === 'KeyM') {
      this.handlers.onToggleMute();
      event.preventDefault();
      return;
    }

    // The turn prompt takes over the arrow keys while it is up.
    if (game.status === 'awaitingTurn') {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
        this.handlers.onTurn('left');
        event.preventDefault();
      } else if (event.code === 'ArrowRight' || event.code === 'KeyD') {
        this.handlers.onTurn('right');
        event.preventDefault();
      }
      return;
    }

    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        if (!this.left.held) {
          this.left.held = true;
          this.left.elapsed = 0;
          this.left.repeating = false;
          game.moveHorizontal(-1);
        }
        break;
      case 'ArrowRight':
      case 'KeyD':
        if (!this.right.held) {
          this.right.held = true;
          this.right.elapsed = 0;
          this.right.repeating = false;
          game.moveHorizontal(1);
        }
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.softDropHeld = true;
        this.softDropElapsed = 0;
        game.softDrop();
        break;
      case 'Space':
        game.hardDrop();
        break;
      case 'KeyZ':
        game.rotatePiece('roll', false);
        break;
      case 'KeyX':
      case 'ArrowUp':
        game.rotatePiece('roll', true);
        break;
      case 'KeyQ':
        game.rotatePiece('yaw', false);
        break;
      case 'KeyE':
        game.rotatePiece('yaw', true);
        break;
      case 'KeyR':
        game.rotatePiece('pitch', true);
        break;
      case 'KeyF':
        game.rotatePiece('pitch', false);
        break;
      case 'KeyW':
        game.nudgeDepth(-1);
        break;
      case 'KeyC':
      case 'ShiftLeft':
        game.hold();
        break;
      case 'Enter':
        if (game.status === 'gameOver') this.handlers.onRestart();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private handleUp(event: KeyboardEvent): void {
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.left.held = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.right.held = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.softDropHeld = false;
        break;
      default:
        break;
    }
  }

  /** Drive key repeat. Called once per simulation step. */
  update(deltaMs: number): void {
    const game = this.game();
    if (game.status !== 'falling') return;

    this.repeat(this.left, deltaMs, () => game.moveHorizontal(-1));
    this.repeat(this.right, deltaMs, () => game.moveHorizontal(1));

    if (this.softDropHeld) {
      this.softDropElapsed += deltaMs;
      const interval = game.softDropIntervalMs();
      while (this.softDropElapsed >= interval) {
        this.softDropElapsed -= interval;
        if (!game.softDrop()) break;
      }
    }
  }

  private repeat(state: RepeatState, deltaMs: number, action: () => void): void {
    if (!state.held) return;
    state.elapsed += deltaMs;
    if (!state.repeating) {
      if (state.elapsed < DAS_MS) return;
      state.repeating = true;
      state.elapsed -= DAS_MS;
    }
    while (state.elapsed >= ARR_MS) {
      state.elapsed -= ARR_MS;
      action();
    }
  }
}
