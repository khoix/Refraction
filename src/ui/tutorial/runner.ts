/**
 * Tutorial state machine.
 *
 * Reads the game and renderer; sends intents through the host. Never touches
 * WebGL directly. Pause freezes the clock between coach beats; hands-on beats
 * resume with an action allowlist.
 */

import type { Game, GameEvent } from '@core/game';
import { FACE_YAW, lineCells } from '@core/projection';
import type { ModeConfig } from '@core/modes';
import type { GameRenderer } from '@render/game-renderer';
import type { Action } from '../../keymap';
import {
  almostCompleteFrontLine,
  buildXrayDemo,
  hiddenRefractionLine,
  laneClearDemo,
  spectrumStack,
} from './fixtures';
import type { TutorialBeat } from './script';
import { TUTORIAL_BEATS } from './script';
import type { CardPlacement, Spotlight, SpotlightHole } from './spotlight';
import { pickCardPlacement } from './spotlight';

export interface TutorialHost {
  getGame: () => Game;
  getRenderer: () => GameRenderer;
  rebuildGame: (mode: ModeConfig, seed: string) => Game;
  /** Leave the tutorial; `modes` opens the mode grid after the coda. */
  finish: (to: 'title' | 'modes') => void;
  /** Touch-primary devices get gesture hints instead of key chords. */
  isTouchPrimary: () => boolean;
  /** Prefer reduced motion: no camera loops / name crossfades. */
  reducedMotion: () => boolean;
}

export class TutorialRunner {
  private index = -1;
  private active = false;
  private waiting: TutorialBeat['advance'] | null = null;
  private allow: ReadonlySet<Action> | null = null;
  private holeSelector: string | null = null;
  private holeKind: 'well' | 'prompt' | 'hud' | 'none' = 'none';
  private holeFocus: 'well' | 'active' | 'filled' = 'well';
  private holeRadius = 120;
  private fitWell = false;
  private softScrim = false;
  /** Locked for the beat so camera motion cannot flip left/right. */
  private lockedPlacement: CardPlacement | null = null;
  /** Pause once the engine leaves turning/resolving. */
  private deferredPause = false;
  /**
   * Place-lane reveal: game is held in `resolving` (line lit) while the camera
   * orbits to a top/side angle, then resumed so the clear plays from that view.
   */
  private revealPanPending = false;
  /** Index of the last beat whose `rebuild` was applied. */
  private appliedRebuildIndex = -1;

  constructor(
    private readonly spotlight: Spotlight,
    private readonly host: TutorialHost
  ) {}

  get running(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    this.index = -1;
    this.appliedRebuildIndex = -1;
    this.spotlight.setReducedMotion(this.host.reducedMotion());
    this.spotlight.show();
    this.spotlight.setCompact(this.isCompact());
    this.advance();
  }

  skip(): void {
    if (!this.active) return;
    this.teardown();
    this.host.finish('title');
  }

  continue(): void {
    if (!this.active || !this.waiting) return;
    if (this.waiting.kind !== 'continue') return;
    this.advance();
  }

  /** Step back one beat and restage it. Hidden on the first beat. */
  back(): void {
    if (!this.active || this.index <= 0) return;
    this.index -= 1;
    const beat = TUTORIAL_BEATS[this.index];
    if (!beat) return;
    this.applyBeat(beat);
  }

  /** Whether a gameplay action may reach the engine this beat. */
  allows(action: Action): boolean {
    if (!this.active) return true;
    if (!this.allow) return false;
    return this.allow.has(action);
  }

  /** Esc / pause during tutorial means skip, not the pause menu. */
  onEscape(): boolean {
    if (!this.active) return false;
    this.skip();
    return true;
  }

  /** Show the face-choice HUD only on the Shift hands-on beat. */
  showsTurnPrompt(): boolean {
    return this.active && this.holeKind === 'prompt';
  }

  onEvents(events: readonly GameEvent[]): void {
    if (!this.active || !this.waiting) return;
    if (this.waiting.kind !== 'event') return;

    const beat = TUTORIAL_BEATS[this.index];
    if (
      beat?.revealBeforeClear &&
      this.waiting.type === 'clear' &&
      !this.revealPanPending &&
      events.some((event) => event.type === 'lock')
    ) {
      this.beginRevealBeforeClear(beat);
    }

    const want = this.waiting.type;
    if (!events.some((event) => event.type === want)) return;

    // After the lane clear, hold on a looping depth pan until Continue.
    if (beat?.revealBeforeClear && want === 'clear') {
      this.holdRevealUntilContinue(beat);
      return;
    }
    this.advance();
  }

  tick(): void {
    if (!this.active) return;
    const game = this.host.getGame();
    if (this.revealPanPending) {
      const renderer = this.host.getRenderer();
      if (this.host.reducedMotion() || renderer.tutorialLookOutboundComplete) {
        this.revealPanPending = false;
        if (game.status === 'paused') game.resume();
      }
    }
    if (this.deferredPause) {
      const busy = game.status === 'turning' || game.status === 'resolving';
      if (!busy) {
        if (game.status !== 'paused') game.pause();
        this.deferredPause = false;
      }
    }
    if (this.waiting?.kind === 'status' && game.status === this.waiting.status) {
      this.advance();
      return;
    }
    this.spotlight.setCompact(this.isCompact());
    this.refreshHole();
  }

  private isCompact(): boolean {
    return this.host.isTouchPrimary() || window.innerWidth < 640;
  }

  /**
   * Freeze the lit clear and orbit so depth behind the line is readable before
   * the lane vanishes. Reduced motion skips the orbit and clears immediately.
   */
  private beginRevealBeforeClear(beat: TutorialBeat): void {
    const cue = beat.revealBeforeClear;
    if (!cue) return;
    const game = this.host.getGame();
    const renderer = this.host.getRenderer();
    if (this.host.reducedMotion()) return;

    const base = FACE_YAW[game.face];
    renderer.startTutorialLook({
      yawTo: base + cue.yawDelta,
      elevation: cue.elevation,
      durationMs: cue.durationMs,
    });
    if (game.status !== 'paused') game.pause();
    this.revealPanPending = true;
  }

  /**
   * Keep the top/side pan looping after the clear until the player Continues
   * into Shift — no snap back to face-on on its own.
   */
  private holdRevealUntilContinue(beat: TutorialBeat): void {
    const cue = beat.revealBeforeClear;
    const game = this.host.getGame();
    const renderer = this.host.getRenderer();

    this.waiting = { kind: 'continue' };
    this.allow = null;
    this.spotlight.setContinueVisible(true);
    this.spotlight.setHint(null);

    const busy = game.status === 'turning' || game.status === 'resolving';
    if (busy) this.deferredPause = true;
    else if (game.status !== 'paused') game.pause();

    if (!cue || this.host.reducedMotion()) return;

    const base = FACE_YAW[game.face];
    const durationMs = Math.max(cue.durationMs, 2000);
    renderer.startTutorialLook({
      yawTo: base + cue.yawDelta,
      elevation: cue.elevation,
      durationMs,
      returnHome: {
        yaw: base,
        elevation: 0,
        durationMs,
      },
      loop: true,
    });
  }

  private advance(): void {
    this.revealPanPending = false;
    this.index += 1;
    if (this.index >= TUTORIAL_BEATS.length) {
      this.teardown();
      this.host.finish('modes');
      return;
    }
    const beat = TUTORIAL_BEATS[this.index];
    if (!beat) return;
    this.applyBeat(beat);
  }

  private applyBeat(beat: TutorialBeat): void {
    const renderer = this.host.getRenderer();
    renderer.clearTutorialLook();
    renderer.setPeek(false);
    this.spotlight.setReducedMotion(this.host.reducedMotion());
    this.spotlight.setCompact(this.isCompact());

    // Apply this beat's rebuild, or restore an earlier checkpoint when stepping
    // back across a later act rebuild (without wiping mid-act board state).
    let checkpointIndex = -1;
    for (let i = this.index; i >= 0; i -= 1) {
      if (TUTORIAL_BEATS[i]?.rebuild) {
        checkpointIndex = i;
        break;
      }
    }
    if (beat.rebuild) {
      this.host.rebuildGame(beat.rebuild.mode, beat.rebuild.seed);
      this.appliedRebuildIndex = this.index;
    } else if (checkpointIndex >= 0 && this.appliedRebuildIndex > checkpointIndex) {
      const checkpoint = TUTORIAL_BEATS[checkpointIndex]?.rebuild;
      if (checkpoint) {
        this.host.rebuildGame(checkpoint.mode, checkpoint.seed);
        this.appliedRebuildIndex = checkpointIndex;
      }
    }

    const game = this.host.getGame();
    game.holdTurnPrompt(false);
    // Hands-on and most teaching beats stay face-on.
    renderer.snapToFace(game.face);
    this.stageBoard(game, beat);
    this.waiting = beat.advance;

    const handsOn = beat.advance.kind !== 'continue';
    this.deferredPause = false;
    if (handsOn) {
      if (game.status === 'paused') game.resume();
      this.allow = new Set(beat.allowedActions ?? []);
      renderer.clearTutorialLook();
    } else if (game.status === 'turning' || game.status === 'resolving') {
      this.deferredPause = true;
      this.allow = null;
    } else {
      if (game.status !== 'paused') game.pause();
      this.allow = null;
    }

    if (beat.id === 'choose-shift') {
      if (game.status === 'paused') game.resume();
      if (game.status !== 'awaitingTurn') {
        game.shiftMeter = game.stage.linesPerTurn;
        game.status = 'awaitingTurn';
      }
      game.holdTurnPrompt(true);
      this.allow = new Set(beat.allowedActions ?? ['moveLeft', 'moveRight']);
    }

    this.spotlight.setCopy(beat.title, beat.body);
    const touch = this.host.isTouchPrimary();
    const hint = touch && beat.touchHint ? beat.touchHint : (beat.hint ?? null);
    this.spotlight.setHint(hint);
    this.spotlight.setContinueVisible(beat.advance.kind === 'continue');
    this.spotlight.setContinueLabel(beat.continueLabel ?? 'CONTINUE');
    this.spotlight.setBackVisible(this.index > 0);
    this.spotlight.setSoftScrim(beat.softScrim === true);

    this.holeKind = beat.target.kind;
    this.holeSelector = beat.target.kind === 'hud' ? beat.target.selector : null;
    this.holeRadius = beat.radius ?? 120;
    this.fitWell = beat.fitWell === true;
    this.softScrim = beat.softScrim === true;
    this.holeFocus =
      beat.focus === 'active' || beat.focus === 'filled' ? beat.focus : 'well';
    // Lock once per beat — camera loops must not re-dock the card.
    this.lockedPlacement = beat.cardPlacement ?? null;

    const reduced = this.host.reducedMotion();
    if (beat.camera && !handsOn && !reduced) {
      const base = FACE_YAW[game.face];
      renderer.startTutorialLook({
        yawTo: base + beat.camera.yawDelta,
        elevation: beat.camera.elevation,
        durationMs: beat.camera.durationMs,
        loop: beat.camera.loop === true,
        ...(beat.camera.returnHome
          ? {
              returnHome: {
                yaw: base,
                elevation: 0,
                durationMs: beat.camera.durationMs,
              },
            }
          : {}),
      });
    } else if (beat.cameraLoop && !handsOn && !reduced) {
      renderer.startTutorialLoop({
        baseYaw: FACE_YAW[game.face],
        yawAmplitude: 8,
        elevAmplitude: 3.5,
        periodMs: 10000,
      });
    }

    this.refreshHole();
  }

  private stageBoard(game: Game, beat: TutorialBeat): void {
    switch (beat.setup) {
      case 'spectrum':
        game.board.clearAll();
        for (const cell of spectrumStack()) game.board.fill(cell);
        game.active = null;
        break;
      case 'xray': {
        game.board.clearAll();
        const demo = buildXrayDemo();
        for (const cell of demo.cells) game.board.fill(cell);
        game.armPiece('O', demo.pieceLane, demo.pieceU);
        if (game.status !== 'paused') game.pause();
        break;
      }
      case 'laneDemo': {
        game.board.clearAll();
        const demo = laneClearDemo();
        for (const cell of demo.cells) game.board.fill(cell);
        game.active = null;
        break;
      }
      case 'placeClear': {
        game.board.clearAll();
        for (const cell of hiddenRefractionLine(2, 1)) game.board.fill(cell);
        const lane = 4;
        const gapStart = 3;
        for (const cell of [...lineCells('front', 0, lane)].filter(
          (_, u) => u !== gapStart && u !== gapStart + 1
        )) {
          game.board.fill(cell);
        }
        // O is already over the two-cell gap — drop only.
        game.armPiece('O', lane, gapStart);
        break;
      }
      case 'shiftReady':
        if (game.status !== 'awaitingTurn') {
          game.shiftMeter = game.stage.linesPerTurn;
          game.status = 'awaitingTurn';
        }
        game.pause();
        break;
      case 'act2Piece':
        game.board.clearAll();
        for (const cell of spectrumStack()) game.board.fill(cell);
        game.armPiece('SCREW_R', 3, 2);
        if (beat.advance.kind === 'continue' && game.status !== 'paused') game.pause();
        break;
      case 'act3Collapse':
        game.board.clearAll();
        for (const cell of spectrumStack()) game.board.fill(cell);
        for (const cell of almostCompleteFrontLine('front', 1, 3, 0)) game.board.fill(cell);
        game.active = null;
        game.heat = 1;
        if (game.status !== 'paused') game.pause();
        break;
      case 'none':
        break;
    }
  }

  private refreshHole(): void {
    if (this.holeKind === 'none') {
      this.spotlight.setHole(null);
      const beat = TUTORIAL_BEATS[this.index];
      if (beat?.id === 'choose-shift' && this.isCompact()) {
        this.spotlight.setCardPlacement('top');
        return;
      }
      if (!this.lockedPlacement || this.lockedPlacement === 'top') this.lockedPlacement = 'left';
      this.spotlight.setCardPlacement(this.lockedPlacement);
      return;
    }
    const hole = this.resolveHole();
    this.spotlight.setHole(hole);
    this.spotlight.setSoftScrim(this.softScrim);
    const beat = TUTORIAL_BEATS[this.index];
    if (beat?.id === 'choose-shift' && this.isCompact()) {
      this.spotlight.setCardPlacement('top');
      return;
    }
    if (!this.lockedPlacement || this.lockedPlacement === 'top') {
      this.lockedPlacement = pickCardPlacement(hole, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    this.spotlight.setCardPlacement(this.lockedPlacement);
  }

  private holeFromCells(cells: readonly { x: number; y: number; z: number }[]): SpotlightHole | null {
    const focus = this.host.getRenderer().cellsScreenRect(cells);
    if (!focus || focus.width <= 0 || focus.height <= 0) return null;
    const pad = 28;
    const radius = Math.max(
      this.holeRadius,
      0.55 * Math.max(focus.width, focus.height) + pad
    );
    return {
      x: focus.left + focus.width / 2,
      y: focus.top + focus.height / 2,
      radius,
    };
  }

  private resolveHole(): SpotlightHole | null {
    if (this.holeKind === 'well') {
      const game = this.host.getGame();
      if (this.holeFocus === 'active') {
        const cells = [
          ...game.activeCells(),
          ...(game.active ? game.ghostCells() : []),
        ];
        const hole = this.holeFromCells(cells);
        if (hole) return hole;
      } else if (this.holeFocus === 'filled') {
        const cells = [
          ...game.board.filledCells(),
          ...game.activeCells(),
          ...(game.active ? game.ghostCells() : []),
        ];
        const hole = this.holeFromCells(cells);
        if (hole) return hole;
      }
      const rect = this.host.getRenderer().wellScreenRect();
      const fitted = this.fitWell
        ? Math.min(280, Math.max(110, 0.55 * Math.min(rect.width, rect.height)))
        : this.holeRadius;
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        radius: fitted,
      };
    }
    if (this.holeKind === 'prompt') {
      const node = document.querySelector('.prompt');
      if (!(node instanceof HTMLElement) || node.hidden) {
        const rect = this.host.getRenderer().wellScreenRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height * 0.35,
          radius: this.holeRadius,
        };
      }
      const pill = node.querySelector('.prompt__pill');
      const box = (pill instanceof HTMLElement ? pill : node).getBoundingClientRect();
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        radius: Math.max(this.holeRadius, Math.max(box.width, box.height) * 0.55),
      };
    }
    if (this.holeKind === 'hud' && this.holeSelector) {
      const node = document.querySelector(this.holeSelector);
      if (!(node instanceof HTMLElement) || node.hidden) return null;
      const box = node.getBoundingClientRect();
      return {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        radius: Math.max(this.holeRadius, Math.max(box.width, box.height) * 0.6),
      };
    }
    return null;
  }

  private teardown(): void {
    this.active = false;
    this.waiting = null;
    this.allow = null;
    this.index = -1;
    this.lockedPlacement = null;
    this.appliedRebuildIndex = -1;
    this.revealPanPending = false;
    this.host.getGame().holdTurnPrompt(false);
    this.host.getRenderer().clearTutorialLook();
    this.host.getRenderer().setPeek(false);
    this.spotlight.hide();
  }
}
