import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Some CI images ship a pre-provisioned Chromium instead of Playwright's own
// download. Point at it when present so `playwright install` is never required.
const PREINSTALLED_CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Rendering is GPU/driver sensitive; allow a small perceptual delta.
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    // Must match the --host the preview script binds to. Leaving vite on its
    // default `localhost` while polling 127.0.0.1 works on some machines and
    // silently times out on others, depending on how localhost resolves.
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Piped, not ignored: a server that never comes up is otherwise a blank
    // three-minute wait with nothing to diagnose.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
