import { test, expect } from '@playwright/test';
import { mockApi, signIn } from './fixtures.js';

/**
 * One screenshot per page, plus the states you cannot reach by URL.
 *
 * Run: `pnpm shots` — the PNGs land in visual/screens/ and are gitignored.
 *
 * Each page also gets two cheap assertions, so a run FAILS rather than
 * quietly writing a picture of a broken screen:
 *   • no uncaught page errors
 *   • the page painted something other than an empty shell
 * Everything beyond that is for your eyes: layout, contrast, spacing, whether
 * the beige is the beige you meant.
 */

const PAGES = [
  ['dashboard',   '/'],
  ['call-report', '/call-report'],
  ['emails',      '/emails'],
  ['ai-analysis', '/ai-analysis'],
  ['tickets',     '/tickets'],
  ['agents',      '/agents'],
  ['stations',    '/stations'],
  ['reports',     '/reports'],
];

/** Fail the run on a page that threw, naming the page rather than a stack. */
function watchForErrors(page, name) {
  const errors = [];
  page.on('pageerror', err => errors.push(`${name}: ${err.message}`));
  return errors;
}

/** The app mounts asynchronously; wait for real content, not just the HTML. */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  // The animations (bar grow, donut draw, shimmer) would otherwise be caught
  // mid-flight and make two runs of the same code look different.
  await page.waitForTimeout(900);
}

test.describe('every page', () => {
  for (const [name, path] of PAGES) {
    test(name, async ({ page, baseURL }) => {
      const errors = watchForErrors(page, name);
      await mockApi(page);
      await signIn(page, baseURL);

      await page.goto(path);
      await settle(page);

      await page.screenshot({ path: `visual/screens/${name}.png`, fullPage: true });

      expect(errors, `${name} threw`).toEqual([]);
      // A shell with a sidebar and nothing else means the page failed to render
      // its own content — worth failing on, because the screenshot would look
      // plausible at a glance.
      expect(await page.locator('main, [role="main"], table, h1').count()).toBeGreaterThan(0);
    });
  }
});

test.describe('the states a URL cannot reach', () => {
  test('login', async ({ page }) => {
    const errors = watchForErrors(page, 'login');
    await mockApi(page);
    // No session seeded: this is the signed-out door.
    await page.goto('/');
    await settle(page);

    await expect(page.getByText('Sign in to your account')).toBeVisible();
    await page.screenshot({ path: 'visual/screens/login.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('email chat', async ({ page, baseURL }) => {
    const errors = watchForErrors(page, 'email-chat');
    await mockApi(page);
    await signIn(page, baseURL);

    await page.goto('/emails');
    await settle(page);
    // Open the first correspondent — the chat is a modal, so it has no URL.
    await page.locator('table tbody tr').first().click();
    await expect(page.getByLabel('Reply')).toBeVisible();
    await page.waitForTimeout(400);

    await page.screenshot({ path: 'visual/screens/email-chat.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  /* The portal is light-only, but every component still carries `dark:`
     variants and StatusTabs reads the class directly. A class left behind by
     the retired theme switcher — a tab that hot-reloaded rather than reloaded —
     put the filter row into a half-inverted state: a charcoal pill, and
     dropdown placeholders the same colour as the surface they sit on. */
  test('a stale dark class cannot half-invert the page', async ({ page, baseURL }) => {
    await mockApi(page);
    await signIn(page, baseURL);
    await page.addInitScript(() => document.documentElement.classList.add('dark'));

    await page.goto('/emails');
    await settle(page);

    await expect(page.locator('html')).not.toHaveClass(/dark/);

    /* Anchored on the filter row's own tabs rather than on a dropdown label:
       the dropdowns collapse behind an overflow menu at some widths, and a
       regression test that depends on which controls happen to be inline is a
       test that breaks for reasons unrelated to what it guards.

       Under the stale class these went two ways at once — the selected pill
       took the dark half of its colour pair, and anything styled
       `dark:text-white` resolved to the beige SURFACE, so the text vanished
       into its own background. */
    const tab = page.getByRole('button', { name: 'Unread', exact: true });
    await expect(tab).toBeVisible();
    const colour = await tab.evaluate(el => getComputedStyle(el).color);
    expect(colour).not.toBe('rgb(251, 246, 236)');   // the beige surface

    const pill = page.getByRole('button', { name: 'All', exact: true }).first();
    const pillBg = await pill.evaluate(el => getComputedStyle(el.parentElement).backgroundColor);
    expect(pillBg).not.toBe('rgb(63, 63, 70)');      // the charcoal slider

    await page.screenshot({ path: 'visual/screens/emails-stale-dark.png', fullPage: true });
  });

  /* Both steps of the compact filter menu. Neither has a URL, and the whole
     point of the control is what it looks like open — a bar that photographs
     well shut and badly open has not saved anything. */
  test('the filter menu, both steps', async ({ page, baseURL }) => {
    const errors = watchForErrors(page, 'email-filters');
    await mockApi(page);
    await signIn(page, baseURL);

    await page.goto('/emails');
    await settle(page);

    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByRole('menuitem', { name: /^Reply State/ })).toBeVisible();
    await page.screenshot({ path: 'visual/screens/emails-filters-step1.png' });

    await page.getByRole('menuitem', { name: /^Analysis/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Analysing' })).toBeVisible();
    await page.screenshot({ path: 'visual/screens/emails-filters-step2.png' });

    // And the chip it leaves behind, which is what keeps a folded filter honest.
    await page.getByRole('menuitem', { name: 'Failed' }).click();
    await expect(page.getByRole('button', { name: 'Failed' })).toBeVisible();
    await page.screenshot({ path: 'visual/screens/emails-filters-chip.png' });

    expect(errors).toEqual([]);
  });

  test('mobile emails', async ({ page, baseURL }) => {
    // The card layout below `lg` is a different set of markup, and nothing else
    // in this suite would ever photograph it.
    await page.setViewportSize({ width: 420, height: 900 });
    await mockApi(page);
    await signIn(page, baseURL);

    await page.goto('/emails');
    await settle(page);
    await page.screenshot({ path: 'visual/screens/emails-mobile.png', fullPage: true });
  });
});
