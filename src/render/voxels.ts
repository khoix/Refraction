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
import { depthParameterAtYaw } from '@core/projection';
import { depthColor } from '@core/spectrum';
import type { Cell } from '@core/types';
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
  readonly emissive?: number;
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

  constructor(options: VoxelLayerOptions = {}) {
    const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.11);
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
        : new THREE.MeshStandardMaterial({
            roughness: 0.34,
            metalness: 0.08,
            transparent,
            opacity: options.opacity ?? 1,
            emissiveIntensity: options.emissive ?? 0.22,
            emissive: new THREE.Color(0x000000),
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

    for (let i = 0; i < count; i += 1) {
      const cell = cells[i] as Cell;
      const depth = THREE.MathUtils.clamp(depthParameterAtYaw(cell.x, cell.z, yawDegrees), 0, 1);

      this.position.set(toSceneX(cell.x), toSceneY(cell.y), toSceneZ(cell.z));
      this.scaleVector.setScalar(size);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      this.mesh.setMatrixAt(i, this.matrix);

      // Full Spectrum drives every band toward white, which is the whole colour
      // metaphor stated literally: the visible spectrum combined is white light.
      const { r, g, b } = this.depthColour ? depthColor(depth) : BLIND_FILL;
      const lit = 1 - toVoid;
      this.color.setRGB(
        THREE.MathUtils.lerp(r, 1, toWhite) * lit,
        THREE.MathUtils.lerp(g, 1, toWhite) * lit,
        THREE.MathUtils.lerp(b, 1, toWhite) * lit,
        THREE.SRGBColorSpace
      );
      this.mesh.setColorAt(i, this.color);
    }

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
