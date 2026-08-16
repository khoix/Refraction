import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LINES_PER_STAGE } from '../../src/core/stages';

/** Wait for the first rendered frame. */
async function boot(page: Page): Promise<void> {
  await page.goto('/');
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

test.describe('boot', () => {
  test('renders the playfield and the HUD', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.hud')).toBeVisible();
    await expect(page.getByText('SCORE')).toBeVisible();
    await expect(page.getByText('LINES')).toBeVisible();
    await expect(page.getByText('STAGE')).toBeVisible();
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

  test('shows the next piece', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.slot__body .piece__cell--filled').first()).toBeVisible();
  });

  test('spaces the next-piece preview evenly in both axes', async ({ page }) => {
    await boot(page);
    const metrics = await page.locator('.slot').first().locator('.piece').evaluate((grid) => {
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
    await page.goto('/?debug=1&seed=render');
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
    // visible tops and sides yield many more.
    await page.goto('/?debug=1&seed=flatness');
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
    const flat = await distinctCanvasColours(page);

    await page.keyboard.press('ArrowRight');
    // Sample at the actual dimensional peak rather than after a magic sleep:
    // under parallel load 370ms is not reliably the midpoint of a 750ms turn.
    await page.waitForFunction(() => {
      const renderer = window.__refraction?.renderer;
      return Boolean(renderer?.isTurning && renderer.flatness < 0.25);
    });
    const midTurn = await distinctCanvasColours(page);

    await page.waitForFunction(() => window.__refraction?.renderer?.isTurning === false);
    await page.waitForTimeout(150);
    const settled = await distinctCanvasColours(page);

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
    await page.goto('/?debug=1&seed=restart');
    await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => {
      const game = window.__refraction?.game;
      if (!game) throw new Error('debug hook unavailable');
      game.status = 'gameOver';
    });

    const hint = page.locator('.overlay__hint');
    await expect(hint).toBeVisible();
    // Parse the key out of the hint itself, so the copy and the binding can
    // never advertise different keys again.
    const advertised = /press (\w+)/i.exec((await hint.textContent()) ?? '')?.[1];
    expect(advertised).toBeTruthy();

    await page.keyboard.press(advertised as string);
    await expect(page.locator('.overlay__hint')).toBeHidden();
    await expect(page.locator('.stat__value').first()).toHaveText('0');
  });
});

test.describe('the turn', () => {
  /** Reach a filled Shift meter directly via the debug hook. */
  async function armTheTurn(page: Page): Promise<void> {
    await page.goto('/?debug=1&seed=e2e');
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
    await page.goto('/?debug=1&seed=reveal&turnMs=3000');
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
    await page.goto('/?debug=1&seed=popup');
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
    await page.goto(`/?debug=1&seed=calm${query}`);
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
    await page.goto('/?debug=1&seed=arc');
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
    await page.goto('/?debug=1&seed=colour');
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
    await page.goto('/?debug=1&seed=endless');
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
    await page.goto('/?debug=1&seed=exp&pieces=experimental');
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
