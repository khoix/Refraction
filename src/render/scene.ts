/**
 * Scene, camera and the static furniture of the well.
 *
 * Depth is a game mechanic here, not a simulation of space.
 *
 * The projection is **orthographic and stays orthographic**. A cube eight lanes
 * back is exactly the same size on screen as one at the front, and sits at the
 * same height; nothing about it says "far away". The only thing that changes
 * with depth is colour. That is the rule the whole game rests on, and any
 * perspective foreshortening or size falloff would quietly undermine it by
 * offering a second, more familiar depth cue for the player to lean on.
 *
 * The board therefore reads as flat 2D when settled: dead-on, orthographic,
 * uniformly lit, so every cube is a flat coloured tile. Turning orbits the
 * camera in yaw only. Cubes become visibly cubes because their side faces come
 * into view and the stack separates horizontally -- both genuine consequences of
 * the rotation, neither of them a distance cue.
 *
 *              settled              mid-turn
 *   projection orthographic         orthographic (unchanged)
 *   size       uniform              uniform (unchanged)
 *   yaw        exactly on a face    sweeping 90 degrees
 *   elevation  0 (dead-on)          12 degrees
 *   lighting   flat ambient         directional key and rim
 *   well       flat frame           plus the box posts
 *
 * The one concession is that mid-turn elevation. Dead level, a cube never shows
 * its top face and the rotating stack reads as a squashed mosaic rather than as
 * cubes. Twelve degrees is enough to see the tops and tell them apart. It costs
 * nothing in the rule above -- orthographic means a far cube is still exactly
 * the size of a near one -- and it returns to zero the moment the board settles,
 * so a face at rest never offers any spatial cue at all. Set TURN_ELEVATION_DEG
 * to 0 to remove it entirely.
 */

import * as THREE from 'three';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';

/** Distance from the board centre. Orthographic, so this only affects clipping. */
const CAMERA_DISTANCE = 60;

/** Camera elevation at the midpoint of a turn. Zero while settled. */
export const TURN_ELEVATION_DEG = 12;

/** Empty space kept around the well when fitting the camera. */
const FIT_MARGIN = 1.6;
/**
 * Room left below the board, in board cells, for the Shift meter.
 *
 * The meter is positioned from the board's on-screen silhouette, so if the
 * camera frames the board symmetrically there is nowhere for it to go and it
 * falls off the bottom of the window. Rather than shrink the board on every
 * axis, the frustum is shifted down by half this amount: the board keeps its
 * size and simply sits above centre, which is how a HUD is composed anyway.
 */
const HUD_RESERVE = 1.6;

/** Board coordinates are centred on the origin so the camera can orbit simply. */
export function toSceneX(x: number): number {
  return x - (BOARD_WIDTH - 1) / 2;
}
export function toSceneY(y: number): number {
  return y - (BOARD_HEIGHT - 1) / 2;
}
export function toSceneZ(z: number): number {
  return z - (BOARD_DEPTH - 1) / 2;
}

/**
 * How wide the board's silhouette is on screen at this yaw, in board cells.
 * Widest at 45 degrees, equal to BOARD_WIDTH when settled on a face.
 */
export function projectedFootprintWidth(yawDegrees: number): number {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  return BOARD_WIDTH * Math.abs(Math.cos(yaw)) + BOARD_DEPTH * Math.abs(Math.sin(yaw));
}

/** How deep the board extends along the view direction at this yaw. */
export function projectedFootprintDepth(yawDegrees: number): number {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  return BOARD_WIDTH * Math.abs(Math.sin(yaw)) + BOARD_DEPTH * Math.abs(Math.cos(yaw));
}

/**
 * A dark panel behind the well, so the room never sits on a cube. Billboarded
 * to the camera yaw and sized to the projected footprint so it tracks the
 * silhouette as the board turns.
 *
 * It must keep its depth test. A translucent material goes into the renderer's
 * *transparent* queue, which is drawn after every opaque object regardless of
 * renderOrder -- renderOrder only sorts within a queue. With the depth test off
 * as well, this panel was therefore painted over the finished board rather than
 * behind it: a 62% wash of near-black across the whole playfield, which cut
 * every cube to a bit over a third of its colour. That is what "all the colour
 * is gone" was. Depth-tested, it draws only where no cube claimed the pixel,
 * which is the job it was meant to do. Depth writing stays off so the
 * see-through passes behind it are unaffected.
 */
export function createColumnPanel(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x07080e,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return mesh;
}

export function orientColumnPanel(mesh: THREE.Mesh, yawDegrees: number, opacity: number): void {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const width = projectedFootprintWidth(yawDegrees) + 0.9;
  const height = BOARD_HEIGHT + 1.8;
  mesh.scale.set(width, height, 1);
  mesh.rotation.y = yaw;
  const depth = projectedFootprintDepth(yawDegrees) / 2 + 0.8;
  mesh.position.set(-Math.sin(yaw) * depth, 0, -Math.cos(yaw) * depth);
  const shown = THREE.MathUtils.clamp(opacity, 0, 1);
  (mesh.material as THREE.MeshBasicMaterial).opacity = shown;
  mesh.visible = shown > 0.01;
}

export interface Well {
  readonly group: THREE.Group;
  /** The playfield's flat silhouette. Visible in both looks. */
  readonly frame: THREE.LineSegments;
  /** The box's corner posts, which only mean anything once the board turns. */
  readonly posts: THREE.LineSegments;
  /** Full cell grid on the floor and inner walls. */
  readonly grid: THREE.LineSegments;
}

export interface SceneLights {
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  /** Shadowless fill. At full strength every face lights alike and cubes read flat. */
  readonly fill: THREE.AmbientLight;
}

export interface SceneBundle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly well: Well;
  readonly lights: SceneLights;
}

const WELL_GRID_DESKTOP = { color: 0x1e263c, opacity: 0.35, faceFloor: 0.28 } as const;
/** Phones crush thin additive lines; tutorial-only so gameplay stays subtle. */
const WELL_GRID_TUTORIAL = { color: 0x6a7eb0, opacity: 0.78, faceFloor: 0.62 } as const;

/** Light positions at yaw 0, rotated with the camera by `orientLights`. */
const KEY_LIGHT_BASE: readonly [number, number, number] = [7, 14, 16];
const RIM_LIGHT_BASE: readonly [number, number, number] = [-12, 5, -10];

function lineSegments(points: number[], color: number, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  material.userData.baseOpacity = opacity;
  return new THREE.LineSegments(geometry, material);
}

function buildWell(): Well {
  const group = new THREE.Group();

  const halfW = BOARD_WIDTH / 2;
  const halfD = BOARD_DEPTH / 2;
  const floorY = toSceneY(0) - 0.5;
  const topY = toSceneY(BOARD_HEIGHT - 1) + 0.5;
  const x0 = -halfW;
  const x1 = halfW;
  const z0 = -halfD;
  const z1 = halfD;

  // The frame is the playfield's flat silhouette: two uprights and a floor line.
  // It is built along one edge and rotated to face the camera, so head-on it is
  // always a clean rectangle regardless of which face is being played.
  const framePoints: number[] = [];
  for (const sx of [-1, 1]) {
    framePoints.push(sx * halfW, floorY, halfD, sx * halfW, topY, halfD);
  }
  framePoints.push(-halfW, floorY, halfD, halfW, floorY, halfD);
  const frame = lineSegments(framePoints, 0x323b5c, 0.7);

  // The four corner posts of the box. Dead-on they hide exactly behind the
  // frame, so they are hidden while settled and faded in as the board turns,
  // where they separate and describe the volume.
  const postPoints: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      postPoints.push(sx * halfW, floorY, sz * halfD, sx * halfW, topY, sz * halfD);
    }
  }
  for (const sz of [-1, 1]) {
    postPoints.push(-halfW, floorY, sz * halfD, halfW, floorY, sz * halfD);
  }
  const posts = lineSegments(postPoints, 0x2a3350, 0.5);

  // Full cell grid on the floor and all four walls — the column's volume.
  const gridPoints: number[] = [];
  const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
    gridPoints.push(ax, ay, az, bx, by, bz);
  };
  for (let i = 0; i <= BOARD_WIDTH; i += 1) {
    const x = x0 + i;
    push(x, floorY, z0, x, floorY, z1);
  }
  for (let j = 0; j <= BOARD_DEPTH; j += 1) {
    const z = z0 + j;
    push(x0, floorY, z, x1, floorY, z);
  }
  // Vertical walls: uprights at each cell, horizontals at each row.
  for (const z of [z0, z1]) {
    for (let i = 0; i <= BOARD_WIDTH; i += 1) {
      const x = x0 + i;
      push(x, floorY, z, x, topY, z);
    }
    for (let row = 0; row <= BOARD_HEIGHT; row += 1) {
      const y = floorY + row;
      push(x0, y, z, x1, y, z);
    }
  }
  for (const x of [x0, x1]) {
    for (let j = 0; j <= BOARD_DEPTH; j += 1) {
      const z = z0 + j;
      push(x, floorY, z, x, topY, z);
    }
    for (let row = 0; row <= BOARD_HEIGHT; row += 1) {
      const y = floorY + row;
      push(x, y, z0, x, y, z1);
    }
  }
  const grid = lineSegments(gridPoints, 0x1e263c, 0.35);

  group.add(frame, posts, grid);
  return { group, frame, posts, grid };
}

export function createScene(): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  // No fog. Distance haze is a depth cue, and depth here is colour's job alone.

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);

  const fill = new THREE.AmbientLight(0xffffff, 1);
  const key = new THREE.DirectionalLight(0xffffff, 0);
  const rim = new THREE.DirectionalLight(0x8fa6ff, 0);
  scene.add(fill, key, rim);

  const lights: SceneLights = { key, rim, fill };
  orientLights(lights, 0);
  setLightingFlatness(lights, 1);

  const well = buildWell();
  scene.add(well.group);
  setWellFlatness(well, 1);

  return { scene, camera, well, lights };
}

/**
 * Size the orthographic frustum to hold the board at any yaw.
 *
 * Mid-turn the footprint presents its diagonal, so the widest the board ever
 * gets is at 45 degrees. Fitting for that once means the board never changes
 * scale during a rotation -- which matters, because a scale change would read
 * as the board moving toward or away from the player.
 */
export function fitCamera(
  camera: THREE.OrthographicCamera,
  aspect: number,
  /**
   * How much clear space the bottom of the window must hold, in CSS pixels.
   *
   * **A floor, not an addition.** The board is only pushed up if the framing
   * does not already leave this much, so a window with room to spare is framed
   * exactly as it was before this parameter existed -- which is every desktop.
   *
   * It exists because `HUD_RESERVE` is measured in *cells*, and cells shrink
   * with the window. On a phone in landscape 1.6 cells is 27 pixels against a
   * 44-pixel Shift meter, so the meter had always been drawn over the bottom
   * rows of the board there. The touch strip made the same arithmetic worse
   * rather than introducing it: a region of the window that nothing lays out
   * around, on top of a reserve that was already too small.
   */
  bottomReservePx = 0,
  /** Window height the reserve is measured against. */
  viewportPx = 0
): void {
  const base = BOARD_HEIGHT / 2 + FIT_MARGIN + HUD_RESERVE / 2;
  const widestHalfWidth = (Math.SQRT1_2 * (BOARD_WIDTH + BOARD_DEPTH)) / 2 + FIT_MARGIN;
  const safeAspect = Math.max(aspect, 0.0001);

  /**
   * The frustum for a given extra reserve, expressed as a fraction of the
   * window's height.
   *
   * Sliding the window down leaves the gap under the board rather than around
   * it, so the reserved space is where the meter and the strip actually need it.
   */
  const place = (fraction: number): { half: number; drop: number } => {
    const half = Math.max(base / (1 - fraction), widestHalfWidth / safeAspect);
    return { half, drop: HUD_RESERVE / 2 + fraction * half };
  };

  /** Clear space under the board, in CSS pixels, at a given fraction. */
  const gapPx = (fraction: number): number => {
    const { half, drop } = place(fraction);
    return ((half + drop - BOARD_HEIGHT / 2) * viewportPx) / (2 * half);
  };

  /*
   * Solved by bisection rather than in closed form.
   *
   * The map from fraction to pixels has two regimes -- the fit is limited by
   * height on a wide window and by width on a narrow one, and a phone in
   * portrait is the width-limited case -- so the algebra needs a branch and the
   * branch needs its own boundary handling. `gapPx` is smooth and strictly
   * increasing in the fraction either way, which is all bisection needs, and
   * this runs once per resize.
   */
  let fraction = 0;
  if (bottomReservePx > 0 && viewportPx > 0 && gapPx(0) < bottomReservePx) {
    const target = bottomReservePx;
    let low = 0;
    // Capped: past a third of the window the board is too small to play on, and
    // a reserve that large means the layout is wrong somewhere else.
    let high = 0.34;
    if (gapPx(high) > target) {
      for (let i = 0; i < 24; i += 1) {
        const mid = (low + high) / 2;
        if (gapPx(mid) < target) low = mid;
        else high = mid;
      }
    }
    fraction = high;
  }

  const { half, drop } = place(fraction);
  camera.top = half - drop;
  camera.bottom = -half - drop;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.updateProjectionMatrix();
}

/**
 * Orbit the camera to a yaw and elevation.
 *
 * Elevation is zero whenever the board is settled, so a face at rest is dead-on
 * and depth shows up as nothing but colour.
 */
export function positionCamera(
  camera: THREE.OrthographicCamera,
  yawDegrees: number,
  elevationDegrees: number,
  shake: { readonly x: number; readonly y: number } = { x: 0, y: 0 }
): void {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const horizontal = CAMERA_DISTANCE * Math.cos(elevation);

  camera.position.set(
    horizontal * Math.sin(yaw),
    CAMERA_DISTANCE * Math.sin(elevation),
    horizontal * Math.cos(yaw)
  );
  camera.lookAt(0, 0, 0);

  // Shake pans the camera after it is aimed, so the view slides rather than
  // tilting. Under orthographic projection a pan is a pure translation, which
  // keeps every cube exactly the size it was.
  if (shake.x !== 0 || shake.y !== 0) {
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(right, elevation);
    camera.position.addScaledVector(right, shake.x).addScaledVector(up, shake.y);
  }
}

/**
 * Rotate the lights with the camera so every face is lit the same way.
 *
 * With lights fixed in world space, orbiting to the opposite face puts the key
 * light behind the board and the whole stack goes muddy -- which would wreck the
 * one thing this game cannot afford to get wrong, since colour is how depth is
 * communicated. Keeping the rig camera-relative means all four faces read alike.
 */
export function orientLights(lights: SceneLights, yawDegrees: number): void {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const place = (light: THREE.DirectionalLight, base: readonly [number, number, number]): void => {
    const [x, y, z] = base;
    light.position.set(x * cos + z * sin, y, -x * sin + z * cos);
  };

  place(lights.key, KEY_LIGHT_BASE);
  place(lights.rim, RIM_LIGHT_BASE);
}

/**
 * Light intensity that reproduces an albedo exactly.
 *
 * Three's physical shading divides irradiance by pi (the Lambert BRDF), so an
 * ambient light of intensity 1 renders a surface at 1/pi -- under a third -- of
 * the colour it was authored in. Every level below is written as a fraction of
 * albedo and multiplied by this, because in this game a cube's colour *is* the
 * information: a settled board lit flat has to come out at the palette value the
 * spectrum ramp chose, not at some arbitrary fraction of it.
 */
const UNIT_ALBEDO = Math.PI;

/**
 * Blend the lighting between flat and dimensional.
 *
 * `flatness` of 1 is pure ambient at full strength: every face of every cube
 * receives identical light, so a cube seen dead-on is a flat coloured square,
 * exactly its depth colour, with no shading to betray its volume. At 0 the
 * directional key and rim take over and the cubes are unmistakably solid. This
 * is the only thing that makes them look like cubes -- there is no perspective
 * doing any of the work.
 *
 * The two looks are balanced to the same peak, so a face turned toward the key
 * is as bright as the same face was while settled. A turn changes how the light
 * falls, not how much of it there is -- the board must not appear to dim and
 * brighten as it rotates, because the player is reading colour off it
 * throughout.
 */
export function setLightingFlatness(lights: SceneLights, flatness: number): void {
  const flat = THREE.MathUtils.clamp(flatness, 0, 1);
  const dimensional = 1 - flat;

  // Dimensional keeps a substantial ambient floor: a face turned away from the
  // key still has to declare its depth, and a black face declares nothing.
  lights.fill.intensity = THREE.MathUtils.lerp(0.3, 1, flat) * UNIT_ALBEDO;
  lights.key.intensity = 0.7 * UNIT_ALBEDO * dimensional;
  lights.rim.intensity = 0.36 * UNIT_ALBEDO * dimensional;
}

/** Keep the flat frame on the near edge of whichever face is being viewed. */
export function orientWell(well: Well, yawDegrees: number): void {
  well.frame.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
}

/**
 * Hide the box posts while the board is presenting as flat, and take the whole
 * well away as it recedes into the front door's backdrop.
 *
 * The two are separate ideas sharing one function because they are the same
 * property: how much of the well's *structure* is on screen. Flatness governs
 * the posts alone, since they only mean anything once the board has turned.
 * `recede` governs everything, including the frame -- and it has to, because the
 * frame is precisely what makes the arrangement read as a board in a box rather
 * than as scenery. Zooming past the edges is wasted if two uprights and a floor
 * line are still drawing the box the player is looking into.
 */
export function setWellFlatness(
  well: Well,
  flatness: number,
  recede = 0,
  brightGrid = false
): void {
  const shown = 1 - THREE.MathUtils.clamp(recede, 0, 1);
  const dimensional = 1 - THREE.MathUtils.clamp(flatness, 0, 1);

  const posts = well.posts.material as THREE.LineBasicMaterial;
  const postBase = (posts.userData.baseOpacity as number | undefined) ?? 1;
  posts.opacity = postBase * dimensional * shown;
  well.posts.visible = dimensional * shown > 0.01;

  // Grid rides with the volume: faint face-on so the far wall still reads as a
  // cell lattice, full strength once the box opens mid-turn / mid-orbit.
  const gridLook = brightGrid ? WELL_GRID_TUTORIAL : WELL_GRID_DESKTOP;
  const grid = well.grid.material as THREE.LineBasicMaterial;
  grid.color.setHex(gridLook.color);
  const gridDim = gridLook.faceFloor + (1 - gridLook.faceFloor) * dimensional;
  grid.opacity = gridLook.opacity * gridDim * shown;
  well.grid.visible = shown > 0.01;

  const frame = well.frame.material as THREE.LineBasicMaterial;
  const frameBase = (frame.userData.baseOpacity as number | undefined) ?? 1;
  frame.opacity = frameBase * shown;
  well.frame.visible = shown > 0.01;
}
