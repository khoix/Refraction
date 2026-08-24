/**
 * Spatial control diagrams for Settings.
 *
 * Desktop labels come from resolved bindings so remaps update the art. Mobile
 * wedge labels name what each zone does (roll, yaw, pitch). Geometry is drawn
 * from the same ZONE_POLYGONS the recogniser hit-tests.
 */

import { keyLabel } from '../keymap';
import type { Binding, BindingProfile } from '../keymap';
import {
  DIAGRAM_VIEW_H,
  DIAGRAM_VIEW_W,
  ZONE_LABEL_AT,
  ZONE_ORDER,
  ZONE_TO_WEDGE,
  zoneSvgPoints,
} from '../touch/wedges';
import type { ZoneId } from '../touch/wedges';

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function codeFor(bindings: readonly Binding[], action: string): string {
  const row = bindings.find((b) => b.action === action);
  if (!row || row.codes.length === 0) return '—';
  return row.codes.map(keyLabel).join(' ');
}

/** Desktop keyboard / mouse diagram. */
export function buildKeyboardDiagram(
  profile: BindingProfile,
  bindings: readonly Binding[]
): HTMLElement {
  const root = el('div', 'control-diagram control-diagram--keyboard');
  root.dataset['profile'] = profile;
  root.setAttribute('aria-hidden', 'true');

  if (profile === 'roll') {
    root.innerHTML = `
      <div class="control-diagram__cluster">
        <div class="control-diagram__pad">
          <span class="control-diagram__key control-diagram__key--ghost"></span>
          <span class="control-diagram__key" data-bind="rollClock">${codeFor(bindings, 'rollClock').split(' ')[0] ?? '↑'}</span>
          <span class="control-diagram__key control-diagram__key--ghost"></span>
          <span class="control-diagram__key" data-bind="moveLeft">${codeFor(bindings, 'moveLeft').split(' ')[0] ?? '←'}</span>
          <span class="control-diagram__key" data-bind="softDrop">${codeFor(bindings, 'softDrop').split(' ')[0] ?? '↓'}</span>
          <span class="control-diagram__key" data-bind="moveRight">${codeFor(bindings, 'moveRight').split(' ')[0] ?? '→'}</span>
        </div>
        <p class="control-diagram__cap">Move · Soft drop · Roll</p>
      </div>
      <div class="control-diagram__cluster">
        <div class="control-diagram__row-keys">
          <span class="control-diagram__key" data-bind="rollAnti">${codeFor(bindings, 'rollAnti')}</span>
          <span class="control-diagram__key" data-bind="hardDrop">${codeFor(bindings, 'hardDrop')}</span>
        </div>
        <p class="control-diagram__cap">◀ Roll · Hard drop</p>
      </div>`;
    return root;
  }

  root.innerHTML = `
    <div class="control-diagram__cluster">
      <div class="control-diagram__pad">
        <span class="control-diagram__key control-diagram__key--ghost"></span>
        <span class="control-diagram__key" data-bind="nudgeDeeper" title="Push deeper">${codeFor(bindings, 'nudgeDeeper')}</span>
        <span class="control-diagram__key control-diagram__key--ghost"></span>
        <span class="control-diagram__key" data-bind="moveLeft">${codeFor(bindings, 'moveLeft')}</span>
        <span class="control-diagram__key" data-bind="nudgeNearer" title="Pull nearer">${codeFor(bindings, 'nudgeNearer')}</span>
        <span class="control-diagram__key" data-bind="moveRight">${codeFor(bindings, 'moveRight')}</span>
      </div>
      <p class="control-diagram__cap">Arrows — move &amp; depth</p>
    </div>
    <div class="control-diagram__cluster">
      <div class="control-diagram__wasd">
        <span class="control-diagram__key" data-bind="pitchUp">${codeFor(bindings, 'pitchUp')}</span>
        <span class="control-diagram__key" data-bind="yawAnti">${codeFor(bindings, 'yawAnti')}</span>
        <span class="control-diagram__key" data-bind="pitchDown">${codeFor(bindings, 'pitchDown')}</span>
        <span class="control-diagram__key" data-bind="yawClock">${codeFor(bindings, 'yawClock')}</span>
        <span class="control-diagram__key" data-bind="rollAnti">${codeFor(bindings, 'rollAnti')}</span>
        <span class="control-diagram__key" data-bind="rollClock">${codeFor(bindings, 'rollClock')}</span>
      </div>
      <p class="control-diagram__cap">Q/E roll · A/D yaw · W/S pitch</p>
    </div>
    <div class="control-diagram__cluster control-diagram__mouse">
      <p class="control-diagram__cap">Mouse drag — move &amp; depth</p>
      <p class="control-diagram__cap"><kbd class="key">${codeFor(bindings, 'softDrop')}</kbd> soft · <kbd class="key">${codeFor(bindings, 'hardDrop')}</kbd> hard</p>
    </div>`;
  return root;
}

const ZONE_CLASS: Readonly<Record<ZoneId, string>> = {
  DEAD_ZONE: 'wedge-dead',
  Q_TOP_LEFT: 'wedge wedge--roll',
  Q_BOTTOM_LEFT: 'wedge wedge--roll',
  E_TOP_RIGHT: 'wedge wedge--roll',
  E_BOTTOM_RIGHT: 'wedge wedge--roll',
  W: 'wedge wedge--pitch',
  S: 'wedge wedge--pitch',
  A: 'wedge wedge--yaw',
  D: 'wedge wedge--yaw',
};

const PHONE_INSET = 4;
const PHONE_TOP = 8;
const PHONE_BOTTOM = 8;
/** Tap zones sit below the status strip and above the home bar. */
const TAP_PAD_TOP = 6;
const TAP_PAD_BOTTOM = 8;

interface DiagramScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function diagramScreenRect(viewW: number, viewH: number): DiagramScreenRect {
  return {
    x: PHONE_INSET,
    y: PHONE_TOP,
    width: viewW - PHONE_INSET * 2,
    height: viewH - PHONE_TOP - PHONE_BOTTOM,
  };
}

/** Playfield tap map — inset within the visible screen, not the full bezel box. */
function diagramTapRect(screen: DiagramScreenRect): DiagramScreenRect {
  return {
    x: screen.x,
    y: screen.y + TAP_PAD_TOP,
    width: screen.width,
    height: screen.height - TAP_PAD_TOP - TAP_PAD_BOTTOM,
  };
}

function zonePointsInRect(id: ZoneId, rect: DiagramScreenRect): string {
  return zoneSvgPoints(id, rect.width, rect.height)
    .split(' ')
    .map((pair) => {
      const [nx, ny] = pair.split(',').map(Number) as [number, number];
      return `${rect.x + nx},${rect.y + ny}`;
    })
    .join(' ');
}

function screenPoint(lx: number, ly: number, screen: DiagramScreenRect): readonly [number, number] {
  return [screen.x + lx * screen.width, screen.y + ly * screen.height];
}

const WEDGE_LABEL_LINE = 3.5;

function wedgeLabelSvg(
  id: ZoneId,
  lx: number,
  ly: number,
  label: string,
  screen: DiagramScreenRect
): string {
  const [x, y] = screenPoint(lx, ly, screen);
  const line = WEDGE_LABEL_LINE * (screen.height / 100);
  const action = ZONE_TO_WEDGE[id];

  if (action === 'pitchUp') {
    return `<text class="wedge-label" text-anchor="middle">
      <tspan x="${x}" y="${y - line}">▲</tspan>
      <tspan x="${x}" y="${y + line}">Pitch</tspan>
    </text>`;
  }
  if (action === 'pitchDown') {
    return `<text class="wedge-label" text-anchor="middle">
      <tspan x="${x}" y="${y - line}">Pitch</tspan>
      <tspan x="${x}" y="${y + line}">▼</tspan>
    </text>`;
  }

  return `<text x="${x}" y="${y}" class="wedge-label" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
}

/** Mini well grid clipped to the dead zone — reads as gameplay, not a tap target. */
function playfieldMock(screen: DiagramScreenRect): string {
  const [x0, y0] = screenPoint(0.39, 0.42, screen);
  const w = 0.22 * screen.width;
  const h = 0.16 * screen.height;
  const cols = 8;
  const rows = 6;
  const cellW = w / cols;
  const cellH = h / rows;
  const cells = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const pad = 0.15;
      return `<rect x="${x0 + col * cellW + pad}" y="${y0 + row * cellH + pad}" width="${cellW - pad * 2}" height="${cellH - pad * 2}" class="diagram-playfield__cell" />`;
    }).join('')
  ).join('');
  return `<g class="diagram-playfield" clip-path="url(#diagram-dead-clip)">${cells}</g>`;
}

function phoneFrameSvg(viewW: number, viewH: number, screen: DiagramScreenRect): string {
  return `
    <rect class="phone-bezel" x="1" y="1" width="${viewW - 2}" height="${viewH - 2}" rx="10" />
    <rect class="phone-screen" x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="5" />
    <rect class="phone-status" x="${screen.x}" y="${screen.y}" width="${screen.width}" height="5" />
    <rect class="phone-notch" x="${viewW / 2 - 8}" y="${screen.y}" width="16" height="2.5" rx="1.25" />
    <rect class="phone-home" x="${viewW / 2 - 10}" y="${screen.y + screen.height - 5}" width="20" height="2.5" rx="1.25" />`;
}

function diagramArrowMarker(id: string): string {
  return `<marker id="${id}" markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto">
    <path d="M0,0 L4,2 L0,4 Z" class="diagram-gesture__head" />
  </marker>`;
}

/** Flatland gesture loop — pauses after move, roll, and drop. */
const FLATLAND_MOVE_PAUSE_S = 1;
const FLATLAND_ROLL_PAUSE_S = 1;
const FLATLAND_DROP_PAUSE_S = 2;
const FLATLAND_FLICK_DUR_S = 1.95 / 2.25;

function flatlandLandmarks(): {
  readonly idle: number;
  readonly moveIn: number;
  readonly moveOut: number;
  readonly moveReturn: number;
  readonly movePauseEnd: number;
  readonly rollIn: number;
  readonly tapL: number;
  readonly tapR: number;
  readonly tapRAnimEnd: number;
  readonly rollOut: number;
  readonly rollPauseEnd: number;
  readonly flickIn: number;
  readonly flickOut: number;
  readonly pauseEnd: number;
  readonly reset: number;
  readonly end: number;
} {
  const moveIn = 0.6;
  const moveOut = 2.0;
  const moveReturn = moveOut + 0.001;
  const movePauseEnd = moveReturn + FLATLAND_MOVE_PAUSE_S;
  const rollIn = movePauseEnd;
  const tapL = rollIn + 0.35;
  const tapR = tapL + 0.55;
  const tapRAnimEnd = tapR + 0.3;
  const rollOut = tapRAnimEnd + 0.35;
  const rollPauseEnd = rollOut + FLATLAND_ROLL_PAUSE_S;
  const flickIn = rollPauseEnd + 0.001;
  const flickOut = flickIn + FLATLAND_FLICK_DUR_S;
  const pauseEnd = flickOut + FLATLAND_DROP_PAUSE_S;
  const reset = pauseEnd + 0.001;
  const end = pauseEnd + 0.4;
  return {
    idle: 0,
    moveIn,
    moveOut,
    moveReturn,
    movePauseEnd,
    rollIn,
    tapL,
    tapR,
    tapRAnimEnd,
    rollOut,
    rollPauseEnd,
    flickIn,
    flickOut,
    pauseEnd,
    reset,
    end,
  };
}

const FLATLAND_S = flatlandLandmarks();
const FLATLAND_CYCLE_S = FLATLAND_S.end;

interface FlatlandGeom {
  readonly dragX0: number;
  readonly dragX1: number;
  readonly midY: number;
  readonly tapL: number;
  readonly tapR: number;
  readonly tapY: number;
  readonly flickX: number;
  readonly flickY0: number;
  readonly flickY1: number;
  readonly moveDx: number;
  readonly dropDy: number;
  readonly cx: number;
  readonly cy: number;
  readonly cell: number;
}

interface FlatlandKeyframe {
  readonly t: number;
  readonly finger: readonly [number, number];
  readonly blockTx: readonly [number, number];
  readonly blockRot: number;
  readonly moveOp: number;
  readonly rollOp: number;
  readonly flickOp: number;
  readonly rippleL: number;
  readonly rippleR: number;
}

function flatlandBuildTimeline(g: FlatlandGeom): FlatlandKeyframe[] {
  const S = FLATLAND_S;
  const pt = (
    finger: readonly [number, number],
    blockTx: readonly [number, number],
    blockRot: number,
    moveOp: number,
    rollOp: number,
    flickOp: number,
    rippleL: number,
    rippleR: number,
    t: number
  ): FlatlandKeyframe => ({ t, finger, blockTx, blockRot, moveOp, rollOp, flickOp, rippleL, rippleR });

  return [
    pt([g.dragX0, g.midY], [0, 0], 0, 0, 0, 0, 0, 0, S.idle),
    pt([g.dragX0, g.midY], [0, 0], 0, 1, 0, 0, 0, 0, S.moveIn),
    pt([g.dragX1, g.midY], [g.moveDx, 0], 0, 1, 0, 0, 0, 0, S.moveOut),
    pt([g.dragX1, g.midY], [0, 0], 0, 0, 0, 0, 0, 0, S.moveReturn),
    pt([g.dragX1, g.midY], [0, 0], 0, 0, 0, 0, 0, 0, S.movePauseEnd),
    pt([g.tapL, g.tapY], [0, 0], 0, 0, 1, 0, 0, 0, S.rollIn),
    pt([g.tapL, g.tapY], [0, 0], -90, 0, 1, 0, 1, 0, S.tapL),
    pt([g.tapL, g.tapY], [0, 0], -90, 0, 1, 0, 0, 0, S.tapR - 0.001),
    pt([g.tapR, g.tapY], [0, 0], -90, 0, 1, 0, 0, 1, S.tapR),
    pt([g.tapR, g.tapY], [0, 0], 0, 0, 1, 0, 0, 0, S.tapRAnimEnd),
    pt([g.tapR, g.tapY], [0, 0], 0, 0, 1, 0, 0, 0, S.rollOut),
    pt([g.tapR, g.tapY], [0, 0], 0, 0, 0, 0, 0, 0, S.rollPauseEnd),
    pt([g.flickX, g.flickY0], [0, 0], 0, 0, 0, 0, 0, 0, S.rollPauseEnd + 0.0001),
    pt([g.flickX, g.flickY0], [0, 0], 0, 0, 0, 1, 0, 0, S.flickIn),
    pt([g.flickX, g.flickY1], [0, g.dropDy], 0, 0, 0, 0, 0, 0, S.flickOut),
    pt([g.flickX, g.flickY1], [0, g.dropDy], 0, 0, 0, 0, 0, 0, S.pauseEnd),
    pt([g.dragX0, g.midY], [0, 0], 0, 0, 0, 0, 0, 0, S.reset),
    pt([g.dragX0, g.midY], [0, 0], 0, 0, 0, 0, 0, 0, S.end),
  ];
}

function flatlandKeyTimes(timeline: readonly FlatlandKeyframe[]): string {
  return timeline.map((k) => (k.t / FLATLAND_CYCLE_S).toFixed(6)).join(';');
}

function flatlandSmil(
  timeline: readonly FlatlandKeyframe[],
  pick: (k: FlatlandKeyframe) => string | number,
  type?: 'translate' | 'rotate'
): string {
  const values = timeline.map((k) => pick(k)).join('; ');
  const kt = flatlandKeyTimes(timeline);
  const dur = FLATLAND_CYCLE_S;
  if (type) {
    return `<animateTransform attributeName="transform" type="${type}" dur="${dur}s" repeatCount="indefinite" calcMode="linear" values="${values}" keyTimes="${kt}" />`;
  }
  return `<animate attributeName="opacity" dur="${dur}s" repeatCount="indefinite" calcMode="linear" values="${values}" keyTimes="${kt}" />`;
}

/** Backhand Index Pointing Up — native SVG text so SMIL transforms work on mobile WebKit. */
function fingerIconUp(): string {
  return `<text class="diagram-finger-emoji" text-anchor="middle" dominant-baseline="hanging" x="0" y="0">\u{1F446}</text>`;
}

function flatlandFingerMotion(timeline: readonly FlatlandKeyframe[]): string {
  const finger = (k: FlatlandKeyframe) => `${k.finger[0]} ${k.finger[1]}`;
  return `<g class="diagram-finger-actuator">
    ${flatlandSmil(timeline, finger, 'translate')}
    ${fingerIconUp()}
  </g>`;
}

function flatlandAnimatedScene(tap: DiagramScreenRect, g: FlatlandGeom, timeline: readonly FlatlandKeyframe[]): string {
  const cells = ([
    [-1, -1],
    [0, -1],
    [-1, 0],
  ] as const).map(
    ([dx, dy]) =>
      `<rect x="${dx * g.cell + 0.2}" y="${dy * g.cell + 0.2}" width="${g.cell - 0.4}" height="${g.cell - 0.4}" rx="0.5" class="diagram-block__cell" />`
  );
  const pivot = g.cell / 2;
  const blockTx = (k: FlatlandKeyframe) => `${k.blockTx[0]},${k.blockTx[1]}`;

  return `
    ${flatlandPlayfieldGrid(tap)}
    <g class="diagram-block" transform="translate(${g.cx} ${g.cy})">
      <g class="diagram-block__translate">
        ${flatlandSmil(timeline, blockTx, 'translate')}
        <g transform="translate(${-pivot} ${-pivot})">
          <g class="diagram-block__rotate">
            ${flatlandSmil(timeline, (k) => k.blockRot, 'rotate')}
            ${cells.join('')}
          </g>
        </g>
      </g>
    </g>
    <g class="flatland-phase flatland-phase--move" opacity="0">
      ${flatlandSmil(timeline, (k) => k.moveOp)}
      <line x1="${g.dragX0}" y1="${g.midY}" x2="${g.dragX1}" y2="${g.midY}" class="diagram-gesture__path" marker-end="url(#flatland-arrow)" />
      <text x="${g.cx}" y="${g.midY + 9}" class="diagram-gesture__label" text-anchor="middle">Move</text>
    </g>
    <g class="flatland-phase flatland-phase--roll" opacity="0">
      ${flatlandSmil(timeline, (k) => k.rollOp)}
      <text x="${g.tapL}" y="${g.tapY - 8}" class="diagram-gesture__label" text-anchor="middle">◀ Roll</text>
      <text x="${g.tapR}" y="${g.tapY - 8}" class="diagram-gesture__label" text-anchor="middle">Roll ▶</text>
    </g>
    <circle cx="${g.tapL}" cy="${g.tapY}" r="5.5" class="diagram-tap-ring flatland-ripple flatland-ripple--l" opacity="0">
      ${flatlandSmil(timeline, (k) => k.rippleL)}
    </circle>
    <circle cx="${g.tapR}" cy="${g.tapY}" r="5.5" class="diagram-tap-ring flatland-ripple flatland-ripple--r" opacity="0">
      ${flatlandSmil(timeline, (k) => k.rippleR)}
    </circle>
    <g class="flatland-phase flatland-phase--flick" opacity="0">
      ${flatlandSmil(timeline, (k) => k.flickOp)}
      <path d="M${g.flickX},${g.flickY0} L${g.flickX},${g.flickY1}" class="diagram-gesture__path diagram-gesture__path--flick" marker-end="url(#flatland-arrow)" />
      <text x="${g.flickX}" y="${g.flickY1 + 8}" class="diagram-gesture__label" text-anchor="middle">Hard drop</text>
    </g>
    ${flatlandFingerMotion(timeline)}`;
}

function flatlandGesturesSvg(tap: DiagramScreenRect): string {
  const cx = tap.x + tap.width / 2;
  const cy = tap.y + tap.height * 0.46;
  const cell = Math.min(tap.width, tap.height) * 0.099;
  const midY = tap.y + tap.height * 0.52;

  const dragX0 = tap.x + tap.width * 0.22;
  const dragX1 = tap.x + tap.width * 0.78;
  const tapL = tap.x + tap.width * 0.24;
  const tapR = tap.x + tap.width * 0.76;
  const tapY = tap.y + tap.height * 0.38;
  const flickY0 = tap.y + tap.height * 0.3;
  const flickY1 = tap.y + tap.height * 0.72;
  const moveDx = dragX1 - cx;
  const flickX = cx;
  const dropDy = flickY1 - cy;

  const geom: FlatlandGeom = {
    dragX0,
    dragX1,
    midY,
    tapL,
    tapR,
    tapY,
    flickX,
    flickY0,
    flickY1,
    moveDx,
    dropDy,
    cx,
    cy,
    cell,
  };
  const timeline = flatlandBuildTimeline(geom);

  return `
    <rect x="${tap.x}" y="${tap.y}" width="${tap.width / 2}" height="${tap.height}" class="diagram-roll-zone diagram-roll-zone--left" />
    <rect x="${cx}" y="${tap.y}" width="${tap.width / 2}" height="${tap.height}" class="diagram-roll-zone diagram-roll-zone--right" />
    ${flatlandAnimatedScene(tap, geom, timeline)}`;
}

function flatlandPlayfieldGrid(rect: DiagramScreenRect): string {
  const cols = 8;
  const rows = 16;
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const cells = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const pad = 0.2;
      return `<rect x="${rect.x + col * cellW + pad}" y="${rect.y + row * cellH + pad}" width="${cellW - pad * 2}" height="${cellH - pad * 2}" class="diagram-playfield__cell" />`;
    }).join('')
  ).join('');
  return `<g class="diagram-playfield">${cells}</g>`;
}

function buildFlatlandTouchDiagram(viewW: number, viewH: number): string {
  const screen = diagramScreenRect(viewW, viewH);
  const tap = diagramTapRect(screen);
  return `
    <h3 class="control-diagram__title">Touch Controls</h3>
    <div class="control-diagram__device">
      <svg class="control-diagram__wedge control-diagram__wedge--flatland" style="--flatland-cycle: ${FLATLAND_CYCLE_S}s" viewBox="0 0 ${viewW} ${viewH}" role="img" aria-label="Flatland touch gestures: drag to move, tap left or right to roll, flick down to hard drop">
        <defs>
          ${diagramArrowMarker('flatland-arrow')}
          <clipPath id="flatland-screen-clip">
            <rect x="${tap.x}" y="${tap.y}" width="${tap.width}" height="${tap.height}" rx="3" />
          </clipPath>
        </defs>
        ${phoneFrameSvg(viewW, viewH, screen)}
        <g clip-path="url(#flatland-screen-clip)">
          ${flatlandGesturesSvg(tap)}
        </g>
      </svg>
    </div>
    <p class="control-diagram__cap">Drag to move · tap left or right to roll · flick down to drop</p>`;
}

/** Mobile gesture / wedge diagram — exact authored polygons. */
export function buildTouchDiagram(
  profile: BindingProfile,
  bindings: readonly Binding[]
): HTMLElement {
  const root = el('div', 'control-diagram control-diagram--touch');
  root.dataset['profile'] = profile;

  if (profile === 'roll') {
    root.innerHTML = buildFlatlandTouchDiagram(DIAGRAM_VIEW_W, DIAGRAM_VIEW_H);
    return root;
  }

  const viewW = DIAGRAM_VIEW_W;
  const viewH = DIAGRAM_VIEW_H;
  const screen = diagramScreenRect(viewW, viewH);
  const tap = diagramTapRect(screen);

  const labelFor = (id: ZoneId): string => {
    if (id === 'DEAD_ZONE') return '';
    const action = ZONE_TO_WEDGE[id];
    if (!action) return '';
    return bindings.find((b) => b.action === action)?.label ?? '';
  };

  const polys = ZONE_ORDER.filter((id) => id !== 'DEAD_ZONE')
    .map(
      (id) =>
        `<polygon points="${zonePointsInRect(id, tap)}" class="${ZONE_CLASS[id]}" data-zone="${id}" />`
    )
    .join('\n      ');

  const labels = ZONE_ORDER.map((id) => {
    const at = ZONE_LABEL_AT[id];
    if (!at) return '';
    const text = labelFor(id);
    if (!text) return '';
    const [lx, ly] = at;
    return wedgeLabelSvg(id, lx, ly, text, tap);
  }).join('\n      ');

  const deadClip = zonePointsInRect('DEAD_ZONE', tap);

  root.innerHTML = `
    <h3 class="control-diagram__title">Tap Zones for<br>Block Rotation</h3>
    <div class="control-diagram__device">
      <svg class="control-diagram__wedge" viewBox="0 0 ${viewW} ${viewH}" role="img" aria-label="Screen tap zones for block rotation">
        <defs>
          <clipPath id="diagram-screen-clip">
            <rect x="${tap.x}" y="${tap.y}" width="${tap.width}" height="${tap.height}" rx="3" />
          </clipPath>
          <clipPath id="diagram-dead-clip">
            <polygon points="${deadClip}" />
          </clipPath>
        </defs>
        ${phoneFrameSvg(viewW, viewH, screen)}
        <g clip-path="url(#diagram-screen-clip)">
          ${polys}
          ${playfieldMock(tap)}
          ${labels}
        </g>
      </svg>
    </div>
    <p class="control-diagram__cap">Each zone rolls, yaws, or pitches the block · swipe the board to move</p>`;
  return root;
}
