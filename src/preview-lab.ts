/**
 * Visual preview lab — password-gated playground for materials and effects.
 *
 * Not linked from the game. Open `/preview.html` and unlock with the shared
 * password. Proof-of-concept looks live here before they ship to the game.
 */

import './styles/preview-lab.css';
import { Audio } from './audio/audio';
import { SFX, playableSfxSource } from './audio/sfx';
import { Game } from '@core/game';
import { modeById } from '@core/modes';
import { BOARD_WIDTH } from '@core/constants';
import { fromView } from '@core/projection';
import { GameRenderer } from '@render/game-renderer';
import { GEL_VARIANTS } from './preview/gel-materials';
import { GelShowcase } from './preview/gel-showcase';
import { EFFECT_DEMOS, EnhancedEffectsShowcase } from './preview/enhanced-effects';

const PASSWORD = '42';
const UNLOCK_KEY = 'refraction-preview-lab';

type PreviewTab = 'materials' | 'effects' | 'enhanced';

const labRoot = document.querySelector('#lab');
if (!(labRoot instanceof HTMLElement)) {
  throw new Error('preview lab: #lab missing');
}
const root = labRoot;

function unlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === '1' || sessionStorage.getItem('refraction-effects-lab') === '1';
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
      <h1>Preview lab</h1>
      <p>Passworded playground for visual proof-of-concepts. Not linked from the game.</p>
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Enter</button>
      <p class="lab-gate__error" aria-live="polite"></p>
    </form>
  `;
  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const error = gate.querySelector('.lab-gate__error');
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement)) {
    throw new Error('preview lab: gate markup broken');
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
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    game.board.fill(fromView(game.face, { u: x, y: 2 + (x % 3), lane: 1 + (x % 3) }));
    if (x % 2 === 0) {
      game.board.fill(fromView(game.face, { u: x, y: 8 + (x % 2), lane: 2 }));
    }
  }
}

function variantCards(activeId: string | null): string {
  return GEL_VARIANTS.map(
    (v) => `
      <button type="button" class="lab-card${activeId === v.id ? ' is-active' : ''}" data-variant="${v.id}">
        <span class="lab-card__name">${v.name}</span>
        <span class="lab-card__blurb">${v.blurb}</span>
      </button>
    `
  ).join('');
}

function effectCards(): string {
  return EFFECT_DEMOS.map(
    (d) => `
      <button type="button" class="lab-card" data-enhanced="${d.id}">
        <span class="lab-card__name">${d.name}</span>
        <span class="lab-card__blurb">${d.blurb}</span>
      </button>
    `
  ).join('');
}

function openLab(): void {
  root.replaceChildren();

  const stage = document.createElement('div');
  stage.className = 'lab-stage';
  const canvas = document.createElement('canvas');
  const panel = document.createElement('aside');
  panel.className = 'lab-panel';
  panel.innerHTML = `
    <h1 class="lab-panel__title">Preview lab</h1>
    <nav class="lab-tabs" role="tablist">
      <button type="button" class="lab-tabs__btn is-active" data-tab="materials" role="tab">Materials</button>
      <button type="button" class="lab-tabs__btn" data-tab="effects" role="tab">Effects</button>
      <button type="button" class="lab-tabs__btn" data-tab="enhanced" role="tab">Enhanced</button>
    </nav>
    <div class="lab-panel__body" data-panel="materials">
      <p class="lab-panel__note">Six gel-cube directions. Click a card to spotlight. Drag bloom sliders to taste.</p>
      <div class="lab-slider">
        <label>Bloom strength <output data-out="bloom-strength">0.22</output></label>
        <input type="range" min="0" max="1.2" step="0.02" value="0.22" data-slider="bloom-strength" />
      </div>
      <div class="lab-slider">
        <label>Bloom threshold <output data-out="bloom-threshold">0.94</output></label>
        <input type="range" min="0.5" max="1" step="0.01" value="0.94" data-slider="bloom-threshold" />
      </div>
      <div class="lab-cards">${variantCards(null)}</div>
    </div>
    <div class="lab-panel__body is-hidden" data-panel="effects">
      <p class="lab-panel__note">Production presentation beats from the live renderer. First click unlocks audio.</p>
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
    </div>
    <div class="lab-panel__body is-hidden" data-panel="enhanced">
      <p class="lab-panel__note">Proposed upgrades — standalone demos, not wired to game logic yet.</p>
      <div class="lab-cards">${effectCards()}</div>
    </div>
  `;

  const banner = document.createElement('div');
  banner.className = 'lab-banner';
  banner.innerHTML = `<span class="lab-banner__text"></span><span class="lab-banner__hint"></span>`;

  const flash = document.createElement('div');
  flash.className = 'lab-flash';
  flash.setAttribute('aria-hidden', 'true');

  const labels = document.createElement('div');
  labels.className = 'lab-labels';
  labels.setAttribute('aria-hidden', 'true');

  stage.append(canvas, panel, banner, flash, labels);
  root.append(stage);

  let tab: PreviewTab = 'materials';
  let activeVariant: string | null = null;
  let gelShowcase: GelShowcase | null = null;
  let enhancedShowcase: EnhancedEffectsShowcase | null = null;
  let gameRenderer: GameRenderer | null = null;
  let game: Game | null = null;
  let audio: Audio | null = null;
  let bannerTimer = 0;

  const bannerText = banner.querySelector('.lab-banner__text');
  const bannerHint = banner.querySelector('.lab-banner__hint');

  const flashBanner = (text: string, hint = ''): void => {
    if (bannerText) bannerText.textContent = text;
    if (bannerHint) bannerHint.textContent = hint;
    banner.classList.remove('is-on');
    void banner.offsetWidth;
    banner.classList.add('is-on');
    bannerTimer = 1800;
  };

  const panelSafeLeft = (): number => {
    const rect = panel.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    // Panel right edge relative to the stage, plus a small gap.
    return Math.max(0, rect.right - stageRect.left) + 16;
  };

  const setTab = (next: PreviewTab): void => {
    tab = next;
    for (const btn of panel.querySelectorAll('.lab-tabs__btn')) {
      btn.classList.toggle('is-active', btn instanceof HTMLElement && btn.dataset.tab === next);
    }
    for (const body of panel.querySelectorAll('.lab-panel__body')) {
      if (!(body instanceof HTMLElement)) continue;
      body.classList.toggle('is-hidden', body.dataset.panel !== next);
    }
    banner.classList.remove('is-on');

    if (next === 'materials') {
      gameRenderer?.dispose();
      gameRenderer = null;
      game = null;
      enhancedShowcase?.dispose();
      enhancedShowcase = null;
      if (!gelShowcase) {
        gelShowcase = new GelShowcase(canvas);
        gelShowcase.resize(panelSafeLeft());
        updateMaterialLabels();
      }
    } else if (next === 'enhanced') {
      gameRenderer?.dispose();
      gameRenderer = null;
      game = null;
      gelShowcase?.dispose();
      gelShowcase = null;
      labels.replaceChildren();
      if (!enhancedShowcase) {
        enhancedShowcase = new EnhancedEffectsShowcase(canvas);
        enhancedShowcase.resize();
      }
    } else {
      gelShowcase?.dispose();
      gelShowcase = null;
      enhancedShowcase?.dispose();
      enhancedShowcase = null;
      labels.replaceChildren();
      if (!gameRenderer) {
        audio = new Audio();
        audio.setSfxCatalog(
          SFX.flatMap((clip) => {
            const source = playableSfxSource(clip);
            return source ? [{ id: clip.id, url: source.url }] : [];
          })
        );
        game = new Game({ seed: 'preview-lab', mode: modeById('ascent') });
        seedBoard(game);
        gameRenderer = new GameRenderer(canvas);
        gameRenderer.setBackdrop(false);
        gameRenderer.setAmbientChroma(false);
        gameRenderer.resize();
      }
    }
  };

  const updateMaterialLabels = (): void => {
    labels.replaceChildren();
    if (!gelShowcase) return;
    for (const anchor of gelShowcase.labelAnchors()) {
      const el = document.createElement('div');
      el.className = 'lab-label';
      el.dataset.variant = anchor.id;
      el.innerHTML = `<strong>${anchor.name}</strong>`;
      el.style.left = `${anchor.x}px`;
      el.style.top = `${anchor.y}px`;
      labels.append(el);
    }
  };

  const syncMaterialLabels = (): void => {
    if (!gelShowcase || labels.childElementCount === 0) {
      updateMaterialLabels();
      return;
    }
    const anchors = gelShowcase.labelAnchors();
    for (const el of labels.querySelectorAll('.lab-label')) {
      if (!(el instanceof HTMLElement)) continue;
      const anchor = anchors.find((a) => a.id === el.dataset.variant);
      if (!anchor) continue;
      el.style.left = `${anchor.x}px`;
      el.style.top = `${anchor.y}px`;
    }
  };

  const fireEffect = (id: string): void => {
    if (!audio || !game || !gameRenderer) return;
    audio.resume();
    switch (id) {
      case 'ready':
        audio.spectralReady();
        flashBanner('SPECTRAL COLLAPSE IMMINENT', 'PRESS V TO TRIGGER');
        break;
      case 'collapse':
        audio.spectralCollapse();
        gameRenderer.startCollapse();
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
        gameRenderer.startCollapse();
        flashBanner('SPECTRAL COLLAPSE');
        break;
      case 'prism':
        audio.prism();
        gameRenderer.startPrism();
        gameRenderer.shake(1);
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
        gameRenderer.clearEffect([{ y, lane }], game.face, false, false);
        audio.clear(1, 0, lane);
        gameRenderer.shake(0.45);
        flashBanner('CLEAR');
        for (const cell of cells) game.board.clear(cell);
        break;
      }
      case 'lock': {
        const cells = [fromView(game.face, { u: 3, y: 5, lane: 2 })];
        for (const cell of cells) game.board.fill(cell);
        gameRenderer.lockFlash(cells);
        audio.lock(2);
        break;
      }
      case 'shake':
        gameRenderer.shake(1);
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

    const tabBtn = target.closest('.lab-tabs__btn');
    const tabId = tabBtn instanceof HTMLElement ? tabBtn.dataset.tab : undefined;
    if (tabId === 'materials' || tabId === 'effects' || tabId === 'enhanced') {
      setTab(tabId);
      return;
    }

    const variantId = target.closest('[data-variant]')?.getAttribute('data-variant');
    if (variantId && gelShowcase) {
      activeVariant = activeVariant === variantId ? null : variantId;
      gelShowcase.highlightVariant(activeVariant);
      for (const card of panel.querySelectorAll('[data-variant]')) {
        card.classList.toggle('is-active', card.getAttribute('data-variant') === activeVariant);
      }
      return;
    }

    const enhancedId = target.closest('[data-enhanced]')?.getAttribute('data-enhanced');
    if (enhancedId && enhancedShowcase) {
      enhancedShowcase.fire(enhancedId as typeof EFFECT_DEMOS[number]['id']);
      const demo = EFFECT_DEMOS.find((d) => d.id === enhancedId);
      if (demo) flashBanner(demo.name.toUpperCase(), demo.blurb);
      return;
    }

    const fx = target.dataset.fx;
    if (fx) fireEffect(fx);
  });

  panel.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.slider) return;
    const key = target.dataset.slider;
    const out = panel.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = target.value;
    if (!gelShowcase) return;
    const strength = Number(
      (panel.querySelector('[data-slider="bloom-strength"]') as HTMLInputElement | null)?.value ?? 0.22
    );
    const threshold = Number(
      (panel.querySelector('[data-slider="bloom-threshold"]') as HTMLInputElement | null)?.value ?? 0.94
    );
    gelShowcase.setBloom(strength, threshold);
  });

  window.addEventListener('resize', () => {
    gelShowcase?.resize(panelSafeLeft());
    enhancedShowcase?.resize();
    gameRenderer?.resize();
    if (tab === 'materials') updateMaterialLabels();
  });

  setTab('materials');

  let last = performance.now();
  const frame = (now: number): void => {
    const delta = Math.min(now - last, 50);
    last = now;

    if (tab === 'materials' && gelShowcase) {
      gelShowcase.update(delta);
      gelShowcase.render();
      syncMaterialLabels();
    } else if (tab === 'enhanced' && enhancedShowcase) {
      enhancedShowcase.update(delta);
      enhancedShowcase.render();
      const level = enhancedShowcase.whiteoutLevel;
      flash.style.opacity = String(level * 0.55);
    } else if (tab === 'effects' && gameRenderer && game) {
      if (game.status === 'resolving' || game.status === 'turning') {
        game.tick(delta);
      }
      for (const event of game.drainEvents()) {
        if (event.type === 'clear' && audio) {
          audio.clear(event.lines ?? 1, event.cascade ?? 0, 2);
          if (event.cleared) {
            gameRenderer.clearEffect(
              event.cleared,
              game.face,
              event.refraction === true,
              event.prism === true
            );
          }
          gameRenderer.shake(event.prism ? 1 : Math.min((event.lines ?? 1) / 4, 0.7));
          if (event.prism) {
            gameRenderer.startPrism();
            audio.prism();
          }
        }
      }
      gameRenderer.render(game, delta);
    }

    if (bannerTimer > 0) {
      bannerTimer -= delta;
      if (bannerTimer <= 0) banner.classList.remove('is-on');
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (unlocked()) openLab();
else showGate();
