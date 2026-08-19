/**
 * The board behind the title screen.
 *
 * The title was plain type over an empty well. The board is the strongest thing
 * this game has and the front door was covering it with an 86%-opaque scrim and
 * then showing nothing underneath anyway -- so the first impression was a
 * wordmark on a black rectangle, which is true of any game.
 *
 * It also has to be the board that supplies the colour, because nothing else may.
 * DESIGN §2.2 partitions the palette absolutely: **the only hue on screen belongs
 * to a cube.** A wordmark running red to violet would be the exact false
 * inference the rule exists to prevent -- a second colour language with no marker
 * separating it from the first. So the type stays achromatic and the board is
 * lit behind it, which is a better division of labour anyway.
 *
 * ## Yours if you have one
 *
 * Composed only when the board is empty. Coming back from a finished run, the
 * board still holds what the player built, and that is a better backdrop than
 * anything authored here -- it is theirs, and they have just been looking at it.
 * The composed arrangement is for a cold boot, where the alternative is nothing.
 *
 * The engine is frozen outside `playing`, so nothing here settles, clears or
 * cascades: it is a still life until a run starts and replaces the whole game.
 */

import type { Game } from '@core/game';
import { BOARD_DEPTH, BOARD_WIDTH } from '@core/constants';

/**
 * A diagonal ridge through the volume.
 *
 * Two things it has to do. Show the whole ramp, so the front face carries every
 * lane rather than a wall of one hue -- the lane advances with both the column
 * and the row, so a single face reads as a spectrum sweep rather than as a
 * gradient in one direction. And hold up from all four faces, because the title
 * turns: a shape composed for the front alone collapses into a flat slab the
 * moment the board presents its side.
 *
 * The arc is what keeps it from reading as a staircase. Heights rise toward the
 * middle and fall away, so the silhouette is a ridge rather than a ramp, and it
 * sits low in the well where the scrim over the type has already cleared.
 *
 * ## Exactly one cube per screen cell
 *
 * `(x + y) % BOARD_DEPTH` puts one cube in each column-and-row of the front
 * face, never two, and that is load-bearing rather than incidental. A near cube
 * hides what is behind it completely (§2.1), so a second cube in the same screen
 * cell is not extra material -- it is a cube you cannot see that has taken a
 * lane away from one you can.
 *
 * A denser version was tried and reverted for exactly that: a second helix half
 * a well apart doubled the cube count and turned the front face warm. Of the two
 * cubes sharing a cell the nearer always won, and with a half-depth offset the
 * nearer is always in lanes 0 to 3 -- red through green, with no blue or violet
 * on screen at all. The whole ramp on the front face is the first thing this
 * arrangement owes the player, so the density comes from height instead.
 *
 * The same property means no line is ever complete: a line is eight cells
 * sharing a row *and* a lane, and each row here holds one cube per lane.
 */
export function composeAttract(game: Game): void {
  if (game.board.filledCells().length > 0) return;

  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const t = x / (BOARD_WIDTH - 1);
    const height = 3 + Math.round(5 * Math.sin(t * Math.PI));
    for (let y = 0; y < height; y += 1) {
      game.board.fill({ x, y, z: (x + y) % BOARD_DEPTH });
    }
  }

  // No piece hovering over the still life. There is one at construction, and on
  // the title screen it would come with a ghost, a landing mark and a drop
  // channel cut through the arrangement -- all of it describing a move nobody is
  // making.
  game.active = null;
}
