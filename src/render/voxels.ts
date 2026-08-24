/**
 * Instanced cube rendering.
 *
 * Each layer -- the settled board (near, focal, far), the active piece, the
 * ghost, the glow, the occluded silhouettes, the contact emphasis, the lock
 * flash -- is one instanced draw of a shared rounded box. Colour is
 * per-instance and recomputed every frame from the live camera yaw, not from
 * the snapped face. That is what makes the turn a continuous transformation
 * rather than a crossfade between two palettes.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';
import { depthParameterAtYaw, toView } from '@core/projection';
import { depthColor } from '@core/spectrum';
import type { Cell, Face } from '@core/types';
import { createGelMaterial, GEL_ROUNDNESS, setGelStrength } from './gel';
import { toSceneX, toSceneY, toSceneZ } from './scene';

const MAX_INSTANCES = BOARD_WIDTH * BOARD_HEIGHT * BOARD_DEPTH;
/** Gap between neighbouring cubes, so silhouette edges stay crisp. */
const CUBE_GAP = 0.92;
/**
 * Fill used when depth colour is switched off, for Blind Spectrum.
 *
 * A single neutral, so cubes still read against the background and against each
 * other by silhouette alone -- but carry no depth information whatsoever.
 * Deliberately achromatic: a tinted "neutral" would leak a hint of a hue back
 * into a mode whose whole point is that there is none.
 */
const BLIND_FILL = { r: 0.62, g: 0.64, b: 0.68 } as const;

export interface VoxelLayerOptions {
  readonly opacity?: number;
  /**
   * Raise the layer's colour toward white, 0..1, so it reads as a mark rather
   * than as another cube.
   *
   * This replaces an `emissive` option that never did anything. The material
   * was built with `emissiveIntensity: options.emissive` alongside
   * `emissive: 0x000000` -- an intensity multiplied into black -- so the contact
   * highlight's 0.7 and the active piece's 0.35 had been silently zero since
   * they were written. The contact layer was therefore drawing a slightly
   * smaller cube in exactly the colour of the cube underneath it, which is
   * invisible by construction.
   *
   * Lifting toward white rather than lighting it differently keeps the mark's
   * hue, which still has to say what depth it is sitting at.
   */
  readonly lift?: number;
  /** Draw only wireframe-ish shells, used for the ghost piece. */
  readonly ghost?: boolean;
  /** Unlit and additively blended, for the glow on lines about to clear. */
  readonly additive?: boolean;
  /**
   * Draw only where the depth test FAILS -- i.e. exactly the parts of these
   * cubes that settled geometry hides. Paired with a normally rendered layer
   * of the same cells, the piece looks ordinary when visible and shows as a
   * translucent silhouette where the board occludes it. The silhouette keeps
   * the piece's true spectrum colours; only its opacity says "occluded".
   */
  readonly whereHidden?: boolean;
  /**
   * Ignore the depth buffer entirely and draw after the board.
   */
  readonly throughWalls?: boolean;
  /**
   * Push instances toward the camera by this many cells, so a mark sits *on* the
   * face of the cube it belongs to rather than inside it.
   *
   * Without this a smaller cube sharing a centre with a bigger opaque one is
   * simply inside it, and no amount of colour makes it visible. That is the
   * second half of why the landing mark has never been seen: the first was a
   * dead `emissive` option, and even with that fixed the geometry was buried.
   */
  readonly faceOffset?: number;
  /** Skip writing depth, so cubes behind this layer stay visible. */
  readonly depthWrite?: boolean;
  /** Explicit render order, for layering the see-through passes. */
  readonly renderOrder?: number;
  readonly maxInstances?: number;
}

export class VoxelLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scaleVector = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private depthColour = true;
  private readonly lift: number;
  private readonly faceOffset: number;

  constructor(options: VoxelLayerOptions = {}) {
    this.lift = THREE.MathUtils.clamp(options.lift ?? 0, 0, 1);
    this.faceOffset = options.faceOffset ?? 0;
    const geometry = new RoundedBoxGeometry(1, 1, 1, 4, GEL_ROUNDNESS);
    const transparent = options.opacity !== undefined && options.opacity < 1;

    // The ghost is unlit on purpose: it has to show its landing lane's colour
    // truthfully from every face, and a shaded translucent cube over a near
    // black background just reads as a dead block.
    const material = options.additive
      ? new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: options.opacity ?? 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      : options.ghost || options.whereHidden || options.throughWalls
        ? new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: options.opacity ?? 0.3,
            depthWrite: false,
          })
        : // Metalness stays at zero. With no environment map there is nothing
          // for a metal to reflect, so the only thing a non-zero value did here
          // was subtract that fraction from the diffuse albedo -- a cube's depth
          // colour, quietly reduced for no visible return. Clearcoat carries the
          // glass film instead; see createGelMaterial.
          createGelMaterial({
            transparent,
            opacity: options.opacity ?? 1,
          });

    // Where-hidden passes invert the depth test: fragments draw only when
    // something nearer has already claimed the pixel. Through-wall passes skip
    // the test entirely. Both draw after the opaque board so the buffer they
    // test against is complete.
    if (options.whereHidden) material.depthFunc = THREE.GreaterDepth;
    if (options.throughWalls) material.depthTest = false;
    if (options.depthWrite === false) material.depthWrite = false;

    this.mesh = new THREE.InstancedMesh(geometry, material, options.maxInstances ?? MAX_INSTANCES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    if (options.renderOrder !== undefined) this.mesh.renderOrder = options.renderOrder;
  }

  /**
   * Rewrite every instance for this frame.
   *
   * `yawDegrees` is the camera's *current* yaw, which during a turn is somewhere
   * between two faces. Depth follows it exactly, and depth drives **colour and
   * nothing else**.
   *
   * Every cube is the same size regardless of how far back it sits. A size
   * falloff would be a second depth cue competing with the spectrum, and a
   * familiar real-world one at that -- players would read distance instead of
   * reading colour. It also has to be uniform for a near cube to cover the ones
   * behind it exactly, which is what keeps the settled board looking flat.
   */
  /**
   * Draw cubes in one neutral fill instead of their depth colour.
   *
   * A layer flag rather than another `update` argument: every call site would
   * otherwise have to pass it through, and this is a property of the mode, not
   * of any individual frame.
   */
  setDepthColour(enabled: boolean): void {
    this.depthColour = enabled;
  }

  update(cells: readonly Cell[], yawDegrees: number, scaleBias = 1, whiteout = 0, dim = 0): void {
    const count = Math.min(cells.length, this.mesh.instanceMatrix.count);
    this.mesh.count = count;
    const size = CUBE_GAP * scaleBias;
    const toWhite = THREE.MathUtils.clamp(whiteout, 0, 1);
    const toVoid = THREE.MathUtils.clamp(dim, 0, 1);
    // Toward the camera at the current yaw, so a face-mounted mark stays on the
    // face the player is looking at as the board turns.
    const yaw = THREE.MathUtils.degToRad(yawDegrees);
    const outX = Math.sin(yaw) * this.faceOffset;
    const outZ = Math.cos(yaw) * this.faceOffset;

    for (let i = 0; i < count; i += 1) {
      const cell = cells[i] as Cell;
      const depth = THREE.MathUtils.clamp(depthParameterAtYaw(cell.x, cell.z, yawDegrees), 0, 1);

      this.position.set(toSceneX(cell.x) + outX, toSceneY(cell.y), toSceneZ(cell.z) + outZ);
      this.scaleVector.setScalar(size);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      this.mesh.setMatrixAt(i, this.matrix);

      // Full Spectrum drives every band toward white, which is the whole colour
      // metaphor stated literally: the visible spectrum combined is white light.
      const { r, g, b } = this.depthColour ? depthColor(depth) : BLIND_FILL;
      const lit = 1 - toVoid;
      // The layer's own lift folds into the same lerp as the whiteout, so a
      // mark is bright by the same mechanism the board is, and a Full Spectrum
      // whiteout still carries it the rest of the way.
      const white = Math.min(1, toWhite + this.lift * (1 - toWhite));
      this.color.setRGB(
        THREE.MathUtils.lerp(r, 1, white) * lit,
        THREE.MathUtils.lerp(g, 1, white) * lit,
        THREE.MathUtils.lerp(b, 1, white) * lit,
        THREE.SRGBColorSpace
      );
      this.mesh.setColorAt(i, this.color);
    }

    // The gel recedes with the cubes: a band dimmed toward the void must not
    // keep a full-strength white rim, which is what would make the muted band
    // read brighter than the glass in front of it.
    setGelStrength(this.mesh.material as THREE.Material, 1 - toVoid);

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Vary the layer's overall strength, e.g. to pulse the clear glow. */
  setOpacity(opacity: number): void {
    (this.mesh.material as THREE.Material).opacity = THREE.MathUtils.clamp(opacity, 0, 1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * The outline around a region of cells, drawn as one silhouette.
 *
 * Paired with a near-invisible fill, an outline is what lets a cube be *seen
 * through* rather than *faded*: the shape stays legible while the board behind
 * comes through at full strength. A translucent solid cannot do both -- whatever
 * fraction of the cube you can see is exactly the fraction of the board you
 * cannot.
 *
 * **The outline is of the region, not of each cube in it.** Twelve edges per
 * cube turns a block of them into a grid of boxes: busy, and it competes with
 * the landing marks for exactly the attention those need. So the cells are
 * projected to screen cells and only the edges bordering an *unoccupied*
 * neighbour are emitted. Interior seams disappear and the region reads as one
 * shape, with holes in it outlined too, which is correct -- a hole in the
 * x-rayed area is a place where there is nothing to see through.
 *
 * Drawn as a flat outline on the plane just in front of the board rather than in
 * depth. The projection is orthographic, so a screen-space boundary is exactly
 * what a silhouette is, and putting it at the front means nothing on the board
 * can hide the border of the region the player is being asked to look into.
 *
 * Each boundary edge carries the spectrum colour of the frontmost cell behind
 * it -- the depth of the nearest thing being seen through at that point -- so the
 * outline still says how deep the region starts, which is the one thing the game
 * may never stop saying.
 *
 * Not an `InstancedMesh`: instancing draws triangles, and `wireframe` on a box
 * draws every triangle edge, which puts a diagonal across all six faces. Clean
 * lines need line primitives, so the geometry is rebuilt each frame. It is a few
 * hundred cells at most into preallocated buffers, so the cost is a memcpy.
 */
export class EdgeLayer {
  readonly lines: THREE.LineSegments;

  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private depthColour = true;

  /** Screen cell -> the smallest depth parameter seen at it, for the colour. */
  private readonly occupied = new Map<number, number>();

  constructor(maxCells = MAX_INSTANCES, opacity = 0.3, renderOrder = 0) {
    // Four boundary edges per cell is the worst case, when no cell touches
    // another. Two vertices each.
    const vertices = maxCells * 4 * 2;
    this.positions = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: false,
    });

    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = renderOrder;
    this.geometry.setDrawRange(0, 0);
  }

  setDepthColour(enabled: boolean): void {
    this.depthColour = enabled;
  }

  setOpacity(opacity: number): void {
    this.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
  }

  /**
   * `face` is the face the cells are being read on, which is always the face
   * the board has already snapped to -- the regions this outlines exist only
   * while a piece is falling, and nothing falls during a turn.
   */
  update(cells: readonly Cell[], face: Face, yawDegrees: number): void {
    this.occupied.clear();
    for (const cell of cells) {
      const { u, y } = toView(face, cell);
      const depth = THREE.MathUtils.clamp(depthParameterAtYaw(cell.x, cell.z, yawDegrees), 0, 1);
      const key = EdgeLayer.key(u, y);
      const known = this.occupied.get(key);
      if (known === undefined || depth < known) this.occupied.set(key, depth);
    }

    // Screen basis at the current yaw. Orthographic, so this is exact.
    const yaw = THREE.MathUtils.degToRad(yawDegrees);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    // Out of the board toward the camera, far enough to clear the front face.
    const outX = Math.sin(yaw) * (BOARD_DEPTH / 2 + 0.06);
    const outZ = Math.cos(yaw) * (BOARD_DEPTH / 2 + 0.06);

    let v = 0;
    const edge = (
      u0: number,
      y0: number,
      u1: number,
      y1: number,
      r: number,
      g: number,
      b: number
    ): void => {
      for (const [u, y] of [
        [u0, y0],
        [u1, y1],
      ] as const) {
        if (v * 3 + 2 >= this.positions.length) return;
        const across = u - (BOARD_WIDTH - 1) / 2;
        this.positions[v * 3] = across * rightX + outX;
        this.positions[v * 3 + 1] = y - (BOARD_HEIGHT - 1) / 2;
        this.positions[v * 3 + 2] = across * rightZ + outZ;
        this.colors[v * 3] = r;
        this.colors[v * 3 + 1] = g;
        this.colors[v * 3 + 2] = b;
        v += 1;
      }
    };

    const half = CUBE_GAP / 2;
    for (const [key, depth] of this.occupied) {
      const u = EdgeLayer.keyU(key);
      const y = EdgeLayer.keyY(key);
      const { r, g, b } = this.depthColour ? depthColor(depth) : BLIND_FILL;

      // Only the sides facing a cell that is not in the region.
      if (!this.occupied.has(EdgeLayer.key(u, y + 1))) {
        edge(u - half, y + half, u + half, y + half, r, g, b);
      }
      if (!this.occupied.has(EdgeLayer.key(u, y - 1))) {
        edge(u - half, y - half, u + half, y - half, r, g, b);
      }
      if (!this.occupied.has(EdgeLayer.key(u - 1, y))) {
        edge(u - half, y - half, u - half, y + half, r, g, b);
      }
      if (!this.occupied.has(EdgeLayer.key(u + 1, y))) {
        edge(u + half, y - half, u + half, y + half, r, g, b);
      }
    }

    this.geometry.setDrawRange(0, v);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
  }

  /** Screen cells are small and bounded, so one integer keys the map. */
  private static key(u: number, y: number): number {
    return (u + 1) * 1024 + (y + 1);
  }
  private static keyU(key: number): number {
    return Math.floor(key / 1024) - 1;
  }
  private static keyY(key: number): number {
    return (key % 1024) - 1;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
