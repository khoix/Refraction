/**
 * The key map is a contract, not a caption.
 *
 * It exists so the settings panel and the input controller cannot disagree about
 * what a key does. These tests hold the table to that: every action bound, every
 * key bound once, and nothing in the table the player cannot actually press.
 *
 * Writing the table out is what found the bug the last test here guards. The
 * depth nudge takes -1 or 1 and the spec says it shifts +/-1 lane, but only one
 * direction had ever been bound, so half of a Stage 4 mechanic was unreachable.
 */

import { describe, expect, it } from 'vitest';
import { ACTION_BY_CODE, BINDINGS, BINDING_GROUPS, TOUCH_ACTIONS, keyLabel } from '../../src/keymap';
import type { Action } from '../../src/keymap';
import { Game, PEEK_LOCKED_FROM_STAGE } from '@core/game';
import { modeById } from '@core/modes';
import { LINES_PER_STAGE } from '@core/stages';

const ALL_ACTIONS: readonly Action[] = [
  'moveLeft',
  'moveRight',
  'softDrop',
  'hardDrop',
  'rollAnti',
  'rollClock',
  'yawAnti',
  'yawClock',
  'pitchUp',
  'pitchDown',
  'nudgeNearer',
  'nudgeDeeper',
  'peek',
  'collapse',
  'hold',
  'pause',
  'mute',
  'restart',
];

describe('the binding table', () => {
  it('binds every action exactly once', () => {
    const bound = BINDINGS.map((binding) => binding.action).sort();
    expect(bound).toEqual([...ALL_ACTIONS].sort());
  });

  it('never gives one key two meanings', () => {
    const codes = BINDINGS.flatMap((binding) => binding.codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('resolves every bound key to its action', () => {
    for (const binding of BINDINGS) {
      for (const code of binding.codes) {
        expect(ACTION_BY_CODE.get(code)).toBe(binding.action);
      }
    }
    expect(ACTION_BY_CODE.size).toBe(BINDINGS.flatMap((b) => b.codes).length);
  });

  it('puts every binding in a group the key map will render', () => {
    for (const binding of BINDINGS) {
      expect(BINDING_GROUPS).toContain(binding.group);
      expect(binding.codes.length).toBeGreaterThan(0);
      expect(binding.label.length).toBeGreaterThan(0);
    }
  });

  it('writes keys the way a keyboard does', () => {
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('Space')).toBe('Space');
  });

  it('keeps the movement cluster out of the depth nudge', () => {
    // The spec suggested W and S for the depth nudge, which cannot work: S is
    // half of the WASD cluster the README advertises and is already the soft
    // drop. Binding it would have taken a key the player uses constantly to give
    // it to one they use from Stage 4.
    const depth = BINDINGS.filter((binding) => binding.group === 'Depth');
    const movement = new Set(
      BINDINGS.filter((binding) => binding.group === 'Move').flatMap((b) => b.codes)
    );
    for (const binding of depth) {
      for (const code of binding.codes) expect(movement.has(code)).toBe(false);
    }
  });
});

describe('the touch controls table', () => {
  it('tells the player to spend Spectral Collapse on the X button, not the gauge', () => {
    const collapse = TOUCH_ACTIONS.find((row) => row.label === 'Spectral Collapse');
    expect(collapse).toBeDefined();
    expect(collapse!.gesture).toBe('X button');
    expect(collapse!.note).toBe('(When bar full) Right panel');
    expect(`${collapse!.gesture} ${collapse!.note ?? ''}`.toLowerCase()).not.toContain('gauge');
  });

  it('places pause on the right panel', () => {
    const pause = TOUCH_ACTIONS.find((row) => row.label === 'Pause');
    expect(pause).toBeDefined();
    expect(pause!.gesture).toBe('Pause');
    expect(pause!.note).toBe('Right panel');
  });
});

describe('the depth nudge', () => {
  it('moves the piece both ways, not just one', () => {
    // Half of this was unreachable: `W` pulled the piece nearer and no key
    // pushed it away. The table now binds both, and this is the engine side of
    // the same claim.
    const game = new Game({ seed: 'nudge', forceDepthNudge: true });
    const lane = () => game.active?.lane ?? -1;

    const start = lane();
    expect(game.nudgeDepth(1)).toBe(true);
    expect(lane()).toBe(start + 1);
    expect(game.nudgeDepth(-1)).toBe(true);
    expect(lane()).toBe(start);
  });

  it('stays locked until the stage that unlocks it', () => {
    const game = new Game({ seed: 'nudge' });
    expect(game.depthNudgeAllowed).toBe(false);
    expect(game.nudgeDepth(1)).toBe(false);
  });
});

describe('Peek', () => {
  it('is offered while the spectrum is still being learned', () => {
    const game = new Game({ seed: 'peek' });
    expect(game.stage.index).toBe(1);
    expect(game.peekAllowed).toBe(true);
  });

  it('withdraws at the stage the spectrum has to carry alone', () => {
    // A tool that never withdraws teaches the player to lean on it. By Stage 6
    // reading depth from colour is the skill, and parallax would be a way round
    // it rather than a way into it.
    const game = new Game({ seed: 'peek' });
    game.lines = LINES_PER_STAGE * (PEEK_LOCKED_FROM_STAGE - 1);
    expect(game.stage.index).toBe(PEEK_LOCKED_FROM_STAGE);
    expect(game.peekAllowed).toBe(false);
  });

  it('is off entirely where there is no colour to supplement', () => {
    // In Blind Spectrum, Peek would not be an aid to reading depth — it would be
    // the only way to read it, and the mode's whole premise is that there isn't
    // one. Keyed off `depthColour` rather than the mode's name, because that is
    // the actual reason.
    const blind = new Game({ seed: 'peek', mode: modeById('blindSpectrum') });
    expect(blind.stage.index).toBeLessThan(PEEK_LOCKED_FROM_STAGE);
    expect(blind.peekAllowed).toBe(false);
  });
});
