import { expect, test } from '@playwright/test';

test.describe('boot screen', () => {
  test('renders the title and tagline', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Refraction/);
    await expect(page.getByRole('heading', { name: 'REFRACTION' })).toBeVisible();
    await expect(page.getByText('Position is absolute. Colour is relative.')).toBeVisible();
  });

  test('renders one lane per depth lane, near red to far violet', async ({ page }) => {
    await page.goto('/');
    const lanes = page.locator('.boot__lane');
    await expect(lanes).toHaveCount(8);

    const nearest = await lanes.first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const farthest = await lanes.last().evaluate((el) => getComputedStyle(el).backgroundColor);

    const parse = (value: string): number[] => (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);

    const [nr, ng, nb] = parse(nearest) as [number, number, number];
    const [, fg, fb] = parse(farthest) as [number, number, number];

    // Nearest lane reads red; farthest reads violet.
    expect(nr).toBeGreaterThan(ng);
    expect(nr).toBeGreaterThan(nb);
    expect(fb).toBeGreaterThan(fg);
  });

  test('reports the milestone and board geometry', async ({ page }) => {
    await page.goto('/');
    const status = page.getByTestId('boot-status');
    await expect(status).toContainText('M0 - Foundation');
    await expect(status).toContainText('8 wide x 18 high x 8 deep');
    await expect(status).toContainText('front -> left -> back -> right -> front');
  });

  test('loads with no console errors and no page errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'REFRACTION' })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('lays out without horizontal overflow on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
