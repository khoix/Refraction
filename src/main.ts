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
import { THEME } from './audio/tracks';
import { preload } from './assets/preload';
import { Screens } from '@ui/screens';
import { composeAttract } from '@ui/attract';
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
import { STRIP_HEIGHT_PX, TouchController, stripTopPx } from './touch/controller';
import { touchPrimary } from './touch/primary';

/** Simulation step. Fixed, so replays are exact regardless of frame rate. */
const STEP_MS = 1000 / 60;
/** Never simulate more than this much time in one frame after a stall. */
const MAX_FRAME_MS = 250;

function randomSeed(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}

/**
 * The screens the menu theme belongs to.
 *
 * Everything a player passes through before a run, and nothing that sits over
 * one. `settings` is deliberately absent and resolved separately, because it is
 * the one panel reachable from both sides -- opened from the title it is still
 * the menu, opened from a pause it is not.
 */
const MENU_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>(['title', 'modes', 'challenge']);

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
   * What the music is doing.
   *
   * `playing` is read off the media element, not off the intent that was handed
   * to it, so the suite can tell "we asked for the theme" apart from "the theme
   * is running".
   */
  music: () => { ready: boolean; playing: boolean };
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
  /**
   * How long the title holds a face before turning to the next.
   *
   * Long enough to read the arrangement in that orientation -- which is the
   * point, since the same stack is a different picture from each face.
   */
  const ATTRACT_DWELL_MS = 2600;
  let attractDwell = 0;
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
      spinPreview: settings.spinPreview,
      depthColour: mode.depthColour,
    });
    audio.setMuted(settings.muted);
    audio.setVolume(settings.volume);
    hud.setMuted(settings.muted);
    hud.setDepthColour(mode.depthColour);
    hud.setSpinPreview(settings.spinPreview);
  };

  const commit = (next: SaveData): void => {
    save = next;
    screens.setSave(save);
    applySettings(save.settings);
    persistSave(save);
  };

  /**
   * Keep the board clear of everything below it.
   *
   * The Shift meter and the touch strip both live under the board, and neither
   * is laid out by the document -- the meter is absolutely positioned and the
   * strip is a region of the window rather than an element -- so the board has
   * to be told how much room to leave. The strip's share is zero in a roll-only
   * mode, which has no strip, and on any device that is not touch-primary.
   *
   * A floor rather than an addition: the fit only pushes the board up when the
   * framing does not already leave this much, so a desktop loses nothing.
   */
  const applyStripReserve = (): void => {
    const strip = touchPrimary() && !game.rollOnly ? STRIP_HEIGHT_PX : 0;
    renderer.setBottomReserve(hud.shiftReservePx + strip);
  };

  const startRun = (id: ModeId, pinned: Challenge | null = null): void => {
    mode = pinned ? pinned.mode : modeById(id);
    challenge = pinned;
    game = newGame(pinned ? pinned.seed : nextSeed(), mode);
    // The title screen has been turning the board; a new game is on the front
    // face. Without this the run opens with the camera wherever the attract
    // cycle left it, colouring the board for a face nobody is playing.
    renderer.snapToFace(game.face);
    // The reserve depends on the mode, so it is re-applied per run rather than
    // once at boot.
    applyStripReserve();
    // The controls panels describe what this mode answers to.
    screens.setMode(mode);
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
    /*
     * The front door opens.
     *
     * Everything here is synchronous and inside the click, which is what makes
     * the sound work: a browser will only start an `AudioContext` from a user
     * gesture, and this is the first one the game is guaranteed to get. The
     * theme is started here as well as from the frame loop -- the loop would
     * pick it up a frame later anyway, but by then the gesture has ended, and
     * starting media outside one relies on the browser's stickier "has
     * interacted" rule rather than on the gesture itself.
     */
    onEnter: () => {
      audio.resume();
      screens.show('title');
      audio.playMusic();
    },
    onChallenge: (entry) => startRun(entry.mode.id, entry),
    onResume: (): void => {
      game.resume();
      screens.show('playing');
    },
    onQuit: () => {
      // From settings this is "back"; from pause it is "leave the run".
      if (screens.screen === 'settings') screens.show(settingsReturn);
      else {
        // Quitting a run before anything landed would otherwise drop the title
        // back to an empty well.
        composeAttract(game);
        screens.show('title');
      }
    },
    onRestart: () => startRun(mode.id, challenge),
    onSettings: (patch) => commit(withSettings(save, patch)),
    onOpen: (screen) => {
      if (screen === 'settings') settingsReturn = screens.screen;
      screens.show(screen);
    },
  });

  // Something behind the title on a cold boot. Returning from a run the board
  // still holds what the player built, and `composeAttract` leaves that alone.
  composeAttract(game);

  root.replaceChildren(canvas, hud.root, screens.root);
  if (!storageAvailable()) screens.warnUnwritableStorage();
  applySettings(save.settings);

  // `?challenge=CODE` and `?mode=prism` both open straight into a run. A deep
  // link still respects the unlock, so it cannot be used to jump the queue --
  // the lock is a pacing device, and a URL is not a reason to spend it.
  //
  // A deep link goes round the front door rather than through it. The boot gate
  // is there to fill a wait and collect a gesture; a link that names a run is a
  // player who has already chosen, and holding a shared challenge code behind a
  // two-megabyte download of music it will not play would be a worse front door
  // than none. The preload still runs -- see below -- so the theme is there if
  // they quit back to the menu.
  const linkedChallenge = parseChallenge(params.get('challenge'));
  const requested = MODES.find((entry) => entry.id === params.get('mode'));
  if (linkedChallenge && isUnlocked(linkedChallenge.mode, save.stats.bestStage)) {
    startRun(linkedChallenge.mode.id, linkedChallenge);
  } else if (requested && isUnlocked(requested, save.stats.bestStage)) {
    startRun(requested.id);
  }

  /*
   * Pull the theme down while the player is looking at the door.
   *
   * Deliberately not awaited and deliberately unable to reject: `preload`
   * resolves a failed asset rather than throwing, so the worst case is a game
   * with no music and a door that still opens. A front door that can be jammed
   * shut by a missing file would be a strictly worse product than no front door
   * at all.
   */
  void preload([{ id: THEME.id, url: THEME.url, bytes: THEME.bytes }], {
    onProgress: (progress) => screens.setLoading(progress.fraction),
  }).then((loaded) => {
    const theme = loaded.find((asset) => asset.id === THEME.id);
    if (theme?.blob) audio.loadMusic(theme.blob);
    screens.setLoading(1);
    screens.setReady(true);
  });

  const playing = (): boolean => screens.screen === 'playing';

  if (debug) {
    const handle: DebugHandle = {
      game,
      renderer,
      /*
       * Both delegate to `startRun` rather than starting a run of their own.
       *
       * They used to duplicate it -- construct the game, reset the flag, show
       * the screen -- and duplication of a start path is drift waiting to
       * happen: it had already missed `snapToFace`, and it missed the strip
       * reserve the moment that was added. The end-to-end suite drives the game
       * through these, so a debug path that diverges from the real one is a
       * suite testing something no player ever gets.
       *
       * `pinnedSeed` is how a seed reaches `startRun`, which reads it through
       * `nextSeed` -- the same route the `?seed=` link uses.
       */
      restart: (seed?: string) => {
        if (seed !== undefined) pinnedSeed = seed;
        startRun(mode.id, challenge);
        handle.game = game;
      },
      play: (id: ModeId, seed?: string) => {
        if (seed !== undefined) pinnedSeed = seed;
        startRun(id);
        handle.game = game;
      },
      save: () => save,
      screen: () => screens.screen,
      music: () => ({ ready: audio.musicReady, playing: audio.musicPlaying }),
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
    // Gated in the engine, not here: when Peek is available is a rule about the
    // mode and the stage, and rules live in core.
    onPeek: (held: boolean) => renderer.setPeek(held && game.peekAllowed),
  });

  // Touch and pen only. A mouse keeps the keyboard game: dragging a piece with
  // a cursor is worse than pressing an arrow key, and a laptop with a
  // touchscreen should not change behaviour based on which input was used last.
  const touch = new TouchController(root, () => game, {
    accepts: playing,
    onInteract: () => audio.resume(),
    onTurn: (direction: TurnDirection) => game.chooseTurn(direction),
    wellRect: () => renderer.wellScreenRect(),
    // The engine answers this, not the interface: which rotations a mode permits
    // is a rule, and a gesture layer that decided for itself could hide a verb
    // the keyboard still had.
    hasStrip: () => !game.rollOnly,
    sensitivity: () => save.settings.touchSensitivity,
  });

  applyStripReserve();
  screens.setMode(mode);
  // Touch's half of the collapse trigger. The engine decides whether it happens.
  hud.onCollapseTap(() => {
    audio.resume();
    game.triggerCollapse();
  });

  window.addEventListener('resize', () => {
    applyStripReserve();
    renderer.resize();
  });
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
        case 'collapse':
          // The event fires the moment the stack gives way, before the clears
          // it produces resolve -- so the shake lands with the fall rather than
          // with whatever the fall happens to complete.
          hud.showBanner('SPECTRAL COLLAPSE');
          renderer.shake(0.9);
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

    /*
     * The theme follows the screen, not the transition into it.
     *
     * Driven from state here rather than from the handlers that change screens,
     * for the reason the game-over panel above is: there are eight ways to reach
     * the mode grid and one of them will eventually forget to make the call. A
     * screen the player is *on* cannot be missed. `Music` is idempotent at the
     * graph level precisely so this can run every frame.
     */
    const screen = screens.screen;
    const menu =
      screen === 'settings' ? MENU_SCREENS.has(settingsReturn) : MENU_SCREENS.has(screen);
    if (menu) audio.playMusic();
    else audio.stopMusic();

    // The title turns.
    //
    // The board presents each face in turn, using the game's own turn rather
    // than a rotation written for the title: the front door is then a
    // demonstration of the central mechanic, before anyone has pressed
    // anything, and there is only one piece of turn choreography in the codebase
    // rather than two that can drift apart.
    //
    // The boot gate turns too. It is the same picture with the same wordmark
    // over it, and a board that started moving only once the door opened would
    // make the first screen read as a still image of the second.
    //
    // Held between turns so it reads as presenting a face rather than as
    // spinning. Suppressed entirely under reduced motion -- an unattended,
    // unstoppable animation is exactly what that setting is for, and the still
    // board is a perfectly good backdrop.
    if ((screen === 'title' || screen === 'boot') && !save.settings.reducedMotion) {
      attractDwell += elapsed;
      if (!renderer.isTurning && attractDwell >= ATTRACT_DWELL_MS) {
        attractDwell = 0;
        renderer.startTurn('right');
      }
    } else {
      attractDwell = 0;
    }

    // Rendering never stops, even behind a menu. The engine is frozen, but the
    // room is not: the environment drifts and breathes on the title screen and
    // under the pause panel, which is the whole point of it. Skipping frames
    // there would save a little power and kill the thing that makes the space
    // feel inhabited.
    // The HUD lays out first so the preview's rectangle is this frame's, not
    // last frame's -- otherwise the turning piece lags the panel by a frame
    // through every resize.
    // The title screen is the board, not the HUD. Nor is the gate in front of it.
    hud.setHidden(screen === 'title' || screen === 'boot');
    hud.setHeat(game.spectralAllowed ? game.heat : null, game.spectralReady);
    hud.update(game, elapsed);
    hud.layoutWell(
      renderer.wellScreenRect(),
      touchPrimary() && !game.rollOnly ? stripTopPx(window.innerHeight) : null
    );
    const next = game.preview[0];
    renderer.setPreview(
      save.settings.spinPreview && next && screens.screen === 'playing' ? hud.nextSlotRect() : null,
      next?.def.cells ?? [],
      next?.lane ?? 0
    );
    renderer.render(game, elapsed);
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
