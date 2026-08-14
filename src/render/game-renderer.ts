/**
 * Ties the pure game state to the scene.
 *
 * Reads game state; never writes it. The only state this owns is presentational:
 * where the camera currently is on its way between two faces.
 */

import * as THREE from 'three';
import type { Game } from '@core/game';
import { FACE_YAW, turnYawDelta } from '@core/projection';
import type { TurnDirection } from '@core/types';
import type { SceneLights, Well } from './scene';
import {
  TURN_ELEVATION_DEG,
  createScene,
  fitCamera,
  orientLights,
  orientWell,
  positionCamera,
  setLightingFlatness,
  setWellFlatness,
} from './scene';
import { VoxelLayer } from './voxels';

/** Duration of the 90 degree turn. Design spec puts the useful range at 0.6-0.9s. */
export const TURN_DURATION_MS = 750;

export interface GameRendererOptions {
  /** Tests read pixels back, which needs the drawing buffer preserved. */
  readonly preserveDrawingBuffer?: boolean;
  /**
   * Override the turn duration. Screenshots and assertions land at unpredictable
   * points inside a 750ms rotation; stretching it makes a chosen moment of the
   * turn reachable reliably instead of by luck.
   */
  readonly turnDurationMs?: number;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  private readonly locked = new VoxelLayer();
  private readonly active = new VoxelLayer({ emissive: 0.35, maxInstances: 8 });
  private readonly ghost = new VoxelLayer({ opacity: 0.3, ghost: true, maxInstances: 8 });
  private readonly lights: SceneLights;
  private readonly well: Well;

  /** Yaw the camera is easing away from, and the one it is heading to. */
  private yawFrom = FACE_YAW.front;
  private yawTo = FACE_YAW.front;
  private turnElapsed: number;
  private aspect = 1;
  private readonly turnDurationMs: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: GameRendererOptions = {}
  ) {
    this.turnDurationMs = options.turnDurationMs ?? TURN_DURATION_MS;
    this.turnElapsed = this.turnDurationMs;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      // Off by default for performance. Tests turn it on so they can read pixels
      // back: without it the drawing buffer is cleared after compositing and
      // every sample comes back blank, whatever is actually on screen.
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const bundle = createScene();
    this.scene = bundle.scene;
    this.camera = bundle.camera;
    this.lights = bundle.lights;
    this.well = bundle.well;

    this.scene.add(this.locked.mesh, this.active.mesh, this.ghost.mesh);
    this.resize();
  }

  /** True while the camera is still travelling between two faces. */
  get isTurning(): boolean {
    return this.turnElapsed < this.turnDurationMs;
  }

  /** Current camera yaw, which mid-turn is between two faces. */
  get yaw(): number {
    if (!this.isTurning) return this.yawTo;
    const t = easeInOutCubic(this.turnElapsed / this.turnDurationMs);
    return this.yawFrom + (this.yawTo - this.yawFrom) * t;
  }

  /** Begin a turn. The camera travels the way the player asked, not the short way. */
  startTurn(direction: TurnDirection): void {
    this.yawFrom = this.yaw;
    this.yawTo = this.yawFrom + turnYawDelta(direction);
    this.turnElapsed = 0;
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.aspect = width / Math.max(1, height);
    fitCamera(this.camera, this.aspect);
  }

  /**
   * How flat the board currently looks: 1 while settled on a face, easing to 0
   * at the midpoint of a turn and back to 1 on arrival.
   *
   * A half sine rather than the eased yaw, so the board is fully flat the
   * instant it settles and the dimensional peak lands exactly halfway through
   * the rotation, where the parallax is most legible.
   */
  get flatness(): number {
    if (!this.isTurning) return 1;
    return 1 - Math.sin(Math.PI * (this.turnElapsed / this.turnDurationMs));
  }

  render(game: Game, deltaMs: number): void {
    if (this.isTurning) {
      this.turnElapsed = Math.min(this.turnDurationMs, this.turnElapsed + deltaMs);
    }

    const yaw = this.yaw;
    const flatness = this.flatness;
    const dimensional = 1 - flatness;

    // Shrink every cube by the SAME factor as the board turns. Packed flush
    // together they smear into bands at an angle; opening the gaps lets each
    // cube read as a cube. Uniform is the important word -- this is a legibility
    // adjustment applied equally to all of them, not a depth cue, and a cube at
    // the back is exactly the size of one at the front throughout.
    const separation = THREE.MathUtils.lerp(1, 0.78, dimensional);

    // Orthographic throughout, so a cube's size on screen never depends on how
    // far back it is. Only the yaw and a small turn-time elevation change.
    positionCamera(this.camera, yaw, TURN_ELEVATION_DEG * dimensional);
    orientLights(this.lights, yaw);
    setLightingFlatness(this.lights, flatness);
    setWellFlatness(this.well, flatness);
    orientWell(this.well, yaw);

    this.locked.update(game.board.filledCells(), yaw, separation);
    this.active.update(game.activeCells(), yaw, separation);
    // The ghost is inset so it reads as a target rather than as a real block.
    this.ghost.update(game.status === 'falling' ? game.ghostCells() : [], yaw, 0.78 * separation);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.locked.dispose();
    this.active.dispose();
    this.ghost.dispose();
    this.renderer.dispose();
  }
}
