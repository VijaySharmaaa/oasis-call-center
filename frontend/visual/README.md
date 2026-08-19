# Screenshots

```bash
pnpm shots          # capture every page → visual/screens/*.png
pnpm shots -- --grep emails    # just the ones you are working on
pnpm shots:ui       # Playwright's UI mode, for stepping through a run
```

The PNGs are gitignored. They are regenerated, not reviewed as text.

## Its companion check

```bash
pnpm check:contrast
```

`scripts/check-contrast.mjs` reads the palette straight out of `src/index.css`
and re-measures every pair the app renders — chip ink on its own tint, figures
on the two beiges, cream on the accent button, and the pie wedges against each
other in CIE Lab. Pastel and unreadable are one slider apart, so the softness is
bounded by a number rather than by taste. It exits non-zero on a failure.

Run it after touching any colour; run the screenshots after that to see what the
numbers cannot tell you.

## What this is for

`pnpm test` (vitest + jsdom) proves behaviour. It cannot prove **legibility** —
jsdom has no layout engine and no CSS, so text the same colour as its
background, a collapsed grid, or a table clipped out of frame all pass there in
silence. These screenshots are the check for that, and they are meant to be
looked at rather than asserted on.

The suite still fails on its own if a page throws or renders an empty shell, so
a broken screen is caught rather than quietly photographed.

## No backend required

Two things make that work, both in `fixtures.js`:

- **auth** — `AuthContext` restores a session from `localStorage` and only
  *decodes* the JWT to read `exp`; verifying the signature is the server's job.
  An unsigned token with a future expiry is therefore enough to render the
  portal as a logged-in admin.
- **api** — every `/api/**` request is fulfilled from a table of fixtures.
  Anything unlisted returns `{}` rather than failing, so a page that grows a new
  endpoint degrades to one empty panel instead of a blank screen.

This is deliberate: pointed at the real database, the pages would change with
whatever mail arrived overnight and any comparison between two runs would drown
in that noise. With fixtures, a difference between runs is a difference in the
**code**.

Fixture routes are matched by substring, **first match wins** — put specific
paths above general ones. A `/read` PATCH sitting below
`/api/emails/conversations/aasha` gets answered with the whole conversation,
which is how a screenshot ends up showing a chat that still claims to be unread.

## Adding a page

Add it to `PAGES` in `screens.spec.js` if it has a URL. States that have no URL
— modals, the mobile layout, the signed-out door — get their own test in *the
states a URL cannot reach*, which is where the email chat and the 420px card
layout are captured.

## Notes

- The dev server is started by Playwright itself on port **5198**, with
  `reuseExistingServer`, so it never fights a `pnpm dev` you already have up.
  `--host 127.0.0.1` is pinned because Vite's default `localhost` binds `::1` on
  Windows while Playwright polls IPv4, and the mismatch shows up only as an
  unexplained 60-second timeout.
- Each shot waits ~900ms after `networkidle`: the bar-grow, donut-draw and
  export-shimmer animations would otherwise be caught mid-flight and make two
  runs of identical code look different.
- The viewport is set **after** the `devices['Desktop Chrome']` spread. A
  project's `use` beats the top-level one, and the preset's own 1280×720 will
  silently replace anything set above it — which clips the wider tables.
