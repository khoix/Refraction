/** Scene, camera and the static furniture of the well. */

import * as THREE from 'three';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';

/**
 * The board presents as flat 2D and only becomes visibly three-dimensional
 * while it turns.
 *
 * A cube viewed dead-on through an orthographic camera is indistinguishable
 * from a flat square, so nothing about the geometry changes between the two
 * looks. What changes is the camera and the lighting:
 *
 *              settled             mid-turn
 *   field      5 deg (near-ortho)  30 deg (real perspective)
 *   elevation  0 deg (dead-on)     14 deg (tops of cubes visible)
 *   lighting   flat ambient        directional key and rim
 *   size       uniform             scaled by depth
 *   well       flat frame only     floor, grid and far posts
 *
 * The camera distance is refitted as the field of view opens, so the board
 * holds its apparent size and the change reads as perspective arriving rather
 * than as a zoom.
 */
export const FLAT_FOV = 5;
export const TURN_FOV = 30;
export const FLAT_ELEVATION_DEG = 0;
export const TURN_ELEVATION_DEG = 14;

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

export interface SceneBundle {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly well: Well;
  readonly lights: SceneLights;
}

export interface Well {
  readonly group: THREE.Group;
  /** The flat silhouette of the playfield. Visible in both looks. */
  readonly frame: THREE.LineSegments;
  /** Floor, grid and the far posts -- all of which read as depth cues. */
  readonly depthFurniture: THREE.Object3D[];
}

export interface SceneLights {
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  /** Shadowless fill. At full strength every face lights alike and cubes read flat. */
  readonly fill: THREE.AmbientLight;
}

/** Light positions at yaw 0, rotated with the camera by `orientLights`. */
const KEY_LIGHT_BASE: readonly [number, number, number] = [6, 18, 14];
const RIM_LIGHT_BASE: readonly [number, number, number] = [-10, 6, -12];

function lineSegments(points: number[], color: number, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

function buildWell(): Well {
  const group = new THREE.Group();

  const halfW = BOARD_WIDTH / 2;
  const halfD = BOARD_DEPTH / 2;
  const floorY = toSceneY(0) - 0.5;
  const topY = toSceneY(BOARD_HEIGHT - 1) + 0.5;

  // The frame is the playfield's flat silhouette: two uprights and a floor line,
  // drawn at the near edge so it stays a clean rectangle head-on.
  const framePoints: number[] = [];
  for (const sx of [-1, 1]) {
    framePoints.push(sx * halfW, floorY, halfD, sx * halfW, topY, halfD);
  }
  framePoints.push(-halfW, floorY, halfD, halfW, floorY, halfD);
  const frame = lineSegments(framePoints, 0x323b5c, 0.7);
  group.add(frame);

  // Everything below is a depth cue and is therefore hidden while the board is
  // presenting itself as flat. It fades in exactly as the cubes gain volume.
  const gridPoints: number[] = [];
  for (let i = 0; i <= BOARD_WIDTH; i += 1) {
    gridPoints.push(-halfW + i, floorY, -halfD, -halfW + i, floorY, halfD);
  }
  for (let i = 0; i <= BOARD_DEPTH; i += 1) {
    gridPoints.push(-halfW, floorY, -halfD + i, halfW, floorY, -halfD + i);
  }
  const grid = lineSegments(gridPoints, 0x2a3350, 0.85);

  const backPostPoints: number[] = [];
  for (const sx of [-1, 1]) {
    backPostPoints.push(sx * halfW, floorY, -halfD, sx * halfW, topY, -halfD);
  }
  const backPosts = lineSegments(backPostPoints, 0x323b5c, 0.45);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_DEPTH),
    new THREE.MeshStandardMaterial({
      color: 0x0a0d18,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY - 0.01;

  group.add(grid, backPosts, floor);

  return { group, frame, depthFurniture: [grid, backPosts, floor] };
}

/**
 * Keep the flat frame on the near edge of whichever face is being viewed.
 *
 * The frame is built along one edge, which is only correct for the front face:
 * from the left face both of its uprights would collapse onto the same screen
 * position and the playfield would lose an edge. Rotating it with the camera
 * works because the footprint is square, so the frame always overlays the
 * board's silhouette exactly.
 */
export function orientWell(well: Well, yawDegrees: number): void {
  well.frame.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
}

/** Hide the well's depth cues while the board is presenting as flat. */
export function setWellFlatness(well: Well, flatness: number): void {
  const dimensional = 1 - THREE.MathUtils.clamp(flatness, 0, 1);
  for (const object of well.depthFurniture) {
    const material = (object as THREE.Mesh | THREE.LineSegments).material as THREE.Material & {
      userData: { baseOpacity?: number };
    };
    material.userData.baseOpacity ??= material.opacity;
    material.opacity = (material.userData.baseOpacity ?? 1) * dimensional;
    object.visible = dimensional > 0.01;
  }
}

export function createScene(): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  // No fog: the near-orthographic camera sits far enough away that any
  // distance-based fade would swallow the whole board.

  const camera = new THREE.PerspectiveCamera(FLAT_FOV, 1, 10, 700);

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
 * are unmistakably solid.
 */
export function setLightingFlatness(lights: SceneLights, flatness: number): void {
  const flat = THREE.MathUtils.clamp(flatness, 0, 1);
  const dimensional = 1 - flat;

  lights.fill.intensity = THREE.MathUtils.lerp(0.5, 1.18, flat);
  lights.key.intensity = 1.65 * dimensional;
  lights.rim.intensity = 0.8 * dimensional;
}

/** Distance at which the whole well fits the viewport at this field of view. */
export function fitDistance(aspect: number, fovDegrees: number): number {
  const halfFovY = THREE.MathUtils.degToRad(fovDegrees) / 2;
  const neededForHeight = (BOARD_HEIGHT / 2 + FIT_MARGIN) / Math.tan(halfFovY);
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  // The widest silhouette is the board's diagonal, seen at 45 degrees of yaw.
  const halfWidth = Math.SQRT1_2 * Math.hypot(BOARD_WIDTH, BOARD_DEPTH);
  const neededForWidth = (halfWidth / 2 + FIT_MARGIN) / Math.tan(halfFovX);
  return Math.max(neededForHeight, neededForWidth);
}

/**
 * Place the camera for a yaw in degrees.
 *
 * Matches `projection.depthParameterAtYaw`'s convention exactly: the camera sits
 * toward `(sin(yaw), 0, cos(yaw))`. Sharing the convention is what guarantees a
 * cube's colour mid-turn converges on its colour when the turn snaps.
 */
export function positionCamera(
  camera: THREE.PerspectiveCamera,
  yawDegrees: number,
  distance: number,
  elevationDegrees: number
): void {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const horizontal = distance * Math.cos(elevation);

  camera.position.set(
    horizontal * Math.sin(yaw),
    distance * Math.sin(elevation),
    horizontal * Math.cos(yaw)
  );
  camera.lookAt(0, 0, 0);
}
