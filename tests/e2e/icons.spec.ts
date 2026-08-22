import { expect, test } from '@playwright/test';

test.describe('page icons', () => {
  test('serves the title voxel as the favicon and apple-touch-icon', async ({ page, request }) => {
    /*
     * A missing icon 404s the boot (that is how the first favicon was found)
     * and iOS never requests apple-touch-icon until someone saves to the home
     * screen, so the console-error test cannot see it. Fetch both, and check
     * the SVG is the wordmark cube rather than the old spectrum square.
     */
    await page.goto('/');
    // Vite rewrites the root-absolute hrefs to relative in the production build.
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /favicon\.svg$/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      /apple-touch-icon\.png$/
    );

    const favicon = await request.get('/favicon.svg');
    expect(favicon.ok()).toBe(true);
    const svg = await favicon.text();
    expect(svg).toContain('M50 3 L96.6 19.1 L50 35.2 L3.4 19.1 Z');
    expect(svg).toContain('#57daff');
    expect(svg).not.toContain('linearGradient');

    const touch = await request.get('/apple-touch-icon.png');
    expect(touch.ok()).toBe(true);
    expect(touch.headers()['content-type']).toMatch(/image\/png/);
  });
});
