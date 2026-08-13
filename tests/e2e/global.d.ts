import type { Game } from '../../src/core/game';

declare global {
  interface Window {
    __refraction?: { game: Game; restart: (seed?: string) => void };
  }
}

export {};
