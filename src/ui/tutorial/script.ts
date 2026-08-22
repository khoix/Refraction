/**
 * Tutorial beat definitions — player-facing copy only.
 *
 * Never names Flatland or other falling-block games. Teaches what is unique:
 * depth, colour, x-ray, lane-scoped clears, Shift, 3D pieces, Collapse.
 */

import type { Action } from '../../keymap';
import type { ModeConfig } from '@core/modes';
import type { CardPlacement } from './spotlight';
import {
  TUTORIAL_ACT1_MODE,
  TUTORIAL_ACT1_SEED,
  TUTORIAL_ACT2_MODE,
  TUTORIAL_ACT2_SEED,
  TUTORIAL_ACT3_MODE,
  TUTORIAL_ACT3_SEED,
} from './fixtures';

export type TutorialTarget =
  | { readonly kind: 'well' }
  | { readonly kind: 'hud'; readonly selector: string }
  | { readonly kind: 'prompt' }
  | { readonly kind: 'none' };

export type TutorialAdvance =
  | { readonly kind: 'continue' }
  | { readonly kind: 'event'; readonly type: 'clear' | 'turn' | 'lock' | 'collapse' }
  | { readonly kind: 'status'; readonly status: 'awaitingTurn' | 'turning' | 'resolving' };

export interface TutorialCameraCue {
  readonly yawDelta: number;
  readonly elevation: number;
  readonly durationMs: number;
  /** After the orbit, ease back to the settled face. */
  readonly returnHome?: boolean;
  /** Repeat out→home for the whole beat. */
  readonly loop?: boolean;
}

export type TutorialSetup =
  | 'spectrum'
  | 'xray'
  | 'laneDemo'
  | 'placeClear'
  | 'shiftReady'
  | 'act2Piece'
  | 'act3Collapse'
  | 'none';

/** What the circular spotlight should cover. */
export type TutorialFocus = 'well' | 'active' | 'filled' | 'hud' | 'prompt' | 'none';

export interface TutorialBeat {
  readonly id: string;
  readonly act: 1 | 2 | 3;
  readonly title: string;
  /** Short coach copy — must fit the card without scrolling. */
  readonly body: string;
  readonly target: TutorialTarget;
  readonly advance: TutorialAdvance;
  readonly setup: TutorialSetup;
  readonly camera?: TutorialCameraCue;
  /** Gentle looping yaw/elevation around the settled face. */
  readonly cameraLoop?: boolean;
  readonly allowedActions?: readonly Action[];
  readonly hint?: string;
  readonly touchHint?: string;
  readonly continueLabel?: string;
  readonly rebuild?: { readonly mode: ModeConfig; readonly seed: string };
  readonly radius?: number;
  readonly fitWell?: boolean;
  readonly softScrim?: boolean;
  readonly cardPlacement?: CardPlacement;
  /** Spotlight focus; defaults from `target`. */
  readonly focus?: TutorialFocus;
}

export const TUTORIAL_BEATS: readonly TutorialBeat[] = [
  {
    id: 'welcome',
    act: 1,
    title: 'Welcome to Refraction.',
    body: "Pieces fall, you build lines, and you clear them—but this board isn't flat. You're building inside a **cube**, where depth matters just as much as left and right.",
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'spectrum',
    rebuild: { mode: TUTORIAL_ACT1_MODE, seed: TUTORIAL_ACT1_SEED },
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'board-3d',
    act: 1,
    title: 'A cube of space',
    body: 'This well has **width, height, and depth**.\n\nFrom straight ahead it can look flat, but every block has a real position inside the cube.',
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'spectrum',
    camera: {
      yawDelta: 14,
      elevation: 6,
      durationMs: 2400,
      returnHome: true,
      loop: true,
    },
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'colour-depth',
    act: 1,
    title: 'Colour is depth',
    body: "Colour is your depth gauge.\n\n**Red is closest to you, violet is farthest away**, with the rest of the spectrum in between. The blocks don't move when their colours change—only your view of their depth does.",
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'spectrum',
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'xray',
    act: 1,
    title: 'The drop channel',
    body: 'Sometimes blocks in front can hide where your piece is actually going.\n\nWhile a piece is falling, its path becomes **X-rayed**, letting you see the landing surface it will hit through anything in the way.',
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'xray',
    focus: 'active',
    fitWell: false,
    softScrim: true,
    radius: 140,
  },
  {
    id: 'lane-clear',
    act: 1,
    title: 'Clears go by depth',
    body: "Here's the important part: a row that **looks full** isn't always full.\n\nEach depth lane is its own line, so hidden gaps can exist behind the blocks you see in front.",
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'laneDemo',
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'place-lane',
    act: 1,
    title: 'Finish this lane',
    body: 'Your turn.\n\nMove the piece over the gap and drop it to finish the line. **Only the completed depth lane will clear.**',
    target: { kind: 'well' },
    advance: { kind: 'event', type: 'clear' },
    setup: 'placeClear',
    focus: 'active',
    allowedActions: ['softDrop', 'hardDrop'],
    hint: 'Soft drop · Hard drop (Space)',
    touchHint: 'Swipe down to drop',
    softScrim: true,
    radius: 130,
  },
  {
    id: 'shift-meter',
    act: 1,
    title: 'Shift',
    body: "Every line you clear charges the **Shift meter**.\n\nWhen it's full, the cube is ready to turn—and a completely different side of your stack can become the playing field.",
    target: { kind: 'hud', selector: '.hud__shift' },
    advance: { kind: 'continue' },
    setup: 'shiftReady',
    radius: 90,
  },
  {
    id: 'choose-shift',
    act: 1,
    title: 'Choose a face',
    body: 'Now choose which way to turn.\n\nPick **Left or Right** to reveal the next face. The camera moves around the cube; **the blocks themselves stay exactly where you placed them.**',
    target: { kind: 'prompt' },
    advance: { kind: 'event', type: 'turn' },
    setup: 'none',
    allowedActions: ['moveLeft', 'moveRight'],
    hint: '← Left face · Right face →',
    touchHint: 'Tap ← / →, or swipe to pull a face forward',
    radius: 100,
  },
  {
    id: 'after-shift',
    act: 1,
    title: 'Same board, new view',
    body: 'Same stack. Different side.\n\nDepth has changed relative to you, so the spectrum changes too. **Position is absolute. Colour is relative.**',
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'none',
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'refraction',
    act: 1,
    title: 'Refraction',
    body: "And this is where Refraction gets interesting.\n\nA line that wasn't playable from the last face may already be complete from this one. When a turn reveals and clears one, that's a **Refraction clear**.",
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'none',
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'piece-3d',
    act: 2,
    title: 'Pieces in depth',
    body: "So far, the pieces have mostly behaved like familiar flat shapes.\n\nBut Refraction's pieces can also extend **into and out of the screen**, occupying several depth lanes at once.",
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'act2Piece',
    focus: 'active',
    camera: {
      yawDelta: 14,
      elevation: 6,
      durationMs: 2400,
      returnHome: true,
      loop: true,
    },
    rebuild: { mode: TUTORIAL_ACT2_MODE, seed: TUTORIAL_ACT2_SEED },
    softScrim: true,
    radius: 150,
  },
  {
    id: 'place-3d',
    act: 2,
    title: 'Place it',
    body: 'Try this one yourself.\n\nMove it, rotate it, turn it through depth, and place it where you want. Use the colours to keep track of **which parts are near and which are farther away**.',
    target: { kind: 'well' },
    advance: { kind: 'event', type: 'lock' },
    setup: 'act2Piece',
    focus: 'active',
    allowedActions: [
      'moveLeft',
      'moveRight',
      'softDrop',
      'hardDrop',
      'rollAnti',
      'rollClock',
      'yawAnti',
      'yawClock',
      'nudgeNearer',
      'nudgeDeeper',
    ],
    hint: 'Move · Roll · Yaw (Q/E) · Depth (T/G) · Drop',
    touchHint: 'Drag to move · Swipe the field to rotate · Swipe down to drop',
    softScrim: true,
    radius: 150,
  },
  {
    id: 'piece-colour',
    act: 2,
    title: 'Still colour, still depth',
    body: 'Once placed, every cube keeps its real position in the stack.\n\nFrom this face, each part is coloured according to its depth. Turn the board later, and the colours will update for the new view.',
    target: { kind: 'well' },
    advance: { kind: 'continue' },
    setup: 'none',
    cameraLoop: true,
    focus: 'filled',
    softScrim: true,
  },
  {
    id: 'collapse',
    act: 3,
    title: 'Spectral Collapse',
    body: "Building in three dimensions can get messy. That's where **Spectral Collapse** comes in.\n\nAs you play, the heat gauge charges. When it's ready, spend it to **collapse a slice of the stack** and create some breathing room.",
    target: { kind: 'hud', selector: '.gauge' },
    advance: { kind: 'continue' },
    setup: 'act3Collapse',
    rebuild: { mode: TUTORIAL_ACT3_MODE, seed: TUTORIAL_ACT3_SEED },
    radius: 70,
  },
  {
    id: 'modes',
    act: 3,
    title: 'Modes',
    body: "That's the core of Refraction: **build in depth, read the spectrum, clear lines, and turn the cube to discover new possibilities.**\n\nDifferent modes change the challenge—speed, piece sets, failure rules, colour information, and more.\n\nPick the one that sounds good and make the cube yours.\n\n**Are you ready to experience the full spectrum?**",
    target: { kind: 'none' },
    advance: { kind: 'continue' },
    setup: 'none',
    cameraLoop: true,
    continueLabel: 'PLAY',
    softScrim: true,
  },
];
