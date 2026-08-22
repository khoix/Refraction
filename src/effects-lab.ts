/**
 * Effects lab — password-gated playground for presentation beats.
 *
 * Not linked from the game. Open `/effects.html` and unlock with the shared
 * password. Exists so collapse bloom, ready cue, Prism and clear debris can be
 * fired without playing into them.
 */

import './styles/effects-lab.css';
import { Audio } from './audio/audio';
import { SFX, playableSfxSource } from './audio/sfx';
import { Game } from '@core/game';
import { modeById } from '@core/modes';
import { BOARD_WIDTH } from '@core/constants';
import { fromView } from '@core/projection';
import { GameRenderer } from '@render/game-renderer';

const PASSWORD = '42';
const UNLOCK_KEY = 'refraction-effects-lab';

const labRoot = document.querySelector('#lab');
if (!(labRoot instanceof HTMLElement)) {
  throw new Error('effects lab: #lab missing');
}
const root = labRoot;

function unlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberUnlock(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    // Private mode can refuse storage; the page still works for this load.
  }
}

function showGate(): void {
  root.replaceChildren();
  const gate = document.createElement('div');
  gate.className = 'lab-gate';
  gate.innerHTML = `
    <form class="lab-gate__card" autocomplete="off">
      <h1>Effects lab</h1>
      <p>Passworded playground for presentation beats. Not linked from the game.</p>
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Enter</button>
      <p class="lab-gate__error" aria-live="polite"></p>
    </form>
  `;
  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const error = gate.querySelector('.lab-gate__error');
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
    throw new Error('effects lab: gate markup broken');
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value !== PASSWORD) {
      if (error) error.textContent = 'Wrong password.';
      input.select();
      return;
    }
    rememberUnlock();
    openLab();
  });
  root.append(gate);
}

function seedBoard(game: Game): void {
  game.active = null;
  // Suspended cells at a few heights — collapse has something to slam down, and
  // the clear that follows has something to light up.
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    game.board.fill(fromView(game.face, { u: x, y: 2 + (x % 3), lane: 1 + (x % 3) }));
    if (x % 2 === 0) {
      game.board.fill(fromView(game.face, { u: x, y: 8 + (x % 2), lane: 2 }));
    }
  }
}

function openLab(): void {
  root.replaceChildren();

  const stage = document.createElement('div');
  stage.className = 'lab-stage';
  const canvas = document.createElement('canvas');
  const panel = document.createElement('aside');
  panel.className = 'lab-panel';
  panel.innerHTML = `
    <h1 class="lab-panel__title">Effects lab</h1>
    <p class="lab-panel__note">Click a beat. Audio needs a gesture — the first button press unlocks it.</p>
    <p class="lab-panel__label">Spectral</p>
    <div class="lab-panel__group">
      <button type="button" data-fx="ready">Ready cue</button>
      <button type="button" data-fx="collapse">Collapse fanfare</button>
      <button type="button" data-fx="live-collapse">Live collapse</button>
    </div>
    <p class="lab-panel__label">Board</p>
    <div class="lab-panel__group">
      <button type="button" data-fx="prism">Full Spectrum</button>
      <button type="button" data-fx="clear">Clear debris</button>
      <button type="button" data-fx="lock">Lock flash</button>
      <button type="button" data-fx="shake">Shake</button>
      <button type="button" data-fx="reset">Reset board</button>
    </div>
  `;
  const banner = document.createElement('div');
  banner.className = 'lab-banner';
  banner.innerHTML = `<span class="lab-banner__text"></span><span class="lab-banner__hint"></span>`;

  stage.append(canvas, panel, banner);
  root.append(stage);

  const audio = new Audio();
  audio.setSfxCatalog(
    SFX.flatMap((clip) => {
      const source = playableSfxSource(clip);
      return source ? [{ id: clip.id, url: source.url }] : [];
    })
  );
  const game = new Game({ seed: 'effects-lab', mode: modeById('ascent') });
  seedBoard(game);

  const renderer = new GameRenderer(canvas);
  renderer.setBackdrop(false);
  renderer.setAmbientChroma(false);
  renderer.resize();

  const bannerText = banner.querySelector('.lab-banner__text');
  const bannerHint = banner.querySelector('.lab-banner__hint');
  let bannerTimer = 0;

  const flashBanner = (text: string, hint = ''): void => {
    if (bannerText) bannerText.textContent = text;
    if (bannerHint) bannerHint.textContent = hint;
    banner.classList.remove('is-on');
    void banner.offsetWidth;
    banner.classList.add('is-on');
    bannerTimer = 1800;
  };

  const fire = (id: string): void => {
    audio.resume();
    switch (id) {
      case 'ready':
        audio.spectralReady();
        flashBanner('SPECTRAL COLLAPSE IMMINENT', 'PRESS V TO TRIGGER');
        break;
      case 'collapse':
        audio.spectralCollapse();
        renderer.startCollapse();
        flashBanner('SPECTRAL COLLAPSE');
        break;
      case 'live-collapse':
        game.heat = 1;
        seedBoard(game);
        if (!game.triggerCollapse()) {
          flashBanner('COLLAPSE REFUSED');
          break;
        }
        audio.spectralCollapse();
        renderer.startCollapse();
        flashBanner('SPECTRAL COLLAPSE');
        break;
      case 'prism':
        audio.prism();
        renderer.startPrism();
        renderer.shake(1);
        flashBanner('FULL SPECTRUM');
        break;
      case 'clear': {
        const y = 3;
        const lane = 2;
        const cells = [];
        for (let u = 0; u < BOARD_WIDTH; u += 1) {
          const cell = fromView(game.face, { u, y, lane });
          game.board.fill(cell);
          cells.push(cell);
        }
        renderer.clearEffect([{ y, lane }], game.face, false, false);
        audio.clear(1, 0, lane);
        renderer.shake(0.45);
        flashBanner('CLEAR');
        // Remove the line so the board does not keep a ghost row forever.
        for (const cell of cells) game.board.clear(cell);
        break;
      }
      case 'lock': {
        const cells = [fromView(game.face, { u: 3, y: 5, lane: 2 })];
        for (const cell of cells) game.board.fill(cell);
        renderer.lockFlash(cells);
        audio.lock(2);
        break;
      }
      case 'shake':
        renderer.shake(1);
        break;
      case 'reset':
        game.board.clearAll();
        seedBoard(game);
        game.heat = 0;
        game.active = null;
        flashBanner('BOARD RESET');
        break;
      default:
        break;
    }
  };

  panel.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.dataset.fx;
    if (!id) return;
    fire(id);
  });

  window.addEventListener('resize', () => renderer.resize());

  let last = performance.now();
  const frame = (now: number): void => {
    const delta = Math.min(now - last, 50);
    last = now;
    if (game.status === 'resolving' || game.status === 'turning') {
      game.tick(delta);
    }
    for (const event of game.drainEvents()) {
      if (event.type === 'clear') {
        audio.clear(event.lines ?? 1, event.cascade ?? 0, 2);
        if (event.cleared) {
          renderer.clearEffect(
            event.cleared,
            game.face,
            event.refraction === true,
            event.prism === true
          );
        }
        renderer.shake(event.prism ? 1 : Math.min((event.lines ?? 1) / 4, 0.7));
        if (event.prism) {
          renderer.startPrism();
          audio.prism();
        }
      }
    }
    if (bannerTimer > 0) {
      bannerTimer -= delta;
      if (bannerTimer <= 0) banner.classList.remove('is-on');
    }
    renderer.render(game, delta);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (unlocked()) openLab();
else showGate();
