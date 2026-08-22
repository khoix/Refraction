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
import { GAMEPLAY, THEME, TRACKS, playableSource, trackById } from './audio/tracks';
import { SFX, playableSfxSource } from './audio/sfx';
import { preload } from './assets/preload';
import { Screens } from '@ui/screens';
import type { ScreenName } from '@ui/screens';
import { Spotlight } from '@ui/tutorial/spotlight';
import { TutorialRunner } from '@ui/tutorial/runner';
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
 * Screens that loop the menu theme.
 *
 * The boot gate is silent — loading and the first tap are not a concert. Once
 * the player is on the main menu (`title`) or choosing a mode/challenge, the
 * theme runs. `settings` is resolved separately: opened from a theme screen it
 * is still the menu; opened from a run it is not.
 */
const THEME_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  'title',
  'modes',
  'challenge',
]);

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
  music: () => {
    ready: boolean;
    playing: boolean;
    error: string | null;
    source: string | null;
    /** Catalogue id of the loaded track (`theme`, `block-drift`, …). */
    track: string | null;
  };
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

/**
 * Live button under a pointer event, if any.
 *
 * Hover and click chrome only answer to real buttons — toggles and ranges are
 * not the same gesture, and firing a tick on every label click would muddy the
 * settings panel.
 */
function liveButton(event: Event): HTMLButtonElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement) || button.disabled || button.hidden) return null;
  return button;
}

/** Soft hover and click ticks for menu / HUD chrome. */
function bindButtonSounds(root: HTMLElement, audio: Audio): void {
  root.addEventListener('pointerover', (event) => {
    // Touch has no hover; a finger landing would otherwise chirp on every tap.
    if (event.pointerType !== 'mouse') return;
    const button = liveButton(event);
    if (!button) return;
    if (event.relatedTarget instanceof Node && button.contains(event.relatedTarget)) return;
    audio.hover();
  });
  root.addEventListener('click', (event) => {
    if (!liveButton(event)) return;
    audio.click();
  });
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
   * Nothing of a run left on a boardless screen.
   *
   * A new `Game` spawns a piece immediately, and on a screen nobody is playing
   * that piece is a cube hanging in mid-air with a ghost, a landing mark and a
   * drop channel cut through the well beneath it -- all of it describing a move
   * nobody is making. The composed arrangement used to clear it as a side effect;
   * with that gone this has to say so itself.
   *
   * Settled cells go too. The title, mode grid and challenge screens no longer
   * show a board -- the room carries them -- so a finished or abandoned stack
   * would sit in the middle of the picture until the next run replaced the game.
   */
  const stillTheTitle = (): void => {
    game.active = null;
    game.board.clearAll();
  };
  stillTheTitle();
  const renderer = new GameRenderer(canvas, {
    preserveDrawingBuffer: debug,
    turnDurationMs,
    reducedMotion: save.settings.reducedMotion,
  });
  const audio = new Audio();
  // Says "this page plays media" before anything tries to. On iOS it is the
  // difference between sound and the hardware silent switch swallowing it.
  Audio.declarePlayback();

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
    // face. Without this the camera opens wherever the attract cycle left it,
    // colouring the board for a face nobody is playing.
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

  const tutorialRef: { current: TutorialRunner | null } = { current: null };
  const spotlight = new Spotlight({
    onContinue: () => tutorialRef.current?.continue(),
    onBack: () => tutorialRef.current?.back(),
    onSkip: () => tutorialRef.current?.skip(),
  });

  const tutorial = new TutorialRunner(spotlight, {
    getGame: () => game,
    getRenderer: () => renderer,
    rebuildGame: (config, seed) => {
      mode = config;
      challenge = null;
      game = newGame(seed, config);
      renderer.snapToFace(game.face);
      applyStripReserve();
      screens.setMode(mode);
      // Tutorial runs are never folded into the save.
      outcomeRecorded = true;
      if (window.__refraction) window.__refraction.game = game;
      applySettings(save.settings);
      return game;
    },
    finish: (to) => {
      audio.clearGameplayPin();
      stillTheTitle();
      screens.show(to);
    },
    isTouchPrimary: () => touchPrimary(),
    reducedMotion: () => save.settings.reducedMotion,
  });
  tutorialRef.current = tutorial;

  const startTutorial = (): void => {
    outcomeRecorded = true;
    screens.show('playing');
    audio.playPinnedGameplay('block-drift');
    tutorial.start();
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
     * interacted" rule rather than on the gesture itself. The boot gate stayed
     * silent; this tap is what lands on the main menu.
     */
    onEnter: () => {
      audio.resume();
      screens.show('title');
      audio.playTheme();
    },
    onTutorial: () => startTutorial(),
    onChallenge: (entry) => startRun(entry.mode.id, entry),
    onResume: (): void => {
      game.resume();
      screens.show('playing');
    },
    onQuit: () => {
      // From settings this is "back"; from pause it is "leave the run".
      if (screens.screen === 'settings') screens.show(settingsReturn);
      else {
        stillTheTitle();
        screens.show('title');
      }
    },
    onRestart: () => startRun(mode.id, challenge),
    onSettings: (patch) => commit(withSettings(save, patch)),
    onOpen: (screen) => {
      if (screen === 'settings') settingsReturn = screens.screen;
      // Game over → mode grid (and any other boardless destination) must drop
      // the finished stack the same way MAIN MENU does via `onQuit`.
      if (
        screens.screen === 'over' &&
        (screen === 'modes' || screen === 'title' || screen === 'challenge')
      ) {
        stillTheTitle();
      }
      screens.show(screen);
    },
  });

  bindButtonSounds(screens.root, audio);
  bindButtonSounds(hud.root, audio);
  bindButtonSounds(spotlight.root, audio);

  root.replaceChildren(canvas, hud.root, spotlight.root, screens.root);
  if (!storageAvailable()) screens.warnUnwritableStorage();
  applySettings(save.settings);

  // `?challenge=CODE` and `?mode=prism` both open straight into a run. A deep
  // link still respects the unlock, so it cannot be used to jump the queue --
  // the lock is a pacing device, and a URL is not a reason to spend it.
  //
  // A deep link goes round the front door rather than through it. The boot gate
  // is there to fill a wait and collect a gesture; a link that names a run is a
  // player who has already chosen, and holding a shared challenge code behind a
  // multi-megabyte download of music it will not play would be a worse front door
  // than none. The preload still runs -- see below -- so the catalogue is there
  // if they quit back to the menu.
  const linkedChallenge = parseChallenge(params.get('challenge'));
  const requested = MODES.find((entry) => entry.id === params.get('mode'));
  if (linkedChallenge && isUnlocked(linkedChallenge.mode, save.stats.bestStage)) {
    startRun(linkedChallenge.mode.id, linkedChallenge);
  } else if (requested && isUnlocked(requested, save.stats.bestStage)) {
    startRun(requested.id);
  }

  /*
   * Pull every track down while the player is looking at the door.
   *
   * Deliberately not awaited and deliberately unable to reject: `preload`
   * resolves a failed asset rather than throwing, so the worst case is a game
   * with no music and a door that still opens. A front door that can be jammed
   * shut by a missing file would be a strictly worse product than no front door
   * at all.
   *
   * The encoding is chosen before the fetch, not after. Downloading megabytes
   * and then discovering the platform cannot decode them is the same silence as
   * downloading nothing, only slower -- and a device that can play none of the
   * encodings should spend no bandwidth at all.
   */
  const wanted = [
    ...TRACKS.flatMap((track) => {
      const source = playableSource(track);
      return source ? [{ id: track.id, url: source.url, bytes: track.bytes }] : [];
    }),
    ...SFX.flatMap((clip) => {
      const source = playableSfxSource(clip);
      return source ? [{ id: clip.id, url: source.url, bytes: clip.bytes }] : [];
    }),
  ];
  void preload(wanted, {
    onProgress: (progress) => screens.setLoading(progress.fraction),
  }).then((loaded) => {
    const byId = new Map(loaded.map((asset) => [asset.id, asset]));
    const themeSource = playableSource(THEME);
    const themeAsset = byId.get(THEME.id);
    const theme =
      themeAsset?.blob && themeSource ? { id: THEME.id, url: themeSource.url } : null;
    // The fetched bytes are not handed on: the element is pointed at the same
    // URL, which the fetch has just warmed in the HTTP cache. See `music.ts` for
    // why a blob was the wrong thing to give it.
    const gameplay = GAMEPLAY.flatMap((track) => {
      const source = playableSource(track);
      const asset = byId.get(track.id);
      return source && asset?.blob ? [{ id: track.id, url: source.url }] : [];
    });
    audio.setMusicCatalog(theme, gameplay);
    const sfx = SFX.flatMap((clip) => {
      const source = playableSfxSource(clip);
      const asset = byId.get(clip.id);
      return source && asset?.blob ? [{ id: clip.id, url: source.url }] : [];
    });
    audio.setSfxCatalog(sfx);
    screens.setLoading(1);
    screens.setReady(true);
    /*
     * Say so when there will be no music.
     *
     * Silence is the one failure this whole arrangement keeps producing, and it
     * looks identical from the outside whatever caused it -- an encoding the
     * device refuses, a fetch that failed, a decoder that gave up. A player who
     * gets no music deserves to know it is the game and not their volume, and it
     * turns an invisible failure into a reportable one.
     */
    if (!playableSource(THEME)) screens.setMusicNote('MUSIC UNAVAILABLE · FORMAT');
    else if (!theme) screens.setMusicNote('MUSIC UNAVAILABLE · DOWNLOAD');
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
      music: () => ({
        ready: audio.musicReady,
        playing: audio.musicPlaying,
        error: audio.musicError,
        // Which encoding this browser said it could play, so a device that is
        // silent can be asked *why* rather than guessed at.
        source: playableSource(THEME)?.mime ?? null,
        track: audio.musicTrackId,
      }),
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
    allowsAction: (action) => !tutorial.running || tutorial.allows(action),
    onPause: () => {
      if (tutorial.onEscape()) {
        touch.cancel();
        return;
      }
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
    allowsAction: (action) => !tutorial.running || tutorial.allows(action),
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
  // Touch spends through the X trigger above pause. The engine decides whether
  // the collapse happens.
  hud.onCollapseTap(() => {
    audio.resume();
    game.triggerCollapse();
  });

  // Face-choice taps on the prompt arrows. Same destination naming as the
  // keys: left brings the left face forward. Strip swipes are inverted (drag
  // the board); these labels are not.
  hud.onTurnTap((direction) => {
    audio.resume();
    if (!playing()) return;
    const action = direction === 'left' ? 'moveLeft' : 'moveRight';
    if (tutorial.running && !tutorial.allows(action)) return;
    game.chooseTurn(direction);
  });

  hud.onMusicDeck({
    onToggle: () => {
      audio.toggleMusicPause();
    },
    onNext: () => {
      audio.nextGameplayTrack();
    },
  });

  // Touch-primary pause. Same open path as Esc; the panel owns resume / main menu.
  hud.onPause(() => {
    if (screens.screen !== 'playing') return;
    if (tutorial.onEscape()) {
      touch.cancel();
      return;
    }
    game.pause();
    screens.show('paused');
    touch.cancel();
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

    const events = game.drainEvents();
    if (tutorial.running) tutorial.onEvents(events);
    for (const event of events) {
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
        case 'spectralReady':
          // Earned, not spent. The collapse itself is silent on the banner — it
          // has not happened yet when the bar fills, and announcing it then would
          // be a lie. Sound + copy mark the threshold; the flicker marks the wait.
          audio.spectralReady();
          hud.showBanner(
            'SPECTRAL COLLAPSE IMMINENT',
            touchPrimary() ? 'PUSH X TO TRIGGER' : 'PRESS V TO TRIGGER'
          );
          break;
        case 'collapse':
          // The event fires the moment the stack gives way, before the clears
          // it produces resolve -- so the fanfare lands with the fall rather
          // than with whatever the fall happens to complete.
          audio.spectralCollapse();
          renderer.startCollapse();
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

    if (tutorial.running) tutorial.tick();

    // The game-over screen follows the engine's *state*, not its event. An
    // event can be missed -- drained while a panel is up, or reached by a route
    // that never queued one -- and a run that has ended must always be shown as
    // ended.
    if (playing() && game.status === 'gameOver' && !tutorial.running) {
      recordOutcome();
      screens.show('over');
    }

    /*
     * The bed follows the screen, not the transition into it.
     *
     * Driven from state here rather than from the handlers that change screens,
     * for the reason the game-over panel above is: there are eight ways to reach
     * the mode grid and one of them will eventually forget to make the call. A
     * screen the player is *on* cannot be missed. Theme and gameplay beds are
     * both idempotent at the graph level precisely so this can run every frame.
     */
    const screen = screens.screen;
    const bedFor = screen === 'settings' ? settingsReturn : screen;
    if (THEME_SCREENS.has(bedFor)) audio.playTheme();
    else if (bedFor === 'boot') audio.stopMusic();
    else audio.playGameplay();

    /*
     * The title no longer turns.
     *
     * It used to, and the reasoning was good while it lasted: the board
     * presented each of its four faces using the game's own turn, so the front
     * door demonstrated the central mechanic before anyone had pressed anything.
     * That argument died with the composed stack. There is no board on the title
     * now, so the turn presents nothing -- it just orbits the camera, and since
     * the room is fixed in world space, orbiting the camera drags the entire
     * background across the screen every few seconds.
     *
     * That was the shifting. Nothing in the room moves as a body any more, and
     * the camera holding still is the last piece of it. It also takes the floor
     * lattice away, which is gated on the turn and has no business under a menu.
     */
    // Rendering never stops, even behind a menu. The engine is frozen, but the
    // room is not: the environment drifts and breathes on the title screen and
    // under the pause panel, which is the whole point of it. Skipping frames
    // there would save a little power and kill the thing that makes the space
    // feel inhabited.
    // The HUD lays out first so the preview's rectangle is this frame's, not
    // last frame's -- otherwise the turning piece lags the panel by a frame
    // through every resize.
    // On the front door the arrangement is scenery: pushed in until its edges
    // run off the frame, so it reads as the room the wordmark is printed on
    // rather than as a board sitting under it. It draws back to its playing
    // framing as the menu arrives, which is half of what makes that handover
    // feel like one screen settling instead of two screens swapping.
    // The well goes with the board: on every screen where nobody is playing,
    // the frame and posts are an empty box drawn around nothing.
    const menu =
      bedFor === 'title' || bedFor === 'modes' || bedFor === 'challenge' || bedFor === 'boot';
    renderer.setBackdrop(menu);
    // The room shows the ramp while nobody is reading a board, and goes neutral
    // for a run. §2.2, and the reason `setAmbientChroma` exists at all.
    renderer.setAmbientChroma(menu);

    // The title screen is the board, not the HUD. Nor is the gate in front of it.
    hud.setHidden(screen === 'title' || screen === 'boot');
    // Pause lives on the phone; Esc covers everything else.
    hud.setPauseVisible(touchPrimary() && screen === 'playing');
    hud.setPauseExits(tutorial.running);
    hud.setStripReserve(touchPrimary() && !game.rollOnly);
    const nowPlaying = trackById(audio.musicTrackId ?? '');
    hud.setMusicDeck(
      screen === 'playing' && nowPlaying
        ? {
            artist: nowPlaying.artist,
            title: nowPlaying.title,
            playing: !audio.musicHeld && audio.musicPlaying,
          }
        : null
    );
    hud.setHeat(game.spectralAllowed ? game.heat : null, game.spectralReady);
    hud.setTurnPromptAllowed(!tutorial.running || tutorial.showsTurnPrompt());
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
