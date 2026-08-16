/** The four canonical viewing directions around the board's vertical axis. */
export type Face = 'front' | 'left' | 'back' | 'right';

/** Which face the player is bringing forward when the Shift meter fills. */
export type TurnDirection = 'left' | 'right';

/** A world-space voxel coordinate. Positions are absolute and never change on turn. */
export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A cell expressed in the current face's viewing frame.
 * - `u` is the on-screen horizontal column (0 = screen left).
 * - `y` is world height, unchanged by any turn.
 * - `lane` is the depth index (0 = nearest the camera, DEPTH_LANES-1 = farthest).
 */
export interface ViewCell {
  readonly u: number;
  readonly y: number;
  readonly lane: number;
}

/** A horizontal axis of the world. Y is always vertical and never a horizontal axis. */
export type HorizontalAxis = 'x' | 'z';

/** An RGB triple with each channel in [0, 1]. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
