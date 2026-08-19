import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright is here to LOOK at the portal, not to test behaviour.
 *
 * Behaviour is covered by vitest against jsdom, which is faster and does not
 * need a browser. What jsdom cannot do is tell you whether a page is legible —
 * it has no layout engine and no CSS, so a theme change, a broken grid or text
 * the same colour as its background all pass there in silence. That is the gap
 * these screenshots fill.
 *
 * The suite starts its own dev server on a port of its own, so it never fights
 * a server you already have running.
 */
export default defineConfig({
  testDir: './visual',
  outputDir: './visual/.artifacts',
  // Screens are captured in one pass and compared by eye; parallel workers
  // would interleave the console output that says which page failed.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:5198',
    // A desktop shape: the portal's table layouts only appear above `lg`, and
    // shooting at a phone width would silently screenshot the mobile cards.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    screenshot: 'off',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // AFTER the spread, deliberately. A project's `use` beats the top-level
        // one, and Desktop Chrome carries its own 1280x720 — which quietly
        // replaced the size set above and clipped the wider tables out of frame.
        viewport: { width: 1440, height: 900 },
        // Bundled Chromium rather than the installed Chrome, so a run does not
        // depend on what happens to be on the machine.
        channel: undefined,
      },
    },
  ],

  webServer: {
    // --host pinned to IPv4: Vite's default `localhost` binds ::1 on Windows,
    // and Playwright polls 127.0.0.1, so the readiness check never succeeds and
    // the run dies on a webServer timeout that says nothing about why.
    command: 'npx vite --port 5198 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
