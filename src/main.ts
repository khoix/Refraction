/**
 * Composition root.
 *
 * Owns the fixed-timestep loop, wires input to the engine and the engine to the
 * renderer, and nothing else. All three of those pieces are independently
 * testable; this file is the only place they meet.
 */

import './styles/app.css';
import { Game } from '@core/game';
import type { TurnDirection } from '@core/types';
import { GameRenderer } from '@render/game-renderer';
import { InputController } from './input';
import { Hud } from '@ui/hud';

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

function boot(root: HTMLElement): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  const hud = new Hud();
  root.replaceChildren(canvas, hud.root);

  const params = new URLSearchParams(window.location.search);
  const startingSeed = params.get('seed') ?? randomSeed();

  const debug = params.get('debug') === '1';
  const turnMs = Number(params.get('turnMs'));

  let game = new Game({ seed: startingSeed });
  const renderer = new GameRenderer(canvas, {
    preserveDrawingBuffer: debug,
    ...(debug && Number.isFinite(turnMs) && turnMs > 0 ? { turnDurationMs: turnMs } : {}),
  });

  if (debug) {
    const handle: DebugHandle = {
      game,
      renderer,
      restart: (seed?: string) => {
        game = new Game({ seed: seed ?? randomSeed() });
        handle.game = game;
      },
    };
    window.__refraction = handle;
  }

  const input = new InputController(() => game, {
    onRestart: () => {
      game = new Game({ seed: randomSeed() });
      if (window.__refraction) window.__refraction.game = game;
    },
    // The camera is driven by the engine's 'turn' event alone. Starting it here
    // as well would begin the rotation twice and overshoot the 90 degrees.
    onTurn: (direction: TurnDirection) => {
      game.chooseTurn(direction);
    },
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
      // Hold the simulation still while the camera is mid-turn, so the reveal
      // is never competing with a falling piece for the player's attention.
      if (!renderer.isTurning) game.tick(STEP_MS);
    }

    for (const event of game.drainEvents()) {
      if (event.type === 'turn' && event.direction) renderer.startTurn(event.direction);
      if (event.type === 'clear' && event.label) hud.showBanner(event.label);
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
