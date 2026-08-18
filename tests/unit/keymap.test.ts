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
import { ACTION_BY_CODE, BINDINGS, BINDING_GROUPS, keyLabel } from '../../src/keymap';
import type { Action } from '../../src/keymap';
import { Game } from '@core/game';

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
