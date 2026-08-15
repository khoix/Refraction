import { describe, expect, it } from 'vitest';
import {
  HARD_DROP_PER_CELL,
  LINE_BASE,
  MAX_CHAIN_MULTIPLIER,
  PRISM_BONUS,
  SOFT_DROP_PER_CELL,
  baseValue,
  cascadeMultiplier,
  chainMultiplier,
  clearLabel,
  scoreClear,
} from '@core/scoring';
import { LINES_PER_STAGE, STAGES, gravityIntervalMs, stageForLines } from '@core/stages';

const context = (overrides: Partial<Parameters<typeof scoreClear>[0]> = {}) => ({
  lines: 1,
  stage: 1,
  cascadeIndex: 0,
  refraction: false,
  chain: 0,
  prism: false,
  ...overrides,
});

describe('base values', () => {
  it('escalates faster than linearly with lines cleared', () => {
    expect(baseValue(1)).toBe(100);
    expect(baseValue(2)).toBe(300);
    expect(baseValue(3)).toBe(700);
    expect(baseValue(4)).toBe(1500);
    expect(baseValue(2)).toBeGreaterThan(baseValue(1) * 2);
    expect(baseValue(4)).toBeGreaterThan(baseValue(3) + baseValue(1));
  });

  it('extrapolates past four lines instead of returning nothing', () => {
    expect(baseValue(5)).toBeGreaterThan(LINE_BASE[4] as number);
  });

  it('is zero for a non-clear', () => {
    expect(baseValue(0)).toBe(0);
    expect(baseValue(-3)).toBe(0);
    expect(scoreClear(context({ lines: 0 }))).toBe(0);
  });
});

describe('multipliers', () => {
  it('caps the refraction chain', () => {
    expect(chainMultiplier(0)).toBe(1);
    expect(chainMultiplier(1)).toBe(2);
    expect(chainMultiplier(99)).toBe(MAX_CHAIN_MULTIPLIER);
  });

  it('grows with each cascade step', () => {
    expect(cascadeMultiplier(0)).toBe(1);
    expect(cascadeMultiplier(1)).toBe(1.5);
    expect(cascadeMultiplier(2)).toBe(2);
    expect(cascadeMultiplier(-5)).toBe(1);
  });

  it('scales with the stage', () => {
    expect(scoreClear(context({ stage: 4 }))).toBe(scoreClear(context({ stage: 1 })) * 4);
  });
});

describe('the reward for turning', () => {
  it('pays double for a line the turn made eligible', () => {
    const plain = scoreClear(context());
    const refracted = scoreClear(context({ refraction: true, chain: 0 }));
    expect(refracted).toBe(plain * 2);
  });

  it('pays more for each consecutive turn that clears', () => {
    const first = scoreClear(context({ refraction: true, chain: 1 }));
    const second = scoreClear(context({ refraction: true, chain: 2 }));
    expect(second).toBeGreaterThan(first);
  });

  it('pays a large bonus for a full revolution', () => {
    const prism = scoreClear(context({ refraction: true, chain: 4, prism: true }));
    const ordinary = scoreClear(context({ refraction: true, chain: 4 }));
    expect(prism).toBeGreaterThan(ordinary * 8);
    expect(prism).toBeGreaterThan(PRISM_BONUS);
  });
});

describe('labels', () => {
  it('names the escalating events', () => {
    expect(clearLabel(context({ prism: true }))).toBe('FULL SPECTRUM');
    expect(clearLabel(context({ refraction: true, chain: 3 }))).toContain('PRISM CHAIN');
    expect(clearLabel(context({ refraction: true, chain: 1 }))).toContain('REFRACTION');
    expect(clearLabel(context({ cascadeIndex: 1 }))).toContain('CASCADE');
  });

  it('stays quiet for an ordinary single line', () => {
    expect(clearLabel(context())).toBeNull();
  });
});

describe('drop scoring', () => {
  it('rewards a hard drop more than a soft drop', () => {
    expect(HARD_DROP_PER_CELL).toBeGreaterThan(SOFT_DROP_PER_CELL);
  });
});

describe('stages', () => {
  it('runs seven authored stages, numbered', () => {
    expect(STAGES.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(STAGES.every((s) => s.name === undefined)).toBe(true);
  });

  it('gets faster and turns more often as it goes', () => {
    for (let i = 1; i < STAGES.length; i += 1) {
      expect(STAGES[i]!.gravity).toBeGreaterThan(STAGES[i - 1]!.gravity);
      expect(STAGES[i]!.linesPerTurn).toBeLessThanOrEqual(STAGES[i - 1]!.linesPerTurn);
      expect(STAGES[i]!.maxTier).toBeGreaterThanOrEqual(STAGES[i - 1]!.maxTier);
    }
  });

  it('unlocks depth nudge at stage 4, not before', () => {
    expect(STAGES.filter((s) => s.depthNudge).map((s) => s.index)).toEqual([4, 5, 6, 7]);
  });

  it('continues past the last authored stage, accelerating', () => {
    const lastAuthoredLine = LINES_PER_STAGE * STAGES.length;
    const last = stageForLines(lastAuthoredLine - 1);
    const beyond = stageForLines(lastAuthoredLine);
    const further = stageForLines(lastAuthoredLine + LINES_PER_STAGE);
    expect(last.index).toBe(STAGES.length);
    expect(beyond.index).toBe(STAGES.length + 1);
    expect(further.gravity).toBeGreaterThan(beyond.gravity);
    expect(beyond.linesPerTurn).toBe(2);
  });

  it('converts gravity into a step interval', () => {
    expect(gravityIntervalMs({ ...(STAGES[0] as (typeof STAGES)[number]), gravity: 2 })).toBe(500);
  });
});
