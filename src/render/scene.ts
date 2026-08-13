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

export interface Well {
  readonly group: THREE.Group;
  /** The playfield's flat silhouette. Visible in both looks. */
  readonly frame: THREE.LineSegments;
  /** The box's corner posts, which only mean anything once the board turns. */
  readonly posts: THREE.LineSegments;
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

  group.add(frame, posts);
  return { group, frame, posts };
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
export function fitCamera(camera: THREE.OrthographicCamera, aspect: number): void {
  const halfHeight = BOARD_HEIGHT / 2 + FIT_MARGIN;
  const widestHalfWidth = (Math.SQRT1_2 * (BOARD_WIDTH + BOARD_DEPTH)) / 2 + FIT_MARGIN;
  const half = Math.max(halfHeight, widestHalfWidth / Math.max(aspect, 0.0001));

  camera.top = half;
  camera.bottom = -half;
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
  elevationDegrees: number
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
 * Blend the lighting between flat and dimensional.
 *
 * `flatness` of 1 is pure ambient: every face of every cube receives identical
 * light, so a cube seen dead-on is a flat coloured square with no shading to
 * betray its volume. At 0 the directional key and rim take over and the cubes
 * are unmistakably solid. This is the only thing that makes them look like
 * cubes -- there is no perspective doing any of the work.
 */
export function setLightingFlatness(lights: SceneLights, flatness: number): void {
  const flat = THREE.MathUtils.clamp(flatness, 0, 1);
  const dimensional = 1 - flat;

  lights.fill.intensity = THREE.MathUtils.lerp(0.45, 1.18, flat);
  lights.key.intensity = 1.7 * dimensional;
  lights.rim.intensity = 0.85 * dimensional;
}

/** Keep the flat frame on the near edge of whichever face is being viewed. */
export function orientWell(well: Well, yawDegrees: number): void {
  well.frame.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
}

/** Hide the box posts while the board is presenting as flat. */
export function setWellFlatness(well: Well, flatness: number): void {
  const dimensional = 1 - THREE.MathUtils.clamp(flatness, 0, 1);
  const material = well.posts.material as THREE.LineBasicMaterial;
  const base = (material.userData.baseOpacity as number | undefined) ?? 1;
  material.opacity = base * dimensional;
  well.posts.visible = dimensional > 0.01;
}
