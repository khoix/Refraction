/**
 * Ties the pure game state to the scene.
 *
 * Reads game state; never writes it. The only state this owns is presentational:
 * where the camera currently is on its way between two faces.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Game } from '@core/game';
import type { Line } from '@core/board';
import { FACE_YAW, depthParameterAtYaw, lineCells, turnYawDelta } from '@core/projection';
import { depthColor } from '@core/spectrum';
import type { Cell, Face, TurnDirection } from '@core/types';
import { Debris, Environment } from './environment';
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
  toSceneX,
  toSceneY,
  toSceneZ,
} from './scene';
import { VoxelLayer } from './voxels';

/** Duration of the 90 degree turn. Design spec puts the useful range at 0.6-0.9s. */
export const TURN_DURATION_MS = 750;

/** How long the Full Spectrum whiteout takes to bloom and fade. */
const PRISM_BLOOM_MS = 1500;
/** Peak camera pan during a shake, in board cells. */
const SHAKE_AMPLITUDE = 0.32;
const SHAKE_DECAY_MS = 380;
/** How long the just-locked cells flash. */
const LOCK_FLASH_MS = 160;

/**
 * Bloom is selective by threshold: the settled board's colours sit safely
 * below it, so only pixels pushed past it by the additive clear glow or the
 * Prism whiteout ever bloom. Clears and Prism events shine; nothing else does.
 */
const BLOOM_THRESHOLD = 0.98;
const BLOOM_STRENGTH = 0.55;
const BLOOM_RADIUS = 0.3;

export interface GameRendererOptions {
  /** Tests read pixels back, which needs the drawing buffer preserved. */
  readonly preserveDrawingBuffer?: boolean;
  /**
   * Override the turn duration. Screenshots and assertions land at unpredictable
   * points inside a 750ms rotation; stretching it makes a chosen moment of the
   * turn reachable reliably instead of by luck.
   */
  readonly turnDurationMs?: number;
  /**
   * Suppress shake and soften the Full Spectrum bloom. Set from
   * `prefers-reduced-motion`, and also the photosensitivity guard: the bloom
   * ramps rather than flashes and never reaches full white.
   */
  readonly reducedMotion?: boolean;
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Cells the renderer should light up: lines complete, or about to be. */
function highlightCells(game: Game): Cell[] {
  const lines = game.status === 'turning' ? game.pendingClears : game.clearingLines;
  if (lines.length === 0) return [];
  return lines.flatMap((line) => lineCells(game.face, line.y, line.lane));
}

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  private readonly locked = new VoxelLayer();
  private readonly active = new VoxelLayer({ emissive: 0.35, maxInstances: 8 });
  private readonly ghost = new VoxelLayer({ opacity: 0.3, ghost: true, maxInstances: 8 });
  /**
   * Lines that are complete and about to be removed, drawn additively over the
   * board. During a turn these are the lines the rotation is *revealing* -- they
   * glow for the whole rotation and go on arrival, which is the entire point of
   * the mechanic and worth showing rather than resolving invisibly.
   */
  private readonly glow = new VoxelLayer({ additive: true, opacity: 0.5 });

  /**
   * The occluded halves of the falling piece and its ghost. These draw only
   * where the depth test fails -- exactly where settled cubes hide them -- so
   * the piece never disappears into the stack. Both keep their true spectrum
   * colours; the active silhouette is solid and the ghost's is fainter and
   * inset, so the two stay distinct even when both show through the board.
   */
  private readonly activeHidden = new VoxelLayer({
    whereHidden: true,
    opacity: 0.5,
    renderOrder: 7,
    maxInstances: 8,
  });
  private readonly ghostHidden = new VoxelLayer({
    whereHidden: true,
    opacity: 0.16,
    renderOrder: 6,
    maxInstances: 8,
  });

  /**
   * The X-ray on the first-contact surface: the settled cubes the falling
   * piece is aimed at, shown through the board. Two passes make it read as
   * seeing *through* rather than drawn *on top*: a translucent shell at the
   * cube's own size and a brighter inner core, both pulsing slowly, both
   * keeping the cube's spectrum colour -- the X-ray manipulates opacity,
   * luminance and animation, never hue. Intervening cubes stay visible
   * through the translucency.
   */
  private readonly xrayShell = new VoxelLayer({
    throughWalls: true,
    opacity: 0.3,
    renderOrder: 4,
    maxInstances: 8,
  });
  private readonly xrayCore = new VoxelLayer({
    additive: true,
    throughWalls: true,
    opacity: 0.5,
    renderOrder: 5,
    maxInstances: 8,
  });

  /** The cells of the piece that just locked, flashing briefly. */
  private readonly lockFlashLayer = new VoxelLayer({
    additive: true,
    opacity: 0,
    renderOrder: 2,
    maxInstances: 8,
  });
  private lockFlashCells: readonly Cell[] = [];
  private lockFlashElapsed = LOCK_FLASH_MS;

  private readonly environment: Environment;
  private readonly debris = new Debris();
  private readonly composer: EffectComposer;
  private readonly lights: SceneLights;
  private readonly well: Well;

  /** Yaw the camera is easing away from, and the one it is heading to. */
  private yawFrom = FACE_YAW.front;
  private yawTo = FACE_YAW.front;
  private turnElapsed: number;
  private aspect = 1;
  private glowElapsed = 0;
  private prismElapsed = PRISM_BLOOM_MS;
  private shakeElapsed = SHAKE_DECAY_MS;
  private shakeStrength = 0;
  private readonly reducedMotion: boolean;
  private readonly turnDurationMs: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: GameRendererOptions = {}
  ) {
    this.turnDurationMs = options.turnDurationMs ?? TURN_DURATION_MS;
    this.reducedMotion = options.reducedMotion ?? false;
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

    this.environment = new Environment(this.reducedMotion);
    this.scene.add(
      this.environment.group,
      this.locked.mesh,
      this.active.mesh,
      this.ghost.mesh,
      this.glow.mesh,
      this.activeHidden.mesh,
      this.ghostHidden.mesh,
      this.xrayShell.mesh,
      this.xrayCore.mesh,
      this.lockFlashLayer.mesh,
      this.debris.points
    );

    // A real post-process chain, so bloom is thresholded rather than painted:
    // only pixels the clear glow or the Prism whiteout push past the threshold
    // ever bloom, and the settled board never does.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
    );
    this.composer.addPass(new OutputPass());

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

  /** Begin the Full Spectrum bloom. */
  startPrism(): void {
    this.prismElapsed = 0;
  }

  /** Knock the camera. `strength` is a 0..1 multiplier on the peak amplitude. */
  shake(strength: number): void {
    if (this.reducedMotion) return;
    this.shakeStrength = Math.max(this.shakeStrength, THREE.MathUtils.clamp(strength, 0, 1));
    this.shakeElapsed = 0;
  }

  /**
   * How white the board currently is, 0..1.
   *
   * Rises quickly and falls slowly, so Full Spectrum reads as a bloom rather
   * than a strobe. Capped well below full white under reduced motion, which is
   * also the photosensitivity guard.
   */
  private get whiteout(): number {
    if (this.prismElapsed >= PRISM_BLOOM_MS) return 0;
    const t = this.prismElapsed / PRISM_BLOOM_MS;
    const shape = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
    return THREE.MathUtils.clamp(shape, 0, 1) * (this.reducedMotion ? 0.35 : 0.92);
  }

  /**
   * The camera's current shake displacement, in board cells.
   *
   * Public because it is the only honest way to assert on shake: the effect
   * lasts well under half a second, and a screenshot round-trip is slower than
   * that, so pixel comparison samples it long after it has decayed.
   */
  get shakeOffset(): { readonly x: number; readonly y: number } {
    if (this.shakeElapsed >= SHAKE_DECAY_MS || this.shakeStrength <= 0) return { x: 0, y: 0 };
    const remaining = 1 - this.shakeElapsed / SHAKE_DECAY_MS;
    const amplitude = SHAKE_AMPLITUDE * this.shakeStrength * remaining * remaining;
    // Two incommensurable frequencies, so the motion never looks like a loop.
    return {
      x: Math.sin(this.shakeElapsed * 0.07) * amplitude,
      y: Math.sin(this.shakeElapsed * 0.113) * amplitude * 0.7,
    };
  }

  /** Flash the cells a piece just locked into. */
  lockFlash(cells: readonly Cell[]): void {
    this.lockFlashCells = cells;
    this.lockFlashElapsed = 0;
    this.environment.react(0.14);
  }

  /**
   * Present a clear: debris erupts from the removed cells in their spectrum
   * colours, staggered along the clearing axis so the line dissolves from one
   * end to the other, and the environment answers -- a ripple for any clear,
   * a bigger one for a Refraction Clear, and a major response for Prism.
   */
  clearEffect(cleared: readonly Line[], face: Face, refraction: boolean, prism: boolean): void {
    const yaw = this.yaw;
    for (const line of cleared) {
      const cells = lineCells(face, line.y, line.lane);
      cells.forEach((cell, index) => {
        const along = cells.length > 1 ? index / (cells.length - 1) : 0;
        const depth = THREE.MathUtils.clamp(depthParameterAtYaw(cell.x, cell.z, yaw), 0, 1);
        this.debris.burst(
          toSceneX(cell.x),
          toSceneY(cell.y),
          toSceneZ(cell.z),
          along,
          depthColor(depth),
          this.reducedMotion ? 2 : 5
        );
      });
    }

    const strength = prism ? 1 : refraction ? 0.7 : 0.42;
    this.environment.react(strength);
    this.environment.ripple(strength);
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
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

    this.prismElapsed = Math.min(PRISM_BLOOM_MS, this.prismElapsed + deltaMs);
    this.shakeElapsed = Math.min(SHAKE_DECAY_MS, this.shakeElapsed + deltaMs);

    const yaw = this.yaw;
    const flatness = this.flatness;
    const dimensional = 1 - flatness;
    const whiteout = this.whiteout;

    // Shrink every cube by the SAME factor as the board turns. Packed flush
    // together they smear into bands at an angle; opening the gaps lets each
    // cube read as a cube. Uniform is the important word -- this is a legibility
    // adjustment applied equally to all of them, not a depth cue, and a cube at
    // the back is exactly the size of one at the front throughout.
    const separation = THREE.MathUtils.lerp(1, 0.78, dimensional);

    // Orthographic throughout, so a cube's size on screen never depends on how
    // far back it is. Only the yaw and a small turn-time elevation change.
    positionCamera(this.camera, yaw, TURN_ELEVATION_DEG * dimensional, this.shakeOffset);
    orientLights(this.lights, yaw);
    setLightingFlatness(this.lights, flatness);
    setWellFlatness(this.well, flatness);
    orientWell(this.well, yaw);

    this.locked.update(game.board.filledCells(), yaw, separation, whiteout);
    this.glowElapsed += deltaMs;
    // Lines being removed swell slightly as they go, so a clear dissolves
    // outward instead of simply vanishing between frames.
    const dissolve = game.status === 'resolving' ? 1.22 : 1.06;
    const highlights = highlightCells(game);
    this.glow.update(highlights, yaw, separation * dissolve, whiteout);
    // Pulse rather than hold steady, so a line about to go reads as urgent.
    this.glow.setOpacity(0.3 + 0.28 * Math.sin(this.glowElapsed * 0.011) + whiteout * 0.4);

    const activeCells = game.activeCells();
    const ghostCells = game.status === 'falling' ? game.ghostCells() : [];
    this.active.update(activeCells, yaw, separation, whiteout);
    // The ghost is inset so it reads as a target rather than as a real block.
    this.ghost.update(ghostCells, yaw, 0.78 * separation);
    // The same cells again, drawn only where the board hides them, so the
    // falling piece and its ghost never vanish into the stack.
    this.activeHidden.update(activeCells, yaw, separation, whiteout);
    this.ghostHidden.update(ghostCells, yaw, 0.78 * separation);

    // The X-ray: the settled cubes the piece would first land on, seen through
    // the board. Shell at full size, brighter core inset, both breathing
    // slowly so they read as revealed rather than as painted on top.
    const contacts = game.status === 'falling' ? game.firstContactCells() : [];
    const breath = Math.sin(this.glowElapsed * 0.006);
    this.xrayShell.update(contacts, yaw, separation * 1.02, 0.12);
    this.xrayShell.setOpacity(0.26 + 0.08 * breath);
    this.xrayCore.update(contacts, yaw, separation * 0.44, 0.3);
    this.xrayCore.setOpacity(0.4 + 0.16 * breath);

    // The lock flash: a brief full-cell glow where the piece just settled.
    this.lockFlashElapsed = Math.min(LOCK_FLASH_MS, this.lockFlashElapsed + deltaMs);
    const flash = 1 - this.lockFlashElapsed / LOCK_FLASH_MS;
    this.lockFlashLayer.update(flash > 0 ? this.lockFlashCells : [], yaw, separation, 0.5);
    this.lockFlashLayer.setOpacity(flash * (this.reducedMotion ? 0.35 : 0.7));

    this.debris.update(deltaMs);
    this.environment.setTension(
      game.status === 'awaitingTurn' ? 1 : game.shiftMeter / game.stage.linesPerTurn
    );
    this.environment.update(deltaMs, yaw, this.isTurning);

    // The post-process chain runs only while something can actually bloom --
    // a lit clear line, the Prism whiteout, a lock flash, debris in flight.
    // Below the threshold the composer's output is identical to a plain
    // render, so skipping it costs nothing visually and returns the whole
    // bloom chain's cost during ordinary play, where it matters most on
    // integrated and software GL.
    const canBloom = highlights.length > 0 || whiteout > 0 || flash > 0 || this.debris.isActive;
    if (canBloom) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.locked.dispose();
    this.active.dispose();
    this.ghost.dispose();
    this.glow.dispose();
    this.activeHidden.dispose();
    this.ghostHidden.dispose();
    this.xrayShell.dispose();
    this.xrayCore.dispose();
    this.lockFlashLayer.dispose();
    this.environment.dispose();
    this.debris.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
