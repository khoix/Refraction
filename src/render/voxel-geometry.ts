import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GEL_ROUNDNESS } from './gel';
type Profile = 'classic' | 'board';
const entries: Record<Profile, { geometry: RoundedBoxGeometry | null; owners: number }> = {
  classic: { geometry: null, owners: 0 },
  board: { geometry: null, owners: 0 },
};
/** Immutable unit geometry. Each owner releases exactly once. */
export function acquireVoxelGeometry(profile: Profile = 'classic'): RoundedBoxGeometry {
  const entry = entries[profile];
  entry.geometry ??= new RoundedBoxGeometry(1, 1, 1, 4, profile === 'board' ? 0.12 : GEL_ROUNDNESS);
  entry.owners++;
  return entry.geometry;
}
export function releaseVoxelGeometry(profile: Profile = 'classic'): void {
  const entry = entries[profile];
  if (--entry.owners === 0) {
    entry.geometry?.dispose();
    entry.geometry = null;
  }
}
