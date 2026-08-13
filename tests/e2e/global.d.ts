import type { Game } from '../../src/core/game';
import type { GameRenderer } from '../../src/render/game-renderer';

declare global {
  interface Window {
    __refraction?: {
      game: Game;
      renderer: GameRenderer;
      restart: (seed?: string) => void;
    };
  }
}

export {};
