/**
 * Keyboard input.
 *
 * Translates key events into game intents. Repeat handling (DAS/ARR) lives here
 * rather than in the engine so the engine stays a pure function of its inputs.
 *
 * Which key means what is **not** decided here -- it comes from `keymap.ts`,
 * which the settings panel reads too. This file resolves a code to an action and
 * then acts on the action, so a binding cannot exist in the engine without
 * appearing in the key map, or appear in the key map without working.
 */

import type { Game } from '@core/game';
import { ACTION_BY_CODE } from './keymap';

/** Delayed auto shift: hold before a move starts repeating. */
export const DAS_MS = 150;
/** Auto repeat rate: interval between repeats once shifting. */
export const ARR_MS = 33;

export interface InputHandlers {
  readonly onRestart: () => void;
  /** Esc, and any other request to open or dismiss the pause menu. */
  readonly onPause: () => void;
  /**
   * Whether the engine should see this key at all.
   *
   * False while a menu is up. The controller still forgets held keys on the way
   * in, so a key held down across a pause does not come back stuck.
   */
  readonly accepts: () => boolean;
  readonly onTurn: (direction: 'left' | 'right') => void;
  /** Any key at all. Browsers refuse to start audio outside a user gesture. */
  readonly onInteract: () => void;
  readonly onToggleMute: () => void;
  /**
   * Hold to tilt the camera. Passed as a held state rather than as an event,
   * because Peek is a thing you do *while* you are doing it -- the renderer
   * eases toward the tilt and back, and a press/release pair is the only honest
   * shape for that.
   */
  readonly onPeek: (held: boolean) => void;
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
  private peekHeld = false;
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

    const action = ACTION_BY_CODE.get(event.code);

    if (action === 'pause') {
      this.releaseAll();
      this.handlers.onPause();
      event.preventDefault();
      return;
    }

    // A menu owns the keyboard while it is up. Movement keys must not reach the
    // engine, or the piece drifts behind the panel while the player reads it.
    if (!this.handlers.accepts()) return;

    if (action === 'mute') {
      this.handlers.onToggleMute();
      event.preventDefault();
      return;
    }

    // The turn prompt takes over the movement keys while it is up.
    if (game.status === 'awaitingTurn') {
      if (action === 'moveLeft') {
        this.handlers.onTurn('left');
        event.preventDefault();
      } else if (action === 'moveRight') {
        this.handlers.onTurn('right');
        event.preventDefault();
      }
      return;
    }

    if (action === undefined) return;

    switch (action) {
      case 'moveLeft':
        this.press(this.left, () => game.moveHorizontal(-1));
        break;
      case 'moveRight':
        this.press(this.right, () => game.moveHorizontal(1));
        break;
      case 'softDrop':
        this.softDropHeld = true;
        this.softDropElapsed = 0;
        game.softDrop();
        break;
      case 'hardDrop':
        game.hardDrop();
        break;
      case 'rollAnti':
        game.rotatePiece('roll', false);
        break;
      case 'rollClock':
        game.rotatePiece('roll', true);
        break;
      case 'yawAnti':
        game.rotatePiece('yaw', false);
        break;
      case 'yawClock':
        game.rotatePiece('yaw', true);
        break;
      case 'pitchUp':
        game.rotatePiece('pitch', true);
        break;
      case 'pitchDown':
        game.rotatePiece('pitch', false);
        break;
      case 'nudgeNearer':
        game.nudgeDepth(-1);
        break;
      case 'nudgeDeeper':
        game.nudgeDepth(1);
        break;
      case 'peek':
        // Held, so a key repeat must not re-announce it.
        if (!this.peekHeld) {
          this.peekHeld = true;
          this.handlers.onPeek(true);
        }
        break;
      case 'hold':
        game.hold();
        break;
      case 'restart':
        if (game.status === 'gameOver') this.handlers.onRestart();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Start a repeatable press, ignoring the browser's own key repeat. */
  private press(state: RepeatState, action: () => void): void {
    if (state.held) return;
    state.held = true;
    state.elapsed = 0;
    state.repeating = false;
    action();
  }

  private handleUp(event: KeyboardEvent): void {
    switch (ACTION_BY_CODE.get(event.code)) {
      case 'moveLeft':
        this.left.held = false;
        break;
      case 'moveRight':
        this.right.held = false;
        break;
      case 'softDrop':
        this.softDropHeld = false;
        break;
      case 'peek':
        this.releasePeek();
        break;
      default:
        break;
    }
  }

  /** Let the camera back down. Idempotent, so a lost keyup cannot strand it. */
  private releasePeek(): void {
    if (!this.peekHeld) return;
    this.peekHeld = false;
    this.handlers.onPeek(false);
  }

  /** Forget every held key. Used when a menu takes the keyboard. */
  private releaseAll(): void {
    this.left.held = false;
    this.right.held = false;
    this.softDropHeld = false;
    // A menu opening while Peek is held would otherwise leave the board tilted
    // behind the panel, with no keyup coming to put it back.
    this.releasePeek();
  }

  /** Drive key repeat. Called once per simulation step. */
  update(deltaMs: number): void {
    const game = this.game();
    if (game.status !== 'falling' || !this.handlers.accepts()) return;

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
