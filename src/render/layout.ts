import * as THREE from 'three';

/** Same boundary as the focused landscape CSS, independent of device branding. */
export function landscapePhone(): boolean {
  return window.matchMedia('(max-height: 500px) and (min-aspect-ratio: 3/2) and (pointer: coarse)').matches;
}

/** 18 cos(12°) + 8√2 sin(12°) = 19.96 cells at the turn's tallest silhouette.
 * 20.8 leaves 0.84 cells total clearance and never changes through a turn.
 */
export function fitLandscapeCamera(camera: THREE.OrthographicCamera, aspect: number): void {
  const half = 10.4;
  camera.top = half;
  camera.bottom = -half;
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.updateProjectionMatrix();
}
