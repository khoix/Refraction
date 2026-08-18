import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LINES_PER_STAGE } from '../../src/core/stages';

/** Wait for the first rendered frame. */
async function boot(page: Page): Promise<void> {
  await page.goto('/?mode=ascent');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('canvas.stage')).toBeVisible();
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

test.describe('boot', () => {
  test('renders the playfield and the HUD', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.getByText('SCORE')).toBeVisible();
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
    await boot(page);
    await expect(page.locator('.slot__body .piece__cell--filled').first()).toBeVisible();
  });

  test('spaces the next-piece preview evenly in both axes', async ({ page }) => {
    await boot(page);
    const metrics = await page
      .locator('.slot')
      .first()
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

    const hint = page.locator('.panel--over .panel__hint');
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
    await expect(page.locator('.panel--title')).toBeVisible();
    await expect(page.locator('.title__word')).toHaveText('REFRACTION');
    // The room is alive behind the title from the first frame.
    await expect(page.locator('canvas.stage')).toBeVisible();
  });

  test('walks from title to a running game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.panel--modes')).toBeVisible();
    await page.locator('.mode[data-mode="ascent"]').click();
    await expect(page.locator('.screens')).toBeHidden();
    await expect(page.locator('.hud')).toBeVisible();
  });

  test('offers every mode, with the expert one locked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.mode')).toHaveCount(6);
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toBeDisabled();
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toContainText('Reach stage 5');
    await expect(page.locator('.mode[data-mode="ascent"]')).toBeEnabled();
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

test.describe('settings', () => {
  test('persists a change across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'SETTINGS' }).click();
    const bloom = page.locator('[data-field="bloom"] input');
    await expect(bloom).toBeChecked();
    await bloom.uncheck();

    await page.reload();
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
    await expect(page.locator('.session__row').first()).toContainText('Flatland');
  });

  test('recovers from a corrupt save rather than refusing to boot', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('refraction.save.v1', '{"records":{"asc'));
    await page.reload();

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
    await page.getByRole('button', { name: 'PLAY' }).click();
    await expect(page.locator('.mode[data-mode="blindSpectrum"]')).toBeEnabled();
  });

  test('a deep link cannot open a locked mode', async ({ page }) => {
    await page.goto('/?mode=blindSpectrum');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    // Held at the title rather than dropped into a mode not yet earned.
    await expect(page.locator('.panel--title')).toBeVisible();
  });
});

test.describe('challenges', () => {
  test('rejects a code that is not one, without starting a run', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'CHALLENGE' }).click();
    await page.locator('.code').fill('nonsense');
    await page.getByRole('button', { name: 'START' }).click();
    await expect(page.locator('.panel--challenge')).toBeVisible();
    await expect(page.locator('.panel--challenge .panel__hint')).toContainText('not a challenge');
  });

  test("starts today's challenge and names it on the game-over screen", async ({ page }) => {
    await page.goto('/?debug=1');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
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
   * Plant one cube per lane, each in its own column, so nothing occludes
   * anything and each band can be measured on its own.
   *
   * On the front face lane 0 is the *high* z, so a lane maps to `7 - lane`.
   * Getting that backwards silently inverts the whole measurement, which is
   * why the helper converts rather than the caller.
   */
  async function bandSamples(page: Page): Promise<{ band: string; mean: number; peak: number }[]> {
    await page.goto('/?debug=1&mode=ascent&seed=xray');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game || !game.active) throw new Error('debug hook unavailable');
      for (let lane = 0; lane < 8; lane += 1) {
        game.board.fill({ x: lane, y: 2, z: 7 - lane });
      }
      game.active = { ...game.active, lane: 3, u: 3, y: 13 };
    });
    await page.waitForTimeout(500);

    return page.evaluate(() => {
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

      const out: { band: string; mean: number; peak: number }[] = [];
      for (let lane = 0; lane < 8; lane += 1) {
        const column = lane; // the cube for this lane sits in column x = lane
        const left = rect.left - box.left + (rect.width * column) / 8;
        const width = rect.width / 8;
        const top = rect.top - box.top + rect.height * (1 - 3 / 18);
        const height = rect.height / 18;

        let sum = 0;
        let count = 0;
        let peak = 0;
        for (let y = top + height * 0.15; y < top + height * 0.85; y += 2) {
          for (let x = left + width * 0.15; x < left + width * 0.85; x += 2) {
            const i = (Math.round(y * scaleY) * scratch.width + Math.round(x * scaleX)) * 4;
            const l =
              0.2126 * (data[i] as number) +
              0.7152 * (data[i + 1] as number) +
              0.0722 * (data[i + 2] as number);
            sum += l;
            count += 1;
            peak = Math.max(peak, l);
          }
        }
        out.push({
          band: lane < 3 ? 'near' : lane > 3 ? 'far' : 'focal',
          mean: sum / Math.max(1, count),
          peak,
        });
      }
      return out;
    });
  }

  test('sees through the lanes in front and darkens the ones behind', async ({ page }) => {
    const samples = await bandSamples(page);
    const focal = samples.find((s) => s.band === 'focal')!;
    const near = samples.filter((s) => s.band === 'near');
    const far = samples.filter((s) => s.band === 'far');

    // The lane the piece will land in is the brightest surface on the board.
    for (const sample of [...near, ...far]) {
      expect(sample.mean).toBeLessThan(focal.mean);
    }

    // In front: mostly empty, so the board behind reads through — but each cube
    // keeps a bright outline, which is what makes it an x-ray rather than a
    // fade. Low mean with a high peak is precisely that signature.
    for (const sample of near) {
      expect(sample.mean).toBeLessThan(focal.mean * 0.6);
      expect(sample.peak).toBeGreaterThan(focal.mean);
      expect(sample.peak).toBeLessThanOrEqual(focal.peak);
    }

    // Behind: a dark mass with no structure. Dimmer than the x-ray on average,
    // and without its bright edges.
    for (const sample of far) {
      expect(sample.peak).toBeLessThan(focal.mean);
    }
    const nearMean = near.reduce((a, s) => a + s.mean, 0) / near.length;
    const farMean = far.reduce((a, s) => a + s.mean, 0) / far.length;
    expect(farMean).toBeLessThan(nearMean);
    // Dark, but not deleted: the band still carries its depth colour.
    expect(farMean).toBeGreaterThan(1);
  });

  test('leaves the board alone when nothing is falling', async ({ page }) => {
    // The bands are a property of the falling piece, not a distance cue: they
    // exist only while something is in play, and they move when it moves. So
    // the same cube has to come back to full strength once the piece is gone.
    const falling = await bandSamples(page);
    const behind = falling.filter((s) => s.band === 'far');

    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (game) game.status = 'gameOver';
    });
    await page.waitForTimeout(400);
    const settled = await page.evaluate(() => {
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

      const means: number[] = [];
      for (let lane = 4; lane < 8; lane += 1) {
        const left = rect.left - box.left + (rect.width * lane) / 8;
        const width = rect.width / 8;
        const top = rect.top - box.top + rect.height * (1 - 3 / 18);
        const height = rect.height / 18;
        let sum = 0;
        let count = 0;
        for (let y = top + height * 0.15; y < top + height * 0.85; y += 2) {
          for (let x = left + width * 0.15; x < left + width * 0.85; x += 2) {
            const i = (Math.round(y * scaleY) * scratch.width + Math.round(x * scaleX)) * 4;
            sum +=
              0.2126 * (data[i] as number) +
              0.7152 * (data[i + 1] as number) +
              0.0722 * (data[i + 2] as number);
            count += 1;
          }
        }
        means.push(sum / Math.max(1, count));
      }
      return means;
    });

    const dimmed = behind.reduce((a, s) => a + s.mean, 0) / behind.length;
    const full = settled.reduce((a, m) => a + m, 0) / settled.length;
    expect(full).toBeGreaterThan(dimmed * 2);
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
    // The NEXT preview is DOM, painted with depthColorHex directly, so it is
    // immune to anything the WebGL pipeline does. When the two disagree it is
    // always the board that is wrong, which is exactly how this was found.
    await page.goto('/?debug=1&mode=ascent&seed=fidelity');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');

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

            // The preview cells carry their colour as an inline style.
            const cell = document.querySelector('.piece__cell--filled') as HTMLElement | null;
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
