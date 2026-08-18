import type { Game } from '../../src/core/game';
import type { ModeId } from '../../src/core/modes';
import type { SaveData } from '../../src/core/save';
import type { GameRenderer } from '../../src/render/game-renderer';
import type { ScreenName } from '../../src/ui/screens';

declare global {
  interface Window {
    __refraction?: {
      game: Game;
      renderer: GameRenderer;
      restart: (seed?: string) => void;
      play: (mode: ModeId, seed?: string) => void;
      save: () => SaveData;
      screen: () => ScreenName;
      bindings: { action: string; label: string; keys: string[] }[];
    };
  }
}

export {};
