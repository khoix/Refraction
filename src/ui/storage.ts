/**
 * The browser half of persistence.
 *
 * Everything that can go wrong with `localStorage` goes wrong here and nowhere
 * else: it is absent in some embeddings, throws on access under strict privacy
 * settings, throws on write when the quota is full, and can hand back a partial
 * string. All of that is swallowed. The game runs identically with storage
 * unavailable -- it simply forgets.
 *
 * The parsing and repair live in `@core/save`, which knows nothing about
 * browsers and is tested without one.
 */

import { SAVE_KEY, defaultSave, migrate } from '@core/save';
import type { SaveData } from '@core/save';

/** Whether the last write succeeded. Surfaced in settings, not in the way. */
let writable = true;

export function storageAvailable(): boolean {
  return writable;
}

function backing(): Storage | null {
  try {
    // Touching `localStorage` at all throws in some privacy modes, so even the
    // existence check has to be guarded.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData {
  const store = backing();
  if (!store) {
    writable = false;
    return defaultSave();
  }
  try {
    return migrate(store.getItem(SAVE_KEY));
  } catch {
    // A read failure is not a reason to refuse to play.
    return defaultSave();
  }
}

export function persistSave(save: SaveData): boolean {
  const store = backing();
  if (!store) {
    writable = false;
    return false;
  }
  try {
    store.setItem(SAVE_KEY, JSON.stringify(save));
    writable = true;
    return true;
  } catch {
    // Quota exceeded, or a storage partition that reads but will not write.
    writable = false;
    return false;
  }
}

export function clearSave(): void {
  const store = backing();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do; the caller already holds the in-memory default.
  }
}
