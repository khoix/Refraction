import { devices, expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { LINES_PER_STAGE } from '../../src/core/stages';

/** Wait for the first rendered frame. */
async function boot(page: Page): Promise<void> {
  await page.goto('/?mode=ascent');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas.stage')).toBeVisible();
}

/**
 * How much of the frame carries cube colour.
 *
 * Chroma rather than brightness, because the room behind the board is lit and
 * the wordmark is bright white -- both would swamp a luminance count, and
 * neither is a cube. Only a cube has hue (DESIGN 2.2), so a saturated pixel is a
 * cube pixel, and the fraction of them is a direct measure of how much of the
 * screen the arrangement occupies.
 */
async function colouredFractionOutsideWell(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
    const renderer = window.__refraction?.renderer;
    if (!renderer) return 0;
    const rect = renderer.wellScreenRect();
    const box = source.getBoundingClientRect();
    const scratch = document.createElement('canvas');
    scratch.width = 200;
    scratch.height = 130;
    const context = scratch.getContext('2d');
    if (!context) return 0;
    context.drawImage(source, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

    // The well's rectangle in the scaled sample, generously margined so a cube at
    // its edge cannot leak into the count.
    const sx = ((rect.left - box.left) / box.width) * scratch.width - 4;
    const sy = ((rect.top - box.top) / box.height) * scratch.height - 4;
    const sw = (rect.width / box.width) * scratch.width + 8;
    const sh = (rect.height / box.height) * scratch.height + 8;

    let coloured = 0;
    let counted = 0;
    for (let y = 0; y < scratch.height; y += 1) {
      for (let x = 0; x < scratch.width; x += 1) {
        if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh) continue;
        const i = (y * scratch.width + x) * 4;
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;
        counted += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 24) coloured += 1;
      }
    }
    return counted === 0 ? 0 : coloured / counted;
  });
}

/**
 * Through the front door.
 *
 * A run reached by a deep link skips the boot gate, so most of this suite never
 * meets it. Anything that starts at a bare `/` does, and has to wait for the
 * preload and tap in -- which is exactly what a player does, so the wait is the
 * test setup being honest rather than a concession to one.
 */
async function enter(page: Page): Promise<void> {
  const way = page.getByRole('button', { name: 'TAP TO PLAY' });
  await expect(way).toBeVisible();
  await way.click();
  await expect(page.locator('.panel--title')).toBeVisible();
}

/** Sample the WebGL canvas and count distinct colours. */
async function distinctCanvasColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
    const scratch = document.createElement('canvas');
    scratch.width = 160;
    scratch.height = 100;
    const context = scratch.getContext('2d');
    if (!context) return 0;
    context.drawImage(source, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });
}

/**
 * Distinct colours inside the play column.
 *
 * A whole-canvas sample cannot tell a flat board from a dimensional one: the
 * room fills most of the frame, so its dust and shafts dominate the count. The
 * play column is where the board's own colours live.
 */
async function distinctWellColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
    const renderer = window.__refraction?.renderer;
    if (!renderer) return 0;
    const rect = renderer.wellScreenRect();
    const box = source.getBoundingClientRect();
    const scaleX = source.width / Math.max(1, box.width);
    const scaleY = source.height / Math.max(1, box.height);
    const inset = 0.08;
    const sx = (rect.left - box.left + rect.width * inset) * scaleX;
    const sy = (rect.top - box.top + rect.height * inset) * scaleY;
    const sw = Math.max(1, rect.width * (1 - inset * 2) * scaleX);
    const sh = Math.max(1, rect.height * (1 - inset * 2) * scaleY);

    const scratch = document.createElement('canvas');
    scratch.width = 80;
    scratch.height = 140;
    const context = scratch.getContext('2d');
    if (!context) return 0;
    context.drawImage(source, sx, sy, sw, sh, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });
}

/**
 * Sample the canvas where the turning next-piece preview is drawn.
 *
 * The preview is not DOM any more: it is a scissored corner of the same WebGL
 * canvas as the board, sitting *behind* the HUD panel that frames it. So the
 * panel's own rectangle gives the region, and the pixels come from the canvas.
 *
 * Inset, because the panel's border and label are DOM and would be sampled as
 * part of the picture otherwise.
 */
async function previewPixels(
  page: Page
): Promise<{ lit: number; chroma: number; signature: string }> {
  return page.evaluate(() => {
    const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
    const panel = document.querySelector('.slot .slot__body') as HTMLElement | null;
    if (!panel) return { lit: 0, chroma: 0, signature: '' };
    const box = source.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const scaleX = source.width / Math.max(1, box.width);
    const scaleY = source.height / Math.max(1, box.height);
    const inset = 0.12;
    const sx = (rect.left - box.left + rect.width * inset) * scaleX;
    const sy = (rect.top - box.top + rect.height * inset) * scaleY;
    const sw = Math.max(1, rect.width * (1 - inset * 2) * scaleX);
    const sh = Math.max(1, rect.height * (1 - inset * 2) * scaleY);

    const scratch = document.createElement('canvas');
    scratch.width = 40;
    scratch.height = 40;
    const context = scratch.getContext('2d');
    if (!context) return { lit: 0, chroma: 0, signature: '' };
    context.drawImage(source, sx, sy, sw, sh, 0, 0, scratch.width, scratch.height);
    const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

    // The preview paints its own near-black ground, so "lit" means a pixel
    // brighter than that ground rather than brighter than nothing.
    let lit = 0;
    let chroma = 0;
    const bytes: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      if (Math.max(r, g, b) > 40) lit += 1;
      chroma = Math.max(chroma, Math.max(r, g, b) - Math.min(r, g, b));
      bytes.push(r, g, b);
    }
    return { lit, chroma, signature: bytes.join(',') };
  });
}

test.describe('boot', () => {
  test('renders the playfield and the HUD', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.getByText('SCORE', { exact: true })).toBeVisible();
    await expect(page.getByText('LINES')).toBeVisible();
    await expect(page.getByText('STAGE', { exact: true })).toBeVisible();
    await expect(page.locator('.hud__face')).toHaveText('FRONT');
  });

  test('starts at stage 1 with an empty score', async ({ page }) => {
    await boot(page);
    const values = page.locator('.stat__value');
    await expect(values.nth(0)).toHaveText('0');
    await expect(values.nth(1)).toHaveText('0');
    await expect(values.nth(2)).toHaveText('1');
  });

  test('shows a Shift meter sized to the stage', async ({ page }) => {
    await boot(page);
    // Stage 1 turns the board every five lines.
    await expect(page.locator('.meter__pip')).toHaveCount(5);
  });

  test('parks the Shift bar under the play column', async ({ page }) => {
    await boot(page);
    // layoutWell runs after the first rendered frame; give the bar its rect.
    await expect(page.locator('.hud__shift')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const bar = document.querySelector('.hud__shift') as HTMLElement;
      const canvas = document.querySelector('canvas.stage') as HTMLCanvasElement;
      const barBox = bar.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      return {
        barCenter: barBox.left + barBox.width / 2,
        canvasCenter: canvasBox.left + canvasBox.width / 2,
        barWidth: barBox.width,
        barTop: barBox.top,
        canvasHeight: canvasBox.height,
        pipCount: bar.querySelectorAll('.meter__pip').length,
      };
    });
    expect(metrics.pipCount).toBe(5);
    expect(metrics.barWidth).toBeGreaterThan(120);
    expect(Math.abs(metrics.barCenter - metrics.canvasCenter)).toBeLessThan(24);
    expect(metrics.barTop).toBeGreaterThan(metrics.canvasHeight * 0.55);
  });

  test('frames the HUD as panels', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.hud__panel')).toHaveCount(5);
  });

  test('shows the next piece', async ({ page }) => {
    // Measured on the canvas, not in the DOM. The preview is a turning 3D render
    // scissored into the corner of the same canvas as the board, so the panel
    // supplies the rectangle and the pixels come from WebGL.
    await page.goto('/?debug=1&mode=ascent&seed=next');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(300);
    const { lit } = await previewPixels(page);
    expect(lit).toBeGreaterThan(60);
  });

  test('spaces the still preview evenly in both axes', async ({ page }) => {
    // The DOM grid, which is what the *still* preview and the hold slot use. The
    // turning preview has no grid to space -- it is a render.
    await boot(page);
    await page.keyboard.press('KeyC');
    const metrics = await page
      .locator('.slot')
      .nth(1)
      .locator('.piece')
      .evaluate((grid) => {
        const cells = [...grid.querySelectorAll('.piece__cell')];
        const a = cells[0]?.getBoundingClientRect();
        const b = cells[1]?.getBoundingClientRect();
        const c = cells[4]?.getBoundingClientRect();
        if (!a || !b || !c) return { count: cells.length, col: 0, row: 0 };
        return { count: cells.length, col: b.x - a.x, row: c.y - a.y };
      });
    expect(metrics.count).toBe(16);
    expect(Math.abs(metrics.col - metrics.row)).toBeLessThan(1);
  });

  test('loads with no console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await boot(page);
    await page.waitForTimeout(500);
    expect(problems).toEqual([]);
  });
});

test.describe('rendering', () => {
  test('draws the board rather than a blank canvas', async ({ page }) => {
    // Reading pixels back needs preserveDrawingBuffer, which is on in debug only.
    await page.goto('/?debug=1&mode=ascent&seed=render');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(300);
    // Flat tiles plus the frame and background. A blank canvas gives one colour.
    expect(await distinctCanvasColours(page)).toBeGreaterThan(4);
  });

  test('looks flat when settled and gains volume only during the turn', async ({ page }) => {
    // The central visual rule: the board reads as 2D until it rotates. Flat
    // tiles are unshaded, so they yield few distinct colours; lit cubes with
    // visible tops and sides yield many more. Sample the well, not the whole
    // canvas — the room behind the column would drown the signal.
    // Stretch the turn so the dimensional peak cannot be missed under
    // parallel load: a 750ms window is shorter than a stalled frame.
    await page.goto('/?debug=1&mode=ascent&seed=flatness&turnMs=4000');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) {
        for (let z = 0; z < 8; z += 1) {
          if ((x + z) % 3 !== 0) game.board.fill({ x, y: 0, z });
        }
      }
      game.shiftMeter = game.stage.linesPerTurn;
      game.status = 'awaitingTurn';
    });
    await page.waitForTimeout(250);
    const flat = await distinctWellColours(page);

    await page.keyboard.press('ArrowRight');
    // Sample at the actual dimensional peak rather than after a magic sleep:
    // under parallel load 370ms is not reliably the midpoint of a 750ms turn.
    await page.waitForFunction(() => {
      const renderer = window.__refraction?.renderer;
      return Boolean(renderer?.isTurning && renderer.flatness < 0.25);
    });
    const midTurn = await distinctWellColours(page);

    await page.waitForFunction(() => window.__refraction?.renderer?.isTurning === false);
    await page.waitForTimeout(150);
    const settled = await distinctWellColours(page);

    expect(midTurn).toBeGreaterThan(flat * 1.5);
    expect(settled).toBeLessThan(midTurn);
  });

  test('the board changes as pieces land', async ({ page }) => {
    await boot(page);
    await page.waitForTimeout(300);
    const before = await page.locator('canvas.stage').screenshot();

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(80);
    }

    const after = await page.locator('canvas.stage').screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('controls', () => {
  test('hard drop scores points and locks a piece', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    const score = await page.locator('.stat__value').first().textContent();
    expect(Number(score?.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('moving and rotating never throws', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await boot(page);

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyZ', 'KeyX', 'ArrowDown']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(200);
    expect(problems).toEqual([]);
  });

  test('the hold slot fills when hold is pressed', async ({ page }) => {
    await boot(page);
    const holdCells = page.locator('.slot').nth(1).locator('.piece__cell--filled');
    await expect(holdCells).toHaveCount(0);
    await page.keyboard.press('KeyC');
    await expect(holdCells.first()).toBeVisible();
  });

  test('the key the game-over screen advertises actually restarts', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=restart');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      game.status = 'gameOver';
    });

    const hint = page.locator('.panel--over .panel__hint--keys');
    await expect(hint).toBeVisible();
    // Parse the key out of the hint itself, so the copy and the binding can
    // never advertise different keys again.
    const advertised = /press (\w+)/i.exec((await hint.textContent()) ?? '')?.[1];
    expect(advertised).toBeTruthy();

    await page.keyboard.press(advertised as string);
    await expect(page.locator('.panel--over')).toBeHidden();
    await expect(page.locator('.stat__value').first()).toHaveText('0');
  });
});

test.describe('the turn', () => {
  /** Reach a filled Shift meter directly via the debug hook. */
  async function armTheTurn(page: Page): Promise<void> {
    await page.goto('/?debug=1&mode=ascent&seed=e2e');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      game.shiftMeter = game.stage.linesPerTurn;
      game.status = 'awaitingTurn';
    });
  }

  test('prompts for a face once the meter fills', async ({ page }) => {
    await armTheTurn(page);
    await expect(page.locator('.prompt')).toBeVisible();
    await expect(page.locator('.prompt__face').first()).toHaveText('LEFT');
    await expect(page.locator('.prompt__face').nth(1)).toHaveText('RIGHT');
  });

  test('turning right reveals the right face', async ({ page }) => {
    await armTheTurn(page);
    await expect(page.locator('.hud__face')).toHaveText('FRONT');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.hud__face')).toHaveText('RIGHT');
    await expect(page.locator('.prompt')).toBeHidden();
  });

  test('turning left reveals the left face', async ({ page }) => {
    await armTheTurn(page);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.hud__face')).toHaveText('LEFT');
  });

  test('clears a line that only exists on the face being turned to', async ({ page }) => {
    await armTheTurn(page);

    // Eight cubes running along Z at one X: no line from the front, a finished
    // line from the left. Nothing moves -- the turn just makes it eligible.
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) return;
      for (let z = 0; z < 8; z += 1) game.board.fill({ x: 3, y: 0, z });
    });

    await expect(page.locator('.stat__value').nth(1)).toHaveText('0');
    await page.keyboard.press('ArrowLeft');

    await expect(page.locator('.stat__value').nth(1)).toHaveText('1');
    await expect(page.locator('.banner')).toContainText('REFRACTION');
  });

  test('holds the revealed lines lit until the board has finished turning', async ({ page }) => {
    // A stretched turn makes the intermediate state observable at all.
    await page.goto('/?debug=1&mode=ascent&seed=reveal&turnMs=3000');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let z = 0; z < 8; z += 1) game.board.fill({ x: 3, y: 0, z });
      game.shiftMeter = game.stage.linesPerTurn;
      game.status = 'awaitingTurn';
    });

    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(900); // well inside the rotation

    const midTurn = await page.evaluate(() => {
      const game = window.__refraction?.game;
      return {
        status: game?.status,
        pending: game?.pendingClears.length ?? 0,
        filled: game?.board.countFilled() ?? 0,
        lines: game?.lines ?? 0,
      };
    });

    // The line is still physically on the board, flagged for the glow, uncounted.
    expect(midTurn.status).toBe('turning');
    expect(midTurn.pending).toBe(1);
    expect(midTurn.filled).toBe(8);
    expect(midTurn.lines).toBe(0);

    await expect(page.locator('.stat__value').nth(1)).toHaveText('1');
  });

  test('the camera actually rotates rather than cutting', async ({ page }) => {
    await armTheTurn(page);
    await page.waitForTimeout(200);
    const before = await page.locator('canvas.stage').screenshot();

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300); // mid-turn
    const during = await page.locator('canvas.stage').screenshot();
    await page.waitForTimeout(900); // settled on the new face
    const after = await page.locator('canvas.stage').screenshot();

    expect(Buffer.compare(before, during)).not.toBe(0);
    expect(Buffer.compare(during, after)).not.toBe(0);
  });
});

test.describe('feel', () => {
  test('shows a score popup when a line clears', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=popup');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
    });
    await page.keyboard.press('Space');
    await expect(page.locator('.popup').first()).toBeVisible();
  });

  test('M mutes and unmutes', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.mute')).toBeHidden();
    await page.keyboard.press('KeyM');
    await expect(page.locator('.mute')).toBeVisible();
    await page.keyboard.press('KeyM');
    await expect(page.locator('.mute')).toBeHidden();
  });

  test('audio never throws, muted or not', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await boot(page);
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    await page.keyboard.press('KeyM');
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(60);
    }
    expect(problems).toEqual([]);
  });

  /**
   * Freeze the board so a frame comparison measures only the effect under test.
   * A falling piece changes the picture every tick, which would drown it out.
   */
  async function frozenBoard(page: Page, query: string): Promise<void> {
    await page.goto(`/?debug=1&mode=ascent&seed=calm${query}`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 5, z: 3 });
      game.status = 'gameOver';
    });
    await page.waitForTimeout(250);
  }

  /**
   * Shake the camera and report the largest displacement seen, in board cells.
   *
   * Sampled inside the page across animation frames rather than by comparing
   * screenshots: the shake decays in under 400ms and a screenshot round-trip is
   * slower than that, so pixels would always be sampled after it had died.
   */
  async function peakShake(page: Page): Promise<number> {
    return page.evaluate(async () => {
      const renderer = window.__refraction?.renderer;
      if (!renderer) throw new Error('debug hook unavailable');
      renderer.shake(1);

      let peak = 0;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const { x, y } = renderer.shakeOffset;
        peak = Math.max(peak, Math.abs(x), Math.abs(y));
      }
      return peak;
    });
  }

  test('shake displaces the camera by default', async ({ page }) => {
    await frozenBoard(page, '');
    // Enough to be felt, nowhere near enough to lose track of the board.
    const peak = await peakShake(page);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(1);
  });

  test('the space stays alive even when the board is still', async ({ page }) => {
    // The environment drifts during idle play, so two frames of a frozen board
    // taken a moment apart must not be identical. The board itself cannot be
    // the difference: the game is over and nothing else moves.
    await frozenBoard(page, '');

    const sample = (): Promise<number[]> =>
      page.evaluate(() => {
        const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
        const scratch = document.createElement('canvas');
        scratch.width = 120;
        scratch.height = 80;
        const context = scratch.getContext('2d');
        if (!context) return [];
        context.drawImage(source, 0, 0, scratch.width, scratch.height);
        return Array.from(context.getImageData(0, 0, scratch.width, scratch.height).data);
      });

    const before = await sample();
    await page.waitForTimeout(900);
    const after = await sample();

    let changedPixels = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (
        Math.abs((before[i] as number) - (after[i] as number)) > 4 ||
        Math.abs((before[i + 1] as number) - (after[i + 1] as number)) > 4 ||
        Math.abs((before[i + 2] as number) - (after[i + 2] as number)) > 4
      ) {
        changedPixels += 1;
      }
    }
    expect(changedPixels).toBeGreaterThan(30);
  });

  test('reduced motion suppresses the shake entirely', async ({ page }) => {
    await frozenBoard(page, '&reducedMotion=1');
    expect(await peakShake(page)).toBe(0);
  });
});

test.describe('progression', () => {
  /** Advance the run to a chosen stage by handing it cleared lines. */
  async function reachStage(page: Page, stageIndex: number): Promise<void> {
    await page.goto('/?debug=1&mode=ascent&seed=arc');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(
      ({ index, perStage }) => {
        const game = window.__refraction?.game;
        if (!game) throw new Error('debug hook unavailable');
        // One short of the boundary, so a single clear crosses it and fires the
        // stage event exactly the way real play would.
        game.lines = perStage * (index - 1) - 1;
        for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
      },
      { index: stageIndex, perStage: LINES_PER_STAGE }
    );
    await page.keyboard.press('Space');
  }

  test('announces a new stage by number', async ({ page }) => {
    await reachStage(page, 2);
    const banner = page.locator('.stage-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText('STAGE 2');
  });

  /** Computed colour of an element, as [r, g, b]. */
  async function inkOf(page: Page, selector: string, index = 0): Promise<[number, number, number]> {
    const value = await page
      .locator(selector)
      .nth(index)
      .evaluate((el) => getComputedStyle(el).color);
    const parts = (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    return parts as [number, number, number];
  }

  /**
   * The stage readout must never carry a hue.
   *
   * A hue on this screen is a claim about depth. If the stage number were
   * tinted -- and it was, before this was corrected -- the player would be
   * shown two colour languages at once with nothing to tell them apart.
   */
  test('never tints the stage readout, at any stage', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=colour');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    const atStageOne = await inkOf(page, '.stat__value', 2);
    const [r, g, b] = atStageOne;
    // Achromatic: no channel dominates. Cool neutrals are fine, hues are not.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);

    // Deep into the arc, and it has not moved.
    await page.evaluate((perStage) => {
      const game = window.__refraction?.game;
      if (game) game.lines = perStage * 6;
    }, LINES_PER_STAGE);
    await page.waitForTimeout(120);
    expect(await inkOf(page, '.stat__value', 2)).toEqual(atStageOne);
    // And it matches the score beside it, which is the point: it is a readout,
    // not a status colour.
    expect(await inkOf(page, '.stat__value', 0)).toEqual(atStageOne);
  });

  test('keeps numbering past the last authored stage', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=endless');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate((perStage) => {
      const game = window.__refraction?.game;
      if (game) game.lines = perStage * 8;
    }, LINES_PER_STAGE);
    await expect(page.locator('.stat__value').nth(2)).toHaveText('9');
  });
});

test.describe('experiments', () => {
  test('the experimental piece vocabulary boots and plays cleanly', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto('/?debug=1&mode=ascent&seed=exp&pieces=experimental');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await page.waitForTimeout(80);
    }
    expect(problems).toEqual([]);
  });
});

test.describe('layout', () => {
  test('has no horizontal overflow on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('screens', () => {
  test('opens on the title rather than dropping straight into a run', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await expect(page.locator('.panel--title')).toBeVisible();
    // Scoped to the panel: the boot gate carries the same mark, deliberately, so
    // an unscoped locator now matches two.
    await expect(page.locator('.panel--title .title__word')).toHaveText('REFRACTION');
    // The room is alive behind the title from the first frame.
    await expect(page.locator('canvas.stage')).toBeVisible();
  });

  test('walks from title to a running game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.panel--modes')).toBeVisible();
    await page.locator('.mode[data-mode="ascent"]').click();
    await expect(page.locator('.screens')).toBeHidden();
    await expect(page.locator('.hud')).toBeVisible();
  });

  test('offers every mode, with the expert one locked', async ({ page }) => {
    await page.goto('/');
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.mode')).toHaveCount(6);
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toBeDisabled();
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toContainText('Reach stage 5');
    await expect(page.locator('.mode[data-mode="ascent"]')).toBeEnabled();
  });

  test('lists modes easiest to hardest, with a pip rating on each card', async ({ page }) => {
    // The menu walks the mode table, so this order is what the player sees —
    // Flatland first, Blind Spectrum last — and each card names its difficulty.
    await page.goto('/');
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();

    const order = await page.locator('.mode').evaluateAll((cards) =>
      cards.map((card) => (card as HTMLElement).dataset['mode'] ?? '')
    );
    expect(order).toEqual([
      'flatland',
      'zen',
      'ascent',
      'endless',
      'prism',
      'blindSpectrum',
    ]);

    for (let i = 0; i < order.length; i += 1) {
      const rating = page.locator(`.mode[data-mode="${order[i]}"] .mode__difficulty`);
      await expect(rating).toHaveAttribute('aria-label', `Difficulty ${i + 1} of 6`);
      await expect(rating).toHaveText(`${'●'.repeat(i + 1)}${'○'.repeat(5 - i)}`);
    }
  });

  test('pauses and resumes on Escape without advancing the board', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=pause');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('.panel--paused')).toBeVisible();
    // Pause is an engine state, not a host flag.
    expect(await page.evaluate(() => window.__refraction?.game.status)).toBe('paused');

    const height = (): Promise<number> =>
      page.evaluate(() => window.__refraction?.game.active?.y ?? -1);
    const before = await height();
    await page.waitForTimeout(700);
    expect(await height()).toBe(before);

    await page.keyboard.press('Escape');
    await expect(page.locator('.panel--paused')).toBeHidden();
    expect(await page.evaluate(() => window.__refraction?.game.status)).not.toBe('paused');
  });

  test('does not let menu keystrokes reach the piece', async ({ page }) => {
    // Also the guard on arrow-key menu navigation: the board is live behind
    // every panel, so a keystroke that moved focus must not also have moved the
    // piece.
    await page.goto('/?debug=1&mode=ascent&seed=gated');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');

    const column = (): Promise<number> =>
      page.evaluate(() => window.__refraction?.game.active?.u ?? -1);
    const before = await column();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    expect(await column()).toBe(before);
  });
});

test.describe('the front door', () => {
  test('opens on the gate, with the room already behind it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.panel--boot')).toBeVisible();
    await expect(page.locator('.panel--title')).toBeHidden();
    await expect(page.locator('.panel--boot .title__word')).toHaveText('REFRACTION');
    // The board is lit behind the gate, not after it.
    await expect(page.locator('canvas.stage')).toBeVisible();

    /*
     * The loading bar makes no claim about depth.
     *
     * A progress bar is the single most tempting surface in this interface to
     * run through the spectrum, and DESIGN 2.2 reserves hue for cubes alone --
     * so a red-to-violet bar would be a second colour language on the first
     * screen anyone sees. A gradient would show up as a background *image*, and
     * a solid hue as a wide channel spread; this refuses both.
     */
    const paint = await page.evaluate(() => {
      const fill = document.querySelector('.loading__fill');
      if (!fill) return null;
      const style = getComputedStyle(fill);
      return { image: style.backgroundImage, colour: style.backgroundColor };
    });
    expect(paint?.image).toBe('none');
    const channels = (paint?.colour.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(16);
  });

  test('holds the way in until the loading has actually finished', async ({ page }) => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/*.webm', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const way = page.getByRole('button', { name: 'TAP TO PLAY' });
    await expect(way).toBeHidden();
    await expect(page.locator('.loading__bar')).toHaveAttribute('aria-valuenow', '0');

    release();
    await expect(way).toBeVisible();
    await expect(page.locator('.loading__bar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('keeps the boot gate silent, then themes the menu and a run', async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    // Boot is up before any gesture; nothing should be trying to sound yet.
    await expect(page.locator('.panel--boot')).toBeVisible();
    expect(await page.evaluate(() => window.__refraction?.music().playing)).toBe(false);

    await enter(page);
    // Main menu (`title`) starts the theme on the same gesture that opens it.
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(true);
    expect(await page.evaluate(() => window.__refraction?.music().track)).toBe('theme');
    await expect(page.locator('.lcd')).toBeHidden();

    await page.evaluate(() => window.__refraction?.play('ascent'));
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().track), { timeout: 5000 })
      .not.toBe('theme');
    await expect(page.locator('.lcd')).toBeVisible();
    await expect(page.locator('.lcd__text').first()).toContainText(/refraction/i);

    await page.getByRole('button', { name: 'Pause music' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(false);

    await page.getByRole('button', { name: 'Next track' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(true);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.locator('.panel--title')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().track), { timeout: 5000 })
      .toBe('theme');
    await expect(page.locator('.lcd')).toBeHidden();
  });

  test('a deep link goes round the door rather than through it', async ({ page }) => {
    // A shared challenge code is a player who has already chosen. Holding one
    // behind a download of music it will not play would be a worse front door
    // than none.
    await page.goto('/?mode=ascent');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.panel--boot')).toBeHidden();
    await expect(page.locator('.hud')).toBeVisible();
  });

  test('mute stops the music outright, rather than turning it down', async ({ page }) => {
    /*
     * The one control that has to work on every platform.
     *
     * iOS ignores `volume` on a media element -- it is the hardware's business
     * there -- so a mute implemented as "set the gain to zero" is a mute that
     * does nothing on a phone. Implemented as a pause it works everywhere, and
     * this asserts the pause rather than the level, because the level is exactly
     * the thing that silently fails on the platform that matters.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(true);

    await page.getByRole('button', { name: 'SETTINGS' }).click();
    await page.locator('[data-field="sound"] input').uncheck();
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(false);

    await page.locator('[data-field="sound"] input').check();
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.music().playing), { timeout: 5000 })
      .toBe(true);
  });

  test('the gate drops the tagline the menu keeps', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    // The mark is the same on both; the line under it is not. The front door is
    // already carrying a loading bar and a way in.
    await expect(page.locator('.panel--boot .title__word')).toHaveText('REFRACTION');
    await expect(page.locator('.panel--boot .title__rule')).toHaveCount(0);

    await enter(page);
    await expect(page.locator('.panel--title .title__rule')).toContainText('Position is absolute');
  });

  test('the room carries the ramp on the menus and drops it for a run', async ({ page }) => {
    /*
     * The one sanctioned exception to §2.2, and its limit.
     *
     * The front door has no board on it at all, so the room has to carry the
     * picture — and it does that with colour, drawn from the same ramp the cubes
     * use. That is only safe while there is nothing to misread: a player learning
     * that hue means depth must not have coloured cubes drifting in the corner of
     * their eye during a run.
     *
     * Measured outside the well, so the board's own cubes cannot be mistaken for
     * the room's. On the menus that region carries hue; during a run it must not.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(1200);
    const onTheMenu = await colouredFractionOutsideWell(page);
    expect(onTheMenu).toBeGreaterThan(0.01);

    await page.evaluate(() => window.__refraction?.play('ascent'));
    // Longer than the fade, so this is the settled room rather than the handover.
    await page.waitForTimeout(1600);
    const inARun = await colouredFractionOutsideWell(page);
    expect(inARun).toBeLessThan(onTheMenu * 0.25);
  });

  test('keeps the front door clear of the piece nobody is playing', async ({ page }) => {
    // A new game spawns a piece straight away, and on the gate that is a cube
    // hanging in mid-air with a ghost and a drop channel under it, describing a
    // move nobody is making. The composed arrangement used to clear it as a side
    // effect; nothing does now unless it is asked to.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    expect(await page.evaluate(() => window.__refraction?.game.active)).toBeNull();
  });

  test('exposes one screen at a time, even mid-fade', async ({ page }) => {
    /*
     * The cross-fade keeps the outgoing panel painted, and for a while it kept
     * it *reachable* too: its buttons held their place in the tab order and a
     * screen reader read two screens at once. For 280 ms after the door opened
     * there were two buttons whose names contain "play" -- the gate's "TAP TO
     * PLAY" and the menu's "PLAY" -- which is precisely the ambiguity someone
     * navigating by voice or by screen reader would have hit.
     *
     * Sampled across the fade rather than after it, because after it the bug is
     * gone on its own.
     */
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const way = page.getByRole('button', { name: 'TAP TO PLAY' });
    await expect(way).toBeVisible();

    /*
     * Sampled from inside the page, on `requestAnimationFrame`.
     *
     * Driving this from the test instead was the obvious approach and does not
     * work: each round trip costs more than a frame, and under the ease the
     * outgoing panel passes through its middle opacities in about two of them.
     * The first attempt sampled every 50 ms from outside and saw only the ends,
     * which reads exactly like a cut -- a test that fails on working code.
     */
    await page.evaluate(() => {
      const store = window as unknown as { __fade?: number[] };
      store.__fade = [];
      const tick = (): void => {
        const leaving = document.querySelector('.panel--leaving');
        store.__fade?.push(leaving ? Number(getComputedStyle(leaving).opacity) : -1);
        if ((store.__fade?.length ?? 0) < 60) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await way.click();
    for (let i = 0; i < 6; i += 1) {
      expect(await page.getByRole('button', { name: 'PLAY' }).count()).toBeLessThanOrEqual(1);
      await page.waitForTimeout(50);
    }

    /*
     * And it is genuinely a fade, not a delayed cut.
     *
     * Worth asserting separately, because the difference is invisible to every
     * other test here and easy to reintroduce: the outgoing panel's animation has
     * to be its own keyframes rather than the arrival's reversed, since reversing
     * an animation that has already finished does not replay it. That mistake
     * leaves the panel at full opacity for the whole handover and then removes
     * it -- passing "is it hidden afterwards" while looking exactly like the cut
     * this replaced.
     */
    const opacities = await page.evaluate(
      () => (window as unknown as { __fade?: number[] }).__fade ?? []
    );
    expect(opacities.some((value) => value > 0.02 && value < 0.98)).toBe(true);
  });

  test('does not leave the outgoing panel on screen', async ({ page }) => {
    // The cross-fade keeps the panel it is leaving displayed for the length of
    // the fade. If that hand-off ever fails to complete, two screens are stacked
    // on top of each other and the game looks broken rather than smooth.
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await expect(page.locator('.panel--boot')).toBeHidden();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.panel--title')).toBeHidden();
    await expect(page.locator('.panel--modes')).toBeVisible();
  });

  test('a missing track does not jam the door shut', async ({ page }) => {
    await page.route('**/*.webm', (route) => route.abort());
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    // The bar completes and the way in opens regardless. The game is playable
    // without music, so a failed asset costs the soundtrack and nothing else.
    await expect(page.locator('.loading__bar')).toHaveAttribute('aria-valuenow', '100');
    await enter(page);
    expect(await page.evaluate(() => window.__refraction?.music().ready)).toBe(false);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.panel--modes')).toBeVisible();
  });
});

test.describe('settings', () => {
  test('persists a change across a reload', async ({ page }) => {
    await page.goto('/');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    const bloom = page.locator('[data-field="bloom"] input');
    await expect(bloom).toBeChecked();
    await bloom.uncheck();

    await page.reload();
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    await expect(page.locator('[data-field="bloom"] input')).not.toBeChecked();
  });

  test('reaches the renderer, not just the save', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=prefs');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    await page.locator('[data-field="screenShake"] input').uncheck();

    expect(await page.evaluate(() => window.__refraction?.renderer.preferences.screenShake)).toBe(
      false
    );
  });

  test('mutes from the settings panel and from the M key alike', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=mute');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('KeyM');
    await expect(page.locator('.mute')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    const sound = page.locator('[data-field="sound"] input');
    await expect(sound).not.toBeChecked();
    await sound.check();
    await expect(page.locator('.mute')).toBeHidden();
  });
});

test.describe('persistence', () => {
  /** End the run in progress the way the engine would. */
  async function endRun(page: Page): Promise<void> {
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      game.status = 'gameOver';
    });
    await expect(page.locator('.panel--over')).toBeVisible();
  }

  test('records a finished run and shows it on the mode card', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=record');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('Space');
    await endRun(page);

    expect(await page.evaluate(() => window.__refraction?.save().stats.runs ?? 0)).toBe(1);

    await page.getByRole('button', { name: 'CHOOSE MODE' }).click();
    await expect(page.locator('.mode[data-mode="ascent"]')).not.toContainText('Not yet played');
  });

  test('logs the run on the title screen', async ({ page }) => {
    await page.goto('/?debug=1&mode=flatland&seed=log');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await endRun(page);
    await page.getByRole('button', { name: 'CHOOSE MODE' }).click();
    await page.getByRole('button', { name: 'BACK' }).click();
    await page.getByRole('button', { name: 'SCORES' }).click();
    await expect(page.locator('.scores__row').first()).toContainText('Flatland');
  });

  test('game over can return to the title', async ({ page }) => {
    await page.goto('/?debug=1&mode=flatland&seed=home');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await endRun(page);
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.locator('.panel--over')).toBeHidden();
    await expect(page.locator('.panel--title')).toBeVisible();
  });

  test('game over is a result ledger, not a stack of captions', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=ledger');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      game.score = 12_400;
      game.lines = 17;
      game.status = 'gameOver';
    });

    const over = page.locator('.panel--over');
    await expect(over).toBeVisible();
    await expect(over.locator('.over')).toBeVisible();
    await expect(over.locator('.over__title')).toHaveText('GAME OVER');
    await expect(over.locator('.over__label')).toHaveText('SCORE');
    await expect(over.locator('.over__value')).toHaveText('12,400');
    await expect(over.locator('.over__stat-label')).toHaveText(['LINES', 'STAGE']);
    await expect(over.locator('.over__stat-value').first()).toHaveText('17');
    await expect(over.locator('.over__best')).toBeVisible();
    await expect(over.locator('.over__challenge')).toBeHidden();
    await expect(over.getByRole('button', { name: 'PLAY AGAIN' })).toBeVisible();
  });

  test('leaves no board on the title after game over', async ({ page }) => {
    /*
     * The menus carry the room, not a stack. Leaving a finished run used to keep
     * every settled cell in place, so the board sat in the middle of the title
     * (and the mode grid) until PLAY started a new game and replaced it.
     */
    await page.goto('/?debug=1&mode=flatland&seed=leftover');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
      game.status = 'gameOver';
    });
    await expect(page.locator('.panel--over')).toBeVisible();
    expect(
      await page.evaluate(() => window.__refraction?.game.board.filledCells().length ?? -1)
    ).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.locator('.panel--title')).toBeVisible();
    expect(await page.evaluate(() => window.__refraction?.game.board.filledCells().length)).toBe(0);
    expect(await page.evaluate(() => window.__refraction?.game.active)).toBeNull();
  });

  test('leaves no board on the mode grid after game over', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=leftover-modes');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 1, z: 2 });
      game.status = 'gameOver';
    });
    await expect(page.locator('.panel--over')).toBeVisible();

    await page.getByRole('button', { name: 'CHOOSE MODE' }).click();
    await expect(page.locator('.panel--modes')).toBeVisible();
    expect(await page.evaluate(() => window.__refraction?.game.board.filledCells().length)).toBe(0);
  });

  test('recovers from a corrupt save rather than refusing to boot', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('refraction.save.v1', '{"records":{"asc'));
    await page.reload();
    await enter(page);

    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('.panel--title')).toBeVisible();
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.mode')).toHaveCount(6);
    expect(problems).toEqual([]);
  });

  test('honours an unlock earned in an earlier session', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'refraction.save.v1',
        JSON.stringify({ stats: { bestStage: 6 }, records: {} })
      );
    });
    await page.reload();
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toBeEnabled();
  });

  test('a deep link cannot open a locked mode', async ({ page }) => {
    await page.goto('/?mode=blindSpectrum');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    // Held at the title rather than dropped into a mode not yet earned.
    await expect(page.locator('.panel--title')).toBeVisible();
  });
});

test.describe('challenges', () => {
  test('rejects a code that is not one, without starting a run', async ({ page }) => {
    await page.goto('/');
    await enter(page);
    await page.getByRole('button', { name: 'CHALLENGE' }).click();
    await page.locator('.code').fill('nonsense');
    await page.getByRole('button', { name: 'START' }).click();
    await expect(page.locator('.panel--challenge')).toBeVisible();
    await expect(page.locator('.panel--challenge .panel__hint')).toContainText('not a challenge');
  });

  test("starts today's challenge and names it on the game-over screen", async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'CHALLENGE' }).click();
    await page.getByRole('button', { name: "TODAY'S CHALLENGE" }).click();
    await expect(page.locator('.screens')).toBeHidden();

    const daily = await page.locator('.code').inputValue();
    expect(daily).toHaveLength(7);

    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game) game.status = 'gameOver';
    });
    await expect(page.locator('.panel--over .panel__detail')).toContainText(daily);
    await expect(page.locator('.panel--over .over__challenge')).toBeVisible();
  });

  test('the same code gives the same game', async ({ page }) => {
    const fingerprint = async (): Promise<string> => {
      await page.goto('/?debug=1&challenge=A1B2C3D');
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      return page.evaluate(() => {
        const game = window.__refraction?.game;
        if (!game) return '';
        return game.preview.map((entry) => `${entry.def.id}@${entry.lane}`).join('|');
      });
    };
    const first = await fingerprint();
    expect(first).not.toBe('');
    expect(await fingerprint()).toBe(first);
  });
});

test.describe('modes in play', () => {
  test('Flatland deals only flat pieces', async ({ page }) => {
    await page.goto('/?debug=1&mode=flatland&seed=flat');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const allPlanar = await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) return false;
      const shapes = [game.active?.offsets ?? [], ...game.preview.map((p) => p.cells)];
      return shapes.every((cells) => new Set(cells.map((c) => c.z)).size === 1);
    });
    expect(allPlanar).toBe(true);
  });

  test('Blind Spectrum hides depth in the board and the preview alike', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'refraction.save.v1',
        JSON.stringify({ stats: { bestStage: 6 }, records: {} })
      );
    });
    await page.goto('/?debug=1&mode=blindSpectrum&seed=blind');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    expect(await page.evaluate(() => window.__refraction?.renderer.preferences.depthColour)).toBe(
      false
    );

    // The preview must not leak what the board hides: a coloured next-piece
    // would hand back the very lane this mode withholds.
    //
    // Measured on the canvas, where the preview lives since M10. It is drawn by
    // the same `VoxelLayer` as the board, so the mode's neutral fill has to
    // reach it through the same switch rather than through a second decision
    // somewhere in the HUD -- but a shared implementation is a reason to check,
    // not a reason to assume.
    await page.waitForTimeout(300);
    const { lit, chroma } = await previewPixels(page);
    expect(lit).toBeGreaterThan(60);
    expect(chroma).toBeLessThan(24);

    // And the hold slot, which is still DOM and paints from the same palette.
    await page.keyboard.press('KeyC');
    const spreads = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.slot__body .piece__cell--filled')];
      return cells.map((cell) => {
        const [r, g, b] = (getComputedStyle(cell).backgroundColor.match(/\d+/g) ?? []).map(Number);
        return Math.max(r!, g!, b!) - Math.min(r!, g!, b!);
      });
    });
    expect(spreads.length).toBeGreaterThan(0);
    for (const spread of spreads) expect(spread).toBeLessThan(24);
  });

  test('Zen trims the stack instead of ending the run', async ({ page }) => {
    await page.goto('/?debug=1&mode=zen&seed=zen');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      for (let y = 0; y < 20; y += 1) {
        for (let x = 1; x < 8; x += 1) {
          for (let z = 0; z < 8; z += 1) game.board.fill({ x, y, z });
        }
      }
    });
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);

    await expect(page.locator('.panel--over')).toBeHidden();
    expect(await page.evaluate(() => window.__refraction?.game.status)).not.toBe('gameOver');
  });
});

test.describe('the room', () => {
  /**
   * Sample the canvas inside and outside the play column.
   *
   * The room is made of light, not colour, and it sits *under* the board in the
   * visual hierarchy. Both of those are easy to lose by accident -- the room
   * once ran on a hue clock at 0.85 saturation, and its levels were written in
   * linear space where a value that reads as "nearly black" arrives on screen
   * as a mid-dark grey. These are the two numbers that catch either mistake.
   */
  async function roomAndBoard(page: Page): Promise<{
    roomMean: number;
    roomBright: number;
    roomSaturation: number;
    boardBrightest: number;
  }> {
    return page.evaluate(() => {
      const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
      const renderer = window.__refraction?.renderer;
      if (!renderer) throw new Error('debug hook unavailable');
      const rect = renderer.wellScreenRect();
      const box = source.getBoundingClientRect();
      const scaleX = source.width / Math.max(1, box.width);
      const scaleY = source.height / Math.max(1, box.height);

      const scratch = document.createElement('canvas');
      scratch.width = source.width;
      scratch.height = source.height;
      const context = scratch.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(source, 0, 0);
      const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

      const left = (rect.left - box.left) * scaleX;
      const right = left + rect.width * scaleX;
      const top = (rect.top - box.top) * scaleY;
      const bottom = top + rect.height * scaleY;

      let roomSum = 0;
      let roomCount = 0;
      let roomSaturation = 0;
      let boardBrightest = 0;
      const roomLuminance: number[] = [];

      for (let y = 0; y < scratch.height; y += 3) {
        for (let x = 0; x < scratch.width; x += 3) {
          const i = (y * scratch.width + x) * 4;
          const r = data[i] as number;
          const g = data[i + 1] as number;
          const b = data[i + 2] as number;
          const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

          if (x >= left && x <= right && y >= top && y <= bottom) {
            boardBrightest = Math.max(boardBrightest, luminance);
          } else {
            roomSum += luminance;
            roomCount += 1;
            roomLuminance.push(luminance);
            roomSaturation = Math.max(roomSaturation, Math.max(r, g, b) - Math.min(r, g, b));
          }
        }
      }
      roomLuminance.sort((a, b) => a - b);
      const percentile = roomLuminance[Math.floor(roomLuminance.length * 0.995)] ?? 0;
      return {
        roomMean: roomSum / Math.max(1, roomCount),
        roomBright: percentile,
        roomSaturation,
        boardBrightest,
      };
    });
  }

  /**
   * A board with cubes on it and nothing falling.
   *
   * Settled on purpose. While a piece falls the lane focus dims most of the
   * board by design, so "is the room brighter than the board" stops being a
   * question about the room. Freezing the board puts every cube at full
   * strength, which is the comparison worth making.
   */
  async function busyBoard(page: Page): Promise<void> {
    await page.goto('/?debug=1&mode=ascent&seed=room');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press(i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
      await page.keyboard.press('Space');
      await page.waitForTimeout(90);
    }
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game) game.status = 'gameOver';
    });
    await page.waitForTimeout(400);
  }

  test('draws no hard line across the frame when the board is settled', async ({ page }) => {
    // The floor lattice is a horizontal plane, and a horizontal plane viewed
    // from zero elevation is edge-on: every line in it lands on the same row of
    // pixels. Under additive blending eighteen of them at 0.085 sum past 1 and
    // clip, so what reached the screen was not a grid but a hard white rule
    // across the bottom -- luminance 194 against a room that reads under 30.
    //
    // Measured as a local spike rather than as overall brightness, because that
    // is what a line is: one row far brighter than the rows either side of it.
    // The room's own gradients move slowly and score near zero here.
    await busyBoard(page);
    const spike = await page.evaluate(() => {
      const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
      const scratch = document.createElement('canvas');
      scratch.width = source.width;
      scratch.height = source.height;
      const context = scratch.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(source, 0, 0);
      const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

      const rowMean = (y: number): number => {
        let sum = 0;
        let n = 0;
        for (let x = 0; x < scratch.width; x += 4) {
          const i = (y * scratch.width + x) * 4;
          sum +=
            0.2126 * (data[i] as number) +
            0.7152 * (data[i + 1] as number) +
            0.0722 * (data[i + 2] as number);
          n += 1;
        }
        return sum / Math.max(1, n);
      };

      const means: number[] = [];
      for (let y = 0; y < scratch.height; y += 1) means.push(rowMean(y));

      // Each row against the rows three away on both sides, so a genuine hard
      // line stands out and a smooth gradient does not.
      let worst = 0;
      for (let y = 3; y < means.length - 3; y += 1) {
        const around = ((means[y - 3] as number) + (means[y + 3] as number)) / 2;
        worst = Math.max(worst, (means[y] as number) - around);
      }
      return worst;
    });

    // The bug measured about 174 by this reading; the room without it scores a
    // handful of levels.
    expect(spike).toBeLessThan(40);
  });

  test('is achromatic — no hue anywhere outside the board', async ({ page }) => {
    await busyBoard(page);
    const { roomSaturation } = await roomAndBoard(page);
    // A cube at full chroma spans ~170 between its channels. The room must not
    // come close: anything with a hue would be a second colour language.
    expect(roomSaturation).toBeLessThan(40);
  });

  test('sits under the board rather than over it', async ({ page }) => {
    await busyBoard(page);
    const { roomMean, roomBright, boardBrightest } = await roomAndBoard(page);
    // The room is a backdrop: its bright end stays below the brightest thing on
    // the board, and on average it is far darker still. Measured at the 99.5th
    // percentile rather than the maximum -- bloom throws a halo a few pixels
    // past the well, and one stray pixel is not the room out-shining the board.
    expect(roomBright).toBeLessThan(boardBrightest);
    expect(roomMean).toBeLessThan(20);
  });

  test('still moves, quietly', async ({ page }) => {
    // Dark is not the same as dead. The dust and the shafts keep drifting.
    await busyBoard(page);
    const sample = (): Promise<number[]> =>
      page.evaluate(() => {
        const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
        const scratch = document.createElement('canvas');
        scratch.width = 120;
        scratch.height = 80;
        const context = scratch.getContext('2d');
        if (!context) return [];
        context.drawImage(source, 0, 0, scratch.width, scratch.height);
        return Array.from(context.getImageData(0, 0, scratch.width, scratch.height).data);
      });

    const before = await sample();
    await page.waitForTimeout(900);
    const after = await sample();
    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs((before[i] as number) - (after[i] as number)) > 1) changed += 1;
    }
    expect(changed).toBeGreaterThan(20);
  });
});

test.describe('the Shift meter stays on screen', () => {
  /** How far the meter's box falls outside the viewport, in pixels. */
  async function overflowBelow(page: Page): Promise<number> {
    return page.evaluate(() => {
      const shift = document.querySelector('.hud__shift');
      if (!shift) return Number.NaN;
      const rect = shift.getBoundingClientRect();
      return rect.bottom - window.innerHeight;
    });
  }

  const viewports = [
    { name: 'a normal window', width: 1440, height: 900 },
    { name: 'a laptop', width: 1280, height: 720 },
    { name: 'a short window', width: 1280, height: 560 },
    { name: 'a phone', width: 390, height: 844 },
    { name: 'landscape on a phone', width: 844, height: 390 },
  ];

  for (const viewport of viewports) {
    test(`is fully visible on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?debug=1&mode=ascent&seed=shift');
      await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
      await page.waitForTimeout(200);

      await expect(page.locator('.hud__shift')).toBeVisible();
      // The camera reserves room below the board and the layout clamps to the
      // window, so the meter cannot fall off the bottom at any aspect.
      expect(await overflowBelow(page)).toBeLessThanOrEqual(0);
      await expect(page.locator('.meter__pip')).toHaveCount(5);
    });
  }

  test('sits below the board, not over it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?debug=1&mode=ascent&seed=under');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    const gap = await page.evaluate(() => {
      const shift = document.querySelector('.hud__shift');
      const renderer = window.__refraction?.renderer;
      if (!shift || !renderer) return Number.NaN;
      const well = renderer.wellScreenRect();
      return shift.getBoundingClientRect().top - (well.top + well.height);
    });
    // Clear of the board's silhouette rather than clamped on top of it.
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});

test.describe('the x-ray', () => {
  /**
   * The x-ray is a property of the falling piece's **drop channel**, not of the
   * board: the columns the piece spans, from the row it will land on upward.
   *
   * Which means a flat board x-rays nothing at all, correctly — the ghost sits
   * on top of the stack, so on level ground there is nothing above it to see
   * through. The effect only has anything to do when the stack is *uneven*: when
   * cubes in some other lane stand higher than the row the piece is aiming for
   * and get between the player and it. So the fixture builds a wall in a chosen
   * range of lanes and drops a single cube into a lane that has none.
   *
   * Building the wall in front of the piece isolates the x-ray; building it
   * behind isolates the muting. Nothing else is in the way either time, so each
   * measurement is of one band alone rather than of a stack of them.
   */
  const BASE_HEIGHT = 6;
  const WALL_HEIGHT = 10;
  /** Comfortably inside the wall and above the landing row. */
  const PROBE_ROW = 8;

  interface Fixture {
    /** Inclusive lane range the wall occupies. Must exclude `pieceLane`. */
    readonly wall: readonly [number, number];
    readonly pieceLane: number;
    readonly pieceColumn: number;
    /** Height of the wall. Defaults to `WALL_HEIGHT`. */
    readonly wallTop?: number;
    /** Leave the piece off entirely, for the untouched-board baseline. */
    readonly falling?: boolean;
    /**
     * Hide the ghost marker. The channel is still computed from the ghost's
     * position either way -- this only stops it being drawn, so a cell can be
     * measured for the settled cubes in it alone.
     */
    readonly hideGhost?: boolean;
  }

  interface CellSample {
    readonly u: number;
    readonly y: number;
    readonly mean: number;
    readonly peak: number;
  }

  async function sample(
    page: Page,
    fixture: Fixture,
    cells: readonly { u: number; y: number }[]
  ): Promise<CellSample[]> {
    await page.goto('/?debug=1&mode=ascent&seed=xray');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(
      ({ fixture, base, wallTop }) => {
        const game = window.__refraction?.game;
        if (!game || !game.active) throw new Error('debug hook unavailable');

        // Seven columns, not eight. A line is eight cells sharing a row and a
        // lane, so a full-width slab would complete dozens of them at once, the
        // engine would go to 'resolving', and there would be no falling piece to
        // have a channel at all. One empty column keeps the board legal.
        const [wallLo, wallHi] = fixture.wall;
        for (let x = 0; x < 7; x += 1) {
          for (let lane = 0; lane < 8; lane += 1) {
            // Front face: lane maps to z = 7 - lane.
            const z = 7 - lane;
            const top = lane >= wallLo && lane <= wallHi ? wallTop : base;
            for (let y = 0; y < top; y += 1) game.board.fill({ x, y, z });
          }
        }

        if (fixture.hideGhost) window.__refraction?.renderer?.setPreferences({ showGhost: false });

        if (fixture.falling === false) {
          game.active = null;
          return;
        }
        // A single cube, so the channel is exactly one column wide and sits in
        // exactly the lane asked for.
        game.active = {
          ...game.active,
          offsets: [{ x: 0, y: 0, z: 0 }],
          u: fixture.pieceColumn,
          lane: fixture.pieceLane,
          y: 15,
        };
      },
      { fixture, base: BASE_HEIGHT, wallTop: fixture.wallTop ?? WALL_HEIGHT }
    );
    await page.waitForTimeout(400);

    return page.evaluate(
      ({ cells }) => {
        const renderer = window.__refraction?.renderer;
        const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
        if (!renderer) throw new Error('debug hook unavailable');
        const rect = renderer.wellScreenRect();
        const box = source.getBoundingClientRect();
        const scaleX = source.width / box.width;
        const scaleY = source.height / box.height;

        const scratch = document.createElement('canvas');
        scratch.width = source.width;
        scratch.height = source.height;
        const context = scratch.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(source, 0, 0);
        const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

        // The well rect is padded by 0.6 cells above and below the board, so a
        // row is not simply a fraction of eighteen.
        const PAD = 0.6;
        const rows = 18 + PAD * 2;

        return cells.map(({ u, y }) => {
          const left = rect.left - box.left + (rect.width * u) / 8;
          const width = rect.width / 8;
          const top = rect.top - box.top + (rect.height * (PAD + (18 - y - 1))) / rows;
          const height = rect.height / rows;

          const luminance = (px: number, py: number): number => {
            const i = (Math.round(py * scaleY) * scratch.width + Math.round(px * scaleX)) * 4;
            return (
              0.2126 * (data[i] as number) +
              0.7152 * (data[i + 1] as number) +
              0.0722 * (data[i + 2] as number)
            );
          };

          // Mean over the interior, peak over the whole cell. A cube's outline
          // runs around its perimeter, so an interior-only window measures fill
          // and nothing else -- which reads a perfectly good x-ray as a flat
          // fade, since the fill alone is exactly that. The two windows are what
          // separate the two: fill from the middle, structure from the edge.
          let sum = 0;
          let count = 0;
          for (let py = top + height * 0.15; py < top + height * 0.85; py += 1) {
            for (let px = left + width * 0.15; px < left + width * 0.85; px += 1) {
              sum += luminance(px, py);
              count += 1;
            }
          }
          let peak = 0;
          for (let py = top; py < top + height; py += 1) {
            for (let px = left; px < left + width; px += 1) {
              peak = Math.max(peak, luminance(px, py));
            }
          }
          return { u, y, mean: sum / Math.max(1, count), peak };
        });
      },
      { cells }
    );
  }

  /** Wall in front of the piece: everything in the channel is x-rayed. */
  const IN_FRONT: Fixture = { wall: [0, 2], pieceLane: 5, pieceColumn: 3 };
  /** Wall behind the piece: everything in the channel is muted. */
  const BEHIND: Fixture = { wall: [5, 7], pieceLane: 2, pieceColumn: 3 };

  const at = (samples: CellSample[], u: number, y: number): CellSample =>
    samples.find((s) => s.u === u && s.y === y) as CellSample;

  test('only the columns under the piece are touched', async ({ page }) => {
    // This is the failure that shipped: classifying the whole board by lane, so
    // a piece dealt anywhere turned every column to glass or to shadow. A column
    // the piece does not cover must render exactly as it would with nothing
    // falling at all.
    const probe = [
      { u: 3, y: PROBE_ROW },
      { u: 0, y: PROBE_ROW },
      { u: 6, y: PROBE_ROW },
    ];
    const falling = await sample(page, IN_FRONT, probe);
    const still = await sample(page, { ...IN_FRONT, falling: false }, probe);

    expect(at(falling, 3, PROBE_ROW).mean).toBeLessThan(at(still, 3, PROBE_ROW).mean * 0.6);
    for (const u of [0, 6]) {
      expect(Math.abs(at(falling, u, PROBE_ROW).mean - at(still, u, PROBE_ROW).mean)).toBeLessThan(
        4
      );
    }
  });

  test('the channel stops at the surface the piece will rest on', async ({ page }) => {
    // Above the surface the player is looking through the channel at what they
    // are aiming for. Below it the stack is buried and has nothing to do with
    // the shot being lined up, so it stays at full strength.
    const below = BASE_HEIGHT - 3;
    const probe = [
      { u: 3, y: PROBE_ROW },
      { u: 3, y: below },
    ];
    const falling = await sample(page, IN_FRONT, probe);
    const still = await sample(page, { ...IN_FRONT, falling: false }, probe);

    expect(at(falling, 3, PROBE_ROW).mean).toBeLessThan(at(still, 3, PROBE_ROW).mean * 0.6);
    expect(Math.abs(at(falling, 3, below).mean - at(still, 3, below).mean)).toBeLessThan(4);
  });

  test('sees through the channel rather than fading it', async ({ page }) => {
    // The x-ray signature is a low mean with a high peak: the fill is barely a
    // tint, and each cube keeps a bright outline. A uniform fade has neither --
    // it lowers both together, which is what "everything looks muted" was.
    const probe = [{ u: 3, y: PROBE_ROW }];
    const [channel] = await sample(page, IN_FRONT, probe);
    const [plain] = await sample(page, { ...IN_FRONT, falling: false }, probe);

    expect((channel as CellSample).mean).toBeLessThan((plain as CellSample).mean * 0.6);
    expect((channel as CellSample).peak).toBeGreaterThan((plain as CellSample).mean);
  });

  test('darkens what stands behind the landing surface', async ({ page }) => {
    // Behind is a dark mass with no structure: dimmer than the x-ray on average
    // and without its bright edges. Dark, not deleted -- the cubes are still
    // there and still carry their depth colour.
    const probe = [{ u: 3, y: PROBE_ROW }];
    const [muted] = await sample(page, BEHIND, probe);
    const [plain] = await sample(page, { ...BEHIND, falling: false }, probe);
    const [xrayed] = await sample(page, IN_FRONT, probe);

    expect((muted as CellSample).mean).toBeLessThan((plain as CellSample).mean * 0.4);
    expect((muted as CellSample).mean).toBeGreaterThan(1);
    expect((muted as CellSample).peak).toBeLessThan((xrayed as CellSample).peak);
  });

  test('x-rays what stands directly in front of the ghost', async ({ page }) => {
    // The landing row itself, not just the rows above it. A cube level with the
    // ghost in a nearer lane hides the exact cell the piece is aimed at, so it
    // is the single most important one to see through -- and it is the one an
    // off-by-one in the channel's floor would leave solid.
    //
    // The wall is built one row taller than the rest of the board, so its top
    // row sits at precisely the height the piece will land at.
    const level: Fixture = {
      wall: [0, 2],
      wallTop: BASE_HEIGHT + 1,
      pieceLane: 5,
      pieceColumn: 3,
    };
    const probe = [{ u: 3, y: BASE_HEIGHT }];
    // Measured with the ghost hidden, so this is the settled cubes alone rather
    // than the settled cubes plus the marker showing through them.
    const [channel] = await sample(page, { ...level, hideGhost: true }, probe);
    const [plain] = await sample(page, { ...level, falling: false }, probe);

    expect((channel as CellSample).mean).toBeLessThan((plain as CellSample).mean * 0.6);
    expect((channel as CellSample).peak).toBeGreaterThan((channel as CellSample).mean * 1.5);
  });

  test('shows the ghost through the cubes standing in front of it', async ({ page }) => {
    // The point of all of it. The marker sits behind a wall of settled cubes and
    // still has to read, which it only can because those cubes went to glass.
    // Comparing the same cell with the marker drawn and suppressed isolates it:
    // the difference is exactly how much of the ghost is getting through.
    const level: Fixture = {
      wall: [0, 2],
      wallTop: BASE_HEIGHT + 1,
      pieceLane: 5,
      pieceColumn: 3,
    };
    const probe = [{ u: 3, y: BASE_HEIGHT }];
    const [withGhost] = await sample(page, level, probe);
    const [withoutGhost] = await sample(page, { ...level, hideGhost: true }, probe);

    expect((withGhost as CellSample).mean).toBeGreaterThan(
      (withoutGhost as CellSample).mean * 1.25
    );
  });

  test('leaves the board alone when nothing is falling', async ({ page }) => {
    // The channel belongs to the falling piece, not to the board, so the same
    // cube comes back to full strength once the piece is gone.
    // Column 0 carries an identical stack and the piece never covers it, so it
    // is the same cube under no aids at all -- the reference for what "left
    // alone" looks like.
    const probe = [
      { u: 3, y: PROBE_ROW },
      { u: 0, y: PROBE_ROW },
    ];
    const falling = await sample(page, IN_FRONT, probe);
    const settled = await sample(page, { ...IN_FRONT, falling: false }, probe);

    // Substantially changed while the piece is in play...
    expect(at(falling, 3, PROBE_ROW).mean).toBeLessThan(at(settled, 3, PROBE_ROW).mean * 0.6);
    // ...and once it is gone, indistinguishable from a cube the channel never
    // reached: no fill, no region outline, no mark, nothing.
    //
    // Measured against that neighbour rather than as "peak within three levels
    // of mean", which is what this asserted until the gel material landed. That
    // form was really asserting the cube is *featureless*, which was true of flat
    // shading and is deliberately false now -- a gel cube carries a rim, a catch
    // and a pooled glow, and reads about sixty levels between peak and mean all
    // on its own. Comparing two cubes in the same frame states the actual claim
    // and does not care what the material does, as long as it does it to both.
    expect(Math.abs(at(settled, 3, PROBE_ROW).mean - at(settled, 0, PROBE_ROW).mean)).toBeLessThan(
      3
    );
    expect(Math.abs(at(settled, 3, PROBE_ROW).peak - at(settled, 0, PROBE_ROW).peak)).toBeLessThan(
      6
    );
  });
});

/**
 * The one thing the renderer may never get wrong.
 *
 * "Position is absolute. Colour is relative" only means anything if the colour
 * that reaches the screen is the colour the spectrum ramp chose. Every stop is
 * authored in OKLCH at a specific lightness and chroma; anything in the render
 * pipeline that rescales, compresses or re-tints them is rewriting the game's
 * only depth cue.
 *
 * This is a fidelity test, not a "looks about right" test, and it exists
 * because three separate things were quietly rewriting the ramp at once and the
 * entire suite passed anyway. A backdrop panel was being composited over the
 * finished board instead of behind it, washing the whole playfield to a third
 * of its colour. The ambient light was set to 1.18 where Three's Lambert BRDF
 * needs pi to reproduce an albedo. And ACES tone mapping was compressing what
 * was left, clipping red's blue channel and violet's green one. Together they
 * put every cube at roughly a fifth of its palette value: the board came out
 * dark and muddy while the DOM piece preview, which uses the palette directly,
 * was vivid. That gap is the bug, and this test is that comparison.
 */
test.describe('the board renders the palette it was given', () => {
  test('a settled cube is exactly its depth colour', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=fidelity');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    const samples = await page.evaluate(() => {
      const game = window.__refraction?.game;
      const renderer = window.__refraction?.renderer;
      if (!game || !renderer) throw new Error('debug hook unavailable');

      // One cube per lane, on a diagonal so no cube hides another, and no
      // active piece so the lane focus is off and every cube is at full
      // strength. Front face, where lane = 7 - z.
      for (let lane = 0; lane < 8; lane += 1) game.board.fill({ x: lane, y: 0, z: 7 - lane });
      game.active = null;
      return new Promise<{ lane: number; drawn: number[] }[]>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
            const rect = renderer.wellScreenRect();
            const box = source.getBoundingClientRect();
            const scaleX = source.width / box.width;
            const scaleY = source.height / box.height;
            const scratch = document.createElement('canvas');
            scratch.width = source.width;
            scratch.height = source.height;
            const context = scratch.getContext('2d');
            if (!context) throw new Error('no 2d context');
            context.drawImage(source, 0, 0);

            // The well rect is padded by 0.6 cells above and below the board,
            // so a row's centre is not simply a fraction of eighteen.
            const PAD = 0.6;
            const rows = 18 + PAD * 2;
            const rowCentre = (y: number): number => (PAD + (18 - y - 0.5)) / rows;

            const out: { lane: number; drawn: number[] }[] = [];
            for (let lane = 0; lane < 8; lane += 1) {
              // The cube for this lane sits in column x = lane, bottom row.
              const cx = rect.left - box.left + (rect.width * (lane + 0.5)) / 8;
              const cy = rect.top - box.top + rect.height * rowCentre(0);
              const patch = context.getImageData(
                Math.round(cx * scaleX) - 2,
                Math.round(cy * scaleY) - 2,
                5,
                5
              ).data;
              let r = 0;
              let g = 0;
              let b = 0;
              let n = 0;
              for (let i = 0; i < patch.length; i += 4) {
                r += patch[i] as number;
                g += patch[i + 1] as number;
                b += patch[i + 2] as number;
                n += 1;
              }
              out.push({ lane, drawn: [Math.round(r / n), Math.round(g / n), Math.round(b / n)] });
            }
            resolve(out);
          })
        );
      });
    });

    // The same ramp the game uses, read straight from the core module -- the
    // test must not carry its own copy of the palette or it stops testing the
    // thing that matters.
    const { depthColor } = await import('../../src/core/spectrum');

    for (const { lane, drawn } of samples) {
      const want = depthColor(lane / 7);
      const expected = [want.r, want.g, want.b].map((v) => Math.round(v * 255));
      for (let c = 0; c < 3; c += 1) {
        // A few levels of slack for the rounded cube's shading at the sampled
        // patch, and nothing like enough to hide a pipeline that rescales.
        expect(
          Math.abs((drawn[c] as number) - (expected[c] as number)),
          `lane ${lane} channel ${'rgb'[c]}: drawn ${drawn.join(',')} vs palette ${expected.join(',')}`
        ).toBeLessThanOrEqual(6);
      }
    }
  });

  test('the board is as vivid as the piece preview beside it', async ({ page }) => {
    // The reference has to be DOM, painted with depthColorHex directly, so it is
    // immune to anything the WebGL pipeline does. When the two disagree it is
    // always the board that is wrong, which is exactly how this was found.
    //
    // It reads the HOLD slot now. NEXT used to be that reference and no longer
    // can be -- it is a WebGL render since M10, so comparing it to the board
    // would be comparing the pipeline to itself, and every fault this test
    // exists to catch would cancel out. Hold is still DOM, and it paints at lane
    // 0, which is the lane the board cube below is filled at: the two are the
    // same colour, not merely two saturated ones.
    await page.goto('/?debug=1&mode=ascent&seed=fidelity');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.keyboard.press('KeyC');
    await expect(
      page.locator('.slot').nth(1).locator('.piece__cell--filled').first()
    ).toBeVisible();

    const { board, preview } = await page.evaluate(() => {
      const game = window.__refraction?.game;
      const renderer = window.__refraction?.renderer;
      if (!game || !renderer) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 7 });
      game.active = null;

      const chroma = (r: number, g: number, b: number): number =>
        Math.max(r, g, b) - Math.min(r, g, b);

      return new Promise<{ board: number; preview: number }>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
            const rect = renderer.wellScreenRect();
            const box = source.getBoundingClientRect();
            const scratch = document.createElement('canvas');
            scratch.width = source.width;
            scratch.height = source.height;
            const context = scratch.getContext('2d');
            if (!context) throw new Error('no 2d context');
            context.drawImage(source, 0, 0);
            const PAD = 0.6;
            const rowCentre = (PAD + 17.5) / (18 + PAD * 2);
            // Centre of column 3, not the centre of the well -- the well's
            // midline runs down the seam between two columns.
            const cx = (rect.left - box.left + (rect.width * 3.5) / 8) * (source.width / box.width);
            const cy =
              (rect.top - box.top + rect.height * rowCentre) * (source.height / box.height);
            const patch = context.getImageData(Math.round(cx) - 2, Math.round(cy) - 2, 5, 5).data;
            const px = [0, 1, 2].map((c) => {
              let sum = 0;
              for (let i = c; i < patch.length; i += 4) sum += patch[i] as number;
              return Math.round(sum / (patch.length / 4));
            });

            // The preview cells carry their colour as an inline style. Indexed
            // off the slot rather than queried globally, so this cannot silently
            // start reading NEXT again if the still preview ever becomes the
            // default -- that would put it back to measuring WebGL against WebGL.
            const hold = document.querySelectorAll('.slot')[1];
            const cell = hold?.querySelector('.piece__cell--filled') as HTMLElement | null;
            const style = cell ? getComputedStyle(cell).backgroundColor : 'rgb(0,0,0)';
            const [pr, pg, pb] = (style.match(/\d+/g) ?? ['0', '0', '0']).map(Number) as [
              number,
              number,
              number,
            ];

            resolve({
              board: chroma(px[0] as number, px[1] as number, px[2] as number),
              preview: chroma(pr, pg, pb),
            });
          })
        );
      });
    });

    // Both are a fully saturated spectrum colour, so both should span a wide
    // range between their channels. Before the fix the board managed a fifth of
    // the preview's chroma.
    expect(preview).toBeGreaterThan(80);
    expect(board).toBeGreaterThan(preview * 0.75);
  });
});

/**
 * Where the piece will come to rest, and what it will come to rest on.
 *
 * Two marks, not one, and on a stepped board they are rows apart. A piece whose
 * underside does not match the stack lands on its highest point and leaves a gap
 * under everything else — so "where it lands" and "the first real voxel" are
 * different cells, and the player needs both.
 */
test.describe('the landing marks', () => {
  /**
   * A staircase in one lane with a solid wall in front of it.
   *
   * The staircase makes the gap: a flat four-wide bar rests on the tallest step
   * and hangs over the rest. The wall gives the channel something to see through
   * at every row, so the channel's reach can be measured as a change in a cube
   * rather than as empty space, which has no brightness to compare.
   */
  const STAIRCASE = [0, 9, 5, 3, 2, 0, 0];
  const WALL_LANES = 3;
  const PIECE_LANE = 3;

  interface CellSample {
    readonly u: number;
    readonly y: number;
    readonly mean: number;
    readonly peak: number;
  }

  async function sample(
    page: Page,
    cells: readonly { u: number; y: number }[],
    options: { falling?: boolean; wall?: boolean } = {}
  ): Promise<CellSample[]> {
    await page.goto('/?debug=1&mode=ascent&seed=marks');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(
      ({ staircase, wallLanes, pieceLane, falling, wall }) => {
        const game = window.__refraction?.game;
        if (!game || !game.active) throw new Error('debug hook unavailable');
        // Seven columns; the eighth stays empty so no line ever completes and
        // the engine stays in 'falling'.
        for (let x = 0; x < 7; x += 1) {
          for (let lane = 0; lane < 8; lane += 1) {
            const height =
              lane === pieceLane ? (staircase[x] ?? 0) : wall !== false && lane < wallLanes ? 9 : 0;
            for (let y = 0; y < height; y += 1) game.board.fill({ x, y, z: 7 - lane });
          }
        }
        if (falling === false) {
          game.active = null;
          return;
        }
        game.active = {
          ...game.active,
          offsets: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 },
          ],
          u: 1,
          lane: pieceLane,
          y: 15,
        };
      },
      {
        staircase: STAIRCASE,
        wallLanes: WALL_LANES,
        pieceLane: PIECE_LANE,
        falling: options.falling ?? true,
        wall: options.wall ?? true,
      }
    );
    await page.waitForTimeout(400);

    return page.evaluate(
      ({ cells }) => {
        const renderer = window.__refraction?.renderer;
        const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
        if (!renderer) throw new Error('debug hook unavailable');
        const rect = renderer.wellScreenRect();
        const box = source.getBoundingClientRect();
        const scaleX = source.width / box.width;
        const scaleY = source.height / box.height;

        const scratch = document.createElement('canvas');
        scratch.width = source.width;
        scratch.height = source.height;
        const context = scratch.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(source, 0, 0);
        const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

        const PAD = 0.6;
        const rows = 18 + PAD * 2;
        const luminance = (px: number, py: number): number => {
          const i = (Math.round(py * scaleY) * scratch.width + Math.round(px * scaleX)) * 4;
          return (
            0.2126 * (data[i] as number) +
            0.7152 * (data[i + 1] as number) +
            0.0722 * (data[i + 2] as number)
          );
        };

        return cells.map(({ u, y }) => {
          const left = rect.left - box.left + (rect.width * u) / 8;
          const width = rect.width / 8;
          const top = rect.top - box.top + (rect.height * (PAD + (18 - y - 1))) / rows;
          const height = rect.height / rows;

          let sum = 0;
          let count = 0;
          for (let py = top + height * 0.15; py < top + height * 0.85; py += 1) {
            for (let px = left + width * 0.15; px < left + width * 0.85; px += 1) {
              sum += luminance(px, py);
              count += 1;
            }
          }
          let peak = 0;
          for (let py = top; py < top + height; py += 1) {
            for (let px = left; px < left + width; px += 1) {
              peak = Math.max(peak, luminance(px, py));
            }
          }
          return { u, y, mean: sum / Math.max(1, count), peak };
        });
      },
      { cells }
    );
  }

  const at = (samples: CellSample[], u: number, y: number): CellSample =>
    samples.find((s) => s.u === u && s.y === y) as CellSample;

  test('the channel reaches the first real voxel, not where the piece stops', async ({ page }) => {
    // The bar rests at row 9 in every column it covers, but the surface under it
    // sits at 8, 4, 2 and 1. Row 4 is therefore *inside* the channel in column 3,
    // whose surface is two rows lower, and *outside* it in column 1, whose
    // surface is directly beneath the piece. Same row, same wall in front, and
    // the only difference is how far down the player has to see.
    //
    // Stopping the channel at the landing row — as it did — put both of them
    // outside, which hid the gap: the single most useful thing on the board when
    // a piece is about to land badly.
    const probe = [
      { u: 3, y: 4 },
      { u: 1, y: 4 },
    ];
    const falling = await sample(page, probe);
    const still = await sample(page, probe, { falling: false });

    expect(at(falling, 3, 4).mean).toBeLessThan(at(still, 3, 4).mean * 0.6);
    expect(Math.abs(at(falling, 1, 4).mean - at(still, 1, 4).mean)).toBeLessThan(4);
  });

  test('the surface the piece will rest on stays solid, and is marked', async ({ page }) => {
    // The backstop. Everything above it in the channel goes to glass, but the
    // surface cube itself stays opaque — an x-rayed cube cannot carry a mark —
    // and takes a smaller, brighter square on its face.
    //
    // Measured with no wall in front, so the mark is on its own and nothing can
    // be credited to the x-ray. The mark lives *inside* the cell, so it lifts the
    // interior mean rather than the peak at the border.
    const probe = [{ u: 3, y: 2 }];
    const [marked] = await sample(page, probe, { wall: false });
    const [plain] = await sample(page, probe, { wall: false, falling: false });

    expect((marked as CellSample).mean).toBeGreaterThan((plain as CellSample).mean * 1.15);
  });

  test('the landing mark reads with nothing in front of it', async ({ page }) => {
    // A mark may not depend on the x-ray to be legible. On an open board the
    // x-ray correctly does nothing, which is exactly where the landing mark was
    // faintest — a 0.44 cube over a near-black background, reading around
    // luminance 47.
    //
    // It had an outline for a while, which fixed that and created a worse
    // problem: an outlined mark inside an outlined x-ray region is two borders
    // a few pixels apart saying different things. The legibility comes from the
    // fill now, raised and lifted toward white.
    //
    // Row 9 is where the bar comes to rest, and with no wall there is nothing
    // else in that cell at all: whatever is measured there is the mark.
    const probe = [{ u: 3, y: 9 }];
    const [mark] = await sample(page, probe, { wall: false });
    const [empty] = await sample(page, probe, { wall: false, falling: false });

    // Relative, because the room is not perfectly black behind the well and an
    // absolute floor would be measuring the environment's brightness instead.
    expect((mark as CellSample).peak).toBeGreaterThan((empty as CellSample).peak * 2.5);
    expect((mark as CellSample).peak).toBeGreaterThan(80);
  });

  test('outlines the x-rayed region once, not every cube in it', async ({ page }) => {
    // Twelve edges per cube turns a block of them into a grid of boxes, which is
    // busy and competes with the marks above. Only the region's outer edge
    // carries a border now.
    //
    // A cell in the middle of the region and a cell on its edge, both x-rayed:
    // the interior one must be flat, the edge one must not.
    //
    // Picking the two cells needs care, and two wrong choices were measured on
    // the way. The staircase makes the region's own shape stepped — each column's
    // floor is its own surface — so a cell that looks interior may sit against a
    // column whose floor is higher. And every column's floor row holds the
    // backstop cube, which is solid and carries the landing mark, so a cell there
    // is not measuring the x-ray at all.
    //
    // Row 5 clears both: the floors of columns 2, 3 and 4 are all below it, and
    // none of their backstops are in it. (3, 5) is surrounded; (4, 5) is right
    // beside it against column 5, which the piece does not cover.
    //
    // Measured as one cell against the other rather than as each cell's peak
    // against its own mean. That was the original form and it stopped working
    // when the channel was capped at one pane of glass: the fill is now faint by
    // design, so an interior cell's mean sits near the background, and scaling
    // its peak against that turns two luminance levels of antialiasing into a
    // 55% swing. The claim is a comparison between two cells anyway -- this one
    // has a border through it, that one does not -- so it is measured as one.
    const probe = [
      { u: 3, y: 5 },
      { u: 4, y: 5 },
    ];
    const falling = await sample(page, probe);

    const interior = at(falling, 3, 5);
    const border = at(falling, 4, 5);
    expect(interior.peak).toBeLessThan(border.peak * 0.5);
    expect(border.peak).toBeGreaterThan(border.mean * 2);
  });
});

/**
 * The marks, on the board that needs them most.
 *
 * Every other measurement here puts three lanes of wall in front of the piece.
 * Three is not the hard case: the well is eight deep, and a stack that has
 * filled the front of the board is exactly when a player cannot tell where
 * anything is going to land.
 *
 * It was also where the aid quietly stopped working. Translucency accumulates,
 * so a channel seen through seven panes of glass came back to 59% coverage --
 * measured at luminance 93 where an untouched cube reads 107. The landing
 * footprint behind it peaked at 135 against glass peaking at 119: a 13%
 * separation, where an open board gives fourteen times. The x-ray dissolved as
 * the board got harder, which is backwards, and no amount of re-tuning the marks
 * could fix it because the marks were not the problem.
 *
 * The channel draws one pane per screen cell now. These hold that: both marks
 * have to read against a full-depth wall the way they read against nothing.
 */
test.describe('the marks survive a buried board', () => {
  /**
   * The deepest lane, behind a wall filling every lane in front of it.
   *
   * The piece is a flat four-wide bar in lane 7 with a single three-high stack
   * under one end, so it comes to rest at row 3 and hangs over the rest -- the
   * two marks are rows apart, and both are behind seven cubes of wall. Column 7
   * stays empty so no line ever completes and the engine stays in `falling`.
   */
  const LANE7 = [0, 3, 0, 0, 0, 0, 0];
  const PIECE_LANE = 7;
  const WALL_TOP = 14;

  interface CellSample {
    readonly u: number;
    readonly y: number;
    readonly mean: number;
    readonly peak: number;
  }

  async function sample(
    page: Page,
    cells: readonly { u: number; y: number }[],
    options: { buried?: boolean } = {}
  ): Promise<CellSample[]> {
    await page.goto('/?debug=1&mode=ascent&seed=buried');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.evaluate(
      ({ lane7, pieceLane, wallTop }) => {
        const game = window.__refraction?.game;
        if (!game || !game.active) throw new Error('debug hook unavailable');
        for (let x = 0; x < 7; x += 1) {
          for (let lane = 0; lane < 8; lane += 1) {
            const height = lane === pieceLane ? (lane7[x] ?? 0) : wallTop;
            for (let y = 0; y < height; y += 1) game.board.fill({ x, y, z: 7 - lane });
          }
        }
        game.active = {
          ...game.active,
          offsets: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 },
          ],
          u: 1,
          lane: pieceLane,
          y: 16,
        };
      },
      {
        lane7: LANE7,
        pieceLane: PIECE_LANE,
        wallTop: options.buried === false ? 0 : WALL_TOP,
      }
    );
    await page.waitForTimeout(400);

    return page.evaluate(
      ({ cells }) => {
        const renderer = window.__refraction?.renderer;
        const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
        if (!renderer) throw new Error('debug hook unavailable');
        const rect = renderer.wellScreenRect();
        const box = source.getBoundingClientRect();
        const scaleX = source.width / box.width;
        const scaleY = source.height / box.height;

        const scratch = document.createElement('canvas');
        scratch.width = source.width;
        scratch.height = source.height;
        const context = scratch.getContext('2d');
        if (!context) throw new Error('no 2d context');
        context.drawImage(source, 0, 0);
        const { data } = context.getImageData(0, 0, scratch.width, scratch.height);

        const PAD = 0.6;
        const rows = 18 + PAD * 2;
        const luminance = (px: number, py: number): number => {
          const i = (Math.round(py * scaleY) * scratch.width + Math.round(px * scaleX)) * 4;
          return (
            0.2126 * (data[i] as number) +
            0.7152 * (data[i + 1] as number) +
            0.0722 * (data[i + 2] as number)
          );
        };

        return cells.map(({ u, y }) => {
          const left = rect.left - box.left + (rect.width * u) / 8;
          const width = rect.width / 8;
          const top = rect.top - box.top + (rect.height * (PAD + (18 - y - 1))) / rows;
          const height = rect.height / rows;

          let sum = 0;
          let count = 0;
          for (let py = top + height * 0.15; py < top + height * 0.85; py += 1) {
            for (let px = left + width * 0.15; px < left + width * 0.85; px += 1) {
              sum += luminance(px, py);
              count += 1;
            }
          }
          let peak = 0;
          for (let py = top; py < top + height; py += 1) {
            for (let px = left; px < left + width; px += 1) {
              peak = Math.max(peak, luminance(px, py));
            }
          }
          return { u, y, mean: sum / Math.max(1, count), peak };
        });
      },
      { cells }
    );
  }

  const at = (samples: CellSample[], u: number, y: number): CellSample =>
    samples.find((s) => s.u === u && s.y === y) as CellSample;

  test('both marks stand clear of seven lanes of glass', async ({ page }) => {
    // Row 3 is where the bar rests; row 2 is the cube it rests on; row 8 is the
    // same channel well above both, where there is nothing behind the glass at
    // all. The marks have to separate from that, not merely exceed it.
    const probe = [
      { u: 1, y: 3 },
      { u: 1, y: 2 },
      { u: 1, y: 8 },
    ];
    const buried = await sample(page, probe);

    const glass = at(buried, 1, 8);
    expect(at(buried, 1, 3).mean).toBeGreaterThan(glass.mean * 3);
    expect(at(buried, 1, 2).mean).toBeGreaterThan(glass.mean * 3);
    // And the two marks stay distinguishable from each other. They say different
    // things -- where the piece will sit, and what it will sit on -- so a board
    // that flattens them into one bright smear has lost the gap between them.
    expect(at(buried, 1, 2).mean).toBeGreaterThan(at(buried, 1, 3).mean * 1.3);
  });

  test('a wall in front costs the marks almost nothing', async ({ page }) => {
    // The measurement that made the accumulation obvious. With the channel
    // capped at one pane the buried board and the open one read within a tenth
    // of each other; before the cap the contact mark lost a sixth of its
    // strength to the wall and the footprint gained a quarter from the glass in
    // front of it, which is the aid becoming the obstruction.
    const probe = [
      { u: 1, y: 3 },
      { u: 1, y: 2 },
    ];
    const buried = await sample(page, probe);
    const open = await sample(page, probe, { buried: false });

    for (const y of [3, 2]) {
      const ratio = at(buried, 1, y).mean / at(open, 1, y).mean;
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
  });

  test('a column the piece does not cover keeps its full colour', async ({ page }) => {
    // The cap must not have turned into a general thinning of the board. Column
    // 6 is outside the channel, so its front cube is untouched whatever is
    // happening in the columns beside it.
    const probe = [
      { u: 6, y: 3 },
      // Column 5 is outside the channel too, and carries the same stack: the
      // reference for a cube under no aids at all.
      { u: 5, y: 3 },
      // Above the wall, which stops at row 13, and outside the piece's columns:
      // empty. The dark reference, so a pass cannot come from the sample simply
      // reading everything as bright.
      { u: 6, y: 15 },
    ];
    const buried = await sample(page, probe);

    const wall = at(buried, 6, 3);
    expect(wall.mean).toBeGreaterThan(80);
    // And identical to its untouched neighbour: no glass, no outline, no mark.
    //
    // Compared against another cube rather than asserted featureless -- this read
    // `peak - mean < 3` until the gel material landed, which was measuring flat
    // shading rather than the absence of aids. A gel cube is about sixty levels
    // between peak and mean by itself, and that is the material working.
    expect(Math.abs(wall.mean - at(buried, 5, 3).mean)).toBeLessThan(3);
    expect(Math.abs(wall.peak - at(buried, 5, 3).peak)).toBeLessThan(6);
    expect(at(buried, 6, 15).mean).toBeLessThan(30);
  });
});

/**
 * The controls, told to the player.
 *
 * The game had never said what its keys do anywhere but the README, and it has
 * enough of them now — move, three rotation axes, a depth nudge, hold, hard
 * drop, face choice, pause, mute, restart — that it has to.
 *
 * The panel is built from the same table the input controller reads, so these
 * check the rendering against that table rather than against a list written out
 * here. A key map with its own copy of the bindings is right on the day it is
 * written and wrong by the next change, with nothing to catch it.
 */
test.describe('the key map', () => {
  // Both panels are in the DOM; CSS decides which one the device sees. Every
  // locator here has to say which, or it matches the touch rows as well and
  // counts them as keyboard bindings.
  const KEYBOARD_MAP = '.keymap:not(.keymap--touch)';

  /**
   * Open settings with a given mode in play.
   *
   * The panel describes what *that mode* answers to, so which mode is running
   * changes what it lists. Opened from the title it describes the default, which
   * is Flatland -- a mode that permits roll alone and never offers the depth
   * nudge, so four keys and two gestures are correctly absent there.
   */
  async function openSettings(page: Page, mode = 'ascent'): Promise<void> {
    await page.goto('/?debug=1&seed=keymap');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate((id) => window.__refraction?.play(id as never, 'keymap'), mode);
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    await expect(page.locator(KEYBOARD_MAP)).toBeVisible();
  }

  test('shows a row for every binding the mode answers to', async ({ page }) => {
    // Ascent permits everything, so here the panel and the table are the same
    // list -- which is the contract the shared table exists to hold.
    await openSettings(page, 'ascent');

    const table = await page.evaluate(() => window.__refraction?.bindings ?? []);
    expect(table.length).toBeGreaterThan(10);

    for (const binding of table) {
      const row = page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="${binding.action}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('.keymap__label')).toHaveText(binding.label);
      await expect(row.locator('.key')).toHaveText(binding.keys);
    }
    // Nothing rendered that the table does not carry.
    await expect(page.locator(`${KEYBOARD_MAP} .keymap__row`)).toHaveCount(table.length);
  });

  test('leaves out the keys a mode does not answer to', async ({ page }) => {
    // Flatland permits roll alone and never offers the depth nudge. A panel that
    // listed Q, E, R, F and the two nudge keys would be advertising six controls
    // the engine ignores -- exactly the drift a table shared with the
    // implementation exists to prevent, arriving through the mode instead.
    await openSettings(page, 'flatland');

    for (const action of ['yawClock', 'yawAnti', 'pitchUp', 'pitchDown']) {
      await expect(
        page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="${action}"]`)
      ).toHaveCount(0);
    }
    for (const action of ['nudgeDeeper', 'nudgeNearer']) {
      await expect(
        page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="${action}"]`)
      ).toHaveCount(0);
    }
    // Roll is still there: it is the one rotation the mode does have.
    await expect(
      page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="rollClock"]`)
    ).toBeVisible();
  });

  test('names the one key that means two things', async ({ page }) => {
    // Left and Right move the piece, and answer the turn prompt while the Shift
    // meter is full. A key map that lists only the first is telling a half
    // truth about the game's most important input.
    await openSettings(page);
    await expect(page.locator(`${KEYBOARD_MAP} .keymap__foot`)).toContainText('Shift meter');
  });

  test('the depth nudge is listed in both directions', async ({ page }) => {
    // The bug the table found: only one direction had ever been bound, so half
    // of a Stage 4 mechanic was unreachable. Read in a mode that has the nudge.
    await openSettings(page, 'ascent');
    await expect(
      page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="nudgeDeeper"]`)
    ).toBeVisible();
    await expect(
      page.locator(`${KEYBOARD_MAP} .keymap__row[data-action="nudgeNearer"]`)
    ).toBeVisible();
  });
});

/**
 * Getting around without a mouse.
 *
 * The same keys that move a piece move through the menu — which is the point:
 * the player should not have to work out that this part of the game wants Tab
 * instead.
 */
test.describe('arrow keys move through the menus', () => {
  const focused = (page: Page): Promise<string> =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return '';
      return (el.querySelector('.mode__name')?.textContent ?? el.textContent ?? '').trim();
    });

  test('walks the mode grid as a grid, not as a list', async ({ page }) => {
    // Left and right walk the row; up and down change row and keep the column.
    // A grid that is one column on a phone and three on a laptop is the same
    // markup either way, so the rows come from the laid-out geometry.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();

    const top = (): Promise<number> =>
      page.evaluate(() => Math.round(document.activeElement?.getBoundingClientRect().top ?? -1));

    const firstName = await focused(page);
    const firstRow = await top();

    await page.keyboard.press('ArrowRight');
    expect(await focused(page)).not.toBe(firstName);
    expect(await top()).toBe(firstRow);

    await page.keyboard.press('ArrowDown');
    const lowerRow = await top();
    expect(lowerRow).toBeGreaterThan(firstRow);

    await page.keyboard.press('ArrowUp');
    expect(await top()).toBeLessThan(lowerRow);

    // Deliberately not asserting that down-then-up returns to the same card.
    // It does not always, and should not: a locked mode is not focusable, so
    // the rows can hold different numbers of cards, and moving between two rows
    // of different occupancy keeps the nearest column rather than an exact one.
  });

  test('moves down the settings rows and reaches the button at the end', async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      seen.add(await page.evaluate(() => document.activeElement?.className ?? ''));
      await page.keyboard.press('ArrowDown');
    }
    // It travels the checkboxes and the slider, and gets to BACK.
    expect([...seen].some((name) => name.includes('field__input'))).toBe(true);
    expect([...seen].some((name) => name.includes('field__range'))).toBe(true);
  });

  test('leaves the arrows alone where a control needs them', async ({ page }) => {
    // A slider needs left and right for its value and a text field needs them
    // for the caret. Taking those would make the volume control unusable by the
    // very keyboard this is meant to serve.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    // Named rather than "the range input": there are two now -- volume, and the
    // touch sensitivity added with the relative controls -- and an unscoped
    // locator matches both.
    const volume = page.locator('.field[data-field="volume"] .field__range');
    await volume.focus();
    const before = await volume.inputValue();
    await page.keyboard.press('ArrowLeft');
    expect(await volume.inputValue()).not.toBe(before);
    // Focus stayed on the slider rather than moving away.
    expect(await page.evaluate(() => document.activeElement?.className ?? '')).toContain(
      'field__range'
    );
  });
});

/**
 * Playing with a thumb.
 *
 * The gesture vocabulary itself is pinned by unit tests, which is where the
 * thresholds belong. These are about the wiring: that a real pointer event
 * reaches the engine, that the zoning holds on the actual laid-out screen, and
 * that touch does not become a second way past the guards the keyboard respects.
 */
test.describe('touch controls', () => {
  /** Dispatch a touch-type pointer gesture through a list of viewport points. */
  async function gesture(
    page: Page,
    points: readonly { x: number; y: number }[],
    options: { pauseMs?: number } = {}
  ): Promise<void> {
    await page.evaluate(
      async ({ points, pauseMs }) => {
        const root = document.querySelector('#app');
        if (!root) throw new Error('no root');
        const send = (type: string, x: number, y: number): void => {
          root.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 1,
              pointerType: 'touch',
              isPrimary: true,
              clientX: x,
              clientY: y,
              bubbles: true,
            })
          );
        };
        const first = points[0] as { x: number; y: number };
        send('pointerdown', first.x, first.y);
        for (const point of points.slice(1)) {
          if (pauseMs) await new Promise((done) => setTimeout(done, pauseMs));
          send('pointermove', point.x, point.y);
        }
        const last = points[points.length - 1] as { x: number; y: number };
        send('pointerup', last.x, last.y);
      },
      { points, pauseMs: options.pauseMs ?? 0 }
    );
  }

  /** Viewport coordinates for a board column, in the strip and in the field. */
  async function anchors(page: Page): Promise<{
    strip: (column: number) => { x: number; y: number };
    field: (column: number) => { x: number; y: number };
  }> {
    const rect = await page.evaluate(() => {
      const r = window.__refraction?.renderer.wellScreenRect();
      if (!r) throw new Error('no renderer');
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    // The strip is anchored to the bottom of the window, not to the bottom of
    // the well. It used to sit directly under the board, which is also where the
    // Shift meter goes -- on a Pixel 7 the two overlapped almost exactly, so the
    // thumb rested on the one readout that says when the board is about to turn.
    const stripY = await page.evaluate(() => window.innerHeight - 84 + 40);
    const columnX = (column: number): number => rect.left + (rect.width * (column + 0.5)) / 8;
    return {
      strip: (column) => ({ x: columnX(column), y: stripY }),
      field: (column) => ({ x: columnX(column), y: rect.top + rect.height * 0.4 }),
    };
  }

  const column = (page: Page): Promise<number> =>
    page.evaluate(() => window.__refraction?.game.active?.u ?? -1);

  test('a drag moves the piece by how far the finger travelled', async ({ page }) => {
    // Relative, not absolute. The finger's position on screen says nothing; the
    // distance it covers says everything.
    //
    // This test used to assert the opposite -- drag to column 0's x, expect the
    // piece at column 0 -- and it kept passing after the change, because
    // dragging four columns left from a spawn near the middle also ends at the
    // wall. A test that passes for the wrong reason is worse than none, so it
    // measures the delta now and starts away from both walls.
    await page.goto('/?debug=1&mode=ascent&seed=touchdrag');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);

    const start = await column(page);
    // Two columns right, from a point nowhere near the piece.
    await gesture(page, [at.strip(0), at.strip(1), at.strip(2)]);
    expect(await column(page)).toBe(start + 2);

    // And back, from a different part of the screen entirely.
    await gesture(page, [at.strip(6), at.strip(5), at.strip(4)]);
    expect(await column(page)).toBe(start);
  });

  test('lifting and putting the finger down somewhere else does not move the piece', async ({
    page,
  }) => {
    // The reason for the change. A player has to be able to rest a thumb, shift
    // grip, or reach a more comfortable part of the screen without the board
    // answering -- under an absolute mapping every one of those teleported the
    // piece to wherever the hand happened to land.
    await page.goto('/?debug=1&mode=ascent&seed=touchlift');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);

    const start = await column(page);
    // Down and up at one end of the strip, then the other. No drag either time.
    await gesture(page, [at.strip(0), at.strip(0)]);
    expect(await column(page)).toBe(start);
    await gesture(page, [at.strip(7), at.strip(7)]);
    expect(await column(page)).toBe(start);

    // And a drag after re-placing still measures from the new resting point.
    await gesture(page, [at.strip(7), at.strip(6)]);
    expect(await column(page)).toBe(start - 1);
  });

  test('a drag into a wall does not bank distance to be undone', async ({ page }) => {
    // Press into the left wall and hold, then reverse. Without re-anchoring on a
    // refused step, the recogniser keeps counting columns the piece never took,
    // and the first part of the return journey does nothing at all -- which
    // reads as the controls dying rather than as a wall.
    await page.goto('/?debug=1&mode=ascent&seed=touchwall');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);

    // One continuous drag: left into the wall, then back, without lifting.
    //
    // Without lifting is the whole point, and the first version of this test got
    // it wrong -- it used two separate gestures, and a new touch re-anchors by
    // itself, so the test passed with re-anchoring removed. The banked distance
    // only exists inside a single drag.
    await gesture(
      page,
      [at.strip(7), at.strip(4), at.strip(1), at.strip(0), at.strip(0), at.strip(1)],
      { pauseMs: 10 }
    );
    // Seven columns of travel left from a spawn near the middle leaves three or
    // four columns pressed into the wall. Coming back one column has to move the
    // piece one column, not work off the debt first.
    expect(await column(page)).toBe(1);
  });

  test('a flick down in the strip drops the piece', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=touchdrop');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);

    // Measured on the board, not on the piece's height. A hard drop locks the
    // piece and spawns the next one at the same spawn row, so `active.y` reads
    // the same before and after and cannot tell "dropped" from "did not move".
    const settled = (): Promise<number> =>
      page.evaluate(() => window.__refraction?.game.board.filledCells().length ?? -1);
    expect(await settled()).toBe(0);

    const start = at.strip(4);
    await gesture(page, [start, { x: start.x, y: start.y + 70 }]);
    await page.waitForTimeout(250);
    expect(await settled()).toBeGreaterThan(0);
  });

  test('a tap above the strip rotates instead of moving', async ({ page }) => {
    // The zoning is the point: the same finger, a few hundred pixels higher,
    // means something else entirely.
    await page.goto('/?debug=1&mode=ascent&seed=touchspin');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);

    const shape = (): Promise<string> =>
      page.evaluate(() => JSON.stringify(window.__refraction?.game.active?.offsets ?? []));
    const before = await shape();
    const beforeColumn = await column(page);
    await gesture(page, [at.field(6), at.field(6)]);
    expect(await shape()).not.toBe(before);
    expect(await column(page)).toBe(beforeColumn);
  });

  test('a mouse is still a keyboard player', async ({ page }) => {
    // Dragging a piece with a cursor is worse than pressing an arrow key, and a
    // laptop with a touchscreen should not change behaviour based on which
    // input was used last.
    await page.goto('/?debug=1&mode=ascent&seed=touchmouse');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);
    const before = await column(page);

    await page.mouse.move(at.strip(4).x, at.strip(4).y);
    await page.mouse.down();
    await page.mouse.move(at.strip(0).x, at.strip(0).y, { steps: 6 });
    await page.mouse.up();

    expect(await column(page)).toBe(before);
  });

  test('does not reach the piece while a menu is up', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=touchmenu');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const at = await anchors(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.panel[data-screen="paused"]')).toBeVisible();

    const before = await column(page);
    await gesture(page, [at.strip(4), at.strip(0)]);
    expect(await column(page)).toBe(before);
  });
});

/**
 * Pause on a phone.
 *
 * Esc is no use without a keyboard, so a bottom-right control opens the same
 * panel. Resume and Main Menu are the ways back out; the button itself must not
 * also rotate the piece.
 */
test.describe('touch-primary pause', () => {
  async function phonePage(browser: Browser): Promise<{
    context: BrowserContext;
    page: Page;
  }> {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    return { context, page };
  }

  test('opens resume and main menu from the bottom-right control', async ({ browser }) => {
    const { context, page } = await phonePage(browser);
    await page.goto('/?debug=1&mode=ascent&seed=touchpause');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    // Exact: the LCD's "Pause music" also contains "Pause".
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toBeVisible();

    const shape = (): Promise<string> =>
      page.evaluate(() => JSON.stringify(window.__refraction?.game.active?.offsets ?? []));
    const before = await shape();
    await pause.click();
    await expect(page.locator('.panel--paused')).toBeVisible();
    expect(await page.evaluate(() => window.__refraction?.game.status)).toBe('paused');
    // A tap on the control must not also count as a field rotate.
    expect(await shape()).toBe(before);

    await page.getByRole('button', { name: 'RESUME' }).click();
    await expect(page.locator('.panel--paused')).toBeHidden();
    expect(await page.evaluate(() => window.__refraction?.game.status)).not.toBe('paused');
    await expect(pause).toBeVisible();

    await pause.click();
    await page.getByRole('button', { name: 'MAIN MENU' }).click();
    await expect(page.locator('.panel--title')).toBeVisible();
    await expect(pause).toBeHidden();

    await context.close();
  });

  test('stays off a keyboard device', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=deskpause');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeHidden();
  });
});

/**
 * Which set of controls a device is told about.
 *
 * Chosen by input method, not by width: a narrow window on a laptop still has a
 * keyboard, and a tablet with one attached reports a fine pointer. Both panels
 * are in the DOM and CSS picks; these check that it picks correctly, because a
 * phone being shown `Z` / `X` to rotate is worse than being shown nothing.
 */
test.describe('the controls panel follows the input method', () => {
  test('a phone is told the gestures, not the keys', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    // `isMobile` alone does not move the `pointer` and `hover` media features,
    // and those are what the stylesheet asks about -- deliberately, since they
    // are the pair that actually means "touch is the only way in". Emulating
    // them directly is the honest test: it is exactly what a phone reports.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'pointer', value: 'coarse' },
        { name: 'hover', value: 'none' },
      ],
    });
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    await expect(page.locator('.keymap--touch')).toBeVisible();
    await expect(page.locator('.keymap:not(.keymap--touch)')).toBeHidden();
    // And it describes the scheme the game actually answers to.
    await expect(page.locator('.keymap--touch')).toContainText('Flick down');
    await expect(page.locator('.keymap--touch .keymap__foot')).toContainText('Shift meter');
    // Spectral Collapse spends through the X button above pause — not the gauge.
    await expect(page.locator('.keymap--touch')).toContainText('X button');
    await expect(page.locator('.keymap--touch')).toContainText('(When bar full) Right panel');
    await expect(page.locator('.keymap--touch')).not.toContainText('gauge');
    await context.close();
  });

  test('a desktop is told the keys, not the gestures', async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    await expect(page.locator('.keymap:not(.keymap--touch)')).toBeVisible();
    await expect(page.locator('.keymap--touch')).toBeHidden();
  });
});

/**
 * Interface corrections from the play notes.
 *
 * Small, unrelated to each other, and grouped only because they are all things
 * the interface was getting wrong.
 */
test.describe('interface corrections', () => {
  test('no HUD element paints over a panel', async ({ page }) => {
    // The Shift meter carries a stacking context so it clears the board's
    // chrome, and with nothing answering it on `.screens` the meter sat on top
    // of every panel — the title screen included, which is the first thing
    // anyone sees.
    //
    // Measured in pixels, not by hit-testing and not by reading z-index. Hit
    // testing cannot see this at all: the HUD is `pointer-events: none`, so
    // `elementFromPoint` skips it and reports the panel underneath whichever way
    // round the two are stacked — a check that passed just as happily with the
    // bug reinstated. Reading z-index would pin one implementation of the fix
    // rather than the thing that matters.
    //
    // So: the meter's own rectangle, with a panel open and without. The panel's
    // backdrop is 86% opaque, so if it is genuinely on top the meter's chrome
    // has to lose most of its brightness behind it.
    await page.goto('/?debug=1&mode=ascent&seed=stacking');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const box = await page.locator('.hud__shift').boundingBox();
    if (!box) throw new Error('no Shift meter');

    const brightness = async (): Promise<number> => {
      const shot = await page.screenshot({ clip: box });
      return page.evaluate(
        async (bytes) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) {
            sum +=
              0.2126 * (data[i] as number) +
              0.7152 * (data[i + 1] as number) +
              0.0722 * (data[i + 2] as number);
          }
          return sum / (data.length / 4);
        },
        [...shot]
      );
    };

    const uncovered = await brightness();
    await page.keyboard.press('Escape');
    await expect(page.locator('.panel[data-screen="paused"]')).toBeVisible();
    const covered = await brightness();

    expect(covered).toBeLessThan(uncovered * 0.6);
  });

  test('the ghost piece is not something a player can switch off', async ({ page }) => {
    // It is not a preference, it is how the board is read — every landing-mark
    // decision assumes it is there. A toggle invites a player to turn off the
    // thing that makes depth legible and then conclude the game is unfair.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    await expect(page.locator('.field[data-field="showGhost"]')).toHaveCount(0);
    // And it is gone from the saved settings, not merely hidden from the panel.
    const saved = await page.evaluate(() => JSON.stringify(window.__refraction?.save() ?? {}));
    expect(saved).not.toContain('showGhost');
  });

  test('volume is labelled and left alone', async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'SETTINGS' }).click();

    const row = page.locator('.field[data-field="volume"]');
    await expect(row.locator('.field__label')).toHaveText('Volume');
    await expect(row.locator('.field__hint')).toHaveCount(0);
  });

  test('a new player lands in Flatland', async ({ page }) => {
    // Planar pieces only, so depth is purely a property of where a piece is put
    // rather than of its own shape.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'PLAY' }).click();
    await page.keyboard.press('Enter');

    await expect
      .poll(() => page.evaluate(() => window.__refraction?.game.mode.id))
      .toBe('flatland');
  });
});

/**
 * Peek: a held key that tilts the camera and does nothing else.
 *
 * A settled board is seen dead-on, so it offers no parallax at all -- which is
 * the point, since parallax would be a second way to read depth competing with
 * the spectrum. Peek lends the player eight degrees of it for as long as they
 * hold the key, and takes it back when they let go.
 *
 * It is a comprehension aid with a deadline. It is offered while the spectrum is
 * still being learned and withdrawn at Stage 6, where reading depth from colour
 * is the skill rather than the tutorial; and it is off entirely in Blind
 * Spectrum, where it would not supplement the depth channel but *be* it.
 */
test.describe('Peek', () => {
  const peeking = (page: Page): Promise<boolean | undefined> =>
    page.evaluate(() => window.__refraction?.renderer.peeking);

  test('tilts while held and comes back when released', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=peek');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    expect(await peeking(page)).toBe(false);
    await page.keyboard.down('KeyP');
    await expect.poll(() => peeking(page)).toBe(true);
    await page.keyboard.up('KeyP');
    await expect.poll(() => peeking(page)).toBe(false);
  });

  test('the tilt is eased rather than snapped', async ({ page }) => {
    // The movement is what carries the parallax: it is the cubes sliding past
    // each other that says which is in front. A hard cut to eight degrees would
    // arrive at the same camera position and show none of it.
    await page.goto('/?debug=1&mode=ascent&seed=peek&turnMs=4000');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    await page.keyboard.down('KeyP');
    // One frame in, the camera has to be on its way but not yet there. The ease
    // runs 180ms, so a single frame is a small fraction of it.
    const partway = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(Boolean(window.__refraction?.renderer.peeking)))
          );
        })
    );
    await page.keyboard.up('KeyP');
    expect(partway).toBe(true);
  });

  test('moves the camera and nothing else', async ({ page }) => {
    // The reason it is safe to offer at all. Peek is a renderer concern: no
    // piece moves, no lock timer runs down, no line resolves. If it touched the
    // run it would be a mechanic, and a mechanic that switches itself off at
    // Stage 6 would be a cliff rather than a lesson.
    await page.goto('/?debug=1&mode=ascent&seed=peek');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    const snapshot = (): Promise<string> =>
      page.evaluate(() => {
        const game = window.__refraction?.game;
        if (!game) throw new Error('debug hook unavailable');
        game.status = 'falling';
        return JSON.stringify({ active: game.active, lines: game.lines, score: game.score });
      });

    const before = await snapshot();
    await page.keyboard.down('KeyP');
    await expect.poll(() => peeking(page)).toBe(true);
    const during = await snapshot();
    await page.keyboard.up('KeyP');

    expect(during).toBe(before);
  });

  test('is withdrawn at the stage the spectrum has to carry alone', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=peek');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(
      ({ perStage }) => {
        const game = window.__refraction?.game;
        if (!game) throw new Error('debug hook unavailable');
        game.lines = perStage * 5;
      },
      { perStage: LINES_PER_STAGE }
    );
    await expect.poll(() => page.evaluate(() => window.__refraction?.game.stage.index)).toBe(6);

    await page.keyboard.down('KeyP');
    await page.waitForTimeout(300);
    const tilted = await peeking(page);
    await page.keyboard.up('KeyP');
    expect(tilted).toBe(false);
  });

  test('is off entirely where there is no colour to supplement', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'refraction.save.v1',
        JSON.stringify({ stats: { bestStage: 6 }, records: {} })
      );
    });
    await page.goto('/?debug=1&mode=blindSpectrum&seed=peek');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    await page.keyboard.down('KeyP');
    await page.waitForTimeout(300);
    const tilted = await peeking(page);
    await page.keyboard.up('KeyP');
    expect(tilted).toBe(false);
  });

  test('a menu opening cannot strand the tilt', async ({ page }) => {
    // Holding a key and opening pause means the keyup lands on the menu, not on
    // the game. Without an explicit release the camera would stay tilted for the
    // rest of the run with no key held down to explain it.
    await page.goto('/?debug=1&mode=ascent&seed=peek');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    await page.keyboard.down('KeyP');
    await expect.poll(() => peeking(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => peeking(page)).toBe(false);
    await page.keyboard.up('KeyP');
  });
});

/**
 * The next piece, turning.
 *
 * A flat preview shows the piece's silhouette from the front, which is exactly
 * as much as the board shows -- and for a piece with cubes at two depths that is
 * not enough to know its shape. A screw and its mirror project identically from
 * one face, so the player is asked to plan a placement for a solid they have
 * only ever seen flattened.
 *
 * It is drawn into a scissored corner of the board's own canvas rather than into
 * a canvas of its own, which is why the panel that frames it had to become a
 * window: the canvas sits behind the HUD, and a panel with a fill of its own
 * simply covers the render. That failure looked exactly like a black preview,
 * and cost a long hunt through the camera, the frustum and the instance count
 * before the panel above it was suspected.
 */
test.describe('the turning preview', () => {
  test('turns, rather than holding one projection', async ({ page }) => {
    await page.goto('/?debug=1&mode=ascent&seed=spin');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.waitForTimeout(200);

    const first = await previewPixels(page);
    // A revolution is seven seconds, so a second is about a seventh of a turn:
    // plenty to change every face's projection, and short enough that the piece
    // on screen is still the same one.
    await page.waitForTimeout(1000);
    const second = await previewPixels(page);

    expect(first.lit).toBeGreaterThan(60);
    expect(second.signature).not.toBe(first.signature);
  });

  test('holds still when the player asks it to', async ({ page }) => {
    // Off is the *harder* option, not the plainer one: a still preview shows the
    // piece the way the board shows everything, as one projection, and leaves
    // the player to infer the rest.
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'refraction.save.v1',
        JSON.stringify({ stats: {}, records: {}, settings: { spinPreview: false } })
      );
    });
    await page.goto('/?debug=1&mode=ascent&seed=spin');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    // The still preview is the DOM grid, and the panel goes back to being a
    // panel rather than a window over the canvas.
    await expect(
      page.locator('.slot').first().locator('.piece__cell--filled').first()
    ).toBeVisible();
    await expect(page.locator('.slot').first()).not.toHaveClass(/slot--window/);
  });

  test('draws the piece at the depth it will arrive at', async ({ page }) => {
    // The preview turns; the *colour* does not. Each cube wears the colour of
    // the lane it will arrive in, exactly as on the board, because the preview's
    // job is to say what is coming and where -- not to invent a second way of
    // describing depth. A preview that repainted itself as it spun would be
    // saying the piece was moving through the board while it sat in a panel.
    await page.goto('/?debug=1&mode=ascent&seed=spin');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    await page.waitForTimeout(200);

    // Chroma rather than exact bytes: the render is lit and antialiased, and the
    // piece is turning, so no single pixel is stable. What must hold is that the
    // preview shows a spectrum colour rather than the neutral fill, and that the
    // colour does not drift as the piece turns through its faces.
    const first = await previewPixels(page);
    await page.waitForTimeout(900);
    const second = await previewPixels(page);
    expect(first.chroma).toBeGreaterThan(40);
    expect(Math.abs(second.chroma - first.chroma)).toBeLessThan(30);
  });
});

/**
 * The gel material.
 *
 * Every solid cube is cast resin rather than flat plastic. The look is a look
 * and is judged by eye, but two properties of it are rules, and both have been
 * broken by well-meaning render work before:
 *
 * - a settled cube still renders at exactly its `depthColor` (§2.5), which the
 *   fidelity suite above holds; and
 * - nothing the material does varies with depth (§2.1), because a gel that
 *   glowed harder at the front would be a second depth cue competing with the
 *   spectrum.
 *
 * The second is measured here, in Blind Spectrum. That mode gives every cube one
 * neutral fill whatever lane it sits in, so the instance colour is identical
 * across the board and the *only* thing that could make one lane look different
 * from another is the material. Eight cubes, one per lane, have to come out the
 * same.
 */
test.describe('the gel material', () => {
  interface LaneSample {
    readonly lane: number;
    readonly mean: number;
    readonly peak: number;
  }

  /** One cube per lane along the bottom row, sampled cell by cell. */
  async function lanes(page: Page, mode: string): Promise<LaneSample[]> {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'refraction.save.v1',
        JSON.stringify({ stats: { bestStage: 6 }, records: {} })
      );
    });
    await page.goto(`/?debug=1&mode=${mode}&seed=gel`);
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    return page.evaluate(() => {
      const game = window.__refraction?.game;
      const renderer = window.__refraction?.renderer;
      if (!game || !renderer) throw new Error('debug hook unavailable');
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 7 - x });
      game.active = null;

      return new Promise<LaneSample[]>((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const source = document.querySelector('canvas.stage') as HTMLCanvasElement;
            const rect = renderer.wellScreenRect();
            const box = source.getBoundingClientRect();
            const scaleX = source.width / box.width;
            const scaleY = source.height / box.height;
            const scratch = document.createElement('canvas');
            scratch.width = source.width;
            scratch.height = source.height;
            const context = scratch.getContext('2d');
            if (!context) throw new Error('no 2d context');
            context.drawImage(source, 0, 0);
            const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
            const lum = (px: number, py: number): number => {
              const i = (Math.round(py * scaleY) * scratch.width + Math.round(px * scaleX)) * 4;
              return (
                0.2126 * (data[i] as number) +
                0.7152 * (data[i + 1] as number) +
                0.0722 * (data[i + 2] as number)
              );
            };

            const PAD = 0.6;
            const rows = 18 + PAD * 2;
            const out: LaneSample[] = [];
            for (let lane = 0; lane < 8; lane += 1) {
              // Column x = lane holds the cube for that lane, on the bottom row.
              const left = rect.left - box.left + (rect.width * lane) / 8;
              const width = rect.width / 8;
              const top = rect.top - box.top + (rect.height * (PAD + 17)) / rows;
              const height = rect.height / rows;
              let sum = 0;
              let n = 0;
              let peak = 0;
              // The cube fills 4% to 96% of its cell -- `CUBE_GAP` is 0.92 -- so
              // this covers the whole of it, silhouette included, and stops
              // short of the neighbour. An inner-80% window was tried first and
              // is blind to exactly the part that matters: the Fresnel rim lives
              // on the extreme edge, so a violation confined to it changed
              // nothing the sample could see.
              for (let py = top + height * 0.03; py < top + height * 0.97; py += 1) {
                for (let px = left + width * 0.03; px < left + width * 0.97; px += 1) {
                  const v = lum(px, py);
                  sum += v;
                  n += 1;
                  peak = Math.max(peak, v);
                }
              }
              out.push({ lane, mean: sum / Math.max(1, n), peak });
            }
            resolve(out);
          })
        );
      });
    });
  }

  test('does not vary with depth', async ({ page }) => {
    // The measurement that makes this exact rather than approximate. In Blind
    // Spectrum the eight cubes carry one identical fill, so any difference
    // between them is the material reading the lane -- which it must not.
    //
    // Not measured in a coloured mode, and one attempt was: the ratio of a
    // cube's internal contrast to its own brightness looked like it should be
    // constant across the ramp and is not, because luminance is not linear in a
    // per-channel mix toward white. A violet cube gains far more luminance from
    // the same lerp than a green one. That test would have been fitted to
    // today's numbers rather than to the rule.
    // Two out of 255 across the eight lanes. The material as written spreads
    // 1.16; scaling any of its terms by the cube's world depth spreads 2.5 to
    // 2.9, including when the dependence is confined to the Fresnel rim alone,
    // which is the narrowest form the violation could take.
    const samples = await lanes(page, 'blindSpectrum');
    const means = samples.map((s) => s.mean);
    expect(Math.max(...means) - Math.min(...means)).toBeLessThan(2);
  });

  test('is actually there', async ({ page }) => {
    // The companion to the fidelity test. That one pins the centre of a cube to
    // its palette colour, and a material deleted entirely would pass it
    // perfectly -- so something has to claim the cube is more than a flat
    // square. A gel cube carries a rim, a catch along the bevel and a pooled
    // glow, which is tens of levels between its peak and its mean; flat shading
    // measured under three.
    const samples = await lanes(page, 'blindSpectrum');
    for (const sample of samples) {
      expect(sample.peak - sample.mean).toBeGreaterThan(12);
    }
  });
});

/**
 * The title screen.
 *
 * It was plain type over an 86%-opaque blackout, on a cold boot with nothing
 * behind the blackout anyway -- a wordmark on a black rectangle, which is true
 * of any game. The board is the strongest thing this one has, so the front door
 * shows it: a composed stack, turning by itself, under an achromatic masthead.
 */
test.describe('the title screen', () => {
  test('washes the front screens more lightly than it blacks out the rest', async ({ page }) => {
    /*
     * The decision, asserted directly instead of through the picture.
     *
     * This was a pixel test for four milestones and it has earned its retirement.
     * The original claim was that the title's scrim had to be light enough to let
     * a composed stack's colour through, and it was measured in the well, where
     * the stack was. There is no stack now, and every attempt to re-aim the
     * camera at the surviving claim failed for a different reason worth
     * recording:
     *
     * - Over the well **inverted** the result: a panel's own text lands there and
     *   the settings panel is full of it.
     * - A strip down the side measured almost nothing. With the shafts of light
     *   gone the room's edges are near black, and the two screens came out 7.5
     *   against 6.1 — a claim surviving only by a threshold nobody could defend.
     * - The brightest pixels outside the panel inverted it again, because the HUD
     *   comes back on the settings screen and its chrome sits exactly there.
     *
     * The room is a few dim floaters on a dark ground; there is no longer enough
     * light in it to measure a scrim through. So this reads the scrim itself. It
     * is a weaker test in one sense — it cannot catch the wash being defeated by
     * something drawn over it — and a much stronger one in another: it is exact,
     * it cannot go intermittent, and it says precisely what the design decided.
     */
    const alphaOf = async (): Promise<number> =>
      page.evaluate(() => {
        const screens = document.querySelector('.screens');
        if (!screens) return 1;
        const colour = getComputedStyle(screens).backgroundColor;
        const parts = colour.match(/[\d.]+/g) ?? [];
        // `rgb(...)` with no fourth component is fully opaque.
        return parts.length >= 4 ? Number(parts[3]) : 1;
      });

    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const gate = await alphaOf();
    await enter(page);
    const title = await alphaOf();

    await page.getByRole('button', { name: 'SETTINGS' }).click();
    await expect(page.locator('.panel[data-screen="settings"]')).toBeVisible();
    const settings = await alphaOf();

    // The front door and the menu share one light wash; everything that sits
    // over a run keeps the blackout.
    expect(title).toBe(gate);
    expect(title).toBeLessThan(settings);
    expect(settings).toBeGreaterThan(0.8);
  });
  test('lights the masthead without tinting it, and keeps that light off the board', async ({
    page,
  }) => {
    /*
     * §2.2, restated for a front door that now glows.
     *
     * The rule partitions the palette: a hue on screen means depth from the
     * current camera. The mockup this screen was rebuilt from puts a cyan accent
     * on the wordmark, and that is allowed for one reason only — the gate and the
     * menu have no board on them, so there is nothing whose distance a colour
     * could be mistaken for. The moment a board is on screen the old rule applies
     * in full.
     *
     * So this tests two things instead of one, and the second is the one that
     * matters: the *lettering* stays neutral, and the accent never reaches
     * anything that sits over a live board.
     *
     * Measured from declared colours, not pixels. A pixel reading measures the
     * font rasteriser — Chrome renders white glyphs with subpixel antialiasing,
     * so the masthead's rectangle came back at chroma 34 with nothing tinted.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);

    const chromaOf = (colour: string): number => {
      const parts = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      if (parts.length < 3) return 0;
      return Math.max(...parts) - Math.min(...parts);
    };

    // The letters themselves. White type throwing coloured light reads as lit;
    // tinted type reads as cheap, and would be a second colour language.
    const letters = await page.evaluate(
      () => getComputedStyle(document.querySelector('.title__letters') as Element).color
    );
    expect(chromaOf(letters)).toBeLessThan(12);

    /*
     * And now the part the rule is actually for.
     *
     * Every one of these sits over a live board. Forty is the same bar the room
     * is held to: a cube at full chroma spans about 170 between its channels,
     * while the neutral ink ramp's cool cast is 34, so a tighter threshold would
     * be measuring the neutral's temperature rather than testing the rule.
     */
    await page.evaluate(() => window.__refraction?.play('ascent'));
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');
    const overTheBoard = await page.evaluate(() => {
      const read = (selector: string): string[] => {
        const node = document.querySelector(selector);
        if (!node) return [];
        const style = getComputedStyle(node);
        return [style.color, style.backgroundColor, style.borderColor, style.boxShadow];
      };
      return [...read('.hud__panel'), ...read('.meter__pip'), ...read('.hud__label')];
    });
    for (const colour of overTheBoard) {
      for (const match of colour.matchAll(/rgba?\([^)]+\)/g)) {
        expect(chromaOf(match[0])).toBeLessThan(40);
      }
    }
  });

  test('sets the wordmark in the face it was drawn for, at the weight that face has', async ({
    page,
  }) => {
    /*
     * The mark has been wrong twice, in two different ways, and neither showed up
     * as a broken build.
     *
     * First it was set in Oxanium 600 when the artwork is far heavier, which read
     * as an entirely different typeface — a geometric face carries most of its
     * identity in stem weight, so the wrong weight is indistinguishable from the
     * wrong family by eye. Then it was Oxanium 800, closer and still wrong,
     * because the artwork's letters were drawn rather than typed: A, C, E, F, I,
     * N, R and T are traced glyphs, which is every letter of REFRACTION except
     * the O the cube covers.
     *
     * Both failures rendered perfectly. Nothing threw, no request 404'd, and the
     * only symptom was a person looking at it and saying that is not the font. So
     * the assertion has to be that the *built face is the one actually drawing*,
     * which is what document.fonts.check answers and what a font-family
     * declaration on its own does not — a declaration naming a face that failed to
     * load falls silently through to the next name in the stack.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    const mark = await page.evaluate(async () => {
      await document.fonts.ready;
      const word = document.querySelector('.panel--boot .title__word') as HTMLElement;
      const style = getComputedStyle(word);
      return {
        family: style.fontFamily,
        weight: style.fontWeight,
        loaded: document.fonts.check(`${style.fontWeight} ${style.fontSize} "Refraction Display"`),
      };
    });

    expect(mark.family).toContain('Refraction Display');
    expect(mark.loaded).toBe(true);

    /*
     * 700 exactly, and this half is not pedantry about a number.
     *
     * Refraction Display is a single static Bold. Ask it for 800 and the browser
     * does not fail — it synthesises one, smearing glyphs that were traced by hand
     * to a specific weight. That renders, ships, and looks subtly wrong forever.
     */
    expect(mark.weight).toBe('700');
  });

  test('scales and centres the voxel against the cap line it stands on', async ({ page }) => {
    /*
     * The cube's size is a ratio to the letters' cap height, and the letters can
     * change underneath it — which is not hypothetical. It was sized 0.74em to
     * Oxanium's caps, the mark moved to a face whose caps are 0.69em, and nothing
     * failed: the cube simply became the wrong size, in a way that reads as "the
     * O looks off" rather than as a broken build.
     *
     * The numbers come from the source artwork: the voxel there is 1.12 times cap
     * height and sits centred on the cap line, breaking it top and bottom. That
     * overshoot is deliberate — a corner-on cube is pointed at both ends, and
     * cropping it to the caps would flatten the two vertices carrying the
     * projection.
     *
     * Cap height is measured off a canvas rather than read from a rectangle,
     * because an element's box is line-height and glyph metrics, not ink.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

    const fit = await page.evaluate(async () => {
      await document.fonts.ready;
      const word = document.querySelector('.panel--boot .title__word') as HTMLElement;
      const cube = word.querySelector('.title__cube') as HTMLElement;
      const style = getComputedStyle(word);
      const size = parseFloat(style.fontSize);

      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.fillStyle = '#fff';
      ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('N', 40, 300);
      const data = ctx.getImageData(0, 0, 400, 400).data;
      let top = Infinity;
      let bottom = -1;
      for (let y = 0; y < 400; y += 1) {
        for (let x = 0; x < 400; x += 1) {
          if ((data[(y * 400 + x) * 4 + 3] ?? 0) > 128) {
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
      const capHeight = bottom - top + 1;
      const capAboveBaseline = 300 - top;

      /*
       * Put the cap line on the screen.
       *
       * An element's box is line-height and font metrics, never ink, so the
       * letters' rectangle cannot answer this directly — its centre sits below
       * the cap centre by half a descender. The baseline is recovered from the
       * half-leading instead: with a known line box and the face's own ascent and
       * descent, everything else follows.
       */
      const letters = word.querySelector('.title__letters') as HTMLElement;
      const lettersBox = letters.getBoundingClientRect();
      const metrics = ctx.measureText('N');
      const ascent = metrics.fontBoundingBoxAscent;
      const descent = metrics.fontBoundingBoxDescent;
      const halfLeading = (lettersBox.height - (ascent + descent)) / 2;
      const baseline = lettersBox.top + halfLeading + ascent;
      const capCentre = baseline - capAboveBaseline / 2;

      const cubeBox = cube.getBoundingClientRect();
      return {
        capHeight,
        cubeToCap: cubeBox.height / capHeight,
        square: cubeBox.width / cubeBox.height,
        centreOffset: (cubeBox.top + cubeBox.height / 2 - capCentre) / capHeight,
      };
    });

    expect(fit.capHeight).toBeGreaterThan(20);
    // 1.12 from the artwork; a tolerance wide enough for rasterisation, far too
    // narrow for the cube to be sized to some other face's caps.
    expect(fit.cubeToCap).toBeGreaterThan(1.05);
    expect(fit.cubeToCap).toBeLessThan(1.2);
    // A voxel is a cube: the box it is drawn in has to stay square.
    expect(fit.square).toBeCloseTo(1, 2);
    expect(Math.abs(fit.centreOffset)).toBeLessThan(0.06);
  });

  test('hides the HUD, which belongs to a run', async ({ page }) => {
    /*
     * A score of zero, an empty NEXT and a Shift meter for a run nobody has
     * started are furniture from a different screen.
     *
     * Read off the computed opacity rather than sampled from the meter's
     * rectangle. The pixel version compared that rectangle on the title against
     * in play, which worked while the room behind it was almost black — and the
     * front door now glows, so the "hidden" reading rose to meet the visible one.
     * The hiding is a single declaration and this is exactly what it claims,
     * which also catches the failure it has actually had: `.hud--hidden` once
     * landed nested inside another rule, became a descendant selector matching
     * nothing, and the HUD simply stayed on screen.
     */
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    const opacity = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.querySelector('.hud') as Element).opacity);

    expect(Number(await opacity())).toBe(0);
    await enter(page);
    expect(Number(await opacity())).toBe(0);

    await page.evaluate(() => window.__refraction?.play('flatland'));
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');
    // setHidden runs on the next animation frame, after screen flips.
    await expect.poll(async () => Number(await opacity())).toBe(1);
  });
  test('a run starts on the face the engine is playing', async ({ page }) => {
    // The bug the attract turn introduced, and the reason a title that moves the
    // camera is not free. The renderer's yaw is its own state: after a few
    // attract turns it is at 90, 180 or 270 while a new game is always on the
    // front face, so the board would come up wearing the palette of a face
    // nobody is playing and every control would point the wrong way.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);

    /*
     * The camera is driven off front directly, because the attract turn that
     * used to do it is gone.
     *
     * The invariant it guarded has not gone anywhere: the renderer's yaw is its
     * own state and outlives any one run, so a player who turns the board, quits
     * to the menu and starts again would otherwise come up on a board wearing
     * the palette of a face nobody is playing, with every control pointing the
     * wrong way. Turning the renderer by hand reaches that state in one step
     * instead of waiting on a title animation that no longer exists.
     */
    await page.evaluate(() => window.__refraction?.renderer.startTurn('right'));
    await expect
      .poll(() => page.evaluate(() => window.__refraction?.renderer.isTurning), { timeout: 12_000 })
      .toBe(false);
    const turned = await page.evaluate(() => window.__refraction?.renderer.yaw ?? 0);
    expect(Math.abs(turned % 360)).toBeGreaterThan(1);

    await page.getByRole('button', { name: 'PLAY' }).click();
    await page.getByRole('button', { name: 'FLATLAND' }).click();
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');

    const { yaw, face } = await page.evaluate(() => ({
      yaw: window.__refraction?.renderer.yaw ?? -1,
      face: window.__refraction?.game.face,
    }));
    expect(face).toBe('front');
    expect(yaw).toBe(0);
  });
});

/**
 * The phone.
 *
 * Measured on a real device profile rather than on a narrowed desktop window,
 * because the two differ in the way that matters: a narrow window on a laptop
 * still reports a fine pointer and a hover, and still has a keyboard. The
 * layout branches on `(hover: none) and (pointer: coarse)` for exactly that
 * reason, so a width-only emulation would test the wrong branch.
 */
test.describe('on a phone', () => {
  /*
   * The device profile is applied per context rather than through `test.use`,
   * which cannot set one inside a describe -- it carries `defaultBrowserType`
   * and that would force a new worker.
   */
  const PHONE = (() => {
    const { defaultBrowserType: _ignored, ...rest } = devices['Pixel 7'];
    return rest;
  })();

  /*
   * Contexts made from `browser` are not closed for us the way the `page`
   * fixture is, and each one holds a page rendering WebGL every frame. Left to
   * accumulate they saturate the machine: the seventh test in this block started
   * timing out at 35 seconds and passed in four on its own.
   */
  const open: BrowserContext[] = [];
  test.afterEach(async () => {
    await Promise.all(open.splice(0).map((context) => context.close()));
  });

  async function phone(
    browser: Browser,
    viewport?: { width: number; height: number }
  ): Promise<Page> {
    const context = await browser.newContext({ ...PHONE, ...(viewport ? { viewport } : {}) });
    open.push(context);
    return context.newPage();
  }

  /** Where the movement strip begins, by the same rule the app uses. */
  const stripTop = (page: Page): Promise<number> => page.evaluate(() => window.innerHeight - 84);

  async function play(page: Page, mode: string): Promise<void> {
    await page.goto('/?debug=1&seed=phone');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate((id) => window.__refraction?.play(id as never, 'phone'), mode);
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');
    await page.waitForTimeout(300);
  }

  test('is what the layout thinks it is', async ({ browser }) => {
    const page = await phone(browser);
    // The premise every other test here rests on. If the profile stopped
    // reporting a coarse pointer, the rest would pass by testing the desktop
    // layout and nobody would notice.
    await play(page, 'flatland');
    const coarse = await page.evaluate(
      () => window.matchMedia('(hover: none) and (pointer: coarse)').matches
    );
    expect(coarse).toBe(true);
  });

  test('never scrolls sideways', async ({ browser }) => {
    const page = await phone(browser);
    await play(page, 'ascent');
    for (const screen of ['playing', 'settings'] as const) {
      if (screen === 'settings') {
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'SETTINGS' }).click();
        await expect(page.locator('.panel[data-screen="settings"]')).toBeVisible();
      }
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBe(clientWidth);
    }
  });

  test('does not let a long press select text', async ({ browser }) => {
    const page = await phone(browser);
    // A long press is how a player holds a piece in place. It must not also
    // raise a selection and a context menu over the board.
    await play(page, 'flatland');
    const selectable = await page.evaluate(() => {
      const probes = ['.hud__stats', '.hud__label', '.stat__value', 'body'];
      return probes.filter((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const value = getComputedStyle(node).userSelect;
        return value !== 'none';
      });
    });
    expect(selectable).toEqual([]);
  });

  test('keeps the challenge code selectable, because it is meant to be copied', async ({
    browser,
  }) => {
    const page = await phone(browser);
    // The exception that stops the rule above from being a blanket. A code is
    // read aloud and retyped; a player who wants to copy theirs has to be able
    // to select it.
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await enter(page);
    await page.getByRole('button', { name: 'CHALLENGE' }).click();
    const value = await page.evaluate(
      () => getComputedStyle(document.querySelector('.code') as Element).userSelect
    );
    expect(value).toBe('text');
  });

  test('the Shift meter stays clear of the strip in a mode that has one', async ({ browser }) => {
    // The measurement that started this: on a Pixel 7 the meter ran 679 to 723
    // and the strip 669 to 753, so the thumb rested squarely on it.
    //
    // Both orientations, because portrait alone does not test anything hard --
    // there the meter lands a good thirty pixels clear whatever the layout does,
    // and the assertion passes even with the meter's own clamp removed. Landscape
    // is where the margin is thin enough for the reserve to be doing real work.
    for (const size of [
      { width: 412, height: 839 },
      { width: 863, height: 360 },
    ]) {
      const page = await phone(browser, size);
      await play(page, 'ascent');
      const bar = await page.locator('.hud__shift').boundingBox();
      if (!bar) throw new Error('no Shift meter');
      expect(bar.y + bar.height).toBeLessThanOrEqual(await stripTop(page));
    }
  });

  test('the Shift meter stays clear of the board, in both orientations', async ({ browser }) => {
    // Separate from the strip, and older than it. `HUD_RESERVE` is measured in
    // cells, and cells shrink with the window -- 1.6 of them is 27 pixels on a
    // phone in landscape against a 44-pixel meter, so the meter had always been
    // drawn over the bottom rows of the board there.
    for (const size of [
      { width: 412, height: 839 },
      { width: 863, height: 360 },
    ]) {
      const page = await phone(browser, size);
      await play(page, 'ascent');
      const bar = await page.locator('.hud__shift').boundingBox();
      const well = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
      if (!bar || !well) throw new Error('no geometry');
      expect(bar.y).toBeGreaterThanOrEqual(well.top + well.height);
    }
  });

  test('a roll-only mode spends no screen space on a strip', async ({ browser }) => {
    const page = await phone(browser);
    // Flatland permits roll alone, so there is nothing for the split to carry.
    // The board it gets back is the whole point: the strip is 84px out of an
    // eighteen-row well, paid for a verb the mode does not have.
    await play(page, 'flatland');
    const flat = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
    await play(page, 'ascent');
    const full = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
    if (!flat || !full) throw new Error('no geometry');

    expect(await page.evaluate(() => window.__refraction?.game.rollOnly)).toBe(false);
    // Portrait has room to spare, so neither is squeezed -- the reserve is a
    // floor, not an addition, and a window that already clears it is framed
    // exactly as it was. What must hold is that the roll-only mode is never the
    // smaller of the two.
    expect(flat.height).toBeGreaterThanOrEqual(full.height);
  });

  test('a tap low on the screen rolls in Flatland and does not in Ascent', async ({ browser }) => {
    const page = await phone(browser);
    // The behavioural half of dropping the split. With no strip there is nowhere
    // for a hand to rest that is not the playfield, so a tap anywhere is the
    // roll; with a strip, a tap there is a miss rather than a verb.
    const tapLow = async (): Promise<string> => {
      const y = (await stripTop(page)) + 40;
      const x = await page.evaluate(() => {
        const r = window.__refraction?.renderer.wellScreenRect();
        return (r?.left ?? 0) + (r?.width ?? 0) * 0.75;
      });
      const before = await page.evaluate(() =>
        JSON.stringify(window.__refraction?.game.active?.offsets)
      );
      await page.evaluate(
        ({ x, y }) => {
          const root = document.querySelector('#app');
          if (!root) throw new Error('no root');
          for (const type of ['pointerdown', 'pointerup']) {
            root.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                clientX: x,
                clientY: y,
                bubbles: true,
              })
            );
          }
        },
        { x, y }
      );
      const after = await page.evaluate(() =>
        JSON.stringify(window.__refraction?.game.active?.offsets)
      );
      return before === after ? 'unchanged' : 'rolled';
    };

    await play(page, 'flatland');
    expect(await tapLow()).toBe('rolled');

    await play(page, 'ascent');
    expect(await tapLow()).toBe('unchanged');
  });

  test('the sensitivity setting reaches the controls, not just the panel', async ({ browser }) => {
    // A slider that persists a number and changes nothing is worse than no
    // slider. Same drag, two settings: at twice the sensitivity it has to move
    // the piece twice as far.
    const drag = async (sensitivity: number): Promise<number> => {
      const page = await phone(browser);
      await page.goto('/');
      await page.evaluate(
        (value) =>
          localStorage.setItem(
            'refraction.save.v1',
            JSON.stringify({ stats: {}, records: {}, settings: { touchSensitivity: value } })
          ),
        sensitivity
      );
      await play(page, 'ascent');

      // Pinned to the middle, so neither setting can reach a wall -- the first
      // version dragged half the well and clamped at both sensitivities, which
      // made the two indistinguishable and the test useless.
      await page.evaluate(() => {
        const game = window.__refraction?.game;
        if (!game?.active) throw new Error('no piece');
        game.active = { ...game.active, u: 3 };
      });
      const well = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
      if (!well) throw new Error('no well');
      const y = (await stripTop(page)) + 40;
      const from = well.left + well.width * 0.2;
      const before = await page.evaluate(() => window.__refraction?.game.active?.u ?? -1);

      await page.evaluate(
        ({ from, y, distance }) => {
          const root = document.querySelector('#app');
          if (!root) throw new Error('no root');
          const send = (type: string, x: number): void => {
            root.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 1,
                pointerType: 'touch',
                isPrimary: true,
                clientX: x,
                clientY: y,
                bubbles: true,
              })
            );
          };
          send('pointerdown', from);
          // In steps, so every column threshold is crossed rather than jumped.
          for (let i = 1; i <= 10; i += 1) send('pointermove', from + (distance * i) / 10);
          send('pointerup', from + distance);
        },
        // A little over one column's travel at the default. One column at
        // normal sensitivity, two at double, and three clear of the right wall
        // either way.
        { from, y, distance: (well.width / 8) * 1.2 }
      );

      const after = await page.evaluate(() => window.__refraction?.game.active?.u ?? -1);
      return after - before;
    };

    const normal = await drag(1);
    const sensitive = await drag(2);
    expect(normal).toBeGreaterThan(0);
    expect(sensitive).toBeGreaterThan(normal);
  });

  test('the score panel does not lie across the board', async ({ browser }) => {
    const page = await phone(browser);
    // It did: `min-width: 8.5rem` on the stats is 136px before padding, in a
    // margin of about 80px, so the panel covered the top-left of the well and
    // the first rows of the stack with it.
    await play(page, 'flatland');
    const stats = await page.locator('.hud__stats').boundingBox();
    const well = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
    if (!stats || !well) throw new Error('no geometry');
    expect(stats.x + stats.width).toBeLessThanOrEqual(well.left);
  });

  test('slides out an X trigger above pause when Spectral Collapse is ready', async ({
    browser,
  }) => {
    const page = await phone(browser);
    await play(page, 'ascent');

    const trigger = page.getByRole('button', { name: 'Spectral Collapse' });
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pause).toBeVisible();
    // Present but parked off-screen until the bar is full.
    await expect(trigger).toBeAttached();
    expect(await trigger.evaluate((el) => el.classList.contains('hud__collapse--ready'))).toBe(
      false
    );

    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game) game.heat = 1;
    });
    await page.waitForTimeout(200);
    await expect(trigger).toHaveClass(/hud__collapse--ready/);

    const triggerBox = await trigger.boundingBox();
    const pauseBox = await pause.boundingBox();
    if (!triggerBox || !pauseBox) throw new Error('no geometry');
    // Above pause, same right edge family.
    expect(triggerBox.y + triggerBox.height).toBeLessThanOrEqual(pauseBox.y + 2);
    expect(Math.abs(triggerBox.x - pauseBox.x)).toBeLessThan(8);

    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('no hook');
      game.active = null;
      game.board.fill({ x: 2, y: 9, z: 3 });
    });
    await trigger.click();
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => window.__refraction?.game.board.isFilled({ x: 2, y: 9, z: 3 }))
    ).toBe(false);
    // Spent — the button slides away with the charge.
    expect(await trigger.evaluate((el) => el.classList.contains('hud__collapse--ready'))).toBe(
      false
    );
  });
});

/**
 * Spectral Collapse.
 *
 * A hot bar bought with cleared lines, spent on one board-wide compaction. The
 * engine's half is unit-tested without a browser; what needs a canvas is the
 * gauge — that it shows in the modes that have it (including Flatland), that it
 * never steals pointer events from the play column, that it reads the level, and
 * above all that it carries no hue.
 */
test.describe('Spectral Collapse', () => {
  async function play(page: Page, mode: string): Promise<void> {
    await page.goto('/?debug=1&seed=collapse');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate((id) => window.__refraction?.play(id as never, 'collapse'), mode);
    await expect.poll(() => page.evaluate(() => window.__refraction?.screen())).toBe('playing');
    await page.waitForTimeout(250);
  }

  const setHeat = (page: Page, heat: number): Promise<void> =>
    page.evaluate((value) => {
      const game = window.__refraction?.game;
      if (game) game.heat = value;
    }, heat);

  test('the gauge is there in Ascent and in Flatland', async ({ page }) => {
    await play(page, 'ascent');
    await setHeat(page, 0.5);
    await page.waitForTimeout(150);
    await expect(page.locator('.gauge')).toBeVisible();

    await play(page, 'flatland');
    await setHeat(page, 0.5);
    await page.waitForTimeout(150);
    await expect(page.locator('.gauge')).toBeVisible();
  });

  test('stands against the well rather than over the board', async ({ page }) => {
    // The board is the one thing nothing may cover.
    await play(page, 'ascent');
    await setHeat(page, 0.5);
    await page.waitForTimeout(150);

    const gauge = await page.locator('.gauge').boundingBox();
    const well = await page.evaluate(() => window.__refraction?.renderer.wellScreenRect());
    if (!gauge || !well) throw new Error('no geometry');
    expect(gauge.x).toBeGreaterThanOrEqual(well.left + well.width);
    // And it spans the board's height, so the level reads against the stack.
    expect(Math.abs(gauge.height - well.height)).toBeLessThan(4);
  });

  test('reads the level', async ({ page }) => {
    await play(page, 'ascent');
    const fillAt = async (heat: number): Promise<number> => {
      await setHeat(page, heat);
      await page.waitForTimeout(300);
      const box = await page.locator('.gauge__fill').boundingBox();
      return box?.height ?? -1;
    };
    const low = await fillAt(0.2);
    const high = await fillAt(0.9);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low * 2);
  });

  test('carries no hue, at any level', async ({ page }) => {
    // §2.2 partitions the palette absolutely: the only hue on screen belongs to
    // a cube. A heat gauge conventionally runs blue to red, and here red means
    // *near* — a bar that reddened as it filled would teach that colour means
    // intensity, which is the exact false inference the rule exists to prevent.
    await play(page, 'ascent');
    for (const heat of [0.15, 0.6, 1]) {
      await setHeat(page, heat);
      await page.waitForTimeout(300);
      const box = await page.locator('.gauge').boundingBox();
      if (!box) throw new Error('no gauge');
      const shot = await page.screenshot({ clip: box });
      const chroma = await page.evaluate(
        async (bytes) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d context');
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          let worst = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i] as number;
            const g = data[i + 1] as number;
            const b = data[i + 2] as number;
            worst = Math.max(worst, Math.max(r, g, b) - Math.min(r, g, b));
          }
          return worst;
        },
        [...shot]
      );
      // Forty, the same bar the room and the masthead are held to. A cube at
      // full chroma spans about 170 between its channels.
      expect(chroma, `heat ${heat}`).toBeLessThan(40);
    }
  });

  test('the key collapses the stack when the bar is full, and not before', async ({ page }) => {
    await play(page, 'ascent');

    // A cell suspended high with nothing under it: only a collapse moves it.
    const suspend = (): Promise<void> =>
      page.evaluate(() => {
        const game = window.__refraction?.game;
        if (!game) throw new Error('no hook');
        game.active = null;
        game.board.fill({ x: 2, y: 9, z: 3 });
      });
    const suspended = (): Promise<boolean> =>
      page.evaluate(() => window.__refraction?.game.board.isFilled({ x: 2, y: 9, z: 3 }) ?? false);

    await suspend();
    await setHeat(page, 0.9);
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(200);
    expect(await suspended()).toBe(true);

    await setHeat(page, 1);
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(400);
    expect(await suspended()).toBe(false);
    expect(await page.evaluate(() => window.__refraction?.game.heat)).toBe(0);
  });

  test('the gauge never steals pointer events, even when ready', async ({ page }) => {
    // Touch spends through the X trigger. A live gauge over the well would steal
    // the play column from the piece.
    await play(page, 'ascent');
    for (const heat of [0.5, 1]) {
      await setHeat(page, heat);
      await page.waitForTimeout(150);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector('.gauge') as Element).pointerEvents
        ),
        `heat ${heat}`
      ).toBe('none');
    }
  });

  test('the controls panel lists it in Ascent and in Flatland', async ({ page }) => {
    for (const mode of ['ascent', 'flatland'] as const) {
      await play(page, mode);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'SETTINGS' }).click();
      await expect(
        page.locator('.keymap:not(.keymap--touch) .keymap__row[data-action="collapse"]')
      ).toBeVisible();
    }
  });

  test('announces readiness when the bar fills, with the spend hint beneath', async ({
    page,
  }) => {
    // setHeat bypasses the crossing event; a real clear is what earns the cue.
    await play(page, 'ascent');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('no hook');
      game.heat = 0.95;
      for (let x = 0; x < 8; x += 1) game.board.fill({ x, y: 0, z: 3 });
    });
    await page.keyboard.press('Space');
    await expect(page.locator('.banner__text')).toHaveText('SPECTRAL COLLAPSE IMMINENT', {
      timeout: 3000,
    });
    await expect(page.locator('.banner__hint')).toHaveText('PRESS V TO TRIGGER');
  });

  test('does not claim the collapse has happened when the charge is spent', async ({
    page,
  }) => {
    await play(page, 'ascent');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('no hook');
      game.heat = 1;
      game.active = null;
      game.board.fill({ x: 2, y: 9, z: 3 });
    });
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(120);
    // The spend is shake + bloom + sample — silent on the banner. `.banner__text`
    // is only mounted when a cue is shown, so absence is the pass; `not.toHaveText`
    // would hang waiting for a node that should never appear.
    await expect(page.locator('.banner__text')).toHaveCount(0);
    await expect(page.getByText('SPECTRAL COLLAPSE', { exact: true })).toHaveCount(0);
  });
});
