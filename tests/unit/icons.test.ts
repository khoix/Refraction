/**
 * The page icon is the title's O.
 *
 * The first favicon was a rounded square swept through the spectrum. It said
 * "colour" and not "this game". The mark that does both jobs is already on the
 * wordmark: a corner-on voxel standing in for the letter O. These tests hold
 * the favicon and the apple-touch source to that same silhouette, so a later
 * tweak to the cube cannot leave the tab icon drawing a different one.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function pathD(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1] as string);
}

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]+)`));
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1];
}

describe('page icons', () => {
  const wordmark = read('src/ui/screens.ts');
  const favicon = read('public/favicon.svg');
  const touch = read('public/apple-touch-icon.svg');
  const css = read('src/styles/app.css');
  const voxel = pathD(wordmark);

  it('draws the wordmark voxel, not a spectrum square', () => {
    // Five paths: three faces, the hexagonal silhouette, the internal Y.
    expect(voxel).toHaveLength(5);
    expect(pathD(favicon)).toEqual(voxel);
    expect(pathD(touch)).toEqual(voxel);
    expect(favicon).not.toContain('linearGradient');
    expect(touch).not.toContain('linearGradient');
  });

  it('wears the beam colour on the HUD ground', () => {
    const beam = token(css, '--accent-beam');
    const ground = token(css, '--surface-deep');
    expect(favicon).toContain(beam);
    expect(favicon).toContain(ground);
    expect(touch).toContain(beam);
    expect(touch).toContain(ground);
  });

  it('is declared on both shells, with a 180px apple-touch PNG', () => {
    for (const page of ['index.html', 'effects.html']) {
      const html = read(page);
      expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
      expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    }

    const png = readFileSync(resolve(root, 'public/apple-touch-icon.png'));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: signature 8, length 4, type 4, then width and height.
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
  });
});
