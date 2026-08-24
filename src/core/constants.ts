/**
 * Board dimensions.
 *
 * BOARD_WIDTH (X) and BOARD_DEPTH (Z) MUST be equal: every 90 degree turn swaps
 * which of them is the on-screen horizontal axis, and the playfield has to stay
 * the same width across all four faces.
 */
export const BOARD_WIDTH = 8; // X
export const BOARD_HEIGHT = 18; // Y
export const BOARD_DEPTH = 8; // Z

/** Number of cells in a complete line, on any face. */
export const LINE_LENGTH = BOARD_WIDTH;

/** Number of distinct depth lanes visible from any face. */
export const DEPTH_LANES = BOARD_DEPTH;

/** Rows above the visible field used for spawning. Overflow into these ends the run. */
export const SPAWN_BUFFER = 3;

/** Total addressable Y range including the spawn buffer. */
export const BOARD_HEIGHT_TOTAL = BOARD_HEIGHT + SPAWN_BUFFER;

/**
 * Compile-time guard for the square-footprint requirement. If BOARD_WIDTH and
 * BOARD_DEPTH ever diverge this line stops type-checking, which is the earliest
 * possible place to catch it. Also covered at runtime by the projection tests.
 */
type _AssertSquareFootprint = typeof BOARD_WIDTH extends typeof BOARD_DEPTH ? true : never;
export const SQUARE_FOOTPRINT: _AssertSquareFootprint = true;
