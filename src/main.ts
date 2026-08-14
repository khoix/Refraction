/**
 * Composition root.
 *
 * Owns the fixed-timestep loop, wires input to the engine and the engine to the
 * renderer, and nothing else. All three of those pieces are independently
 * testable; this file is the only place they meet.
 */

import './styles/app.css';
import { DEFAULT_TURN_DURATION_MS, Game } from '@core/game';
import type { TurnDirection } from '@core/types';
import { GameRenderer } from '@render/game-renderer';
import { InputController } from './input';
import { Hud } from '@ui/hud';
import { Audio } from './audio/audio';
import { toView } from '@core/projection';

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
  root.replaceChildren(canvas, hud.root);

  const params = new URLSearchParams(window.location.search);
  const startingSeed = params.get('seed') ?? randomSeed();

  const debug = params.get('debug') === '1';
  const turnMs = Number(params.get('turnMs'));

  // Honour the OS setting, and let a query flag force it for testing. This is
  // both the reduced-motion and the photosensitivity guard.
  const reducedMotion =
    params.get('reducedMotion') === '1' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The engine owns the turn's duration and the renderer animates the camera
  // over the same span, so the snap and the clear land on the same frame.
  const turnDurationMs =
    debug && Number.isFinite(turnMs) && turnMs > 0 ? turnMs : DEFAULT_TURN_DURATION_MS;

  const newGame = (seed: string): Game => new Game({ seed, turnDurationMs });

  let game = newGame(startingSeed);
  const renderer = new GameRenderer(canvas, {
    preserveDrawingBuffer: debug,
    turnDurationMs,
    reducedMotion,
  });
  const audio = new Audio();

  if (debug) {
    const handle: DebugHandle = {
      game,
      renderer,
      restart: (seed?: string) => {
        game = newGame(seed ?? randomSeed());
        handle.game = game;
      },
    };
    window.__refraction = handle;
  }

  const input = new InputController(() => game, {
    onRestart: () => {
      game = newGame(randomSeed());
      if (window.__refraction) window.__refraction.game = game;
    },
    // The camera is driven by the engine's 'turn' event alone. Starting it here
    // as well would begin the rotation twice and overshoot the 90 degrees.
    onTurn: (direction: TurnDirection) => {
      game.chooseTurn(direction);
    },
    // An AudioContext cannot start outside a user gesture, so the first key
    // press is what brings the sound up.
    onInteract: () => audio.resume(),
    onToggleMute: () => hud.setMuted(audio.toggleMute()),
  });

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number): void => {
    const elapsed = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    accumulator += elapsed;

    while (accumulator >= STEP_MS) {
      accumulator -= STEP_MS;
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
          break;
        case 'clear': {
          if (event.label) hud.showBanner(event.label);
          hud.showScorePopup(event.score ?? 0);
          audio.clear(event.lines ?? 1, event.cascade ?? 0, nearestLane(game));
          // Bigger clears hit harder; a Full Spectrum shakes the hardest.
          renderer.shake(event.prism ? 1 : Math.min((event.lines ?? 1) / 4, 0.7));
          if (event.prism) {
            renderer.startPrism();
            audio.prism();
          }
          break;
        }
        case 'gameOver':
          audio.gameOver();
          break;
        default:
          break;
      }
    }

    renderer.render(game, elapsed);
    hud.update(game, elapsed);
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
