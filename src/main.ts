/**
 * Composition root.
 *
 * Owns the fixed-timestep loop, wires input to the engine and the engine to the
 * renderer, and nothing else. All three of those pieces are independently
 * testable; this file is the only place they meet.
 */

import './styles/app.css';
import { DEFAULT_TURN_DURATION_MS, Game } from '@core/game';
import type { PieceCatalog } from '@core/pieces';
import type { TurnDirection } from '@core/types';
import { GameRenderer } from '@render/game-renderer';
import { InputController } from './input';
import { Hud } from '@ui/hud';
import { Audio } from './audio/audio';
import { Screens } from '@ui/screens';
import type { ScreenName } from '@ui/screens';
import { toView } from '@core/projection';
import { stageLabel } from '@core/stages';
import { MODES, isUnlocked, modeById } from '@core/modes';
import type { ModeConfig, ModeId } from '@core/modes';
import { parseChallenge } from '@core/challenge';
import type { Challenge } from '@core/challenge';
import { isPersonalBest, recordRun, withSettings } from '@core/save';
import type { SaveData, Settings } from '@core/save';
import { loadSave, persistSave, storageAvailable } from '@ui/storage';
import { BINDINGS, keyLabel } from './keymap';
import { TouchController } from './touch/controller';

/** Simulation step. Fixed, so replays are exact regardless of frame rate. */
const STEP_MS = 1000 / 60;
/** Never simulate more than this much time in one frame after a stall. */
const MAX_FRAME_MS = 250;

function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}

/**
 * `?debug=1` publishes the live game on `window`, and `?seed=` pins the run.
 *
 * The engine is deterministic but the *player* is not, and some states -- a
 * filled Shift meter, a Refraction Clear -- take a skilled run to reach. This
 * lets the end-to-end suite and the capture script drive the game to those
 * states directly instead of hoping to stumble into them.
 */
interface DebugHandle {
  game: Game;
  renderer: GameRenderer;
  restart: (seed?: string) => void;
  /** Jump straight into a mode, skipping the title and mode select. */
  play: (mode: ModeId, seed?: string) => void;
  save: () => SaveData;
  screen: () => ScreenName;
  /**
   * The binding table, flattened for assertions. The end-to-end suite checks the
   * rendered key map against this rather than against a copy of the bindings
   * written out in the test, which would drift the moment one changed.
   */
  bindings: { action: string; label: string; keys: string[] }[];
}

declare global {
  interface Window {
    __refraction?: DebugHandle;
  }
}

/** Depth lane of the shallowest filled cell, used to pitch a sound. */
function nearestLane(game: Game): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const cell of game.board.filledCells()) {
    nearest = Math.min(nearest, toView(game.face, cell).lane);
    if (nearest === 0) break;
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

function boot(root: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  const hud = new Hud();

  const params = new URLSearchParams(window.location.search);
  const startingSeed = params.get('seed') ?? randomSeed();

  const debug = params.get('debug') === '1';
  const turnMs = Number(params.get('turnMs'));

  let save = loadSave();

  // The OS setting is a floor, not a default: a player who has asked their
  // system for reduced motion gets it whatever the save says, but one who
  // switched it on in our settings keeps it regardless of the OS. This is both
  // the reduced-motion and the photosensitivity guard.
  const systemReducedMotion =
    params.get('reducedMotion') === '1' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (systemReducedMotion && !save.settings.reducedMotion) {
    save = withSettings(save, { reducedMotion: true });
  }

  // The engine owns the turn's duration and the renderer animates the camera
  // over the same span, so the snap and the clear land on the same frame.
  const turnDurationMs =
    debug && Number.isFinite(turnMs) && turnMs > 0 ? turnMs : DEFAULT_TURN_DURATION_MS;

  // The M6.5 playtest bed: an alternative piece vocabulary, never the default.
  const catalog: PieceCatalog =
    params.get('pieces') === 'experimental' ? 'experimental' : 'standard';

  let mode: ModeConfig = modeById(save.lastMode);
  /** The challenge the current run is pinned to, if any. */
  let challenge: Challenge | null = null;

  const newGame = (seed: string, config: ModeConfig): Game =>
    new Game({ seed, turnDurationMs, catalog, mode: config });

  /**
   * `?seed=` pins the *first* run, not every run.
   *
   * A pinned seed exists to reproduce one game exactly, which is what the
   * end-to-end suite and the capture script need. Handing the same seed to
   * every subsequent run would quietly turn "play again" into "replay the
   * identical game", so the pin is spent once and the rest are random.
   */
  let pinnedSeed: string | null = params.get('seed');
  const nextSeed = (): string => {
    const seed = pinnedSeed ?? randomSeed();
    pinnedSeed = null;
    return seed;
  };

  let game = newGame(startingSeed, mode);
  const renderer = new GameRenderer(canvas, {
    preserveDrawingBuffer: debug,
    turnDurationMs,
    reducedMotion: save.settings.reducedMotion,
  });
  const audio = new Audio();

  /** Where the settings panel returns to when it is dismissed. */
  let settingsReturn: ScreenName = 'title';
  /** Whether the run in progress has already been folded into the save. */
  let outcomeRecorded = false;

  const applySettings = (settings: Settings): void => {
    renderer.setPreferences({
      reducedMotion: settings.reducedMotion,
      screenShake: settings.screenShake,
      bloom: settings.bloom,
      depthColour: mode.depthColour,
    });
    audio.setMuted(settings.muted);
    audio.setVolume(settings.volume);
    hud.setMuted(settings.muted);
    hud.setDepthColour(mode.depthColour);
  };

  const commit = (next: SaveData): void => {
    save = next;
    screens.setSave(save);
    applySettings(save.settings);
    persistSave(save);
  };

  const startRun = (id: ModeId, pinned: Challenge | null = null): void => {
    mode = pinned ? pinned.mode : modeById(id);
    challenge = pinned;
    game = newGame(pinned ? pinned.seed : nextSeed(), mode);
    outcomeRecorded = false;
    if (window.__refraction) window.__refraction.game = game;
    applySettings(save.settings);
    screens.show('playing');
  };

  /** Fold a finished run into the save, exactly once. */
  const recordOutcome = (): void => {
    if (outcomeRecorded) return;
    outcomeRecorded = true;
    const outcome = {
      mode: mode.id,
      score: game.score,
      lines: game.lines,
      stage: game.stage.index,
      turns: game.turns,
      prisms: game.prisms,
      ...(challenge ? { challenge: challenge.code } : {}),
    };
    screens.showOutcome({
      score: game.score,
      lines: game.lines,
      stage: game.stage.index,
      best: save.records[mode.id]?.bestScore ?? 0,
      personalBest: isPersonalBest(save, outcome),
      canFail: mode.canFail,
      ...(challenge ? { challenge: challenge.code } : {}),
    });
    commit(recordRun(save, outcome));
  };

  const screens: Screens = new Screens(save, {
    onStart: (id) => startRun(id),
    onChallenge: (entry) => startRun(entry.mode.id, entry),
    onResume: (): void => {
      game.resume();
      screens.show('playing');
    },
    onQuit: () => {
      // From settings this is "back"; from pause it is "leave the run".
      if (screens.screen === 'settings') screens.show(settingsReturn);
      else screens.show('title');
    },
    onRestart: () => startRun(mode.id, challenge),
    onSettings: (patch) => commit(withSettings(save, patch)),
    onOpen: (screen) => {
      if (screen === 'settings') settingsReturn = screens.screen;
      screens.show(screen);
    },
  });

  root.replaceChildren(canvas, hud.root, screens.root);
  if (!storageAvailable()) screens.warnUnwritableStorage();
  applySettings(save.settings);

  // `?challenge=CODE` and `?mode=prism` both open straight into a run. A deep
  // link still respects the unlock, so it cannot be used to jump the queue --
  // the lock is a pacing device, and a URL is not a reason to spend it.
  const linkedChallenge = parseChallenge(params.get('challenge'));
  const requested = MODES.find((entry) => entry.id === params.get('mode'));
  if (linkedChallenge && isUnlocked(linkedChallenge.mode, save.stats.bestStage)) {
    startRun(linkedChallenge.mode.id, linkedChallenge);
  } else if (requested && isUnlocked(requested, save.stats.bestStage)) {
    startRun(requested.id);
  }

  const playing = (): boolean => screens.screen === 'playing';

  if (debug) {
    const handle: DebugHandle = {
      game,
      renderer,
      restart: (seed?: string) => {
        game = newGame(seed ?? nextSeed(), mode);
        outcomeRecorded = false;
        handle.game = game;
      },
      play: (id: ModeId, seed?: string) => {
        mode = modeById(id);
        challenge = null;
        game = newGame(seed ?? nextSeed(), mode);
        outcomeRecorded = false;
        handle.game = game;
        applySettings(save.settings);
        screens.show('playing');
      },
      save: () => save,
      screen: () => screens.screen,
      bindings: BINDINGS.map((binding) => ({
        action: binding.action,
        label: binding.label,
        keys: binding.codes.map(keyLabel),
      })),
    };
    window.__refraction = handle;
  }

  const input = new InputController(() => game, {
    accepts: playing,
    onPause: () => {
      // Esc toggles between the board and the pause panel, and backs out of
      // settings to wherever it was opened from.
      if (screens.screen === 'playing') {
        game.pause();
        screens.show('paused');
      } else if (screens.screen === 'paused') {
        game.resume();
        screens.show('playing');
      } else if (screens.screen === 'settings') {
        screens.show(settingsReturn);
      }
      // A gesture half-made when the menu opened must not land on the board
      // when it closes.
      touch.cancel();
    },
    onRestart: () => {
      if (screens.screen === 'over') startRun(mode.id, challenge);
    },
    // The camera is driven by the engine's 'turn' event alone. Starting it here
    // as well would begin the rotation twice and overshoot the 90 degrees.
    onTurn: (direction: TurnDirection) => {
      game.chooseTurn(direction);
    },
    // An AudioContext cannot start outside a user gesture, so the first key
    // press is what brings the sound up.
    onInteract: () => audio.resume(),
    onToggleMute: () => commit(withSettings(save, { muted: !save.settings.muted })),
  });

  // Touch and pen only. A mouse keeps the keyboard game: dragging a piece with
  // a cursor is worse than pressing an arrow key, and a laptop with a
  // touchscreen should not change behaviour based on which input was used last.
  const touch = new TouchController(root, () => game, {
    accepts: playing,
    onInteract: () => audio.resume(),
    onTurn: (direction: TurnDirection) => game.chooseTurn(direction),
    wellRect: () => renderer.wellScreenRect(),
  });

  window.addEventListener('resize', () => renderer.resize());
  // Clicking a menu button is also a user gesture, and the only one a
  // mouse-only player makes before the first key press.
  root.addEventListener('pointerdown', () => audio.resume());

  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    const elapsed = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    accumulator += elapsed;

    while (accumulator >= STEP_MS) {
      accumulator -= STEP_MS;
      if (!playing()) continue;
      input.update(STEP_MS);
      // The engine has its own turning state now, so it holds itself still while
      // the board rotates. No need for the renderer to gate the simulation.
      game.tick(STEP_MS);
    }

    for (const event of game.drainEvents()) {
      switch (event.type) {
        case 'turn':
          if (event.direction) {
            renderer.startTurn(event.direction);
            audio.turn(event.direction);
          }
          break;
        case 'lock':
          audio.lock(nearestLane(game));
          if (event.cells) renderer.lockFlash(event.cells);
          break;
        case 'clear': {
          if (event.label) hud.showBanner(event.label);
          hud.showScorePopup(event.score ?? 0);
          audio.clear(event.lines ?? 1, event.cascade ?? 0, nearestLane(game));
          // Bigger clears hit harder; a Full Spectrum shakes the hardest.
          renderer.shake(event.prism ? 1 : Math.min((event.lines ?? 1) / 4, 0.7));
          if (event.cleared) {
            renderer.clearEffect(
              event.cleared,
              game.face,
              event.refraction === true,
              event.prism === true
            );
          }
          if (event.prism) {
            renderer.startPrism();
            audio.prism();
          }
          break;
        }
        case 'stage':
          hud.showStageBanner(stageLabel(game.stage));
          break;
        case 'rescue':
          // Zen took the top of the stack off instead of ending the run. Say
          // so, or the rows appear to vanish for no reason.
          hud.showBanner('OVERFLOW CLEARED');
          renderer.shake(0.5);
          break;
        case 'gameOver':
          audio.gameOver();
          break;
        default:
          break;
      }
    }

    // The game-over screen follows the engine's *state*, not its event. An
    // event can be missed -- drained while a panel is up, or reached by a route
    // that never queued one -- and a run that has ended must always be shown as
    // ended.
    if (playing() && game.status === 'gameOver') {
      recordOutcome();
      screens.show('over');
    }

    // Rendering never stops, even behind a menu. The engine is frozen, but the
    // room is not: the environment drifts and breathes on the title screen and
    // under the pause panel, which is the whole point of it. Skipping frames
    // there would save a little power and kill the thing that makes the space
    // feel inhabited.
    renderer.render(game, elapsed);
    hud.update(game, elapsed);
    hud.layoutWell(renderer.wellScreenRect());
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);

  // Signals to the end-to-end suite that the first frame has been drawn.
  root.dataset.ready = 'true';
}

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  boot(root);
}
