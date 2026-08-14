/**
 * Instanced cube rendering.
 *
 * Every cube on the board is one instance of a single rounded box, so the whole
 * playfield is one draw call. Colour and apparent size are per-instance and are
 * recomputed every frame from the live camera yaw -- not from the snapped face.
 * That is what makes the turn a continuous transformation rather than a
 * crossfade between two palettes.
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

export interface VoxelLayerOptions {
  readonly opacity?: number;
  readonly emissive?: number;
  /** Draw only wireframe-ish shells, used for the ghost piece. */
  readonly ghost?: boolean;
  /** Unlit and additively blended, for the glow on lines about to clear. */
  readonly additive?: boolean;
  readonly maxInstances?: number;
}

export class VoxelLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scaleVector = new THREE.Vector3();
  private readonly color = new THREE.Color();

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
      : options.ghost
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

    this.mesh = new THREE.InstancedMesh(geometry, material, options.maxInstances ?? MAX_INSTANCES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
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
  update(cells: readonly Cell[], yawDegrees: number, scaleBias = 1, whiteout = 0): void {
    const count = Math.min(cells.length, this.mesh.instanceMatrix.count);
    this.mesh.count = count;
    const size = CUBE_GAP * scaleBias;
    const toWhite = THREE.MathUtils.clamp(whiteout, 0, 1);

    for (let i = 0; i < count; i += 1) {
      const cell = cells[i] as Cell;
      const depth = THREE.MathUtils.clamp(depthParameterAtYaw(cell.x, cell.z, yawDegrees), 0, 1);

      this.position.set(toSceneX(cell.x), toSceneY(cell.y), toSceneZ(cell.z));
      this.scaleVector.setScalar(size);
      this.matrix.compose(this.position, this.quaternion, this.scaleVector);
      this.mesh.setMatrixAt(i, this.matrix);

      // Full Spectrum drives every band toward white, which is the whole colour
      // metaphor stated literally: the visible spectrum combined is white light.
      const { r, g, b } = depthColor(depth);
      this.color.setRGB(
        THREE.MathUtils.lerp(r, 1, toWhite),
        THREE.MathUtils.lerp(g, 1, toWhite),
        THREE.MathUtils.lerp(b, 1, toWhite),
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
