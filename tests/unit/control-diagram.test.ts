/**
 * Settings control diagrams — structure the player sees in the touch panel.
 *
 * These read the diagram builder source rather than mounting DOM, because the
 * unit suite runs in Node. The assertions pin the phone frame, Flatland loop,
 * and wedge map wiring that e2e only spot-checks.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_VIEW_H, DIAGRAM_VIEW_W, zoneSvgPoints } from '../../src/touch/wedges';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('touch control diagrams', () => {
  const source = read('src/ui/control-diagram.ts');

  it('draws a phone frame and Flatland gesture loop', () => {
    expect(source).toContain('phone-bezel');
    expect(source).toContain('control-diagram__wedge--flatland');
    expect(source).toContain('flatlandBuildTimeline');
    expect(source).toContain('Drag to move · tap left or right to roll');
  });

  it('labels 3D wedge zones with rotation actions, not key codes', () => {
    expect(source).toContain('ZONE_TO_WEDGE');
    expect(source).toContain('Tap Zones for');
    expect(source).toContain('wedgeLabelSvg');
    expect(source).not.toContain('wedge-dead-label');
  });

  it('uses the phone aspect viewBox shared with wedge geometry', () => {
    expect(source).toContain('DIAGRAM_VIEW_W');
    expect(source).toContain('DIAGRAM_VIEW_H');
    expect(DIAGRAM_VIEW_W).toBe(100);
    expect(DIAGRAM_VIEW_H).toBe(216);
    const points = zoneSvgPoints('Q_TOP_LEFT');
    expect(points).toMatch(/^\d+,\d+/);
  });
});
