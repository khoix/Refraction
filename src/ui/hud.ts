/**
 * The HUD.
 *
 * Plain DOM over the canvas: it is sharper than canvas-drawn text at any pixel
 * ratio, and it is readable by assistive technology for free. Like the renderer,
 * it only ever reads game state.
 */

import { facePreview, type Game } from '@core/game';
import { DEPTH_LANES } from '@core/constants';
import { PIECES_BY_ID, extent, normalize } from '@core/pieces';
import type { PieceId } from '@core/pieces';
import { depthColorHex, laneToDepthParameter } from '@core/spectrum';
import type { Cell, Face } from '@core/types';

/**
 * Preview fill when depth colour is off, matching the board's neutral.
 * Kept in step with `BLIND_FILL` in `src/render/voxels.ts`.
 */
const BLIND_FILL_HEX = '#9ea3ad';

const FACE_LABEL: Record<Face, string> = {
  front: 'FRONT',
  left: 'LEFT',
  back: 'BACK',
  right: 'RIGHT',
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Front-on projection of a piece, coloured by each cube's depth lane. */
const PREVIEW_SPAN = 4;
const PREVIEW_CELL = '0.85rem';

function renderPiecePreview(
  cells: readonly Cell[],
  lane: number,
  depthColour: boolean
): HTMLElement {
  const shape = normalize([...cells]);
  const size = extent(shape);
  const grid = element('div', 'piece');
  grid.style.gridTemplateColumns = `repeat(${PREVIEW_SPAN}, ${PREVIEW_CELL})`;
  grid.style.gridTemplateRows = `repeat(${PREVIEW_SPAN}, ${PREVIEW_CELL})`;

  // Nearest cube wins each screen cell, exactly as the renderer draws it.
  const nearest = new Map<string, number>();
  for (const cube of shape) {
    const key = `${cube.x},${cube.y}`;
    const depth = Math.min(nearest.get(key) ?? Infinity, cube.z);
    nearest.set(key, depth);
  }

  // Centre the shape in a fixed 4x4 so every piece shares one baseline and
  // the slot never reflows as extents change. Tracks are explicit rem sizes
  // rather than 1fr: a 1fr row inside a stretched flex child grew while the
  // cells stayed 0.85rem, which is the gap the playtest caught.
  const originX = Math.floor((PREVIEW_SPAN - size.x) / 2);
  const originY = Math.floor((PREVIEW_SPAN - size.y) / 2);

  for (let y = PREVIEW_SPAN - 1; y >= 0; y -= 1) {
    for (let x = 0; x < PREVIEW_SPAN; x += 1) {
      const cube = element('span', 'piece__cell');
      const depth = nearest.get(`${x - originX},${y - originY}`);
      if (depth !== undefined) {
        const t = laneToDepthParameter(Math.min(lane + depth, DEPTH_LANES - 1), DEPTH_LANES);
        // In Blind Spectrum the preview must not leak what the board hides:
        // a coloured next-piece would hand back the lane the mode withholds.
        cube.style.background = depthColour ? depthColorHex(t) : BLIND_FILL_HEX;
        cube.classList.add('piece__cell--filled');
      }
      grid.append(cube);
    }
  }
  return grid;
}

export class Hud {
  private readonly score = element('span', 'stat__value', '0');
  private readonly lines = element('span', 'stat__value', '0');
  private readonly stage = element('span', 'stat__value', '1');
  private readonly face = element('span', 'hud__face hud__panel', 'FRONT');
  private readonly meter = element('div', 'meter');
  private readonly shift = element('div', 'hud__shift');
  private readonly nextSlot = element('div', 'slot__body');
  private readonly holdSlot = element('div', 'slot__body');
  private readonly chain = element('div', 'chain');
  private readonly popups = element('div', 'popups');
  private readonly mute = element('div', 'mute');
  private readonly stageBanner = element('div', 'stage-banner');
  private readonly banner = element('div', 'banner');
  private readonly prompt = element('div', 'prompt');
  private readonly promptLeft = element('span', 'prompt__face', 'LEFT');
  private readonly promptRight = element('span', 'prompt__face', 'RIGHT');

  readonly root = element('div', 'hud');

  private bannerTimer = 0;
  private stageBannerTimer = 0;
  private depthColour = true;

  constructor() {
    const stats = element('div', 'hud__stats hud__panel');
    stats.append(
      this.stat('SCORE', this.score),
      this.stat('LINES', this.lines),
      this.stat('STAGE', this.stage)
    );

    this.shift.classList.add('hud__panel');
    this.shift.append(element('span', 'hud__label', 'SHIFT'), this.meter);

    const left = element('div', 'hud__column hud__column--left');
    left.append(stats);

    const next = element('div', 'slot hud__panel');
    next.append(element('span', 'hud__label', 'NEXT'), this.nextSlot);
    const hold = element('div', 'slot hud__panel');
    hold.append(element('span', 'hud__label', 'HOLD'), this.holdSlot);

    const right = element('div', 'hud__column hud__column--right');
    right.append(this.face, next, hold);

    this.chain.hidden = true;
    this.mute.hidden = true;
    this.mute.textContent = 'MUTED';
    this.stageBanner.hidden = true;

    const pill = element('div', 'prompt__pill');
    pill.append(
      element('span', 'prompt__arrow', '←'),
      this.promptLeft,
      element('span', 'prompt__text', '·'),
      this.promptRight,
      element('span', 'prompt__arrow', '→')
    );
    this.prompt.append(pill);
    this.prompt.hidden = true;
    this.banner.hidden = true;

    this.root.append(
      left,
      right,
      this.shift,
      this.chain,
      this.popups,
      this.mute,
      this.stageBanner,
      this.banner,
      this.prompt
    );
  }

  private stat(label: string, value: HTMLElement): HTMLElement {
    const wrapper = element('div', 'stat');
    wrapper.append(element('span', 'stat__label', label), value);
    return wrapper;
  }

  /** A floating score gain, rising and fading beside the score. */
  showScorePopup(amount: number): void {
    if (amount <= 0) return;
    const popup = element('span', 'popup', `+${amount.toLocaleString('en-US')}`);
    this.popups.append(popup);
    popup.addEventListener('animationend', () => popup.remove());
  }

  /** Off in Blind Spectrum, so the previews match the board. */
  setDepthColour(enabled: boolean): void {
    this.depthColour = enabled;
  }

  setMuted(muted: boolean): void {
    this.mute.hidden = !muted;
  }

  /**
   * Announce a new stage.
   *
   * Deliberately quiet: the arc should be felt through the speed and the
   * pieces, not narrated. It is also deliberately colourless -- a stage is not
   * a place on the spectrum, and tinting this would teach the player that it
   * was.
   */
  showStageBanner(label: string): void {
    this.stageBanner.textContent = label.toUpperCase();
    this.stageBanner.hidden = false;
    this.stageBanner.classList.remove('stage-banner--pulse');
    void this.stageBanner.offsetWidth;
    this.stageBanner.classList.add('stage-banner--pulse');
    this.stageBannerTimer = 2000;
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.hidden = false;
    this.banner.classList.remove('banner--pulse');
    // Restart the animation on a repeat of the same label.
    void this.banner.offsetWidth;
    this.banner.classList.add('banner--pulse');
    this.bannerTimer = 1400;
  }

  /**
   * Park the Shift bar under the play column. `rect` is the well's silhouette
   * in viewport CSS pixels; the HUD subtracts its own origin because it is
   * width-capped and centred over a full-bleed canvas.
   */
  layoutWell(rect: { left: number; top: number; width: number; height: number }): void {
    const origin = this.root.getBoundingClientRect();
    this.shift.style.left = `${rect.left - origin.left}px`;
    this.shift.style.width = `${rect.width}px`;
    this.shift.style.top = `${rect.top + rect.height + 10 - origin.top}px`;
  }

  update(game: Game, deltaMs: number): void {
    this.score.textContent = game.score.toLocaleString('en-US');
    this.lines.textContent = String(game.lines);
    // Just the number. The label is already "STAGE"; the colour is deliberately
    // the ordinary readout colour, since colour on this screen means depth.
    this.stage.textContent = game.stage.name
      ? `${game.stage.index} · ${game.stage.name}`
      : String(game.stage.index);
    this.face.textContent = FACE_LABEL[game.face];

    this.renderMeter(game);
    this.renderSlots(game);

    // The chain is the reward for turning into a clear over and over, so it is
    // worth showing while it is alive rather than only in the score.
    this.chain.hidden = game.refractionChain < 1;
    this.chain.textContent = `REFRACTION CHAIN ×${game.refractionChain}`;

    this.prompt.hidden = game.status !== 'awaitingTurn';
    if (game.status === 'awaitingTurn') {
      this.promptLeft.textContent = FACE_LABEL[facePreview(game.face, 'left')];
      this.promptRight.textContent = FACE_LABEL[facePreview(game.face, 'right')];
    }
    // Game over is a screen now, not a HUD overlay -- see `src/ui/screens.ts`.
    // Two panels announcing the same thing was one too many, and only the
    // screen can offer the mode list and the session log.

    if (this.bannerTimer > 0) {
      this.bannerTimer -= deltaMs;
      if (this.bannerTimer <= 0) this.banner.hidden = true;
    }
    if (this.stageBannerTimer > 0) {
      this.stageBannerTimer -= deltaMs;
      if (this.stageBannerTimer <= 0) this.stageBanner.hidden = true;
    }
  }

  private renderMeter(game: Game): void {
    const total = game.stage.linesPerTurn;
    const filled = Math.min(game.shiftMeter, total);
    if (this.meter.childElementCount !== total) {
      this.meter.replaceChildren();
      for (let i = 0; i < total; i += 1) this.meter.append(element('span', 'meter__pip'));
    }
    [...this.meter.children].forEach((pip, index) => {
      pip.classList.toggle('meter__pip--on', index < filled);
    });
  }

  private renderSlots(game: Game): void {
    const next = game.preview[0];
    this.nextSlot.replaceChildren(
      next ? renderPiecePreview(next.cells, next.lane, this.depthColour) : element('div', 'piece')
    );

    const held = game.held;
    this.holdSlot.replaceChildren(
      held ? renderPiecePreview(pieceCellsFor(held), 0, this.depthColour) : element('div', 'piece')
    );
  }
}

/** Look up a piece's cubes by id, for the hold slot. */
function pieceCellsFor(id: PieceId): readonly Cell[] {
  return PIECES_BY_ID.get(id)?.cells ?? [];
}
