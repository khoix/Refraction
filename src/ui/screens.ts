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

import { DEFAULT_MODE_ID, MODE_DIFFICULTY_MAX, MODES, isUnlocked, modeById } from '@core/modes';
import type { ModeConfig, ModeId } from '@core/modes';
import { dailyChallenge, parseChallenge } from '@core/challenge';
import type { Challenge } from '@core/challenge';
import { TOUCH_SENSITIVITY_MAX, TOUCH_SENSITIVITY_MIN } from '@core/save';
import type { SaveData, Settings } from '@core/save';
import {
  BINDING_GROUPS,
  TOUCH_ACTIONS,
  TOUCH_TURN_NOTE,
  TURN_PROMPT_NOTE,
  appliesToMode,
  capsForProfile,
  keyLabel,
  profileForMode,
  rebindAction,
  remapFromSave,
  resolveBindings,
} from '../keymap';
import type { Action, Binding, BindingGroup, BindingProfile } from '../keymap';
import { buildKeyboardDiagram, buildTouchDiagram } from './control-diagram';

export type ScreenName =
  | 'boot'
  | 'title'
  | 'modes'
  | 'playing'
  | 'paused'
  | 'over'
  | 'settings'
  | 'settings-controls'
  | 'challenge';

/**
 * How long a panel takes to hand over to the next one.
 *
 * Must match the CSS, which owns the actual animation -- this only decides when
 * the outgoing panel stops being on screen at all. Short enough that it never
 * feels like waiting for the interface.
 */
const CROSSFADE_MS = 280;

export interface ScreenHandlers {
  readonly onStart: (mode: ModeId) => void;
  /** The tap that opens the front door: the first gesture, and the only one
   *  that is allowed to start an `AudioContext`. */
  readonly onEnter: () => void;
  /** Start a run pinned to a challenge code. */
  readonly onChallenge: (challenge: Challenge) => void;
  /** Start the hybrid tutorial from the title screen. */
  readonly onTutorial: () => void;
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

/** Title row with a back control tucked against the left of the heading. */
function panelMasthead(title: string, onBack: () => void): HTMLElement {
  const head = element('div', 'panel__masthead');
  const inner = element('div', 'panel__masthead-inner');
  const back = button('←', 'panel__back', onBack);
  back.setAttribute('aria-label', 'Back');
  inner.append(back, element('h2', 'panel__title', title));
  head.append(inner);
  return head;
}

/** Filled and empty pips for the mode card's difficulty rating. */
function difficultyPips(rating: number): string {
  const filled = Math.max(0, Math.min(MODE_DIFFICULTY_MAX, Math.round(rating)));
  return `${'●'.repeat(filled)}${'○'.repeat(MODE_DIFFICULTY_MAX - filled)}`;
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
 * The wordmark, built fresh each time it is needed.
 *
 * Two screens show it -- the boot gate and the title -- and a DOM node cannot be
 * in two panels at once, so this is a factory rather than a shared constant.
 * They are deliberately identical: the mark moves from the centre of the screen
 * to the masthead when the door opens, and if it were also a different mark that
 * would read as a second screen rather than as the same one settling.
 */
function wordmark(tagline: boolean): HTMLElement {
  const title = element('h1', 'title');
  // Hairlines bracket the wordmark. Presentational, so they are `<hr>` inside
  // the heading rather than borders on it -- the mark needs to breathe between
  // them, and a border cannot fade out at its ends.
  /*
   * The O is a cube.
   *
   * The one place the wordmark is allowed to say what the game is about, and it
   * costs nothing: `REFRACTI` + a drawn cube + `N` reads as the word at a glance
   * and as a cube a moment later. Inline SVG rather than a glyph so it takes the
   * heading's own colour and glow, and scales with the type instead of being a
   * picture pasted next to it.
   *
   * Marked `aria-hidden` with the letter supplied to assistive technology
   * separately, so the accessible name stays the word rather than "REFRACTI N".
   */
  const word = element('span', 'title__word');
  word.append(element('span', 'title__letters', 'REFRACTI'));
  const cube = element('span', 'title__cube');
  cube.setAttribute('aria-hidden', 'true');
  /*
   * The voxel, in the artwork's own projection.
   *
   * Corner-on: yawed 45 degrees so no face is square to the viewer, and tilted
   * about 20 degrees above the horizon. The silhouette is therefore a hexagon
   * with two vertical sides, and three edges meet at a junction inside it --
   * down to the bottom vertex, up-left and up-right to the shoulders.
   *
   * Every number here was read off the screenshot rather than chosen. Solving
   * the orthographic projection against the measured silhouette -- half-height
   * 57px, junction 18px above centre -- gives an elevation of 20.19 degrees, and
   * that model then predicts a 75px vertical side edge where the artwork has 74.
   *
   * The tilt is the whole point, and it is what the first version got wrong. It
   * had been drawn in cabinet projection -- a square front face with the top and
   * side sheared off behind it -- which is a drawing convention rather than a
   * viewpoint. True isometric would be wrong too, in the other direction: 35.26
   * degrees lifts the junction to the middle of the shape and shows far more of
   * the top face than the artwork does.
   *
   * The three faces carry different fills because the artwork lights them
   * differently -- the top catches most, the right least.
   */
  cube.innerHTML = `<svg viewBox="0 0 100 100" focusable="false" aria-hidden="true"><g><path d="M50 3 L96.6 19.1 L50 35.2 L3.4 19.1 Z" fill="currentColor" fill-opacity="0.2" stroke="none"/><path d="M3.4 19.1 L50 35.2 L50 97 L3.4 80.9 Z" fill="currentColor" fill-opacity="0.1" stroke="none"/><path d="M50 35.2 L96.6 19.1 L96.6 80.9 L50 97 Z" fill="currentColor" fill-opacity="0.075" stroke="none"/><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M50 3 L96.6 19.1 L96.6 80.9 L50 97 L3.4 80.9 L3.4 19.1 Z"/><path d="M3.4 19.1 L50 35.2 L96.6 19.1 M50 35.2 L50 97"/></g></g></svg>`;
  const letterO = element('span', 'sr-only', 'O');
  word.append(cube, letterO, element('span', 'title__letters', 'N'));

  title.append(element('hr', 'title__rules'), word, element('hr', 'title__rules'));
  // The front door goes without it. The line is the game's thesis and it earns
  // its place over the menu, but the first screen is carrying a loading bar and
  // a way in already, and the mark reads harder with nothing under it.
  if (tagline) {
    title.append(element('span', 'title__rule', 'Position is absolute. Colour is relative.'));
  }
  return title;
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
 * resolved bindings.
 */
function buildTouchMap(mode: ModeConfig): HTMLElement {
  const list = element('div', 'keymap keymap--touch');
  list.append(element('h3', 'keymap__title', 'CONTROLS'));

  for (const group of BINDING_GROUPS) {
    const rows = TOUCH_ACTIONS.filter(
      (action) => action.group === group && appliesToMode(action, mode)
    );
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

const CONTROL_TABLE_CELL: Readonly<Record<BindingGroup, string>> = {
  Move: 'controls-editor__cell--move',
  Rotate: 'controls-editor__cell--rotate',
  Depth: 'controls-editor__cell--depth',
  Game: 'controls-editor__cell--game',
};

export class Screens {
  readonly root = element('div', 'screens');

  private readonly panels = new Map<ScreenName, HTMLElement>();
  private readonly syncers: (() => void)[] = [];
  private readonly modeCards = new Map<ModeId, HTMLButtonElement>();

  private readonly overTitle = element('h2', 'panel__title over__title', 'GAME OVER');
  private readonly overScore = element('p', 'panel__score over__value', '0');
  private readonly overLines = element('span', 'over__stat-value', '0');
  private readonly overStage = element('span', 'over__stat-value', '1');
  private readonly overDetail = element('p', 'panel__detail over__challenge', '');
  /**
   * Where the two controls panels live, so they can be rebuilt.
   *
   * They describe what the *mode in play* answers to, and a mode can withhold a
   * verb outright: Flatland permits roll alone and never offers the depth nudge,
   * so a panel built once at boot would advertise four keys and two gestures the
   * engine ignores.
   */
  private readonly controls = element('div', 'settings-controls__stack');
  private readonly settingsControlsHost = element('div', 'settings-controls-host');
  private readonly settingsControlsPageHost = element('div', 'settings-controls-page__editor');
  private mode: ModeConfig = modeById(DEFAULT_MODE_ID);
  /** Settings tab: which binding profile is being edited. */
  private settingsProfile: BindingProfile = 'roll';
  private rebindTarget: Action | null = null;
  private readonly onRebindKey = (event: KeyboardEvent): void => this.captureRebind(event);
  private readonly onRebindMouse = (event: MouseEvent): void => this.captureRebindMouse(event);
  private readonly overBest = element('p', 'panel__best over__best', '');
  private readonly statsLine = element('p', 'scores__stats', '');
  private readonly sessionLog = element('ol', 'scores__log');
  /** Title-screen ledger: collapsed until the player asks to see it. */
  private readonly scores = element('div', 'scores');
  private readonly scoresToggle = element('button', 'scores__toggle');
  private readonly scoresPanel = element('div', 'scores__panel');
  private scoresOpen = false;
  private readonly challengeInput = element('input');
  private readonly challengeError = element('p', 'panel__hint', '');
  private readonly dailyLine = element('p', 'panel__detail', '');
  private readonly storageWarning = element('p', 'panel__warning', '');

  /** The boot gate's three moving parts. */
  private readonly loadingBar = element('div', 'loading__bar');
  private readonly loadingFill = element('div', 'loading__fill');
  private readonly loadingNote = element('p', 'loading__note', 'LOADING');
  /** Says why there will be no music, when there will be none. */
  private readonly musicNote = element('p', 'loading__note loading__note--warn', '');
  private readonly enterButton = button('TAP TO PLAY', 'button button--primary', () =>
    this.handlers.onEnter()
  );

  private current: ScreenName = 'boot';
  /** Hides the outgoing panel once its fade has run. */
  private leavingTimer: ReturnType<typeof setTimeout> | undefined;
  private save: SaveData;

  constructor(
    save: SaveData,
    private readonly handlers: ScreenHandlers
  ) {
    this.save = save;
    this.overDetail.hidden = true;
    this.panels.set('boot', this.buildBoot());
    this.panels.set('title', this.buildTitle());
    this.panels.set('modes', this.buildModes());
    this.panels.set('paused', this.buildPause());
    this.panels.set('over', this.buildGameOver());
    this.setMode(this.mode);
    this.panels.set('settings', this.buildSettings());
    this.panels.set('settings-controls', this.buildSettingsControls());
    this.panels.set('challenge', this.buildChallenge());
    for (const panel of this.panels.values()) this.root.append(panel);
    this.root.addEventListener('keydown', (event) => this.handleArrow(event));
    // The front door, not the title. A deep link overrides this from the host
    // before the first frame; see `main.ts`.
    this.show('boot');
  }

  // ------------------------------------------------------------------ panels

  private panel(name: ScreenName, ...children: HTMLElement[]): HTMLElement {
    const panel = element('div', `panel panel--${name}`);
    panel.dataset['screen'] = name;
    panel.append(...children);
    panel.hidden = true;
    return panel;
  }

  /**
   * The front door.
   *
   * Two jobs, and the second is the reason it exists at all. It fills the wait
   * on a large asset with something to look at -- and it collects the one user
   * gesture a browser requires before an `AudioContext` may start. Without a
   * screen like this, the first sound in the game is whatever the player happens
   * to press first, and menu music simply cannot exist.
   *
   * The button is `hidden` *and* `disabled` until loading finishes, which is one
   * belt more than it looks. `show` focuses the first enabled button in a panel,
   * and `hidden` alone would leave an invisible button to take focus and answer
   * a stray Enter -- opening the door before the thing behind it had arrived.
   */
  private buildBoot(): HTMLElement {
    this.loadingBar.append(this.loadingFill);
    this.loadingBar.setAttribute('role', 'progressbar');
    this.loadingBar.setAttribute('aria-valuemin', '0');
    this.loadingBar.setAttribute('aria-valuemax', '100');
    this.loadingBar.setAttribute('aria-label', 'Loading');

    this.musicNote.hidden = true;
    const loading = element('div', 'loading');
    loading.append(this.loadingBar, this.loadingNote, this.musicNote);

    const actions = element('div', 'panel__actions');
    actions.append(this.enterButton);

    const panel = this.panel('boot', wordmark(false), loading, actions);
    this.setLoading(0);
    this.setReady(false);
    return panel;
  }

  /**
   * Move the bar.
   *
   * Width only -- no transition longer than a frame or two, because a bar that
   * eases toward its target is showing an animation rather than a download, and
   * the two disagree most at the end, which is exactly when the player is
   * watching.
   */
  setLoading(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    const percent = Math.round(clamped * 100);
    this.loadingFill.style.width = `${percent}%`;
    this.loadingBar.setAttribute('aria-valuenow', String(percent));
    this.loadingBar.dataset['value'] = String(percent);
  }

  /**
   * Report that the music will not play, and why.
   *
   * On the gate rather than in a log, because the player is the one who notices
   * the silence and has no other way to tell it apart from their own volume being
   * down. Null clears it.
   */
  setMusicNote(note: string | null): void {
    this.musicNote.textContent = note ?? '';
    this.musicNote.hidden = note === null;
  }

  /** Reveal the way in. Idempotent, so it can be driven from state. */
  setReady(ready: boolean): void {
    this.enterButton.hidden = !ready;
    this.enterButton.disabled = !ready;
    this.loadingNote.textContent = ready ? 'READY' : 'LOADING';
    const panel = this.panels.get('boot');
    panel?.classList.toggle('panel--ready', ready);
    if (ready && this.current === 'boot') this.enterButton.focus();
  }

  private buildTitle(): HTMLElement {
    const title = wordmark(true);

    const actions = element('div', 'panel__actions');
    actions.append(
      button('PLAY', 'button button--primary', () => this.handlers.onOpen('modes')),
      button('TUTORIAL', 'button', () => this.handlers.onTutorial()),
      button('CHALLENGE', 'button', () => this.handlers.onOpen('challenge')),
      button('SETTINGS', 'button', () => this.handlers.onOpen('settings'))
    );

    return this.panel('title', title, actions, this.buildScores(), this.storageWarning);
  }

  /**
   * Recent runs and lifetime totals, behind a fold.
   *
   * The title already has three destinations. Leaving the ledger open would push
   * the wordmark and the play row up with a list nobody asked to read yet. The
   * fold keeps the first look as mark + actions; a click opens the sitting.
   *
   * The body is taken out of flow when it opens, so the centred title block does
   * not re-balance upward -- the ledger only ever grows down from the toggle.
   */
  private buildScores(): HTMLElement {
    this.scoresToggle.type = 'button';
    this.scoresToggle.setAttribute('aria-expanded', 'false');
    this.scoresToggle.setAttribute('aria-controls', 'scores-panel');
    const caret = element('span', 'scores__caret', '▾');
    caret.setAttribute('aria-hidden', 'true');
    const lead = element('span', 'scores__rule', '');
    lead.setAttribute('aria-hidden', 'true');
    const trail = element('span', 'scores__rule', '');
    trail.setAttribute('aria-hidden', 'true');
    this.scoresToggle.append(lead, element('span', 'scores__label', 'SCORES'), caret, trail);
    this.scoresToggle.addEventListener('click', () => this.setScoresOpen(!this.scoresOpen));

    this.scoresPanel.id = 'scores-panel';
    this.scoresPanel.setAttribute('aria-hidden', 'true');
    this.scoresPanel.setAttribute('inert', '');
    const clip = element('div', 'scores__clip');
    clip.append(this.statsLine, this.sessionLog);
    this.scoresPanel.append(clip);

    this.scores.append(this.scoresToggle, this.scoresPanel);
    this.scores.hidden = true;
    return this.scores;
  }

  private setScoresOpen(open: boolean): void {
    this.scoresOpen = open;
    this.scores.classList.toggle('scores--open', open);
    this.scoresToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.scoresPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) this.scoresPanel.removeAttribute('inert');
    else this.scoresPanel.setAttribute('inert', '');
  }

  private buildModes(): HTMLElement {
    const grid = element('div', 'modes');
    for (const mode of MODES) {
      const card = element('button', 'mode');
      card.type = 'button';
      card.dataset['mode'] = mode.id;
      const head = element('span', 'mode__head');
      const rating = element('span', 'mode__difficulty', difficultyPips(mode.difficulty));
      rating.setAttribute(
        'aria-label',
        `Difficulty ${mode.difficulty} of ${MODE_DIFFICULTY_MAX}`
      );
      head.append(element('span', 'mode__name', mode.name), rating);
      card.append(head, element('span', 'mode__blurb', mode.blurb), element('span', 'mode__best', ''));
      card.addEventListener('click', () => {
        if (card.disabled) return;
        this.handlers.onStart(mode.id);
      });
      this.modeCards.set(mode.id, card);
      grid.append(card);
    }

    return this.panel(
      'modes',
      panelMasthead('CHOOSE A MODE', () => this.handlers.onOpen('title')),
      grid
    );
  }

  private buildPause(): HTMLElement {
    const actions = element('div', 'panel__actions');
    actions.append(
      button('RESUME', 'button button--primary', () => this.handlers.onResume()),
      button('SETTINGS', 'button', () => this.handlers.onOpen('settings')),
      button('MAIN MENU', 'button', () => this.handlers.onQuit())
    );
    return this.panel(
      'paused',
      element('h2', 'panel__title', 'PAUSED'),
      actions,
      element('p', 'panel__hint panel__hint--keys', 'Esc to resume'),
      element('p', 'panel__hint panel__hint--touch', 'Tap Resume to continue')
    );
  }

  private buildGameOver(): HTMLElement {
    const mast = element('div', 'over__mast');
    mast.append(
      element('hr', 'over__rule'),
      this.overTitle,
      element('hr', 'over__rule')
    );

    const score = element('div', 'over__score');
    score.append(element('span', 'over__label', 'SCORE'), this.overScore, this.overBest);

    const lines = element('div', 'over__stat');
    lines.append(element('span', 'over__stat-label', 'LINES'), this.overLines);
    const stage = element('div', 'over__stat');
    stage.append(element('span', 'over__stat-label', 'STAGE'), this.overStage);
    const stats = element('div', 'over__stats');
    stats.append(lines, stage);

    const result = element('div', 'over');
    result.append(mast, score, stats, this.overDetail);

    const actions = element('div', 'panel__actions');
    actions.append(
      button('PLAY AGAIN', 'button button--primary', () => this.handlers.onRestart()),
      button('CHOOSE MODE', 'button', () => this.handlers.onOpen('modes')),
      button('MAIN MENU', 'button', () => this.handlers.onQuit())
    );
    return this.panel(
      'over',
      result,
      actions,
      element('p', 'panel__hint panel__hint--keys', 'Press Enter to play again'),
      element('p', 'panel__hint panel__hint--touch', 'Tap Play Again to restart')
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
      })
    );

    return this.panel(
      'challenge',
      panelMasthead('CHALLENGE', () => this.handlers.onOpen('title')),
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

    const controlsNav = element('button', 'field field--nav settings-nav-controls');
    controlsNav.type = 'button';
    controlsNav.append(
      element('span', 'field__label', 'Controls'),
      element('span', 'field__hint', 'Tap zones and gestures')
    );
    controlsNav.addEventListener('click', () => this.handlers.onOpen('settings-controls'));
    fields.append(controlsNav);

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
        'spinPreview',
        'Turning preview',
        'Shows the next piece in three dimensions. Off is harder',
        () => this.save.settings.spinPreview,
        (on) => this.handlers.onSettings({ spinPreview: on })
      ),
      toggleRow(
        'bloom',
        'Bloom',
        'Glow on clears and Prism events',
        () => this.save.settings.bloom,
        (on) => this.handlers.onSettings({ bloom: on })
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
    volumeRow.append(volume, element('span', 'field__label', 'Volume'));
    fields.append(volumeRow);

    /*
     * Touch sensitivity: how far a drag travels to move the piece one column.
     *
     * Shown wherever the device *has* touch at all -- `any-pointer: coarse`,
     * which a touchscreen laptop matches and a mouse-only desktop does not. The
     * controls panels swap on `pointer: coarse`, the stricter test for "touch is
     * the only way in", and that is right for choosing which of two panels to
     * show. It would be wrong here: hiding a setting a player can actually use
     * is not tidying, it is making it unreachable.
     */
    const sensitivity = element('input');
    sensitivity.type = 'range';
    sensitivity.min = String(Math.round(TOUCH_SENSITIVITY_MIN * 100));
    sensitivity.max = String(Math.round(TOUCH_SENSITIVITY_MAX * 100));
    sensitivity.step = '10';
    sensitivity.className = 'field__range';
    sensitivity.addEventListener('input', () =>
      this.handlers.onSettings({ touchSensitivity: Number(sensitivity.value) / 100 })
    );
    const sensitivityRow = element('label', 'field field--touch');
    sensitivityRow.dataset['field'] = 'touchSensitivity';
    sensitivityRow.append(
      sensitivity,
      element('span', 'field__label', 'Touch sensitivity'),
      element('span', 'field__hint', 'How far a drag moves the piece')
    );
    fields.append(sensitivityRow);
    this.syncers.push(() => {
      sensitivity.value = String(Math.round(this.save.settings.touchSensitivity * 100));
    });
    this.syncers.push(() => {
      volume.value = String(Math.round(this.save.settings.volume * 100));
    });

    const preferences = element('section', 'settings-preferences');
    preferences.append(element('h3', 'settings-section__title', 'PREFERENCES'), fields);

    const controlsSection = element('section', 'settings-controls');
    controlsSection.append(
      element('h3', 'settings-section__title', 'CONTROLS'),
      this.settingsControlsHost
    );
    this.settingsControlsHost.append(this.controls);

    const body = element('div', 'settings-body');
    body.append(preferences, controlsSection);

    return this.panel(
      'settings',
      panelMasthead('SETTINGS', () => this.handlers.onQuit()),
      body
    );
  }

  private buildSettingsControls(): HTMLElement {
    const body = element('div', 'settings-controls-page__body');
    body.append(this.settingsControlsPageHost);

    return this.panel(
      'settings-controls',
      panelMasthead('CONTROLS', () => this.handlers.onOpen('settings')),
      body
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
      (node) =>
        !(node as HTMLButtonElement).disabled &&
        node.offsetParent !== null &&
        !node.closest('[inert]')
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

  /**
   * Tell the panels which mode's controls to describe, and rebuild the
   * settings remap UI for the matching profile.
   */
  setMode(mode: ModeConfig): void {
    this.mode = mode;
    this.settingsProfile = profileForMode(mode);
    this.rebuildControls();
  }

  private profileBindings(profile: BindingProfile): readonly Binding[] {
    return resolveBindings(profile, remapFromSave(this.save.settings.bindings[profile]));
  }

  /** Toggle Flatland / 3D panes without rebuilding — keeps layout height pinned. */
  private syncControlsProfile(): void {
    const profile = this.settingsProfile;
    for (const pane of this.controls.querySelectorAll<HTMLElement>('[data-controls-profile]')) {
      const active = pane.dataset['controlsProfile'] === profile;
      pane.classList.toggle('controls-profile-pane--off', !active);
      if (active) {
        pane.removeAttribute('inert');
        pane.removeAttribute('aria-hidden');
      } else {
        pane.setAttribute('inert', '');
        pane.setAttribute('aria-hidden', 'true');
      }
    }
    const flatTab = this.controls.querySelector<HTMLButtonElement>('#controls-tab-roll');
    const fullTab = this.controls.querySelector<HTMLButtonElement>('#controls-tab-full');
    const panel = this.controls.querySelector('#controls-panel-profile');
    if (flatTab) {
      flatTab.classList.toggle('controls-editor__tab--on', profile === 'roll');
      flatTab.setAttribute('aria-selected', profile === 'roll' ? 'true' : 'false');
      flatTab.tabIndex = profile === 'roll' ? 0 : -1;
    }
    if (fullTab) {
      fullTab.classList.toggle('controls-editor__tab--on', profile === 'full');
      fullTab.setAttribute('aria-selected', profile === 'full' ? 'true' : 'false');
      fullTab.tabIndex = profile === 'full' ? 0 : -1;
    }
    panel?.setAttribute(
      'aria-labelledby',
      profile === 'roll' ? 'controls-tab-roll' : 'controls-tab-full'
    );
  }

  private buildBindingRow(binding: Binding, mode: ModeConfig): HTMLElement {
    const row = button('', 'keymap__row keymap__row--rebind', () =>
      this.startRebind(binding.action)
    );
    row.dataset['action'] = binding.action;
    if (this.rebindTarget === binding.action) {
      row.classList.add('keymap__row--listening');
    }
    const keys = element('span', 'keymap__keys');
    for (const code of binding.codes) {
      keys.append(element('kbd', 'key', keyLabel(code)));
    }
    row.append(keys, element('span', 'keymap__label', binding.label));
    const note =
      binding.action === 'peek' && mode.peekPolicy === 'byStage'
        ? 'Until stage 6'
        : binding.note;
    if (note) row.append(element('span', 'keymap__note', note));
    return row;
  }

  private buildControlTableCell(
    profile: BindingProfile,
    group: BindingGroup,
    mode: ModeConfig
  ): HTMLElement {
    const bindings = this.profileBindings(profile);
    const caps = capsForProfile(profile);
    const cell = element('section', `controls-editor__cell ${CONTROL_TABLE_CELL[group]}`);
    cell.append(element('h4', 'controls-editor__cell-title', group.toUpperCase()));

    const rows = bindings.filter(
      (binding) =>
        binding.group === group &&
        appliesToMode(binding, {
          rotation: caps.rotation,
          depthNudge: caps.depthNudge,
          spectralCollapse: caps.spectralCollapse,
          peekPolicy: caps.peekPolicy,
        })
    );
    for (const binding of rows) {
      cell.append(this.buildBindingRow(binding, mode));
    }
    if (group === 'Game') {
      cell.append(element('p', 'keymap__foot', TURN_PROMPT_NOTE));
    }
    return cell;
  }

  private buildControlTable(profile: BindingProfile): HTMLElement {
    const bindings = this.profileBindings(profile);
    const mode = profile === 'roll' ? modeById('flatland') : modeById('ascent');

    const table = element('div', 'controls-editor__table keymap');

    const piece = element('div', 'controls-editor__piece');
    piece.append(element('h4', 'controls-editor__cell-title', 'PIECE CONTROLS'));
    const diagrams = element('div', 'controls-editor__diagrams');
    diagrams.append(buildKeyboardDiagram(profile, bindings));
    piece.append(diagrams);
    table.append(piece);

    for (const group of BINDING_GROUPS) {
      table.append(this.buildControlTableCell(profile, group, mode));
    }

    return table;
  }

  private buildPanelHead(profile: BindingProfile): HTMLElement {
    const head = element('div', 'controls-editor__panel-head');
    head.append(
      button('Reset profile', 'controls-editor__reset', () => {
        this.handlers.onSettings({
          bindings: {
            ...this.save.settings.bindings,
            [profile]: {},
          },
        });
        this.rebuildControls();
      })
    );
    return head;
  }

  private rebuildControls(): void {
    const profile = this.settingsProfile;
    const profiles: readonly BindingProfile[] = ['roll', 'full'];

    const editor = element('div', 'controls-editor');
    const tabs = element('div', 'controls-editor__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Control profile');
    const flatTab = button('Flatland', 'controls-editor__tab', () => {
      if (this.settingsProfile === 'roll') return;
      this.settingsProfile = 'roll';
      this.syncControlsProfile();
    });
    flatTab.id = 'controls-tab-roll';
    flatTab.setAttribute('role', 'tab');
    flatTab.setAttribute('aria-controls', 'controls-panel-profile');
    const fullTab = button('3D modes', 'controls-editor__tab', () => {
      if (this.settingsProfile === 'full') return;
      this.settingsProfile = 'full';
      this.syncControlsProfile();
    });
    fullTab.id = 'controls-tab-full';
    fullTab.setAttribute('role', 'tab');
    fullTab.setAttribute('aria-controls', 'controls-panel-profile');
    tabs.append(flatTab, fullTab);
    editor.append(tabs);

    const profileStack = element('div', 'controls-editor__stack');
    profileStack.id = 'controls-panel-profile';
    profileStack.setAttribute('role', 'tabpanel');
    for (const p of profiles) {
      const pane = element('div', 'controls-editor__profile-pane');
      pane.dataset['controlsProfile'] = p;
      if (p !== profile) pane.classList.add('controls-profile-pane--off');

      const bindings = this.profileBindings(p);
      const displayMode = p === 'roll' ? modeById('flatland') : modeById('ascent');

      const panel = element('div', 'controls-editor__panel');
      panel.append(this.buildPanelHead(p), this.buildControlTable(p));

      const touch = element('div', 'controls-editor__touch');
      const touchDiagrams = element('div', 'controls-editor__diagrams');
      touchDiagrams.append(buildTouchDiagram(p, bindings));
      touch.append(touchDiagrams, buildTouchMap(displayMode));

      pane.append(panel, touch);
      profileStack.append(pane);
    }
    editor.append(profileStack);

    this.controls.replaceChildren(editor);
    this.syncControlsProfile();
    this.mountControls();
  }

  private startRebind(action: Action): void {
    this.stopRebind();
    this.rebindTarget = action;
    this.rebuildControls();
    window.addEventListener('keydown', this.onRebindKey, true);
    window.addEventListener('mousedown', this.onRebindMouse, true);
  }

  private stopRebind(): void {
    this.rebindTarget = null;
    window.removeEventListener('keydown', this.onRebindKey, true);
    window.removeEventListener('mousedown', this.onRebindMouse, true);
  }

  private captureRebind(event: KeyboardEvent): void {
    if (!this.rebindTarget) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      this.stopRebind();
      this.rebuildControls();
      return;
    }
    this.applyRebind([event.code]);
  }

  private captureRebindMouse(event: MouseEvent): void {
    if (!this.rebindTarget) return;
    // Only capture mouse buttons when rebinding soft/hard drop style actions,
    // or always allow Mouse0/Mouse2 as bindable codes.
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    const code = event.button === 0 ? 'Mouse0' : 'Mouse2';
    this.applyRebind([code]);
  }

  private applyRebind(codes: readonly string[]): void {
    const action = this.rebindTarget;
    if (!action) return;
    const profile = this.settingsProfile;
    const current = remapFromSave(this.save.settings.bindings[profile]);
    const next = rebindAction(profile, current, action, codes);
    this.stopRebind();
    if (!next) {
      this.rebuildControls();
      return;
    }
    this.handlers.onSettings({
      bindings: {
        ...this.save.settings.bindings,
        [profile]: next,
      },
    });
    this.rebuildControls();
  }

  /**
   * Swap panels with a cross-fade rather than a cut.
   *
   * `hidden` is `display: none`, which no transition can animate across, so the
   * outgoing panel is held on screen for the length of the fade and hidden
   * afterwards. It keeps `hidden` as the end state, so assistive technology and
   * the end-to-end suite still see exactly one panel -- the fade is a moment, not
   * a second source of truth about which screen this is.
   *
   * It matters most between the front door and the menu, which are the same
   * picture a moment apart: the wordmark rises to the masthead as the buttons
   * arrive, and the board draws forward out of its backdrop framing over a
   * slightly longer beat. Cutting between two near-identical screens read as a
   * flicker, which is the thing that made it feel abrupt.
   *
   * Leaving is skipped on the way into a run: `root.hidden` takes the whole
   * layer away at once there, and a run should start immediately.
   */
  /** Keep the shared controls editor mounted in the panel that is showing it. */
  private mountControls(): void {
    const host =
      this.current === 'settings-controls'
        ? this.settingsControlsPageHost
        : this.settingsControlsHost;
    if (this.controls.parentElement !== host) {
      host.append(this.controls);
    }
  }

  show(name: ScreenName): void {
    const previous = this.current;
    this.current = name;

    if (this.leavingTimer !== undefined) {
      clearTimeout(this.leavingTimer);
      this.leavingTimer = undefined;
    }
    for (const panel of this.panels.values()) panel.classList.remove('panel--leaving');

    const leaving = previous !== name && name !== 'playing' ? this.panels.get(previous) : undefined;
    for (const [key, panel] of this.panels) {
      panel.hidden = key !== name && panel !== leaving;
      // Cleared unconditionally, including on the panel marked below: one that
      // was left mid-fade and is now being shown again must not keep the flags
      // from that fade.
      panel.removeAttribute('inert');
      panel.removeAttribute('aria-hidden');
    }
    if (leaving) {
      leaving.classList.add('panel--leaving');
      /*
       * Gone from the accessibility tree the instant it starts leaving, not when
       * it finishes.
       *
       * A fading panel is still painted, and without this it is still *present*:
       * its buttons keep their place in the tab order and a screen reader reads
       * two screens at once. `pointer-events: none` hides none of that -- it only
       * stops the mouse.
       *
       * The end-to-end suite found it before a person did, and the way it found
       * it is the argument for fixing it here rather than in the test: for 280 ms
       * after the door opens there were two buttons whose names contain "play",
       * which is exactly the ambiguity a player navigating by voice or by screen
       * reader would have hit.
       */
      leaving.setAttribute('inert', '');
      leaving.setAttribute('aria-hidden', 'true');
      this.leavingTimer = setTimeout(() => {
        this.leavingTimer = undefined;
        leaving.classList.remove('panel--leaving');
        // Guarded: the player may have come back to it inside the fade.
        if (this.current !== previous) leaving.hidden = true;
      }, CROSSFADE_MS);
    }

    // The board stays visible and live behind every screen; only the backdrop
    // changes, so the player never loses sight of what they were doing.
    this.root.hidden = name === 'playing';
    this.root.dataset['screen'] = name;
    this.mountControls();
    this.sync();
    // The mode grid opens on the mode you last played, not on whichever card
    // happens to be first in the table. For a new save that is the default mode,
    // which is what makes "the default mode" mean anything on screen rather than
    // only in storage; for anyone else it is where they left off.
    const preferred =
      name === 'modes' ? this.modeCards.get(this.save.lastMode as ModeId) : undefined;
    const focusable =
      preferred && !preferred.disabled
        ? preferred
        : this.panels.get(name)?.querySelector('button:not(:disabled)');
    if (focusable instanceof HTMLElement) focusable.focus();
  }

  setSave(save: SaveData): void {
    this.save = save;
    this.sync();
    // Remaps live in settings; keep the editor in step when commit() updates save.
    if (this.current === 'settings' || this.current === 'settings-controls') this.rebuildControls();
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
    this.overLines.textContent = options.lines.toLocaleString('en-US');
    this.overStage.textContent = String(options.stage);
    this.overDetail.textContent = options.challenge ? options.challenge : '';
    this.overDetail.hidden = !options.challenge;
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
        const row = element('li', 'scores__row');
        row.append(
          element('span', 'scores__mode', label),
          element('span', 'scores__score', run.score.toLocaleString('en-US')),
          element('span', 'scores__meta', `${run.lines} lines · stage ${run.stage}`)
        );
        return row;
      })
    );
    this.sessionLog.hidden = this.save.session.length === 0;

    this.dailyLine.textContent = `Today: ${dailyChallenge(new Date()).code}`;

    const stats = this.save.stats;
    this.statsLine.textContent =
      stats.runs > 0
        ? `${stats.runs} runs · ${stats.lines.toLocaleString('en-US')} lines · ${stats.turns.toLocaleString('en-US')} turns`
        : '';
    this.statsLine.hidden = stats.runs === 0;

    // No ledger until there is something to open. Closing when emptied keeps a
    // stale open panel from lingering after a cleared save.
    const hasScores = stats.runs > 0 || this.save.session.length > 0;
    this.scores.hidden = !hasScores;
    if (!hasScores) this.setScoresOpen(false);
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
