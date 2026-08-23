/**
 * Touch gesture recognition.
 *
 * Pure: pointer samples + layout → intents. Two schemes:
 *
 * **roll** (Flatland): no strip — drag anywhere to move, fling to hard-drop,
 * tap left/right of centre to roll, two-finger vertical swipe to peek.
 *
 * **full** (every other mode): single-finger swipe translates (columns + depth);
 * tap hits the wedge map for rotate; two-finger vertical swipe soft/hard drops.
 */

import { hitWedge, wedgeLayout } from './wedges';
import type { WedgeId } from './wedges';

export const TAP_SLOP_PX = 12;
export const TAP_MAX_MS = 400;
export const SWIPE_MIN_PX = 30;
export const FLING_MIN_PX = 44;
export const FLING_MAX_MS = 320;
export const FLING_ASPECT = 1.4;
export const SOFT_DROP_STEP_PX = 22;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type TouchScheme = 'roll' | 'full';

export interface TouchLayout {
  readonly well: Rect;
  /**
   * Legacy strip top for documentation / tests of the old split. Roll scheme
   * ignores it (always null in production). Full scheme ignores it.
   */
  readonly stripTop: number | null;
  readonly columns: number;
  readonly pxPerColumn: number;
  readonly scheme: TouchScheme;
  /** Viewport size for wedge hit-testing (full scheme). */
  readonly viewport: { readonly width: number; readonly height: number };
}

export interface Sample {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  /** Pointer id; used to count fingers for two-finger drops. */
  readonly id?: number;
}

export type TouchIntent =
  | { readonly kind: 'columnStep'; readonly steps: number }
  | { readonly kind: 'laneStep'; readonly steps: number }
  | { readonly kind: 'softDrop' }
  | { readonly kind: 'hardDrop' }
  | { readonly kind: 'peek'; readonly held: boolean }
  | {
      readonly kind: 'rotate';
      readonly axis: 'roll' | 'yaw' | 'pitch';
      readonly clockwise: boolean;
    };

type Zone = 'strip' | 'field';

interface Active {
  readonly start: Sample;
  readonly zone: Zone;
  originX: number;
  originY: number;
  reportedX: number;
  reportedY: number;
  softDropAnchor: number;
  laneLocked: boolean;
  moved: boolean;
  /** Full scheme: two-finger drop. Roll scheme: two-finger peek. */
  twoFinger: boolean;
  peeking: boolean;
  /** Roll two-finger peek: centroid at promotion. */
  peekAnchorY: number;
  primaryY: number;
  secondaryY: number;
}

export class GestureRecogniser {
  private active: Active | null = null;
  /** Second finger for two-finger drops (full scheme). */
  private secondary: Sample | null = null;

  begin(sample: Sample, layout: TouchLayout): TouchIntent[] {
    if (this.active && !this.active.twoFinger) {
      if (layout.scheme === 'full') {
        // Second finger down while first is active → promote to two-finger drop.
        this.secondary = sample;
        this.active.twoFinger = true;
        this.active.softDropAnchor = Math.min(this.active.start.y, sample.y);
        const intents: TouchIntent[] = [];
        if (this.active.peeking) {
          this.active.peeking = false;
          intents.push({ kind: 'peek', held: false });
        }
        return intents;
      }
      if (layout.scheme === 'roll') {
        this.secondary = sample;
        this.active.twoFinger = true;
        this.active.peekAnchorY = (this.active.start.y + sample.y) / 2;
        this.active.primaryY = this.active.start.y;
        this.active.secondaryY = sample.y;
        return [];
      }
    }

    const zone: Zone =
      layout.scheme === 'roll' || layout.stripTop === null || sample.y >= (layout.stripTop ?? 0)
        ? 'strip'
        : 'field';
    this.active = {
      start: sample,
      zone,
      originX: sample.x,
      originY: sample.y,
      reportedX: 0,
      reportedY: 0,
      softDropAnchor: sample.y,
      laneLocked: false,
      moved: false,
      twoFinger: false,
      peeking: false,
      peekAnchorY: 0,
      primaryY: sample.y,
      secondaryY: sample.y,
    };
    this.secondary = null;
    return [];
  }

  move(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const active = this.active;
    if (!active) return [];

    if (layout.scheme === 'full') {
      return this.moveFull(sample, layout, active);
    }
    return this.moveRoll(sample, layout, active);
  }

  end(sample: Sample, layout: TouchLayout): TouchIntent[] {
    if (layout.scheme === 'full') {
      return this.endFull(sample, layout);
    }
    return this.endRoll(sample, layout);
  }

  cancel(): void {
    this.active = null;
    this.secondary = null;
  }

  // ------------------------------------------------------------------- roll

  private moveRoll(sample: Sample, layout: TouchLayout, active: Active): TouchIntent[] {
    if (active.twoFinger) {
      if (sample.id === active.start.id) active.primaryY = sample.y;
      else if (this.secondary?.id === sample.id) {
        this.secondary = sample;
        active.secondaryY = sample.y;
      }
      const centroid = (active.primaryY + active.secondaryY) / 2;
      const intents: TouchIntent[] = [];
      if (Math.abs(centroid - active.peekAnchorY) > TAP_SLOP_PX && !active.peeking) {
        active.peeking = true;
        intents.push({ kind: 'peek', held: true });
      }
      active.moved = true;
      return intents;
    }

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) active.moved = true;
    if (active.zone !== 'strip' || !active.moved) return [];

    const intents: TouchIntent[] = [];

    while (sample.y - active.softDropAnchor >= SOFT_DROP_STEP_PX) {
      active.softDropAnchor += SOFT_DROP_STEP_PX;
      intents.push({ kind: 'softDrop' });
      active.laneLocked = true;
    }
    if (sample.y < active.softDropAnchor) {
      active.softDropAnchor = sample.y;
      if (active.laneLocked) {
        active.laneLocked = false;
        active.originX = sample.x;
        active.reportedX = 0;
      }
    }

    if (active.laneLocked) {
      active.originX = sample.x;
      active.reportedX = 0;
    } else {
      const travelled = Math.round((sample.x - active.originX) / Math.max(1, layout.pxPerColumn));
      if (travelled !== active.reportedX) {
        intents.push({ kind: 'columnStep', steps: travelled - active.reportedX });
        active.reportedX = travelled;
      }
    }

    return intents;
  }

  private endRoll(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const active = this.active;
    if (active?.twoFinger) {
      const intents: TouchIntent[] = [];
      if (active.peeking) intents.push({ kind: 'peek', held: false });
      this.active = null;
      this.secondary = null;
      return intents;
    }

    this.active = null;
    if (!active) return [];

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    const elapsed = sample.t - active.start.t;
    const travelled = Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX;

    if (!travelled) {
      if (elapsed > TAP_MAX_MS) return [];
      if (layout.stripTop !== null && active.zone !== 'field') return [];
      const centre = layout.well.left + layout.well.width / 2;
      return [{ kind: 'rotate', axis: 'roll', clockwise: sample.x >= centre }];
    }

    if (active.zone === 'strip') {
      const fling =
        dy >= FLING_MIN_PX && elapsed <= FLING_MAX_MS && Math.abs(dy) > Math.abs(dx) * FLING_ASPECT;
      return fling ? [{ kind: 'hardDrop' }] : [];
    }

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (Math.abs(dx) < SWIPE_MIN_PX) return [];
      return [{ kind: 'rotate', axis: 'yaw', clockwise: dx > 0 }];
    }
    if (Math.abs(dy) < SWIPE_MIN_PX) return [];
    return [{ kind: 'rotate', axis: 'pitch', clockwise: dy < 0 }];
  }

  // ------------------------------------------------------------------- full

  private moveFull(sample: Sample, layout: TouchLayout, active: Active): TouchIntent[] {
    const intents: TouchIntent[] = [];

    if (active.twoFinger) {
      const y = this.secondary ? Math.max(sample.y, this.secondary.y) : sample.y;
      // Track whichever finger moved; secondary updates on its own move calls
      // via begin's sample — controller should call move with each pointer.
      while (y - active.softDropAnchor >= SOFT_DROP_STEP_PX) {
        active.softDropAnchor += SOFT_DROP_STEP_PX;
        intents.push({ kind: 'softDrop' });
      }
      active.moved = true;
      return intents;
    }

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) active.moved = true;
    if (!active.moved) return intents;

    const px = Math.max(1, layout.pxPerColumn);
    const colTotal = Math.round((sample.x - active.originX) / px);
    // Up = push deeper (negative screen dy).
    const laneTotal = Math.round(-(sample.y - active.originY) / px);

    if (colTotal !== active.reportedX) {
      intents.push({ kind: 'columnStep', steps: colTotal - active.reportedX });
      active.reportedX = colTotal;
    }
    if (laneTotal !== active.reportedY) {
      intents.push({ kind: 'laneStep', steps: laneTotal - active.reportedY });
      active.reportedY = laneTotal;
      // Auto-peek while depth-swiping.
      if (!active.peeking && Math.abs(laneTotal) > 0) {
        active.peeking = true;
        intents.push({ kind: 'peek', held: true });
      }
    }

    return intents;
  }

  private endFull(sample: Sample, layout: TouchLayout): TouchIntent[] {
    const active = this.active;
    const intents: TouchIntent[] = [];

    // If ending the secondary finger, keep primary alive.
    if (active?.twoFinger && this.secondary && sample.id !== undefined) {
      if (sample.id === this.secondary.id) {
        this.secondary = null;
        // Check fling on the pair using primary start → this sample.
        const dy = sample.y - active.start.y;
        const elapsed = sample.t - active.start.t;
        const fling =
          dy >= FLING_MIN_PX &&
          elapsed <= FLING_MAX_MS &&
          Math.abs(dy) > Math.abs(sample.x - active.start.x) * FLING_ASPECT;
        this.active = null;
        if (active.peeking) intents.push({ kind: 'peek', held: false });
        if (fling) intents.push({ kind: 'hardDrop' });
        return intents;
      }
    }

    this.active = null;
    this.secondary = null;
    if (!active) return intents;

    if (active.peeking) intents.push({ kind: 'peek', held: false });

    if (active.twoFinger) {
      const dy = sample.y - active.start.y;
      const elapsed = sample.t - active.start.t;
      const fling =
        dy >= FLING_MIN_PX &&
        elapsed <= FLING_MAX_MS &&
        Math.abs(dy) > Math.abs(sample.x - active.start.x) * FLING_ASPECT;
      if (fling) intents.push({ kind: 'hardDrop' });
      return intents;
    }

    const dx = sample.x - active.start.x;
    const dy = sample.y - active.start.y;
    const elapsed = sample.t - active.start.t;
    const travelled = Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX;

    if (!travelled) {
      if (elapsed > TAP_MAX_MS) return intents;
      const layoutW = wedgeLayout(layout.viewport.width, layout.viewport.height);
      const wedge = hitWedge(sample.x, sample.y, layoutW);
      if (!wedge) return intents;
      intents.push(wedgeToRotate(wedge));
      return intents;
    }

    return intents;
  }
}

function wedgeToRotate(wedge: WedgeId): Extract<TouchIntent, { kind: 'rotate' }> {
  switch (wedge) {
    case 'rollClock':
      return { kind: 'rotate', axis: 'roll', clockwise: true };
    case 'rollAnti':
      return { kind: 'rotate', axis: 'roll', clockwise: false };
    case 'yawClock':
      return { kind: 'rotate', axis: 'yaw', clockwise: true };
    case 'yawAnti':
      return { kind: 'rotate', axis: 'yaw', clockwise: false };
    case 'pitchUp':
      return { kind: 'rotate', axis: 'pitch', clockwise: true };
    case 'pitchDown':
      return { kind: 'rotate', axis: 'pitch', clockwise: false };
  }
}
