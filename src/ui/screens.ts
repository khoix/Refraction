/**
 * Everything that is not the board: title, mode select, pause, game over,
 * settings.
 *
 * Plain DOM, like the HUD, for the same reasons -- crisp text at any pixel
 * ratio and assistive technology for free. Screens are built once and shown or
 * hidden, so opening the pause menu allocates nothing.
 *
 * These read state and emit intents. They never touch the game.
 */

import { MODES, isUnlocked } from '@core/modes';
import type { ModeConfig, ModeId } from '@core/modes';
import { dailyChallenge, parseChallenge } from '@core/challenge';
import type { Challenge } from '@core/challenge';
import type { SaveData, Settings } from '@core/save';
import {
  BINDINGS,
  BINDING_GROUPS,
  TOUCH_ACTIONS,
  TOUCH_TURN_NOTE,
  TURN_PROMPT_NOTE,
  keyLabel,
} from '../keymap';

export type ScreenName =
  'title' | 'modes' | 'playing' | 'paused' | 'over' | 'settings' | 'challenge';

export interface ScreenHandlers {
  readonly onStart: (mode: ModeId) => void;
  /** Start a run pinned to a challenge code. */
  readonly onChallenge: (challenge: Challenge) => void;
  readonly onResume: () => void;
  readonly onQuit: () => void;
  readonly onRestart: () => void;
  readonly onSettings: (patch: Partial<Settings>) => void;
  readonly onOpen: (screen: ScreenName) => void;
}

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

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** A labelled on/off row for the settings panel. */
function toggleRow(
  key: string,
  label: string,
  hint: string,
  get: () => boolean,
  set: (value: boolean) => void
): { root: HTMLElement; sync: () => void } {
  const input = element('input');
  input.type = 'checkbox';
  input.className = 'field__input';
  const text = element('span', 'field__label', label);
  const note = element('span', 'field__hint', hint);

  const root = element('label', 'field');
  // Named rather than found by its label text: hints mention other settings by
  // name, so text matching picks up the wrong row.
  root.dataset['field'] = key;
  root.append(input, text, note);
  input.addEventListener('change', () => set(input.checked));
  return { root, sync: () => (input.checked = get()) };
}

/**
 * Group focusables into visual rows and step one place in a direction.
 *
 * Rows come from the laid-out geometry, not the markup: a grid that is one
 * column on a phone and three on a laptop is the same DOM either way, and only
 * the rectangles know which it currently is.
 */
function nextInDirection(
  items: readonly HTMLElement[],
  index: number,
  key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
): HTMLElement | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const step = key === 'ArrowRight' ? 1 : -1;
    return items[(index + step + items.length) % items.length] ?? null;
  }

  const boxes = items.map((node) => node.getBoundingClientRect());
  const rows: number[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const top = (boxes[i] as DOMRect).top;
    // Half a row's height of tolerance, so a taller control on the same line
    // does not read as a row of its own.
    const row = rows.find((candidate) => {
      const first = boxes[candidate[0] as number] as DOMRect;
      return Math.abs(first.top - top) < Math.max(8, first.height * 0.5);
    });
    if (row) row.push(i);
    else rows.push([i]);
  }

  const currentRow = rows.findIndex((row) => row.includes(index));
  if (currentRow === -1) return null;
  const step = key === 'ArrowDown' ? 1 : -1;
  const targetRow = rows[(currentRow + step + rows.length) % rows.length];
  if (!targetRow) return null;

  // Keep the horizontal position across the move, which is what makes a grid
  // feel like a grid rather than like a list that happens to wrap.
  const from = (boxes[index] as DOMRect).left;
  let best = targetRow[0] as number;
  for (const candidate of targetRow) {
    const here = Math.abs((boxes[candidate] as DOMRect).left - from);
    const bestSoFar = Math.abs((boxes[best] as DOMRect).left - from);
    if (here < bestSoFar) best = candidate;
  }
  return items[best] ?? null;
}

/**
 * The same panel for touch.
 *
 * Built from `TOUCH_ACTIONS` for the same reason the key map is built from
 * `BINDINGS`: a panel that carries its own copy of the controls is right on the
 * day it is written and wrong by the next change. Which of the two is shown is
 * decided in CSS by input method, not here -- a narrow window on a laptop still
 * has a keyboard, and a tablet with one attached reports a fine pointer.
 */
function buildTouchMap(): HTMLElement {
  const list = element('div', 'keymap keymap--touch');
  list.append(element('h3', 'keymap__title', 'CONTROLS'));

  for (const group of BINDING_GROUPS) {
    const rows = TOUCH_ACTIONS.filter((action) => action.group === group);
    if (rows.length === 0) continue;
    const section = element('section', 'keymap__section');
    section.append(element('h4', 'keymap__group', group.toUpperCase()));
    for (const action of rows) {
      const row = element('div', 'keymap__row');
      row.dataset['gesture'] = action.label;
      const keys = element('span', 'keymap__keys');
      keys.append(element('span', 'gesture', action.gesture));
      row.append(keys, element('span', 'keymap__label', action.label));
      if (action.note) row.append(element('span', 'keymap__note', action.note));
      section.append(row);
    }
    list.append(section);
  }

  list.append(element('p', 'keymap__foot', TOUCH_TURN_NOTE));
  return list;
}

/**
 * The key map.
 *
 * Built from `BINDINGS`, so it cannot describe a key the engine does not answer
 * to. The game had never told the player its controls anywhere but the README,
 * and it has enough of them now -- move, three rotation axes, a depth nudge,
 * hold, hard drop, face choice, pause, mute, restart -- that it has to.
 */
function buildKeyMap(): HTMLElement {
  const list = element('div', 'keymap');
  list.append(element('h3', 'keymap__title', 'CONTROLS'));

  // A group is one block, so the two-column flow moves it whole. Left to break
  // where it liked, the column split landed mid-group and stranded "Pitch back"
  // at the top of the second column with no heading over it.
  for (const group of BINDING_GROUPS) {
    const rows = BINDINGS.filter((binding) => binding.group === group);
    if (rows.length === 0) continue;
    const section = element('section', 'keymap__section');
    section.append(element('h4', 'keymap__group', group.toUpperCase()));
    for (const binding of rows) {
      const row = element('div', 'keymap__row');
      row.dataset['action'] = binding.action;

      const keys = element('span', 'keymap__keys');
      for (const code of binding.codes) {
        keys.append(element('kbd', 'key', keyLabel(code)));
      }
      const label = element('span', 'keymap__label', binding.label);
      row.append(keys, label);
      if (binding.note) row.append(element('span', 'keymap__note', binding.note));
      section.append(row);
    }
    list.append(section);
  }

  list.append(element('p', 'keymap__foot', TURN_PROMPT_NOTE));
  return list;
}

export class Screens {
  readonly root = element('div', 'screens');

  private readonly panels = new Map<ScreenName, HTMLElement>();
  private readonly syncers: (() => void)[] = [];
  private readonly modeCards = new Map<ModeId, HTMLButtonElement>();

  private readonly overTitle = element('h2', 'panel__title', 'GAME OVER');
  private readonly overScore = element('p', 'panel__score', '0');
  private readonly overDetail = element('p', 'panel__detail', '');
  private readonly overBest = element('p', 'panel__best', '');
  private readonly statsLine = element('p', 'panel__stats', '');
  private readonly sessionLog = element('ol', 'session');
  private readonly challengeInput = element('input');
  private readonly challengeError = element('p', 'panel__hint', '');
  private readonly dailyLine = element('p', 'panel__detail', '');
  private readonly storageWarning = element('p', 'panel__warning', '');

  private current: ScreenName = 'title';
  private save: SaveData;

  constructor(
    save: SaveData,
    private readonly handlers: ScreenHandlers
  ) {
    this.save = save;
    this.panels.set('title', this.buildTitle());
    this.panels.set('modes', this.buildModes());
    this.panels.set('paused', this.buildPause());
    this.panels.set('over', this.buildGameOver());
    this.panels.set('settings', this.buildSettings());
    this.panels.set('challenge', this.buildChallenge());
    for (const panel of this.panels.values()) this.root.append(panel);
    this.root.addEventListener('keydown', (event) => this.handleArrow(event));
    this.show('title');
  }

  // ------------------------------------------------------------------ panels

  private panel(name: ScreenName, ...children: HTMLElement[]): HTMLElement {
    const panel = element('div', `panel panel--${name}`);
    panel.dataset['screen'] = name;
    panel.append(...children);
    panel.hidden = true;
    return panel;
  }

  private buildTitle(): HTMLElement {
    const title = element('h1', 'title');
    title.append(
      element('span', 'title__word', 'REFRACTION'),
      element('span', 'title__rule', 'Position is absolute. Colour is relative.')
    );

    const actions = element('div', 'panel__actions');
    actions.append(
      button('PLAY', 'button button--primary', () => this.handlers.onOpen('modes')),
      button('CHALLENGE', 'button', () => this.handlers.onOpen('challenge')),
      button('SETTINGS', 'button', () => this.handlers.onOpen('settings'))
    );

    return this.panel(
      'title',
      title,
      actions,
      this.sessionLog,
      this.statsLine,
      this.storageWarning
    );
  }

  private buildModes(): HTMLElement {
    const grid = element('div', 'modes');
    for (const mode of MODES) {
      const card = element('button', 'mode');
      card.type = 'button';
      card.dataset['mode'] = mode.id;
      card.append(
        element('span', 'mode__name', mode.name),
        element('span', 'mode__blurb', mode.blurb),
        element('span', 'mode__best', '')
      );
      card.addEventListener('click', () => {
        if (card.disabled) return;
        this.handlers.onStart(mode.id);
      });
      this.modeCards.set(mode.id, card);
      grid.append(card);
    }

    const actions = element('div', 'panel__actions');
    actions.append(button('BACK', 'button', () => this.handlers.onOpen('title')));

    return this.panel('modes', element('h2', 'panel__title', 'CHOOSE A MODE'), grid, actions);
  }

  private buildPause(): HTMLElement {
    const actions = element('div', 'panel__actions');
    actions.append(
      button('RESUME', 'button button--primary', () => this.handlers.onResume()),
      button('SETTINGS', 'button', () => this.handlers.onOpen('settings')),
      button('QUIT', 'button', () => this.handlers.onQuit())
    );
    return this.panel(
      'paused',
      element('h2', 'panel__title', 'PAUSED'),
      actions,
      element('p', 'panel__hint', 'Esc to resume')
    );
  }

  private buildGameOver(): HTMLElement {
    const actions = element('div', 'panel__actions');
    actions.append(
      button('PLAY AGAIN', 'button button--primary', () => this.handlers.onRestart()),
      button('CHOOSE MODE', 'button', () => this.handlers.onOpen('modes'))
    );
    return this.panel(
      'over',
      this.overTitle,
      this.overScore,
      this.overDetail,
      this.overBest,
      actions,
      element('p', 'panel__hint', 'Press Enter to play again')
    );
  }

  /**
   * Enter a code, or take today's.
   *
   * A code is a `(mode, seed)` pair, so two people entering the same one get
   * bit-identical runs. The daily code is derived from the date by every copy
   * of the game independently -- no server, no clock authority.
   */
  private buildChallenge(): HTMLElement {
    this.challengeInput.type = 'text';
    this.challengeInput.className = 'code';
    this.challengeInput.placeholder = 'A1B2C3D';
    this.challengeInput.maxLength = 9;
    this.challengeInput.spellcheck = false;
    this.challengeInput.autocomplete = 'off';
    this.challengeInput.setAttribute('aria-label', 'Challenge code');

    const start = (): void => {
      const parsed = parseChallenge(this.challengeInput.value);
      if (!parsed) {
        this.challengeError.textContent = 'That is not a challenge code.';
        return;
      }
      this.challengeError.textContent = '';
      this.handlers.onChallenge(parsed);
    };

    this.challengeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') start();
      // The panel owns the keyboard; Esc is handled by the host, everything
      // else must not reach the engine.
      event.stopPropagation();
    });

    const entry = element('div', 'panel__entry');
    entry.append(this.challengeInput, button('START', 'button button--primary', start));

    const actions = element('div', 'panel__actions');
    actions.append(
      button("TODAY'S CHALLENGE", 'button', () => {
        const daily = dailyChallenge(new Date());
        this.challengeInput.value = daily.code;
        this.handlers.onChallenge(daily);
      }),
      button('BACK', 'button', () => this.handlers.onOpen('title'))
    );

    return this.panel(
      'challenge',
      element('h2', 'panel__title', 'CHALLENGE'),
      element(
        'p',
        'panel__detail',
        'A code fixes the mode and every piece that follows. Same code, same game.'
      ),
      entry,
      this.challengeError,
      this.dailyLine,
      actions
    );
  }

  private buildSettings(): HTMLElement {
    const fields = element('div', 'fields');

    const rows = [
      toggleRow(
        'sound',
        'Sound',
        'Music and effects',
        () => !this.save.settings.muted,
        (on) => this.handlers.onSettings({ muted: !on })
      ),
      toggleRow(
        'reducedMotion',
        'Reduced motion',
        'Shortens the turn, and stills the shake and the glow',
        () => this.save.settings.reducedMotion,
        (on) => this.handlers.onSettings({ reducedMotion: on })
      ),
      toggleRow(
        'screenShake',
        'Screen shake',
        'Impact on lock and clear',
        () => this.save.settings.screenShake,
        (on) => this.handlers.onSettings({ screenShake: on })
      ),
      toggleRow(
        'bloom',
        'Bloom',
        'Glow on clears and Prism events',
        () => this.save.settings.bloom,
        (on) => this.handlers.onSettings({ bloom: on })
      ),
      toggleRow(
        'showGhost',
        'Ghost piece',
        'Shows where the piece will land',
        () => this.save.settings.showGhost,
        (on) => this.handlers.onSettings({ showGhost: on })
      ),
    ];
    for (const row of rows) {
      fields.append(row.root);
      this.syncers.push(row.sync);
    }

    // Volume is the one continuous control, so it gets a slider rather than a
    // toggle. Muting is separate on purpose: turning the sound off should not
    // lose the level you had set.
    const volume = element('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.className = 'field__range';
    volume.addEventListener('input', () =>
      this.handlers.onSettings({ volume: Number(volume.value) / 100 })
    );
    const volumeRow = element('label', 'field');
    volumeRow.dataset['field'] = 'volume';
    volumeRow.append(
      volume,
      element('span', 'field__label', 'Volume'),
      element('span', 'field__hint', 'Master level, kept separately from mute')
    );
    fields.append(volumeRow);
    this.syncers.push(() => {
      volume.value = String(Math.round(this.save.settings.volume * 100));
    });

    const actions = element('div', 'panel__actions');
    actions.append(button('BACK', 'button', () => this.handlers.onQuit()));

    return this.panel(
      'settings',
      element('h2', 'panel__title', 'SETTINGS'),
      fields,
      buildKeyMap(),
      buildTouchMap(),
      actions
    );
  }

  // ------------------------------------------------------------------- state

  get screen(): ScreenName {
    return this.current;
  }

  /**
   * Move focus with the arrow keys.
   *
   * The same keys that move a piece move through the menu, so the whole game is
   * reachable without a mouse -- and, more to the point, without the player
   * having to work out that this part of it wants Tab instead.
   *
   * Focusables are grouped into rows by where they actually land on screen
   * rather than by their order in the markup, because the mode grid is a grid:
   * one column on a narrow window and several on a wide one, from the same DOM.
   * Left and right walk the row and spill into the next; up and down change row
   * and keep the nearest horizontal position.
   *
   * Two controls keep their arrows. A text field needs them for the caret, and a
   * slider needs left and right for its value -- taking those would make the
   * volume control unusable by the very keyboard this is meant to serve.
   */
  private handleArrow(event: KeyboardEvent): void {
    const key = event.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') {
      return;
    }
    const panel = this.panels.get(this.current);
    if (!panel || panel.hidden) return;

    const active = document.activeElement;
    if (active instanceof HTMLInputElement) {
      if (active.type === 'text') return;
      if (active.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) return;
    }

    const items = [...panel.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter(
      (node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null
    );
    if (items.length === 0) return;

    const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
    if (index === -1) {
      items[0]?.focus();
      event.preventDefault();
      return;
    }

    const next = nextInDirection(items, index, key);
    if (next) {
      next.focus();
      event.preventDefault();
    }
  }

  show(name: ScreenName): void {
    this.current = name;
    for (const [key, panel] of this.panels) panel.hidden = key !== name;
    // The board stays visible and live behind every screen; only the backdrop
    // changes, so the player never loses sight of what they were doing.
    this.root.hidden = name === 'playing';
    this.root.dataset['screen'] = name;
    this.sync();
    const focusable = this.panels.get(name)?.querySelector('button:not(:disabled)');
    if (focusable instanceof HTMLElement) focusable.focus();
  }

  setSave(save: SaveData): void {
    this.save = save;
    this.sync();
  }

  /** Fill in the game-over panel from a finished run. */
  showOutcome(options: {
    readonly score: number;
    readonly lines: number;
    readonly stage: number;
    readonly best: number;
    readonly personalBest: boolean;
    readonly canFail: boolean;
    /** Present when the run was played under a challenge code. */
    readonly challenge?: string;
  }): void {
    this.overTitle.textContent = options.canFail ? 'GAME OVER' : 'RUN ENDED';
    this.overScore.textContent = options.score.toLocaleString('en-US');
    this.overDetail.textContent = options.challenge
      ? `${options.lines} lines · stage ${options.stage} · ${options.challenge}`
      : `${options.lines} lines · stage ${options.stage}`;
    this.overBest.textContent = options.personalBest
      ? 'NEW BEST'
      : `Best ${options.best.toLocaleString('en-US')}`;
    this.overBest.classList.toggle('panel__best--new', options.personalBest);
  }

  private sync(): void {
    for (const syncer of this.syncers) syncer();

    const best = this.save.stats.bestStage;
    for (const mode of MODES) {
      const card = this.modeCards.get(mode.id);
      if (!card) continue;
      const unlocked = isUnlocked(mode, best);
      card.disabled = !unlocked;
      card.classList.toggle('mode--locked', !unlocked);
      const note = card.querySelector('.mode__best');
      if (note) note.textContent = this.modeNote(mode, unlocked);
    }

    // The session log is the shape of a sitting, which bests alone cannot show.
    this.sessionLog.replaceChildren(
      ...this.save.session.slice(0, 5).map((run) => {
        const name = MODES.find((mode) => mode.id === run.mode)?.name ?? run.mode;
        const label = run.challenge ? `${name} · ${run.challenge}` : name;
        return element(
          'li',
          'session__row',
          `${label} — ${run.score.toLocaleString('en-US')} · ${run.lines} lines`
        );
      })
    );
    this.sessionLog.hidden = this.save.session.length === 0;

    this.dailyLine.textContent = `Today: ${dailyChallenge(new Date()).code}`;

    const stats = this.save.stats;
    this.statsLine.textContent =
      stats.runs > 0
        ? `${stats.runs} runs · ${stats.lines.toLocaleString('en-US')} lines · ${stats.turns.toLocaleString('en-US')} turns`
        : '';
  }

  private modeNote(mode: ModeConfig, unlocked: boolean): string {
    if (!unlocked) return mode.unlock?.description ?? 'Locked';
    const record = this.save.records[mode.id];
    if (!record || record.runs === 0) return 'Not yet played';
    return `Best ${record.bestScore.toLocaleString('en-US')}`;
  }

  /** Shown once, on the title screen, when progress cannot be saved. */
  warnUnwritableStorage(): void {
    this.storageWarning.textContent =
      'Progress cannot be saved in this browser. Scores will not be kept.';
  }
}
