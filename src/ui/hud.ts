/**
 * The HUD.
 *
 * Plain DOM over the canvas: it is sharper than canvas-drawn text at any pixel
 * ratio, and it is readable by assistive technology for free. Like the renderer,
 * it only ever reads game state.
 */

import type { Game } from '@core/game';
import { DEPTH_LANES } from '@core/constants';
import { PIECES_BY_ID, extent, normalize } from '@core/pieces';
import type { PieceId } from '@core/pieces';
import { depthColorHex, laneToDepthParameter } from '@core/spectrum';
import type { Cell, Face } from '@core/types';

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
function renderPiecePreview(cells: readonly Cell[], lane: number): HTMLElement {
  const shape = normalize([...cells]);
  const size = extent(shape);
  const grid = element('div', 'piece');
  grid.style.gridTemplateColumns = `repeat(${size.x}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${size.y}, 1fr)`;

  // Nearest cube wins each screen cell, exactly as the renderer draws it.
  const nearest = new Map<string, number>();
  for (const cube of shape) {
    const key = `${cube.x},${cube.y}`;
    const depth = Math.min(nearest.get(key) ?? Infinity, cube.z);
    nearest.set(key, depth);
  }

  for (let y = size.y - 1; y >= 0; y -= 1) {
    for (let x = 0; x < size.x; x += 1) {
      const cube = element('span', 'piece__cell');
      const depth = nearest.get(`${x},${y}`);
      if (depth !== undefined) {
        const t = laneToDepthParameter(Math.min(lane + depth, DEPTH_LANES - 1), DEPTH_LANES);
        cube.style.background = depthColorHex(t);
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
  private readonly stage = element('span', 'stat__value', 'Red');
  private readonly face = element('span', 'hud__face', 'FRONT');
  private readonly meter = element('div', 'meter');
  private readonly nextSlot = element('div', 'slot__body');
  private readonly holdSlot = element('div', 'slot__body');
  private readonly chain = element('div', 'chain');
  private readonly banner = element('div', 'banner');
  private readonly prompt = element('div', 'prompt');
  private readonly overlay = element('div', 'overlay');

  readonly root = element('div', 'hud');

  private bannerTimer = 0;

  constructor() {
    const stats = element('div', 'hud__stats');
    stats.append(
      this.stat('SCORE', this.score),
      this.stat('LINES', this.lines),
      this.stat('STAGE', this.stage)
    );

    const shift = element('div', 'hud__shift');
    shift.append(element('span', 'hud__label', 'SHIFT'), this.meter);

    const left = element('div', 'hud__column hud__column--left');
    left.append(stats, shift);

    const next = element('div', 'slot');
    next.append(element('span', 'hud__label', 'NEXT'), this.nextSlot);
    const hold = element('div', 'slot');
    hold.append(element('span', 'hud__label', 'HOLD'), this.holdSlot);

    const right = element('div', 'hud__column hud__column--right');
    right.append(this.face, next, hold);

    this.chain.hidden = true;

    const pill = element('div', 'prompt__pill');
    pill.append(
      element('span', 'prompt__arrow', '←'),
      element('span', 'prompt__text', 'CHOOSE A FACE'),
      element('span', 'prompt__arrow', '→')
    );
    this.prompt.append(pill);
    this.prompt.hidden = true;
    this.overlay.hidden = true;
    this.banner.hidden = true;

    this.root.append(left, right, this.chain, this.banner, this.prompt, this.overlay);
  }

  private stat(label: string, value: HTMLElement): HTMLElement {
    const wrapper = element('div', 'stat');
    wrapper.append(element('span', 'stat__label', label), value);
    return wrapper;
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

  update(game: Game, deltaMs: number): void {
    this.score.textContent = game.score.toLocaleString('en-US');
    this.lines.textContent = String(game.lines);
    this.stage.textContent = game.stage.name;
    this.face.textContent = FACE_LABEL[game.face];

    this.renderMeter(game);
    this.renderSlots(game);

    // The chain is the reward for turning into a clear over and over, so it is
    // worth showing while it is alive rather than only in the score.
    this.chain.hidden = game.refractionChain < 1;
    this.chain.textContent = `REFRACTION CHAIN ×${game.refractionChain}`;

    this.prompt.hidden = game.status !== 'awaitingTurn';
    this.overlay.hidden = game.status !== 'gameOver';
    if (game.status === 'gameOver' && this.overlay.childElementCount === 0) {
      this.overlay.append(
        element('h2', 'overlay__title', 'GAME OVER'),
        element('p', 'overlay__score', `${game.score.toLocaleString('en-US')} points`),
        element('p', 'overlay__hint', 'Press R to play again')
      );
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= deltaMs;
      if (this.bannerTimer <= 0) this.banner.hidden = true;
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
      next ? renderPiecePreview(next.def.cells, next.lane) : element('div', 'piece')
    );

    const held = game.held;
    this.holdSlot.replaceChildren(
      held ? renderPiecePreview(pieceCellsFor(held), 0) : element('div', 'piece')
    );
  }
}

/** Look up a piece's cubes by id, for the hold slot. */
function pieceCellsFor(id: PieceId): readonly Cell[] {
  return PIECES_BY_ID.get(id)?.cells ?? [];
}
