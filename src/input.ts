/**
 * Keyboard and mouse input.
 *
 * Translates key and mouse events into game intents. Repeat handling (DAS/ARR)
 * lives here rather than in the engine so the engine stays a pure function of
 * its inputs.
 *
 * Which code means what comes from a live map supplied by the host (resolved
 * profile bindings), so remaps take effect without rebuilding the controller.
 */

import type { Game } from '@core/game';
import type { Action } from './keymap';

/** Delayed auto shift: hold before a move starts repeating. */
export const DAS_MS = 150;
/** Auto repeat rate: interval between repeats once shifting. */
export const ARR_MS = 33;

export interface InputHandlers {
  readonly onRestart: () => void;
  readonly onPause: () => void;
  readonly accepts: () => boolean;
  readonly allowsAction?: (action: Action) => boolean;
  readonly onTurn: (direction: 'left' | 'right') => void;
  readonly onInteract: () => void;
  readonly onToggleMute: () => void;
  readonly onPeek: (held: boolean) => void;
  /** Live code → action map (keyboard codes and Mouse0 / Mouse2). */
  readonly actionMap: () => ReadonlyMap<string, Action>;
  /**
   * CSS pixels of travel per column / depth step for relative mouse move.
   * Mirrors touch sensitivity.
   */
  readonly pxPerStep: () => number;
  /** True when the pointer is over the playfield (not HUD / menus). */
  readonly playfieldHit: (clientX: number, clientY: number) => boolean;
}

interface RepeatState {
  held: boolean;
  elapsed: number;
  repeating: boolean;
}

export class InputController {
  private readonly left: RepeatState = { held: false, elapsed: 0, repeating: false };
  private readonly right: RepeatState = { held: false, elapsed: 0, repeating: false };
  private readonly nudgeNear: RepeatState = { held: false, elapsed: 0, repeating: false };
  private readonly nudgeDeep: RepeatState = { held: false, elapsed: 0, repeating: false };
  private softDropHeld = false;
  private peekHeld = false;
  private softDropElapsed = 0;

  private mouseOrigin: { x: number; y: number } | null = null;
  private mouseReportedX = 0;
  private mouseReportedY = 0;
  private mouseDragging = false;

  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private readonly onMouseDown: (event: MouseEvent) => void;
  private readonly onMouseUp: (event: MouseEvent) => void;
  private readonly onMouseMove: (event: MouseEvent) => void;
  private readonly onContextMenu: (event: MouseEvent) => void;

  constructor(
    private readonly game: () => Game,
    private readonly handlers: InputHandlers,
    private readonly root: HTMLElement
  ) {
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onKeyUp = (event) => this.handleKeyUp(event);
    this.onMouseDown = (event) => this.handleMouseDown(event);
    this.onMouseUp = (event) => this.handleMouseUp(event);
    this.onMouseMove = (event) => this.handleMouseMove(event);
    this.onContextMenu = (event) => {
      if (this.handlers.accepts()) event.preventDefault();
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.root.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.root.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.root.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.root.removeEventListener('contextmenu', this.onContextMenu);
  }

  private actionFor(code: string): Action | undefined {
    return this.handlers.actionMap().get(code);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const game = this.game();
    this.handlers.onInteract();

    const action = this.actionFor(event.code);

    if (action === 'pause') {
      this.releaseAll();
      this.handlers.onPause();
      event.preventDefault();
      return;
    }

    if (!this.handlers.accepts()) return;

    if (action === 'mute') {
      this.handlers.onToggleMute();
      event.preventDefault();
      return;
    }

    if (game.status === 'awaitingTurn') {
      if (action === 'moveLeft') {
        if (this.handlers.allowsAction && !this.handlers.allowsAction('moveLeft')) return;
        this.handlers.onTurn('left');
        event.preventDefault();
      } else if (action === 'moveRight') {
        if (this.handlers.allowsAction && !this.handlers.allowsAction('moveRight')) return;
        this.handlers.onTurn('right');
        event.preventDefault();
      }
      return;
    }

    if (action === undefined) return;
    if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) {
      event.preventDefault();
      return;
    }

    this.dispatchAction(action, game);
    event.preventDefault();
  }

  private dispatchAction(action: Action, game: Game): void {
    switch (action) {
      case 'moveLeft':
        this.press(this.left, () => game.moveHorizontal(-1));
        break;
      case 'moveRight':
        this.press(this.right, () => game.moveHorizontal(1));
        break;
      case 'nudgeNearer':
        this.press(this.nudgeNear, () => game.nudgeDepth(-1));
        break;
      case 'nudgeDeeper':
        this.press(this.nudgeDeep, () => game.nudgeDepth(1));
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
      case 'peek':
        if (!this.peekHeld) {
          this.peekHeld = true;
          this.handlers.onPeek(true);
        }
        break;
      case 'hold':
        game.hold();
        break;
      case 'collapse':
        game.triggerCollapse();
        break;
      case 'restart':
        if (game.status === 'gameOver') this.handlers.onRestart();
        break;
      default:
        break;
    }
  }

  private press(state: RepeatState, action: () => void): void {
    if (state.held) return;
    state.held = true;
    state.elapsed = 0;
    state.repeating = false;
    action();
  }

  private handleKeyUp(event: KeyboardEvent): void {
    switch (this.actionFor(event.code)) {
      case 'moveLeft':
        this.left.held = false;
        break;
      case 'moveRight':
        this.right.held = false;
        break;
      case 'nudgeNearer':
        this.nudgeNear.held = false;
        break;
      case 'nudgeDeeper':
        this.nudgeDeep.held = false;
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

  private mouseCode(button: number): string | null {
    if (button === 0) return 'Mouse0';
    if (button === 2) return 'Mouse2';
    return null;
  }

  private handleMouseDown(event: MouseEvent): void {
    this.handlers.onInteract();
    if (!this.handlers.accepts()) return;
    if (!this.handlers.playfieldHit(event.clientX, event.clientY)) return;

    // Relative drag for translate on primary button (full profile).
    if (event.button === 0) {
      this.mouseDragging = true;
      this.mouseOrigin = { x: event.clientX, y: event.clientY };
      this.mouseReportedX = 0;
      this.mouseReportedY = 0;
    }

    const code = this.mouseCode(event.button);
    if (!code) return;
    const action = this.actionFor(code);
    if (!action) return;
    if (this.handlers.allowsAction && !this.handlers.allowsAction(action)) return;

    const game = this.game();
    if (game.status === 'awaitingTurn') return;

    this.dispatchAction(action, game);
    event.preventDefault();
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this.mouseDragging = false;
      this.mouseOrigin = null;
      if (this.actionFor('Mouse0') === 'softDrop') this.softDropHeld = false;
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.mouseDragging || !this.mouseOrigin || !this.handlers.accepts()) return;
    // Only the full profile uses mouse translate; roll profile has no mouse move
    // bindings for nudge — still allow column steps if mapped.
    const game = this.game();
    if (game.status !== 'falling' || game.rollOnly) return;

    const px = Math.max(1, this.handlers.pxPerStep());
    const dx = event.clientX - this.mouseOrigin.x;
    const dy = event.clientY - this.mouseOrigin.y;
    const colTotal = Math.trunc(dx / px);
    const laneTotal = Math.trunc(-dy / px); // up = deeper (push)

    const dCol = colTotal - this.mouseReportedX;
    const dLane = laneTotal - this.mouseReportedY;
    this.mouseReportedX = colTotal;
    this.mouseReportedY = laneTotal;

    if (dCol !== 0) {
      const action = dCol < 0 ? 'moveLeft' : 'moveRight';
      if (!this.handlers.allowsAction || this.handlers.allowsAction(action)) {
        const dir = dCol > 0 ? 1 : -1;
        for (let i = 0; i < Math.abs(dCol); i += 1) {
          if (!game.moveHorizontal(dir as -1 | 1)) break;
        }
      }
    }
    if (dLane !== 0) {
      const action = dLane < 0 ? 'nudgeNearer' : 'nudgeDeeper';
      if (!this.handlers.allowsAction || this.handlers.allowsAction(action)) {
        const dir = dLane > 0 ? 1 : -1;
        for (let i = 0; i < Math.abs(dLane); i += 1) {
          if (!game.nudgeDepth(dir as -1 | 1)) break;
        }
      }
    }
  }

  private releasePeek(): void {
    if (!this.peekHeld) return;
    this.peekHeld = false;
    this.handlers.onPeek(false);
  }

  private releaseAll(): void {
    this.left.held = false;
    this.right.held = false;
    this.nudgeNear.held = false;
    this.nudgeDeep.held = false;
    this.softDropHeld = false;
    this.mouseDragging = false;
    this.mouseOrigin = null;
    this.releasePeek();
  }

  update(deltaMs: number): void {
    const game = this.game();
    if (game.status !== 'falling' || !this.handlers.accepts()) return;

    const allows = this.handlers.allowsAction;
    if (!allows || allows('moveLeft')) {
      this.repeat(this.left, deltaMs, () => game.moveHorizontal(-1));
    }
    if (!allows || allows('moveRight')) {
      this.repeat(this.right, deltaMs, () => game.moveHorizontal(1));
    }
    if (!allows || allows('nudgeNearer')) {
      this.repeat(this.nudgeNear, deltaMs, () => game.nudgeDepth(-1));
    }
    if (!allows || allows('nudgeDeeper')) {
      this.repeat(this.nudgeDeep, deltaMs, () => game.nudgeDepth(1));
    }

    if (this.softDropHeld && (!allows || allows('softDrop'))) {
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