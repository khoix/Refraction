/**
 * The next piece, rendered in three dimensions and turning slowly.
 *
 * The 2D preview shows the piece's silhouette from the front, which is exactly
 * as much as the board shows -- and for a piece with cubes at two depths that is
 * not enough to know its shape. A screw and its mirror project identically from
 * one face. The player is asked to plan a placement for a solid they have only
 * seen flattened.
 *
 * So it turns. A slow yaw, continuously, showing every face over a few seconds.
 * Depth colour is unchanged: each cube wears the colour of the lane it will
 * arrive in, exactly as on the board, because the preview's job is to say what
 * is coming and where -- not to invent a second way of describing depth.
 *
 * ## Sharing one renderer
 *
 * Drawn into a scissored corner of the main canvas rather than into a canvas of
 * its own. A second `WebGLRenderer` means a second GL context, a second copy of
 * every shader and a second frame of latency to keep in step; a scissor
 * rectangle costs a viewport change. The rectangle is taken from the DOM panel
 * that holds the preview, so the two stay aligned through every layout change
 * without either knowing about the other.
 */

import * as THREE from 'three';
import { BOARD_DEPTH } from '@core/constants';
import type { Cell } from '@core/types';
import { VoxelLayer } from './voxels';

/** A full turn of the preview, in milliseconds. */
const REVOLUTION_MS = 7000;
/**
 * Elevation the preview is seen from.
 *
 * Higher than the board's, and deliberately so. The board must not offer a
 * spatial cue, but the preview is a diagram of one piece -- looking slightly
 * down on it is what makes a cube read as a cube rather than as a tile.
 */
const PREVIEW_ELEVATION_DEG = 22;
/**
 * Half-height of the preview frustum, in cells.
 *
 * Sized for the longest piece: an I-cube spans four cells and turns through
 * every yaw, so the frustum has to hold four across its width at any angle. The
 * height then has margin to spare, which is why a compact piece looks small --
 * pieces keep their true relative size rather than each being scaled to fill.
 */
const PREVIEW_EXTENT = 2.6;

export interface PreviewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export class PiecePreview {
  readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly cubes = new VoxelLayer({ maxInstances: 8 });
  private readonly light = new THREE.AmbientLight(0xffffff, Math.PI);
  private elapsed = 0;
  private cells: readonly Cell[] = [];
  private lane = 0;
  private spinning = true;
  private readonly target = new THREE.Vector3();

  constructor() {
    this.scene.add(this.light, this.cubes.mesh);
    // The panel's fill lives here rather than in CSS. The preview draws into the
    // canvas, which sits *behind* the HUD, so a panel with a background of its
    // own simply covers it -- 82% opacity plus a backdrop blur was swallowing
    // all but a fifth of it. The DOM keeps the border and the label and becomes
    // a window; the fill comes from this side, at full opacity, with the piece
    // drawn on top of it.
    this.scene.background = new THREE.Color(0x0a0c14);
  }

  setDepthColour(enabled: boolean): void {
    this.cubes.setDepthColour(enabled);
  }

  /**
   * Turning, or held still.
   *
   * Static is offered as the harder option: a player who wants to read the
   * piece's shape off one projection, the way the board asks them to read
   * everything else, can.
   */
  setSpinning(spinning: boolean): void {
    this.spinning = spinning;
    if (!spinning) this.elapsed = 0;
  }

  /**
   * `cells` are the piece's own offsets; `lane` is the depth it will arrive at,
   * which is what decides its colour.
   */
  setPiece(cells: readonly Cell[], lane: number): void {
    this.cells = cells;
    this.lane = lane;
  }

  update(deltaMs: number): void {
    if (this.spinning) this.elapsed = (this.elapsed + deltaMs) % REVOLUTION_MS;

    // Centred on its own bounding box, so a wide piece and a tall one both sit
    // in the middle of the panel rather than drifting by their origin.
    const xs = this.cells.map((cell) => cell.x);
    const ys = this.cells.map((cell) => cell.y);
    const zs = this.cells.map((cell) => cell.z);
    const mid = (values: number[]): number =>
      values.length === 0 ? 0 : (Math.min(...values) + Math.max(...values)) / 2;
    const cx = mid(xs);
    const cy = mid(ys);
    const cz = mid(zs);

    // The layer positions cubes in board space, so the piece is placed where its
    // centre lands on the board's centre and the whole preview shares the
    // board's own colour maths -- including the lane the piece will arrive in.
    const placed: Cell[] = this.cells.map((cell) => ({
      x: cell.x - cx + (BOARD_DEPTH - 1) / 2,
      y: cell.y - cy + 8.5,
      z: BOARD_DEPTH - 1 - this.lane + (cell.z - cz),
    }));

    // The layer places a cube at `toSceneZ(z)`, so a piece bound for lane 0 sits
    // three and a half cells in front of the origin rather than on it. The
    // camera has to look at the piece, not at the middle of a board that is not
    // being drawn.
    this.target.set(0, 0, BOARD_DEPTH - 1 - this.lane - (BOARD_DEPTH - 1) / 2);

    const yaw = (this.elapsed / REVOLUTION_MS) * 360;
    // Colour follows the *board's* yaw, not the preview's: the piece has to be
    // shown wearing the colour of the lane it will arrive in, and that colour is
    // a property of the board's orientation. Spinning the diagram must not
    // repaint it.
    this.cubes.update(placed, 0, 1);
    this.orient(yaw);
  }

  private orient(yawDegrees: number): void {
    const yaw = THREE.MathUtils.degToRad(yawDegrees);
    const pitch = THREE.MathUtils.degToRad(PREVIEW_ELEVATION_DEG);
    const radius = 40;
    this.camera.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * radius,
      this.target.y + Math.sin(pitch) * radius,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * radius
    );
    this.camera.lookAt(this.target);
  }

  /** Fit the frustum to the panel and draw into it. */
  render(renderer: THREE.WebGLRenderer, rect: PreviewRect): void {
    if (this.cells.length === 0 || rect.width <= 0 || rect.height <= 0) return;
    const aspect = rect.width / rect.height;
    this.camera.left = -PREVIEW_EXTENT * aspect;
    this.camera.right = PREVIEW_EXTENT * aspect;
    this.camera.top = PREVIEW_EXTENT;
    this.camera.bottom = -PREVIEW_EXTENT;
    this.camera.updateProjectionMatrix();

    // CSS pixels, not buffer pixels: `setViewport` and `setScissor` multiply by
    // the renderer's own pixel ratio, so pre-multiplying here would place the
    // preview at twice its coordinates on any display where the ratio is not 1 —
    // invisible on the machine it was written on and wrong everywhere else.
    const height = renderer.domElement.clientHeight;
    const width = renderer.domElement.clientWidth;
    // GL counts from the bottom of the drawing buffer; the DOM counts from the
    // top. Getting this backwards puts the preview in the opposite corner, which
    // looks like a layout bug rather than a coordinate one.
    const y = height - (rect.top + rect.height);

    renderer.setScissorTest(true);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }

  dispose(): void {
    this.cubes.dispose();
  }
}
