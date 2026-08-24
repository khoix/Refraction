/**
 * Circular coach-mark overlay for the tutorial.
 *
 * A fading black gradient covers the viewport with a radial hole cut out over
 * the thing being taught. The coach card docks away from the hole so copy does
 * not cover what is being shown. Copy stays achromatic (DESIGN §2.2).
 */

export interface SpotlightHole {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export type CardPlacement = 'left' | 'right' | 'top';

export interface SpotlightHandlers {
  readonly onContinue: () => void;
  readonly onBack: () => void;
  readonly onSkip: () => void;
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

const PLACEMENT_CLASSES: readonly CardPlacement[] = ['left', 'right', 'top'];

/** Split on blank lines; turn `**bold**` into strong nodes. */
export function renderBodyMarkup(container: HTMLElement, source: string): void {
  container.replaceChildren();
  const paragraphs = source.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
  for (const paragraph of paragraphs) {
    const p = element('p', 'tutorial__para');
    const parts = paragraph.split(/(\*\*[^*]+\*\*)/g);
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        p.append(element('strong', undefined, part.slice(2, -2)));
      } else if (part.length > 0) {
        p.append(document.createTextNode(part));
      }
    }
    container.append(p);
  }
}

export class Spotlight {
  readonly root = element('div', 'tutorial');
  private readonly scrim = element('div', 'tutorial__scrim');
  private readonly skipChip: HTMLButtonElement;
  private readonly card = element('div', 'tutorial__card');
  private readonly head = element('div', 'tutorial__head');
  private readonly title = element('h2', 'tutorial__title');
  private readonly body = element('div', 'tutorial__body');
  private readonly hint = element('p', 'tutorial__hint');
  private readonly actions = element('div', 'tutorial__actions');
  private readonly backBtn: HTMLButtonElement;
  private readonly continueBtn: HTMLButtonElement;
  private readonly skipInCard: HTMLButtonElement;
  private hole: SpotlightHole | null = null;
  private placement: CardPlacement = 'left';
  private compact = false;
  private continueLabel = 'CONTINUE';

  constructor(private readonly handlers: SpotlightHandlers) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'tutorial-title');

    this.title.id = 'tutorial-title';
    this.hint.hidden = true;

    this.skipChip = element('button', 'tutorial__skip-chip', 'SKIP');
    this.skipChip.type = 'button';
    this.skipChip.addEventListener('click', () => this.handlers.onSkip());

    this.backBtn = element('button', 'button tutorial__nav', 'BACK');
    this.backBtn.type = 'button';
    this.backBtn.setAttribute('aria-label', 'Back');
    this.backBtn.addEventListener('click', () => this.handlers.onBack());

    this.continueBtn = element('button', 'button button--primary tutorial__nav', 'CONTINUE');
    this.continueBtn.type = 'button';
    this.continueBtn.setAttribute('aria-label', 'Continue');
    this.continueBtn.addEventListener('click', () => this.handlers.onContinue());

    this.skipInCard = element('button', 'tutorial__skip-link', 'Skip');
    this.skipInCard.type = 'button';
    this.skipInCard.addEventListener('click', () => this.handlers.onSkip());

    this.head.append(this.title, this.skipInCard);
    this.actions.append(this.backBtn, this.continueBtn);
    this.card.append(this.head, this.body, this.hint, this.actions);
    this.root.append(this.scrim, this.skipChip, this.card);
    this.setCardPlacement('left');
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.clearHole();
    this.setSoftScrim(false);
  }

  setReducedMotion(reduced: boolean): void {
    this.root.classList.toggle('tutorial--reduced', reduced);
  }

  setCopy(title: string, body: string): void {
    this.title.textContent = title;
    renderBodyMarkup(this.body, body);
  }

  setHint(text: string | null): void {
    this.hint.hidden = !text;
    this.hint.textContent = text ?? '';
  }

  setContinueVisible(visible: boolean): void {
    this.continueBtn.hidden = !visible;
  }

  setBackVisible(visible: boolean): void {
    this.backBtn.hidden = !visible;
  }

  setContinueLabel(label: string): void {
    this.continueLabel = label;
    this.applyActionChrome();
  }

  setSoftScrim(soft: boolean): void {
    this.scrim.classList.toggle('tutorial__scrim--soft', soft);
  }

  setCompact(compact: boolean): void {
    this.compact = compact;
    this.root.classList.toggle('tutorial--compact', compact);
    this.applyActionChrome();
  }

  setHole(hole: SpotlightHole | null): void {
    this.hole = hole;
    this.applyMask();
  }

  setCardPlacement(placement: CardPlacement): void {
    this.placement = placement;
    for (const name of PLACEMENT_CLASSES) {
      this.card.classList.toggle(`tutorial__card--${name}`, name === placement);
    }
  }

  getCardPlacement(): CardPlacement {
    return this.placement;
  }

  clearHole(): void {
    this.hole = null;
    this.scrim.style.maskImage = '';
    this.scrim.style.webkitMaskImage = '';
  }

  refresh(): void {
    this.applyMask();
  }

  private applyActionChrome(): void {
    this.root.classList.toggle('tutorial--arrows', this.compact);
    this.backBtn.textContent = this.compact ? '←' : 'BACK';
    this.continueBtn.textContent =
      this.compact && this.continueLabel === 'CONTINUE' ? '→' : this.continueLabel;
    this.continueBtn.setAttribute(
      'aria-label',
      this.continueLabel === 'CONTINUE' ? 'Continue' : this.continueLabel
    );
  }

  private applyMask(): void {
    if (!this.hole) {
      this.scrim.style.maskImage = '';
      this.scrim.style.webkitMaskImage = '';
      return;
    }
    const { x, y, radius } = this.hole;
    const soft = Math.max(12, radius * 0.22);
    const mask = `radial-gradient(circle ${radius + soft}px at ${x}px ${y}px,
      transparent ${radius}px,
      rgb(0 0 0 / 0.92) ${radius + soft}px)`;
    this.scrim.style.maskImage = mask;
    this.scrim.style.webkitMaskImage = mask;
  }
}

/**
 * Dock the coach card on a side of the well — never top or bottom, which
 * always covers the playfield.
 */
export function pickCardPlacement(
  hole: SpotlightHole | null,
  viewport: { readonly width: number; readonly height: number },
  prefer?: CardPlacement
): CardPlacement {
  if (prefer) return prefer;
  if (!hole) return 'left';
  const spaceLeft = Math.max(0, hole.x - hole.radius);
  const spaceRight = Math.max(0, viewport.width - (hole.x + hole.radius));
  return spaceLeft >= spaceRight ? 'left' : 'right';
}
