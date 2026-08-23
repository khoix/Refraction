/**
 * Spatial control diagrams for Settings.
 *
 * Labels come from resolved bindings so remaps update the art. Mobile wedge
 * geometry is drawn from the same ZONE_POLYGONS the recogniser hit-tests.
 */

import { keyLabel } from '../keymap';
import type { Binding, BindingProfile } from '../keymap';
import { ZONE_LABEL_AT, ZONE_ORDER, zoneSvgPoints } from '../touch/wedges';
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
        <p class="control-diagram__cap">Roll back · Hard drop</p>
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

/** Mobile gesture / wedge diagram — exact authored polygons. */
export function buildTouchDiagram(
  profile: BindingProfile,
  bindings: readonly Binding[]
): HTMLElement {
  const root = el('div', 'control-diagram control-diagram--touch');
  root.dataset['profile'] = profile;
  root.setAttribute('aria-hidden', 'true');

  if (profile === 'roll') {
    root.innerHTML = `
      <div class="control-diagram__phone">
        <div class="control-diagram__phone-body">
          <span class="control-diagram__hint">Drag — move</span>
          <span class="control-diagram__hint">Tap L/R — roll</span>
          <span class="control-diagram__hint">Flick down — hard drop</span>
        </div>
      </div>`;
    return root;
  }

  const q = codeFor(bindings, 'rollAnti');
  const e = codeFor(bindings, 'rollClock');
  const a = codeFor(bindings, 'yawAnti');
  const d = codeFor(bindings, 'yawClock');
  const w = codeFor(bindings, 'pitchUp');
  const s = codeFor(bindings, 'pitchDown');

  const labelFor = (id: ZoneId): string => {
    switch (id) {
      case 'Q_TOP_LEFT':
      case 'Q_BOTTOM_LEFT':
        return q;
      case 'E_TOP_RIGHT':
      case 'E_BOTTOM_RIGHT':
        return e;
      case 'W':
        return w;
      case 'A':
        return a;
      case 'D':
        return d;
      case 'S':
        return s;
      case 'DEAD_ZONE':
        return 'DEAD';
    }
  };

  const polys = ZONE_ORDER.map(
    (id) => `<polygon points="${zoneSvgPoints(id)}" class="${ZONE_CLASS[id]}" data-zone="${id}" />`
  ).join('\n      ');

  const labels = ZONE_ORDER.map((id) => {
    const at = ZONE_LABEL_AT[id];
    if (!at) return '';
    const [lx, ly] = at;
    const text = labelFor(id);
    const cls = id === 'DEAD_ZONE' ? 'wedge-dead-label' : 'wedge-label';
    return `<text x="${lx * 100}" y="${ly * 100}" class="${cls}" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
  }).join('\n      ');

  root.innerHTML = `
    <svg class="control-diagram__wedge" viewBox="0 0 100 100" role="img" aria-label="Mobile rotate tap zones">
      ${polys}
      ${labels}
    </svg>
    <p class="control-diagram__cap">Tap wedges to rotate · Swipe to move / depth · Two-finger down to drop</p>`;
  return root;
}
