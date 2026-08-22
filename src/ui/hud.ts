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

/** Gap kept between the Shift meter and the bottom of the window. */
const SHIFT_EDGE_MARGIN = 8;
/** Space between the well's right edge and the hot bar. */
const GAUGE_GAP = 6;
/** Space between the bottom of the well and the top of the meter. */
const SHIFT_WELL_GAP = 10;

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
  /**
   * The hot bar, pinned to the right edge of the well.
   *
   * Screen space, not world space. "Attached to the right wall" reads as part of
   * the board, and in world space it would turn with it -- sweeping away and
   * sometimes sitting behind the stack, which is unusable for a gauge read under
   * pressure. Pinned to the well's silhouette it reads as attached to the frame
   * and never rotates out of sight.
   */
  private collapseHandler: (() => void) | null = null;
  private readonly gauge = element('div', 'gauge');
  private readonly gaugeFill = element('div', 'gauge__fill');
  private readonly shift = element('div', 'hud__shift');
  private readonly nextSlot = element('div', 'slot__body');
  private nextPanel: HTMLElement = element('div');
  private spinPreview = true;
  private readonly holdSlot = element('div', 'slot__body');
  private readonly chain = element('div', 'chain');
  private readonly popups = element('div', 'popups');
  private readonly mute = element('div', 'mute');
  private readonly stageBanner = element('div', 'stage-banner');
  private readonly banner = element('div', 'banner');
  private readonly prompt = element('div', 'prompt');
  private readonly promptLeft = element('span', 'prompt__face', 'LEFT');
  private readonly promptRight = element('span', 'prompt__face', 'RIGHT');
  private turnHandler: ((direction: 'left' | 'right') => void) | null = null;
  /**
   * In-run music deck: a thin LCD with a scrolling credit and transport keys.
   * Live only while a run is on screen; the menus have no business showing it.
   */
  private readonly lcd = element('div', 'lcd');
  private readonly lcdText = element('span', 'lcd__text', '');
  private readonly lcdPlay = element('button', 'lcd__btn lcd__btn--play');
  private readonly lcdNext = element('button', 'lcd__btn lcd__btn--next');
  private musicToggle: (() => void) | null = null;
  private musicNext: (() => void) | null = null;
  /**
   * Touch-primary pause. Esc is no use on a phone, and pause is not a gesture —
   * it wants a place to live. Bottom-right, clear of the movement strip.
   */
  private readonly pauseBtn = element('button', 'hud__pause');
  private pauseHandler: (() => void) | null = null;
  /**
   * Touch-primary Spectral Collapse trigger. Slides in above the pause button
   * only while the hot bar is full — the gauge alone is a thin target under a
   * thumb, and "tap X" is a clearer spend than hoping they find the flicker.
   */
  private readonly collapseBtn = element('button', 'hud__collapse');
  private pauseVisible = false;
  private collapseReady = false;

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

    this.gauge.append(this.gaugeFill);
    this.gauge.hidden = true;
    // The gauge is read-only under a thumb. Touch spends the charge through the
    // X trigger above pause — a live gauge over the well steals the play column.

    const left = element('div', 'hud__column hud__column--left');
    left.append(stats);

    const next = element('div', 'slot hud__panel');
    this.nextPanel = next;
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
    const leftChoice = element('button', 'prompt__choice prompt__choice--left');
    leftChoice.type = 'button';
    leftChoice.setAttribute('aria-label', 'Turn left');
    leftChoice.append(element('span', 'prompt__arrow', '←'), this.promptLeft);
    const rightChoice = element('button', 'prompt__choice prompt__choice--right');
    rightChoice.type = 'button';
    rightChoice.setAttribute('aria-label', 'Turn right');
    rightChoice.append(this.promptRight, element('span', 'prompt__arrow', '→'));
    this.bindTurnChoice(leftChoice, 'left');
    this.bindTurnChoice(rightChoice, 'right');
    pill.append(leftChoice, element('span', 'prompt__text', '·'), rightChoice);
    this.prompt.append(pill);
    this.prompt.hidden = true;
    this.banner.hidden = true;

    this.lcdPlay.type = 'button';
    this.lcdPlay.setAttribute('aria-label', 'Pause music');
    this.lcdPlay.textContent = '❚❚';
    this.lcdPlay.addEventListener('click', (event) => {
      event.preventDefault();
      this.musicToggle?.();
    });
    this.lcdNext.type = 'button';
    this.lcdNext.setAttribute('aria-label', 'Next track');
    this.lcdNext.textContent = '▶▶';
    this.lcdNext.addEventListener('click', (event) => {
      event.preventDefault();
      this.musicNext?.();
    });
    const screen = element('div', 'lcd__screen');
    const marquee = element('div', 'lcd__marquee');
    // Two copies so the CSS loop can scroll without a gap at the wrap.
    marquee.append(this.lcdText, this.lcdText.cloneNode(true));
    screen.append(marquee);
    this.lcd.append(this.lcdPlay, screen, this.lcdNext);
    this.lcd.hidden = true;

    this.pauseBtn.type = 'button';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.textContent = '❚❚';
    this.pauseBtn.hidden = true;
    // Stop the root touch controller claiming this tap as a rotate / drop.
    this.pauseBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.pauseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pauseHandler?.();
    });

    this.collapseBtn.type = 'button';
    this.collapseBtn.setAttribute('aria-label', 'Spectral Collapse');
    this.collapseBtn.textContent = 'X';
    this.collapseBtn.hidden = true;
    this.collapseBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.collapseBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.collapseHandler?.();
    });

    this.root.append(
      this.lcd,
      left,
      right,
      this.gauge,
      this.shift,
      this.collapseBtn,
      this.pauseBtn,
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

  /**
   * Where the next-piece panel is on screen, in CSS pixels, for the renderer to
   * draw the turning preview into. Null while there is nothing to show.
   */
  nextSlotRect(): { left: number; top: number; width: number; height: number } | null {
    const box = this.nextSlot.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }

  /**
   * Hide the HUD without unmounting it.
   *
   * For the title screen, which now lets the board through: a score of zero, an
   * empty NEXT and a Shift meter for a run nobody has started are furniture from
   * a different screen. Every other panel keeps it -- under pause it is the run
   * you are about to go back to, which is exactly what you want to see.
   *
   * Opacity rather than `hidden`, so the layout the renderer measures for the
   * preview rectangle does not collapse and spring back on every transition.
   */
  /**
   * Vertical space the Shift meter needs below the board, in CSS pixels.
   *
   * Measured rather than assumed, because the meter's height comes from its own
   * type and padding. Read by the camera fit, which reserves this much at the
   * bottom of the window -- the meter is absolutely positioned, so nothing lays
   * out around it and the board would otherwise be framed straight through it.
   */
  get shiftReservePx(): number {
    return this.shift.getBoundingClientRect().height + SHIFT_WELL_GAP + SHIFT_EDGE_MARGIN;
  }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('hud--hidden', hidden);
  }

  setSpinPreview(spinning: boolean): void {
    this.spinPreview = spinning;
    this.nextPanel.classList.toggle('slot--window', spinning);
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

  /**
   * Flash a playfield message. Optional `hint` is a second, quieter line for
   * a control prompt (e.g. how to spend a charge) without shouting it at the
   * same weight as the event name.
   */
  showBanner(text: string, hint?: string): void {
    this.banner.replaceChildren();
    const main = element('span', 'banner__text', text);
    this.banner.append(main);
    if (hint) {
      this.banner.append(element('span', 'banner__hint', hint));
    }
    this.banner.hidden = false;
    this.banner.classList.toggle('banner--hinted', Boolean(hint));
    this.banner.classList.remove('banner--pulse');
    // Restart the animation on a repeat of the same label.
    void this.banner.offsetWidth;
    this.banner.classList.add('banner--pulse');
    // A hinted line needs a beat longer to read than a single word.
    this.bannerTimer = hint ? 2200 : 1400;
  }

  /**
   * Park the Shift bar under the play column. `rect` is the well's silhouette
   * in viewport CSS pixels; the HUD subtracts its own origin because it is
   * width-capped and centred over a full-bleed canvas.
   */
  /**
   * Sit the Shift meter under the board's on-screen silhouette.
   *
   * The camera reserves room below the board for exactly this, but the clamp
   * is not optional: at an extreme aspect ratio the width constraint takes over
   * the fit and the reserved space goes with it. A meter the player cannot see
   * is worse than one a few pixels out of place, so it is kept inside the
   * window whatever the camera does.
   */
  layoutWell(
    rect: { left: number; top: number; width: number; height: number },
    /**
     * Viewport y where the touch strip begins, or null when there is no strip.
     *
     * The meter has to stay clear of it. The strip is where the thumb rests for
     * the whole game, and the meter is the one readout that says when the board
     * is about to turn -- measured on a Pixel 7 they overlapped almost exactly,
     * so the hand covered it.
     *
     * **A guard, not the mechanism.** What actually keeps the two apart is the
     * camera's bottom reserve, which leaves room for both below the board; by
     * the time the meter is placed there is already space for it, and removing
     * this clamp changes nothing measurable. It stays because the reserve is
     * applied on resize and this runs every frame, so a mode change is one
     * ordering mistake away from a frame where they disagree -- and because a
     * function that is handed the strip's position and ignores it invites the
     * next reader to conclude the two are unrelated.
     */
    stripTop: number | null = null
  ): void {
    const origin = this.root.getBoundingClientRect();
    const own = this.shift.getBoundingClientRect().height;
    const desired = rect.top + rect.height + SHIFT_WELL_GAP - origin.top;
    const floor =
      stripTop === null ? origin.height : Math.min(origin.height, stripTop - origin.top);
    const limit = floor - own - SHIFT_EDGE_MARGIN;

    this.shift.style.left = `${rect.left - origin.left}px`;
    this.shift.style.width = `${rect.width}px`;
    this.shift.style.top = `${Math.max(0, Math.min(desired, limit))}px`;

    // Against the well's right edge, spanning its height. Outside the silhouette
    // rather than over it: the board is the one thing nothing may cover.
    this.gauge.style.left = `${rect.left + rect.width - origin.left + GAUGE_GAP}px`;
    this.gauge.style.top = `${rect.top - origin.top}px`;
    this.gauge.style.height = `${rect.height}px`;
  }

  /**
   * Show the hot bar at `heat`, 0 to 1, or hide it where the mode has no such
   * mechanic.
   *
   * `ready` suspends the fill's transition and hands the element over to the
   * flicker: at that point the number has stopped moving and what the gauge has
   * to say is no longer "how full" but "now".
   */
  /** What the touch X trigger (and any other spend control) should do. */
  onCollapseTap(handler: () => void): void {
    this.collapseHandler = handler;
  }

  /** LCD transport: pause/resume the bed, and skip to the next gameplay track. */
  onMusicDeck(handlers: { onToggle: () => void; onNext: () => void }): void {
    this.musicToggle = handlers.onToggle;
    this.musicNext = handlers.onNext;
  }

  /** Touch-primary pause button. Opens the pause panel; Esc still toggles on keyboard. */
  onPause(handler: () => void): void {
    this.pauseHandler = handler;
  }

  /**
   * Tap targets on the face-choice prompt (← / →). Keyboard and strip swipes
   * still choose a face on their own paths; this is the phone answer to the
   * same prompt.
   */
  onTurnTap(handler: (direction: 'left' | 'right') => void): void {
    this.turnHandler = handler;
  }

  private bindTurnChoice(button: HTMLButtonElement, direction: 'left' | 'right'): void {
    // Stop the root touch controller claiming this tap as a roll / drop.
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.turnHandler?.(direction);
    });
  }

  /**
   * Show the pause control only while a run is on screen.
   *
   * CSS still gates it to touch-primary devices — a laptop with a keyboard has
   * Esc, and showing a second pause control there would be noise. The collapse
   * trigger rides the same visibility: it only belongs next to pause mid-run.
   */
  setPauseVisible(visible: boolean): void {
    this.pauseVisible = visible;
    this.pauseBtn.hidden = !visible;
    this.syncCollapseTrigger();
  }

  /**
   * Lift the pause button clear of the movement strip when the mode has one.
   *
   * The strip is a region of the window, not an element, so the button has to be
   * told — the same reason the Shift meter takes `stripTop`. The collapse
   * trigger shares the lift via `.hud--strip`.
   */
  setStripReserve(hasStrip: boolean): void {
    this.root.classList.toggle('hud--strip', hasStrip);
  }

  /**
   * Drive the in-run LCD.
   *
   * Pass `null` off the playing screen. The credit is artist · title; the play
   * glyph flips with `playing` so a held bed reads as paused even during fade.
   */
  setMusicDeck(
    now: { readonly artist: string; readonly title: string; readonly playing: boolean } | null
  ): void {
    if (!now) {
      this.lcd.hidden = true;
      return;
    }
    this.lcd.hidden = false;
    const credit = `${now.artist}  ·  ${now.title}`;
    const texts = this.lcd.querySelectorAll('.lcd__text');
    texts.forEach((node) => {
      node.textContent = `${credit}    ✦    `;
    });
    this.lcdPlay.textContent = now.playing ? '❚❚' : '▶';
    this.lcdPlay.setAttribute('aria-label', now.playing ? 'Pause music' : 'Play music');
    this.lcd.classList.toggle('lcd--paused', !now.playing);
  }

  setHeat(heat: number | null, ready: boolean): void {
    this.gauge.hidden = heat === null;
    this.collapseReady = heat !== null && ready;
    this.syncCollapseTrigger();
    if (heat === null) return;
    const level = Math.min(1, Math.max(0, heat));
    this.gaugeFill.style.height = `${level * 100}%`;
    // The shimmer is driven from here rather than from a fixed animation so it
    // can grow with the fill -- a gauge that shakes hardest just before it is
    // earned is doing the job the play note asked for.
    this.gauge.style.setProperty('--gauge-agitation', level.toFixed(3));
    this.gauge.classList.toggle('gauge--ready', ready);
  }

  /**
   * Slide the touch collapse trigger in while the bar is full and a run is on
   * screen; slide it out the moment either stops being true.
   *
   * Kept in the DOM (not `hidden`) while pause is up so the exit transition can
   * play — `hidden` would cut the slide short.
   */
  private syncCollapseTrigger(): void {
    this.collapseBtn.hidden = !this.pauseVisible;
    this.collapseBtn.classList.toggle(
      'hud__collapse--ready',
      this.pauseVisible && this.collapseReady
    );
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
    // The 3D preview is drawn into this slot by the renderer, through a scissor
    // rectangle taken from `nextSlotRect()`. The DOM cells stay as the fallback
    // for the still preview, so the panel is never empty while a piece is known.
    this.nextSlot.replaceChildren(
      next && !this.spinPreview
        ? renderPiecePreview(next.cells, next.lane, this.depthColour)
        : element('div', 'piece')
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
