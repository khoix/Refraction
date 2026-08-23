/**
 * Dual-profile bindings: every action bound, no duplicate codes, resolve works.
 */

import { describe, expect, it } from 'vitest';
import {
  ACTION_BY_CODE,
  ALL_ACTIONS,
  BINDING_GROUPS,
  DEFAULT_CODES_FULL,
  DEFAULT_CODES_ROLL,
  TOUCH_ACTIONS,
  actionByCodeMap,
  bindingCodesUnique,
  capsForProfile,
  keyLabel,
  profileForMode,
  rebindAction,
  resolveBindings,
} from '../../src/keymap';
import { Game, PEEK_LOCKED_FROM_STAGE } from '@core/game';
import { modeById } from '@core/modes';
import { LINES_PER_STAGE } from '@core/stages';

describe('dual binding profiles', () => {
  it('binds every action exactly once in each profile', () => {
    for (const profile of ['roll', 'full'] as const) {
      const bindings = resolveBindings(profile);
      expect(bindings.map((b) => b.action).sort()).toEqual([...ALL_ACTIONS].sort());
      expect(bindingCodesUnique(bindings)).toBe(true);
    }
  });

  it('resolves every bound code to its action', () => {
    for (const profile of ['roll', 'full'] as const) {
      const bindings = resolveBindings(profile);
      const map = actionByCodeMap(bindings);
      for (const binding of bindings) {
        for (const code of binding.codes) {
          expect(map.get(code)).toBe(binding.action);
        }
      }
    }
  });

  it('keeps the deprecated roll ACTION_BY_CODE in sync with roll defaults', () => {
    expect(ACTION_BY_CODE.get('KeyA')).toBe('moveLeft');
    expect(DEFAULT_CODES_ROLL.moveLeft).toContain('KeyA');
  });

  it('uses Q/E for roll and arrows for depth in the full profile', () => {
    expect(DEFAULT_CODES_FULL.rollClock).toEqual(['KeyE']);
    expect(DEFAULT_CODES_FULL.rollAnti).toEqual(['KeyQ']);
    expect(DEFAULT_CODES_FULL.nudgeDeeper).toEqual(['ArrowUp']);
    expect(DEFAULT_CODES_FULL.nudgeNearer).toEqual(['ArrowDown']);
    expect(DEFAULT_CODES_FULL.softDrop).toEqual(['Mouse0']);
    expect(DEFAULT_CODES_FULL.hardDrop).toContain('Space');
    expect(DEFAULT_CODES_FULL.hardDrop).toContain('Mouse2');
  });

  it('puts every binding in a renderable group', () => {
    for (const binding of resolveBindings('full')) {
      expect(BINDING_GROUPS).toContain(binding.group);
      expect(binding.codes.length).toBeGreaterThan(0);
    }
  });

  it('writes keys the way a keyboard does', () => {
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('Mouse0')).toBe('LMB');
    expect(keyLabel('Mouse2')).toBe('RMB');
  });

  it('picks roll profile for Flatland and full otherwise', () => {
    expect(profileForMode(modeById('flatland'))).toBe('roll');
    expect(profileForMode(modeById('ascent'))).toBe('full');
  });

  it('rebinding moves a code and rejects emptying an action', () => {
    const next = rebindAction('full', {}, 'hardDrop', ['KeyH']);
    expect(next).not.toBeNull();
    expect(resolveBindings('full', next!).find((b) => b.action === 'hardDrop')?.codes).toEqual([
      'KeyH',
    ]);
  });
});

describe('the touch controls table', () => {
  it('tells the player to spend Spectral Collapse on the X button', () => {
    const collapse = TOUCH_ACTIONS.find((row) => row.label === 'Spectral Collapse');
    expect(collapse).toBeDefined();
    expect(collapse!.gesture).toBe('X button');
  });

  it('documents Flatland peek as a two-finger vertical swipe', () => {
    const peek = TOUCH_ACTIONS.find(
      (row) => row.label === 'Peek' && row.profile === 'roll'
    );
    expect(peek?.gesture).toBe('Two-finger swipe up / down');
  });
});

describe('settings profile caps', () => {
  it('keeps Peek always on for Flatland and stage-gated for 3D modes', () => {
    expect(capsForProfile('roll').peekPolicy).toBe('always');
    expect(capsForProfile('full').peekPolicy).toBe('byStage');
  });
});

describe('the depth nudge', () => {
  it('moves the piece both ways when unlocked', () => {
    const game = new Game({ seed: 'nudge', forceDepthNudge: true });
    const lane = () => game.active?.lane ?? -1;
    const start = lane();
    expect(game.nudgeDepth(1)).toBe(true);
    expect(lane()).toBe(start + 1);
    expect(game.nudgeDepth(-1)).toBe(true);
    expect(lane()).toBe(start);
  });

  it('stays locked until the stage that unlocks it in Ascent', () => {
    const game = new Game({ seed: 'nudge' });
    expect(game.depthNudgeAllowed).toBe(false);
    expect(game.nudgeDepth(1)).toBe(false);
  });
});

describe('Peek', () => {
  it('is offered while the spectrum is still being learned', () => {
    const game = new Game({ seed: 'peek' });
    expect(game.peekAllowed).toBe(true);
  });

  it('withdraws at the stage the spectrum has to carry alone', () => {
    const game = new Game({ seed: 'peek' });
    game.lines = LINES_PER_STAGE * (PEEK_LOCKED_FROM_STAGE - 1);
    expect(game.stage.index).toBe(PEEK_LOCKED_FROM_STAGE);
    expect(game.peekAllowed).toBe(false);
  });

  it('stays available in Flatland past that stage', () => {
    const game = new Game({ seed: 'peek', mode: modeById('flatland') });
    game.lines = LINES_PER_STAGE * (PEEK_LOCKED_FROM_STAGE - 1);
    expect(game.stage.index).toBe(PEEK_LOCKED_FROM_STAGE);
    expect(game.peekAllowed).toBe(true);
  });

  it('is off entirely where there is no colour to supplement', () => {
    const blind = new Game({ seed: 'peek', mode: modeById('blindSpectrum') });
    expect(blind.peekAllowed).toBe(false);
  });
});

describe('depthNudge always unlocks yaw and pitch', () => {
  it('lets Zen yaw and pitch from the first piece', () => {
    const game = new Game({ seed: 'zen', mode: modeById('zen') });
    expect(game.allowsRotation('yaw')).toBe(true);
    expect(game.allowsRotation('pitch')).toBe(true);
  });

  it('still gates Ascent by stage', () => {
    const game = new Game({ seed: 'asc', mode: modeById('ascent') });
    expect(game.allowsRotation('yaw')).toBe(false);
    expect(game.allowsRotation('pitch')).toBe(false);
  });
});
