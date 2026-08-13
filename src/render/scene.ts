/**
 * Scene, camera and the static furniture of the well.
 *
 * The camera is near-orthographic on purpose: a narrow 22 degree field of view
 * from far away keeps columns reading as columns, while the small 8 degree
 * elevation shows a sliver of each cube's top face. That sliver is what makes
 * depth legible in a still frame, so colour is not carrying the whole load.
 */

import * as THREE from 'three';
import { BOARD_DEPTH, BOARD_HEIGHT, BOARD_WIDTH } from '@core/constants';

export const CAMERA_FOV = 22;
export const CAMERA_ELEVATION_DEG = 8;
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
  readonly well: THREE.Group;
  readonly lights: SceneLights;
}

export interface SceneLights {
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
}

/** Light positions at yaw 0, rotated with the camera by `orientLights`. */
const KEY_LIGHT_BASE: readonly [number, number, number] = [6, 18, 14];
const RIM_LIGHT_BASE: readonly [number, number, number] = [-10, 6, -12];

function buildWell(): THREE.Group {
  const group = new THREE.Group();

  const halfW = BOARD_WIDTH / 2;
  const halfD = BOARD_DEPTH / 2;
  const floorY = toSceneY(0) - 0.5;
  const topY = toSceneY(BOARD_HEIGHT - 1) + 0.5;

  // Floor grid. This is the anchor that makes depth absolute rather than
  // relative -- you can count lanes back from the front edge.
  const gridPoints: number[] = [];
  for (let i = 0; i <= BOARD_WIDTH; i += 1) {
    gridPoints.push(-halfW + i, floorY, -halfD, -halfW + i, floorY, halfD);
  }
  for (let i = 0; i <= BOARD_DEPTH; i += 1) {
    gridPoints.push(-halfW, floorY, -halfD + i, halfW, floorY, -halfD + i);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
  group.add(
    new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0x2a3350, transparent: true, opacity: 0.85 })
    )
  );

  // Four vertical corner posts, so the playfield reads as a volume.
  const postPoints: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      postPoints.push(sx * halfW, floorY, sz * halfD, sx * halfW, topY, sz * halfD);
    }
  }
  const postGeometry = new THREE.BufferGeometry();
  postGeometry.setAttribute('position', new THREE.Float32BufferAttribute(postPoints, 3));
  group.add(
    new THREE.LineSegments(
      postGeometry,
      new THREE.LineBasicMaterial({ color: 0x323b5c, transparent: true, opacity: 0.55 })
    )
  );

  // A dark floor plane to catch light and ground the stack.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.9, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY - 0.01;
  floor.receiveShadow = true;
  group.add(floor);

  return group;
}

export function createScene(): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.Fog(0x05060a, 60, 130);

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 500);

  // Cool sky over a warm floor bounce keeps the spectrum readable without
  // washing any band out.
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x241a2e, 1.15));

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  const rim = new THREE.DirectionalLight(0x6f8dff, 0.75);
  scene.add(key, rim);

  const lights: SceneLights = { key, rim };
  orientLights(lights, 0);

  const well = buildWell();
  scene.add(well);

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

/** Distance at which the whole well fits the viewport at this aspect ratio. */
export function fitDistance(aspect: number): number {
  const halfFovY = THREE.MathUtils.degToRad(CAMERA_FOV) / 2;
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
  distance: number
): void {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const elevation = THREE.MathUtils.degToRad(CAMERA_ELEVATION_DEG);
  const horizontal = distance * Math.cos(elevation);

  camera.position.set(
    horizontal * Math.sin(yaw),
    distance * Math.sin(elevation),
    horizontal * Math.cos(yaw)
  );
  camera.lookAt(0, 0, 0);
}
