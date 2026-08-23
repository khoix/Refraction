import { describe, expect, it } from 'vitest';
import { Board } from '@core/board';
import { Game } from '@core/game';
import { FACE_YAW, fromView } from '@core/projection';
import {
  TUTORIAL_ACT1_MODE,
  TUTORIAL_ACT1_SEED,
  TUTORIAL_ACT2_MODE,
  buildXrayDemo,
  hiddenRefractionLine,
  laneClearDemo,
  spectrumStack,
} from '@ui/tutorial/fixtures';
import { TUTORIAL_BEATS } from '@ui/tutorial/script';
import { pickCardPlacement } from '@ui/tutorial/spotlight';

describe('tutorial fixtures', () => {
  it('puts a full spectrum ridge on the front face', () => {
    const board = new Board();
    for (const cell of spectrumStack()) board.fill(cell);
    expect(board.countFilled()).toBe(8);
  });

  it('builds a narrow drop channel for the x-ray', () => {
    const demo = buildXrayDemo();
    const board = new Board();
    for (const cell of demo.cells) board.fill(cell);
    const nearTop = fromView('front', { u: 3, y: 7, lane: 1 });
    const deepTop = fromView('front', { u: 3, y: 7, lane: 6 });
    expect(board.isFilled(nearTop)).toBe(true);
    expect(board.isFilled(deepTop)).toBe(false);
    expect(board.countFilled()).toBe(16 + 4);
    expect(demo.pieceLane).toBe(4);
    expect(demo.pieceU).toBe(3);
  });

  it('shows a tall near wall vs an incomplete deeper lane', () => {
    const demo = laneClearDemo();
    const board = new Board();
    for (const cell of demo.cells) board.fill(cell);
    const complete = board.findCompleteLines('front');
    expect(complete.some((line) => line.y === demo.y && line.lane === demo.completeLane)).toBe(
      false
    );
    // Tall near wall: gap only on the floor row (7+8×4) + 5 deep cells.
    expect(demo.cells.length).toBe(7 + 8 * 4 + 5);
  });

  it('plants a hidden line that clears after a left Shift', () => {
    const game = new Game({
      seed: 'tutorial-refraction',
      mode: TUTORIAL_ACT1_MODE,
      turnDurationMs: 100,
      clearFlashMs: 10,
    });
    game.board.clearAll();
    for (const cell of hiddenRefractionLine(3, 0)) game.board.fill(cell);
    game.status = 'awaitingTurn';
    game.chooseTurn('left');
    expect(game.pendingClears.length).toBeGreaterThan(0);
  });
});

describe('tutorial script', () => {
  it('opens with a walk-up welcome before teaching beats', () => {
    expect(TUTORIAL_BEATS[0]?.id).toBe('welcome');
    expect(TUTORIAL_BEATS[0]?.title).toBe('Welcome to Refraction.');
    expect(TUTORIAL_BEATS[0]?.act).toBe(1);
  });

  it('is ordered in three acts with Shift and x-ray in act 1', () => {
    expect(TUTORIAL_BEATS.some((beat) => beat.id === 'xray')).toBe(true);
    expect(TUTORIAL_BEATS.some((beat) => beat.id === 'choose-shift')).toBe(true);
    expect(TUTORIAL_BEATS.some((beat) => beat.id === 'piece-3d')).toBe(true);
    expect(TUTORIAL_BEATS.some((beat) => beat.id === 'collapse')).toBe(true);
    expect(TUTORIAL_BEATS.some((beat) => beat.id === 'modes')).toBe(true);
    const acts = TUTORIAL_BEATS.map((beat) => beat.act);
    expect(acts).toEqual([...acts].sort((a, b) => a - b));
  });

  it('closes on a Modes coda with PLAY', () => {
    const last = TUTORIAL_BEATS[TUTORIAL_BEATS.length - 1];
    expect(last?.id).toBe('modes');
    expect(last?.continueLabel).toBe('PLAY');
    expect(last?.body).toContain('full spectrum');
    expect(last?.body).toContain('**');
  });

  it('spotlights filled cells on cinematic board beats, not the empty well centre', () => {
    for (const id of [
      'welcome',
      'board-3d',
      'colour-depth',
      'lane-clear',
      'after-shift',
      'refraction',
      'piece-colour',
    ]) {
      expect(TUTORIAL_BEATS.find((beat) => beat.id === id)?.focus).toBe('filled');
    }
  });

  it('keeps the x-ray beat face-on with no camera motion', () => {
    const xray = TUTORIAL_BEATS.find((beat) => beat.id === 'xray');
    expect(xray?.camera).toBeUndefined();
    expect(xray?.cameraLoop).toBeUndefined();
    expect(xray?.focus).toBe('active');
  });

  it('keeps cinematic orbits looping and readable', () => {
    const board = TUTORIAL_BEATS.find((beat) => beat.id === 'board-3d');
    expect(board?.camera?.yawDelta).toBeLessThanOrEqual(16);
    expect(board?.camera?.durationMs).toBeGreaterThanOrEqual(2000);
    expect(board?.camera?.returnHome).toBe(true);
    expect(board?.camera?.loop).toBe(true);
    const colour = TUTORIAL_BEATS.find((beat) => beat.id === 'colour-depth');
    expect(colour?.camera).toBeUndefined();
    expect(colour?.cameraLoop).toBe(true);
  });

  it('keeps coach bodies within the provided copy bounds', () => {
    for (const beat of TUTORIAL_BEATS) {
      if (beat.id === 'modes') continue;
      expect(beat.body.length).toBeLessThan(230);
      expect(beat.body.split(/\n\n+/).length).toBeLessThanOrEqual(2);
    }
    const modes = TUTORIAL_BEATS.find((beat) => beat.id === 'modes');
    const modesParas = modes?.body.split(/\n\n+/).map((part) => part.trim()) ?? [];
    expect(modesParas.length).toBeLessThanOrEqual(4);
    expect(modesParas.at(-1)).toBe('**Are you ready to experience the full spectrum?**');
    const welcome = TUTORIAL_BEATS.find((beat) => beat.id === 'welcome');
    expect(welcome?.body).toContain('**cube**');
    const colour = TUTORIAL_BEATS.find((beat) => beat.id === 'colour-depth');
    expect(colour?.body).toContain('**Red is closest to you');
  });

  it('gates hands-on beats with allowlists', () => {
    const place = TUTORIAL_BEATS.find((beat) => beat.id === 'place-lane');
    expect(place?.allowedActions).toEqual(['softDrop', 'hardDrop']);
    expect(place?.allowedActions).not.toContain('moveLeft');
    expect(place?.allowedActions).not.toContain('moveRight');
    expect(place?.touchHint).toBeTruthy();
    expect(place?.revealBeforeClear?.elevation).toBeGreaterThanOrEqual(18);
    expect(place?.revealBeforeClear?.durationMs).toBeGreaterThanOrEqual(2000);
    const shift = TUTORIAL_BEATS.find((beat) => beat.id === 'choose-shift');
    expect(shift?.allowedActions).toEqual(['moveLeft', 'moveRight']);
  });

  it('orbits place-lane before the clear and holds a looping pan cue', () => {
    const place = TUTORIAL_BEATS.find((beat) => beat.id === 'place-lane');
    expect(place?.revealBeforeClear).toEqual({
      yawDelta: 28,
      elevation: 20,
      durationMs: 2200,
    });
    expect(place?.advance).toEqual({ kind: 'event', type: 'clear' });
  });

  it('lets place-3d drop via touch without teaching pitch', () => {
    const place = TUTORIAL_BEATS.find((beat) => beat.id === 'place-3d');
    expect(place?.allowedActions).toContain('hardDrop');
    expect(place?.allowedActions).toContain('softDrop');
    expect(place?.allowedActions).not.toContain('pitchUp');
    expect(place?.allowedActions).not.toContain('pitchDown');
    expect(place?.touchHint).toMatch(/Swipe down to drop/i);
  });
});

describe('tutorial body markup', () => {
  it('splits paragraphs on blank lines for coach copy', () => {
    const source = 'First line with **depth**.\n\nSecond paragraph.';
    const paragraphs = source.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatch(/\*\*depth\*\*/);
  });
});

describe('tutorial card placement', () => {
  it('docks on the side with more room, never top or bottom', () => {
    expect(pickCardPlacement({ x: 700, y: 400, radius: 80 }, { width: 800, height: 800 })).toBe(
      'left'
    );
    expect(pickCardPlacement({ x: 80, y: 400, radius: 60 }, { width: 800, height: 800 })).toBe(
      'right'
    );
    expect(pickCardPlacement({ x: 200, y: 620, radius: 100 }, { width: 390, height: 844 })).toBe(
      'left'
    );
  });

  it('honours an explicit side preference', () => {
    expect(
      pickCardPlacement({ x: 400, y: 300, radius: 100 }, { width: 1200, height: 800 }, 'right')
    ).toBe('right');
  });

  it('defaults to the left with no hole', () => {
    expect(pickCardPlacement(null, { width: 1200, height: 800 })).toBe('left');
  });
});

describe('tutorial mode configs', () => {
  it('uses planar rules and a one-line Shift in act 1', () => {
    expect(TUTORIAL_ACT1_MODE.rotation).toBe('roll');
    expect(TUTORIAL_ACT1_MODE.linesPerTurn).toBe(1);
    expect(TUTORIAL_ACT1_MODE.spectralCollapse).toBe(false);
    const game = new Game({ seed: TUTORIAL_ACT1_SEED, mode: TUTORIAL_ACT1_MODE });
    expect(game.rollOnly).toBe(true);
    expect(game.armPiece('O', 4, 3)).toBe(true);
    expect(game.active?.id).toBe('O');
  });

  it('unlocks multi-lane pieces in act 2', () => {
    expect(TUTORIAL_ACT2_MODE.maxTier).toBe(2);
    expect(TUTORIAL_ACT2_MODE.depthNudge).toBe('always');
    const game = new Game({ seed: 't2', mode: TUTORIAL_ACT2_MODE });
    expect(game.armPiece('SCREW_R', 3, 2)).toBe(true);
    expect(game.active?.id).toBe('SCREW_R');
  });
});

describe('tutorial camera yaw helpers', () => {
  it('keeps face yaw table available for orbits', () => {
    expect(FACE_YAW.front).toBe(0);
    expect(FACE_YAW.right).toBe(90);
  });
});
