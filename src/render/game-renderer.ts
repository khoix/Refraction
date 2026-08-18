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
import { BOARD_HEIGHT } from '@core/constants';
import { FACE_YAW, depthParameterAtYaw, lineCells, toView, turnYawDelta } from '@core/projection';
import { depthColor } from '@core/spectrum';
import type { Cell, Face, TurnDirection } from '@core/types';
import { Debris, Environment } from './environment';
import type { SceneLights, Well } from './scene';
import {
  TURN_ELEVATION_DEG,
  createColumnPanel,
  createScene,
  fitCamera,
  orientColumnPanel,
  orientLights,
  orientWell,
  positionCamera,
  projectedFootprintWidth,
  setLightingFlatness,
  setWellFlatness,
  toSceneX,
  toSceneY,
  toSceneZ,
} from './scene';
import { EdgeLayer, VoxelLayer } from './voxels';

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

/**
 * Player-facing render preferences.
 *
 * These change while the game is running -- the settings panel is reachable
 * from pause -- so they are mutable state rather than constructor options.
 */
export interface RenderPreferences {
  readonly reducedMotion: boolean;
  readonly screenShake: boolean;
  readonly bloom: boolean;
  readonly showGhost: boolean;
  /** False in Blind Spectrum: cubes are drawn in one neutral fill. */
  readonly depthColour: boolean;
}

const DEFAULT_PREFERENCES: RenderPreferences = {
  reducedMotion: false,
  screenShake: true,
  bloom: true,
  showGhost: true,
  depthColour: true,
};

export interface WellScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Outline budget for the x-ray. The channel is at most the piece's widest
 * footprint across the full depth and height of the well, and in practice a
 * small fraction of that.
 */
const MAX_EDGE_CELLS = 8 * 18 * 8;

/**
 * How far the cubes behind the landing surface recede.
 *
 * Tuned by measurement rather than by eye, against a board that renders at
 * exactly its palette values. An untouched cube means luminance 113; this lands
 * the muted band near 20, with no peak above 30 -- a dark mass with no
 * structure, still plainly carrying its hue.
 *
 * The earlier 0.58 was measured while a backdrop panel was washing the whole
 * playfield down to a third, so a band at "0.42 strength" was really at 0.16 of
 * the palette. With the wash gone the same number left these brighter than the
 * x-ray in front of them, which inverts the point of the two bands.
 */
const MUTED_DIM = 0.74;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Cells the renderer should light up: lines complete, or about to be. */
function highlightCells(game: Game): Cell[] {
  const lines = game.status === 'turning' ? game.pendingClears : game.clearingLines;
  if (lines.length === 0) return [];
  return lines.flatMap((line) => lineCells(game.face, line.y, line.lane));
}

/**
 * The falling piece's drop channel, per screen column.
 *
 * The channel is what the player is trying to see into: the columns the piece
 * covers, from the row it will land on upward. Both ends are read off the ghost,
 * which is the piece projected to its landing position and therefore already
 * carries the columns, the lanes and the floor.
 *
 * Per column rather than as one bounding box, because a piece is not always a
 * flat bar. An S or an L lands at different heights in different columns and may
 * occupy different lanes in each, and the channel should follow the piece rather
 * than a box drawn around it.
 */
interface DropChannel {
  /** Lowest row the channel covers here: the row the piece lands on. */
  readonly floor: number;
  /** Deepest lane the piece occupies here. Everything up to it is x-rayed. */
  readonly back: number;
}

function dropChannel(game: Game): Map<number, DropChannel> | null {
  if (game.status !== 'falling' || !game.active) return null;
  const ghost = game.ghostCells();
  if (ghost.length === 0) return null;

  const channel = new Map<number, DropChannel>();
  for (const cell of ghost) {
    const { u, y, lane } = toView(game.face, cell);
    const found = channel.get(u);
    channel.set(u, {
      floor: found ? Math.min(found.floor, y) : y,
      back: found ? Math.max(found.back, lane) : lane,
    });
  }
  return channel;
}

/**
 * Sort the settled board into the three states a cube can be drawn in.
 *
 * **This is not a depth split.** An earlier version classified every cube on the
 * board by its lane alone, which meant a piece dealt to a back lane turned the
 * entire board to glass, and one dealt to the front muted all of it. That is
 * what "everything looks muted" was.
 *
 * The effect belongs to the drop channel, not to the board:
 *
 * | Where the cube is                                  | Drawn as |
 * | -------------------------------------------------- | -------- |
 * | In the channel, at or in front of the piece's depth | x-ray    |
 * | In the channel, behind the piece's depth            | muted    |
 * | Anywhere else -- other columns, below the ghost      | normal   |
 *
 * So a cube only changes if it is standing between the player and the landing
 * surface, or directly behind that surface. Everything else on the board keeps
 * its full depth colour, which is most of it most of the time.
 *
 * The piece's own lanes are x-rayed along with the ones in front. There is no
 * separate focal band: a cube above the ghost blocks the view of the landing row
 * whatever its depth, so the whole front-to-piece run is glass.
 */
interface BoardBands {
  readonly xray: Cell[];
  readonly plain: Cell[];
  readonly muted: Cell[];
}

function partitionBoard(game: Game): BoardBands {
  const filled = game.board.filledCells();
  const channel = dropChannel(game);
  if (!channel) return { xray: [], plain: filled, muted: [] };

  const xray: Cell[] = [];
  const plain: Cell[] = [];
  const muted: Cell[] = [];
  for (const cell of filled) {
    const { u, y, lane } = toView(game.face, cell);
    const column = channel.get(u);
    if (!column || y < column.floor) plain.push(cell);
    else if (lane <= column.back) xray.push(cell);
    else muted.push(cell);
  }
  return { xray, plain, muted };
}

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  /**
   * Cubes standing in the drop channel, drawn as an x-ray rather than a fade.
   *
   * Two passes: a fill so faint it is barely a tint, and a wireframe that keeps
   * the cube's shape legible. That combination is what "see through it" means.
   * One translucent solid cannot do it -- at any opacity, however much of the
   * cube you can see is exactly how much of the board behind it you cannot, so
   * turning it down to reveal the board turns the cube off, and turning it up to
   * show the cube greys out everything underneath. That is the muting.
   *
   * Both passes are unlit, so neither gained anything when the board's lighting
   * was corrected to reproduce the palette exactly. Their opacities carry that
   * factor instead, so an x-rayed cube keeps a low mean with a bright edge
   * against a board now drawn at full palette strength.
   */
  private readonly lockedXray = new VoxelLayer({
    opacity: 0.12,
    ghost: true,
    depthWrite: false,
    renderOrder: 1,
  });
  private readonly lockedXrayEdges = new EdgeLayer(MAX_EDGE_CELLS, 0.7);
  /** Everything the channel does not touch, which is most of the board. */
  private readonly lockedPlain = new VoxelLayer();
  /** In the channel but behind the piece: dark, still carrying its hue. */
  private readonly lockedMuted = new VoxelLayer();
  private readonly active = new VoxelLayer({ emissive: 0.35, maxInstances: 8 });
  /**
   * The landing footprint.
   *
   * Draws *after* the x-ray passes (renderOrder 3 against their 1). It used to
   * sit at the default 0, which put a 0.28 veil on top of a 0.3 ghost and
   * washed it out -- the ghost was never missing, just painted over. It is the
   * single most useful mark on the board, so it goes last and it goes brighter.
   */
  private readonly ghost = new VoxelLayer({
    opacity: 0.44,
    ghost: true,
    renderOrder: 3,
    maxInstances: 8,
  });
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
   * Restrained emphasis on the cubes the falling piece will actually touch --
   * a brighter inner core, no additive glow, no pulse. The lane-focus veil is
   * what makes them visible; this just says "these ones".
   */
  private readonly contact = new VoxelLayer({
    emissive: 0.7,
    renderOrder: 2,
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
  /** Every layer that draws cubes, for settings that apply to all of them. */
  private readonly voxelLayers: readonly VoxelLayer[];
  private readonly lights: SceneLights;
  private readonly well: Well;
  private readonly columnPanel: THREE.Mesh;
  private readonly scratch = new THREE.Vector3();

  /** Yaw the camera is easing away from, and the one it is heading to. */
  private yawFrom = FACE_YAW.front;
  private yawTo = FACE_YAW.front;
  private turnElapsed: number;
  private aspect = 1;
  private glowElapsed = 0;
  private prismElapsed = PRISM_BLOOM_MS;
  private shakeElapsed = SHAKE_DECAY_MS;
  private shakeStrength = 0;
  private prefs: RenderPreferences = DEFAULT_PREFERENCES;
  private readonly turnDurationMs: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: GameRendererOptions = {}
  ) {
    this.turnDurationMs = options.turnDurationMs ?? TURN_DURATION_MS;
    this.prefs = { ...DEFAULT_PREFERENCES, reducedMotion: options.reducedMotion ?? false };
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
    // No tone mapping. A filmic curve is for a scene lit in physical units that
    // has to be squeezed into a display; this scene is authored in display
    // values from the start -- every cube's colour is a point on the spectrum
    // ramp, chosen in OKLCH to land at an exact place on screen. ACES was
    // rewriting them: it compresses midtones and clips channels, which on the
    // saturated end of the ramp cost red its blue channel and violet its green
    // one. The ramp is the game's only depth cue and nothing may reinterpret it.
    // The bloom chain is the one thing that exceeds 1, and clipping to white is
    // exactly what a whiteout is supposed to do.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const bundle = createScene();
    this.scene = bundle.scene;
    this.camera = bundle.camera;
    this.lights = bundle.lights;
    this.well = bundle.well;

    this.environment = new Environment(this.reducedMotion);
    this.columnPanel = createColumnPanel();
    this.voxelLayers = [
      this.lockedXray,
      this.lockedPlain,
      this.lockedMuted,
      this.active,
      this.ghost,
      this.glow,
      this.activeHidden,
      this.ghostHidden,
      this.contact,
      this.lockFlashLayer,
    ];

    this.scene.add(
      this.environment.group,
      this.columnPanel,
      this.lockedXray.mesh,
      this.lockedXrayEdges.lines,
      this.lockedPlain.mesh,
      this.lockedMuted.mesh,
      this.active.mesh,
      this.ghost.mesh,
      this.glow.mesh,
      this.activeHidden.mesh,
      this.ghostHidden.mesh,
      this.contact.mesh,
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

  /**
   * Apply a settings change. Takes effect on the next frame.
   *
   * These are mutable rather than constructor options because the settings
   * panel is reachable from pause, so they change while a run is in progress.
   */
  setPreferences(patch: Partial<RenderPreferences>): void {
    this.prefs = { ...this.prefs, ...patch };
    for (const layer of this.voxelLayers) layer.setDepthColour(this.prefs.depthColour);
    this.lockedXrayEdges.setDepthColour(this.prefs.depthColour);
  }

  get preferences(): RenderPreferences {
    return this.prefs;
  }

  private get reducedMotion(): boolean {
    return this.prefs.reducedMotion;
  }

  /** Knock the camera. `strength` is a 0..1 multiplier on the peak amplitude. */
  shake(strength: number): void {
    if (this.reducedMotion || !this.prefs.screenShake) return;
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
    if (!this.prefs.bloom) return 0;
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

  /**
   * The well's silhouette in viewport CSS pixels. Used to park HUD chrome
   * (the Shift bar) against the play column rather than the screen edge.
   * Orthographic, so a world-space billboard projects to a rectangle.
   */
  wellScreenRect(): WellScreenRect {
    const yaw = THREE.MathUtils.degToRad(this.yaw);
    const halfW = projectedFootprintWidth(this.yaw) / 2;
    const halfH = BOARD_HEIGHT / 2 + 0.6;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const corners: Array<readonly [number, number, number]> = [
      [-halfW * rightX, halfH, -halfW * rightZ],
      [halfW * rightX, halfH, halfW * rightZ],
      [-halfW * rightX, -halfH, -halfW * rightZ],
      [halfW * rightX, -halfH, halfW * rightZ],
    ];
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const box = this.canvas.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y, z] of corners) {
      this.scratch.set(x, y, z).project(this.camera);
      const sx = (this.scratch.x * 0.5 + 0.5) * width;
      const sy = (-this.scratch.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, sx);
      minY = Math.min(minY, sy);
      maxX = Math.max(maxX, sx);
      maxY = Math.max(maxY, sy);
    }
    // Viewport coordinates so the HUD can subtract its own origin. The HUD
    // is width-capped and centred; the canvas is not.
    return {
      left: box.left + minX,
      top: box.top + minY,
      width: maxX - minX,
      height: maxY - minY,
    };
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
    this.scene.background = this.environment.backdrop;
    // The panel dips during Prism so the whiteout can still wash the column.
    orientColumnPanel(this.columnPanel, yaw, 0.62 * (1 - whiteout * 0.7));

    const bands = partitionBoard(game);
    this.lockedXray.update(bands.xray, yaw, separation, whiteout);
    this.lockedXrayEdges.update(bands.xray, yaw, separation);
    this.lockedPlain.update(bands.plain, yaw, separation, whiteout);
    // Behind the landing surface: dark and receding, not merely desaturated.
    this.lockedMuted.update(bands.muted, yaw, separation, whiteout, MUTED_DIM);

    this.glowElapsed += deltaMs;
    // Lines being removed swell slightly as they go, so a clear dissolves
    // outward instead of simply vanishing between frames.
    const dissolve = game.status === 'resolving' ? 1.22 : 1.06;
    const highlights = highlightCells(game);
    this.glow.update(highlights, yaw, separation * dissolve, whiteout);
    // Pulse rather than hold steady, so a line about to go reads as urgent.
    this.glow.setOpacity(0.3 + 0.28 * Math.sin(this.glowElapsed * 0.011) + whiteout * 0.4);

    const activeCells = game.activeCells();
    const ghostCells = this.prefs.showGhost && game.status === 'falling' ? game.ghostCells() : [];
    this.active.update(activeCells, yaw, separation, whiteout);
    // The ghost is inset so it reads as a target rather than as a real block.
    this.ghost.update(ghostCells, yaw, 0.78 * separation);
    // The same cells again, drawn only where the board hides them -- now only
    // load-bearing for focal and far cubes, since nearer ones no longer write
    // depth. Keep them: a same-lane overhang still occludes.
    this.activeHidden.update(activeCells, yaw, separation, whiteout);
    this.ghostHidden.update(ghostCells, yaw, 0.78 * separation);

    const contacts = game.status === 'falling' ? game.firstContactCells() : [];
    this.contact.update(contacts, yaw, separation * 0.72, whiteout);

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
    this.lockedXray.dispose();
    this.lockedXrayEdges.dispose();
    this.lockedPlain.dispose();
    this.lockedMuted.dispose();
    this.active.dispose();
    this.ghost.dispose();
    this.glow.dispose();
    this.activeHidden.dispose();
    this.ghostHidden.dispose();
    this.contact.dispose();
    this.lockFlashLayer.dispose();
    this.environment.dispose();
    this.debris.dispose();
    this.columnPanel.geometry.dispose();
    (this.columnPanel.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
