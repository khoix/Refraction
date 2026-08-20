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
import { setGelYaw } from './gel';
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
import { PiecePreview } from './preview';
import type { PreviewRect } from './preview';
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

/**
 * What bloom becomes on the screens with no board on them.
 *
 * A far lower threshold, because there the glowing cages *are* the picture and
 * they are drawn as lines a pixel wide. See `applyBloom` for why the restrained
 * values above are not negotiable during a run.
 */
const FRONT_BLOOM_THRESHOLD = 0.12;
const FRONT_BLOOM_STRENGTH = 0.85;
const FRONT_BLOOM_RADIUS = 0.75;

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
  /**
   * Draw the landing marks.
   *
   * A renderer flag, **not a player setting**. It was one, and it should not
   * have been: the ghost is not a preference, it is how the board is read, and
   * every landing-mark decision assumes it is there. A toggle invites a player
   * to switch off the thing that makes depth legible and then conclude the game
   * is unfair. It survives here because the end-to-end suite turns the marks off
   * to measure the cubes underneath them on their own.
   */
  readonly showGhost: boolean;
  /** False in Blind Spectrum: cubes are drawn in one neutral fill. */
  readonly depthColour: boolean;
  /**
   * Turn the next-piece preview in three dimensions.
   *
   * Off is the *harder* option, not the plainer one: a still preview shows the
   * piece the way the board shows everything, as one projection, and leaves the
   * player to infer the rest. Unlike the ghost, this is a real difficulty choice
   * rather than a comprehension aid, which is why it is a setting at all.
   */
  readonly spinPreview: boolean;
}

const DEFAULT_PREFERENCES: RenderPreferences = {
  reducedMotion: false,
  screenShake: true,
  bloom: true,
  showGhost: true,
  depthColour: true,
  spinPreview: true,
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

/**
 * Peek: how far the camera tilts, and how long it takes to get there.
 *
 * Eight degrees is small on purpose. It has to be enough to separate the stack
 * along the depth axis -- which is the whole point, since a settled board is
 * dead-on and gives no parallax at all -- without becoming a second way to read
 * depth that competes with the spectrum. The board stays orthographic
 * throughout, so a far cube is still exactly the size of a near one; only the
 * angle changes.
 *
 * Eased rather than snapped, in both directions. A hard cut to eight degrees
 * reads as a glitch, and the movement itself is what carries the parallax: it is
 * the cubes sliding past each other that says which is in front.
 */
const PEEK_ELEVATION_DEG = 8;
const PEEK_EASE_MS = 180;

/** Slow: this is a scene changing, not a control responding. */
const BACKDROP_EASE_MS = 900;

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
 * covers, and how far down they have to see.
 *
 * **Down to the first real voxel, not to where the piece stops.** Those are the
 * same row only when the piece lands flush. A piece whose underside does not
 * match the stack comes to rest on its highest point and leaves a gap under
 * everything else -- a flat four-wide bar on a staircase lands at one height in
 * all four columns while the surface below sits four, six and seven rows lower.
 * The gap is the single most useful thing to be able to see, and stopping the
 * channel at the landing row is exactly what hid it.
 *
 * Per column rather than as one bounding box, because a piece is not always a
 * flat bar. An S or an L lands at different heights in different columns and may
 * occupy different lanes in each, so the channel follows the piece rather than a
 * box drawn around it.
 */
interface DropChannel {
  /** Lowest row the channel reaches here: the first settled cube beneath it. */
  readonly floor: number;
  /** Deepest lane the piece occupies here. Everything up to it is x-rayed. */
  readonly back: number;
}

function dropChannel(game: Game): Map<number, DropChannel> | null {
  if (game.status !== 'falling' || !game.active) return null;
  const ghost = game.ghostCells();
  if (ghost.length === 0) return null;

  // Where the surface actually is, keyed by the column and lane it sits under.
  // A column with nothing beneath the piece has no contact cell at all, and its
  // channel should reach the well floor rather than stop in mid-air.
  const surface = new Map<string, number>();
  for (const cell of game.firstContactCells()) {
    const { u, y, lane } = toView(game.face, cell);
    surface.set(`${u},${lane}`, y);
  }

  const channel = new Map<number, DropChannel>();
  for (const cell of ghost) {
    const { u, lane } = toView(game.face, cell);
    const floor = surface.get(`${u},${lane}`) ?? 0;
    const found = channel.get(u);
    channel.set(u, {
      floor: found ? Math.min(found.floor, floor) : floor,
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
 * | The surface the piece will rest on                  | normal   |
 * | Anywhere else -- other columns, below the surface    | normal   |
 *
 * So a cube only changes if it is standing between the player and the landing
 * surface, or directly behind that surface. Everything else on the board keeps
 * its full depth colour, which is most of it most of the time.
 *
 * The piece's own lanes are x-rayed along with the ones in front. There is no
 * separate focal band: a cube above the surface blocks the view of it whatever
 * its depth, so the whole front-to-piece run is glass.
 *
 * ## One pane of glass per screen cell
 *
 * Only the *nearest* cube in each screen cell is drawn as glass. The ones behind
 * it are not drawn at all.
 *
 * Translucency accumulates, and that is what made the x-ray fail on exactly the
 * boards it exists for. Seven panes at 0.12 each leave 0.88^7 = 41% of the light
 * behind them, so a channel seen through a full-depth wall came back to 59%
 * coverage -- measured at luminance 93 against an untouched cube's 107. The
 * landing footprint behind it read 135 at its peak against glass peaking at 119.
 * A 13% separation where an open board gives fourteen times: the aid dissolved
 * as the board got harder, which is backwards.
 *
 * Dropping the fill's opacity cannot fix this, because one number has to serve
 * both a single pane and eight of them: faint enough for eight is invisible for
 * one. Per-instance alpha cannot either -- instance colour multiplies the
 * fragment, not its alpha, so dimming a rear pane darkens the stack without
 * making it any more transparent.
 *
 * So the pane count is capped instead, and one is the right cap. The number of
 * cubes stacked in the way is not something a player acts on; where the region
 * is, how deep it starts, and where the piece will land are, and those come from
 * the outline, the outline's colour and the marks. `EdgeLayer` already collapses
 * the region to one depth per screen cell for exactly that reason, so this makes
 * the fill agree with the border drawn around it.
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

  // The surface cubes the piece will come to rest on are the one thing in the
  // channel that stays solid. They are the backstop the channel stops against,
  // and they carry the landing mark -- an x-rayed cube cannot hold a mark.
  const backstop = new Set<string>();
  for (const cell of game.firstContactCells()) backstop.add(`${cell.x},${cell.y},${cell.z}`);

  // Screen cell -> the nearest cube standing in the channel there, and its lane.
  // Screen cells are 8 x 18, so one integer keys them.
  const pane = new Map<number, { readonly cell: Cell; readonly lane: number }>();
  const plain: Cell[] = [];
  const muted: Cell[] = [];
  for (const cell of filled) {
    const { u, y, lane } = toView(game.face, cell);
    const column = channel.get(u);
    if (!column || y < column.floor || backstop.has(`${cell.x},${cell.y},${cell.z}`)) {
      plain.push(cell);
    } else if (lane <= column.back) {
      const key = u * 1024 + y;
      const nearest = pane.get(key);
      if (nearest === undefined || lane < nearest.lane) pane.set(key, { cell, lane });
    } else {
      muted.push(cell);
    }
  }
  const xray = [...pane.values()].map((nearest) => nearest.cell);
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
   *
   * The outline is of the *region*, not of each cube in it -- see `EdgeLayer`.
   */
  private readonly lockedXray = new VoxelLayer({
    opacity: 0.12,
    ghost: true,
    depthWrite: false,
    renderOrder: 1,
  });
  private readonly lockedXrayEdges = new EdgeLayer(MAX_EDGE_CELLS, 0.7, 2);
  /** Everything the channel does not touch, which is most of the board. */
  private readonly lockedPlain = new VoxelLayer();
  /** In the channel but behind the piece: dark, still carrying its hue. */
  private readonly lockedMuted = new VoxelLayer();
  private readonly active = new VoxelLayer({ maxInstances: 8 });
  /**
   * The landing footprint: where the piece's own cubes will come to rest.
   *
   * One of two marks, and the higher of them whenever the piece does not land
   * flush. This one says where the piece will *sit*; `contact` below says what
   * it will sit *on*, and on a stepped board they are rows apart.
   *
   * **No outline.** It had one briefly, and an outlined mark sitting inside an
   * outlined x-ray region is two borders a few pixels apart saying different
   * things -- the mark lost, and the region's edge got harder to read too.
   *
   * So the legibility has to come from the fill. A mark may not depend on the
   * x-ray to be seen: on an open board, where the x-ray correctly does nothing,
   * a translucent cube alone reads as a dead block -- 0.44 of a lane colour over
   * the well's near-black background lands around luminance 47. It is raised and
   * lifted toward white, which also evens out the ramp: violet at luminance 67
   * is the case that decides the numbers, since a fill alone leaves the dark end
   * of the spectrum far fainter than the bright end.
   *
   * It stays inset at 0.78, which is what keeps it reading as a mark rather than
   * as a cube now that it is this solid.
   */
  private readonly ghost = new VoxelLayer({
    opacity: 0.72,
    lift: 0.45,
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
   * The landing mark: a smaller solid square on the face of the cube the piece
   * will come to rest on. The second of the two marks, and the lower one.
   *
   * Drawn inset at 0.72 and lifted toward white. The inset alone was never
   * enough -- and for its whole life it did nothing at all, because the layer
   * asked for `emissive: 0.7` on a material whose emissive colour was black, so
   * it drew a slightly smaller cube in exactly the colour of the cube
   * underneath it. Invisible by construction, which is why the landing surface
   * has never had any emphasis.
   *
   * Lifted almost to white rather than tinted. Halfway was measured first and
   * is not enough: on an already-bright lane -- green means luminance 198, yellow
   * 190 -- a 50% lift moves it about 12%, so the mark disappears on exactly the
   * colours it most needs to survive. Near-white gives a step of a quarter or
   * more on every stop of the ramp, and it is the more consistent choice anyway:
   * the cube it sits on already states the depth, so the mark is chrome, and
   * chrome in this game is achromatic.
   */
  private readonly contact = new VoxelLayer({
    lift: 0.85,
    // Half a cell forward, so a 0.66 cube straddles the 0.92 cube's near face
    // and reads as a raised square patch on it rather than as a cube inside it.
    faceOffset: 0.5,
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

  /**
   * The next piece, drawn into a scissored corner of this same canvas. One
   * renderer, one GL context, one frame -- a second `WebGLRenderer` would mean a
   * second of each and a second thing to keep in step.
   */
  private readonly preview = new PiecePreview();
  private previewRect: PreviewRect | null = null;
  private readonly environment: Environment;
  private readonly debris = new Debris();
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
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
  /** 0 while dead-on, 1 while fully peeked. Eased, so it is never a step. */
  private peek = 0;
  private peekHeld = false;
  /** 0 while framed for play, 1 while pushed back as the front door's scenery. */
  private backdrop = 0;
  private backdropHeld = false;
  private bottomReservePx = 0;
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
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    this.composer.addPass(this.bloomPass);
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

  /**
   * Put the camera on a face immediately, with no travel.
   *
   * For starting a run. The title screen turns the board by itself, so by the
   * time anyone presses PLAY the camera is at whatever yaw the attract cycle
   * reached -- while the new game is on the front face, always. Nothing
   * reconciles those two on its own: the renderer's yaw is its own state and
   * colour is computed from it, so the board would have come up wearing the
   * palette of a face the engine was not playing, and every control would have
   * pointed the wrong way.
   */
  snapToFace(face: Face): void {
    this.yawFrom = FACE_YAW[face];
    this.yawTo = this.yawFrom;
    this.turnElapsed = this.turnDurationMs;
  }

  /** Begin a turn. The camera travels the way the player asked, not the short way. */
  startTurn(direction: TurnDirection): void {
    this.yawFrom = this.yaw;
    this.yawTo = this.yawFrom + turnYawDelta(direction);
    this.turnElapsed = 0;
  }

  /**
   * Where on screen the next-piece preview should be drawn, in CSS pixels, and
   * what it should show. Null hides it.
   */
  setPreview(rect: PreviewRect | null, cells: readonly Cell[], lane: number): void {
    this.previewRect = rect;
    this.preview.setPiece(cells, lane);
  }

  /**
   * Hold or release Peek. Changes no game state -- the camera moves and nothing
   * else does, which is what makes it safe to offer at all.
   */
  setPeek(held: boolean): void {
    this.peekHeld = held;
  }

  /** Whether the camera is currently away from dead-on because of Peek. */
  get peeking(): boolean {
    return this.peek > 0;
  }

  /**
   * Take the well away for the front door, or bring it back.
   *
   * The gate shows no board at all now -- there is no composed arrangement in it,
   * and an empty box drawn in outline behind the wordmark is worse than nothing.
   * So the frame and the corner posts fade out and the room carries the picture
   * on its own.
   *
   * This used to zoom the camera as well, back when there *was* a stack to push
   * past the edges of the frame. With the stack gone the zoom was magnifying an
   * empty well and throwing the room's drifting voxels outside the viewport, so
   * it is gone too. Eased rather than switched, so the well arrives with the menu
   * rather than appearing on the same frame as it.
   */
  setBackdrop(on: boolean): void {
    this.backdropHeld = on;
  }

  /**
   * Let the front door's floaters bloom.
   *
   * In a run the threshold sits just under white so that *only* a clear's
   * additive glow or the Full Spectrum whiteout ever blooms — that restraint is
   * the reason the settled board looks like tiles rather than neon, and it stays.
   * A screen with no board on it has nothing to protect, and the floating cages
   * are lines a pixel wide: without bloom they read as wire, and the whole point
   * of them is that they read as light.
   *
   * Stepped with the backdrop's own ease so the two arrive together rather than
   * one snapping while the other glides.
   */
  private applyBloom(): void {
    const eased = easeInOutCubic(this.backdrop);
    this.bloomPass.threshold = THREE.MathUtils.lerp(BLOOM_THRESHOLD, FRONT_BLOOM_THRESHOLD, eased);
    this.bloomPass.strength = THREE.MathUtils.lerp(BLOOM_STRENGTH, FRONT_BLOOM_STRENGTH, eased);
    this.bloomPass.radius = THREE.MathUtils.lerp(BLOOM_RADIUS, FRONT_BLOOM_RADIUS, eased);
  }

  /**
   * Whether the room's drifting voxels may carry the spectrum.
   *
   * Separate from `setBackdrop` on purpose, even though the menus turn both on:
   * one is a camera framing and the other is a palette permission, and the
   * screens they belong to are not guaranteed to stay the same. Folding them
   * into one flag would make the next change to either a change to both.
   */
  setAmbientChroma(on: boolean): void {
    this.environment.setChroma(on);
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
    this.preview.setDepthColour(this.prefs.depthColour);
    this.preview.setSpinning(this.prefs.spinPreview);
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
    fitCamera(this.camera, this.aspect, this.bottomReservePx, height);
  }

  /**
   * Keep this many pixels clear at the bottom of the window.
   *
   * Set from the touch strip, which is a region rather than an element -- so
   * nothing lays out around it and the board has to be told. Takes effect on the
   * next resize, and triggers one, because the alternative is a frame drawn with
   * the old framing.
   */
  setBottomReserve(px: number): void {
    const next = Math.max(0, px);
    if (next === this.bottomReservePx) return;
    this.bottomReservePx = next;
    this.resize();
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
    // Peek eases toward its tilt while held and back when released. It adds to
    // the turn's own elevation rather than replacing it, so letting go mid-turn
    // cannot snap the camera through the rotation.
    const peekStep = deltaMs / PEEK_EASE_MS;
    this.peek = THREE.MathUtils.clamp(this.peek + (this.peekHeld ? peekStep : -peekStep), 0, 1);
    const elevation =
      TURN_ELEVATION_DEG * dimensional + PEEK_ELEVATION_DEG * easeInOutCubic(this.peek);
    positionCamera(this.camera, yaw, elevation, this.shakeOffset);

    // The front door takes the well away. Eased on the same principle as Peek,
    // and slower, because this one is a scene change rather than a held look.
    const backdropStep = deltaMs / BACKDROP_EASE_MS;
    this.backdrop = THREE.MathUtils.clamp(
      this.backdrop + (this.backdropHeld ? backdropStep : -backdropStep),
      0,
      1
    );
    this.applyBloom();
    orientLights(this.lights, yaw);
    // The gel's own light travels with them, for the same reason they travel
    // with the camera: otherwise the material's highlight lands somewhere
    // different on each of the four faces.
    setGelYaw(yaw);
    setLightingFlatness(this.lights, flatness);
    setWellFlatness(this.well, flatness, easeInOutCubic(this.backdrop));
    orientWell(this.well, yaw);
    this.scene.background = this.environment.backdrop;
    // The panel dips during Prism so the whiteout can still wash the column.
    orientColumnPanel(this.columnPanel, yaw, 0.62 * (1 - whiteout * 0.7));

    const bands = partitionBoard(game);
    this.lockedXray.update(bands.xray, yaw, separation, whiteout);
    this.lockedXrayEdges.update(bands.xray, game.face, yaw);
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
    this.environment.setFlatness(flatness);
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

    // After the board, and after the bloom chain: the preview is a diagram, not
    // part of the scene, and it must not be swept into a whiteout meant for the
    // playfield.
    this.preview.update(deltaMs);
    if (this.previewRect) {
      this.preview.render(this.renderer, this.previewRect);
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
    this.preview.dispose();
    this.environment.dispose();
    this.debris.dispose();
    this.columnPanel.geometry.dispose();
    (this.columnPanel.material as THREE.Material).dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
