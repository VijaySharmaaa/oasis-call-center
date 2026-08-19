/**
 * Does the pastel palette stay readable?
 *
 *   node scripts/check-contrast.mjs
 *
 * Pastel is a look. Unreadable is a bug, and the two are a slider apart — every
 * step that makes a chip softer also drags its text toward the background it
 * sits on. This reads the tokens straight out of src/index.css (so the
 * stylesheet stays the single source of truth, and a value edited there cannot
 * drift from what is checked) and re-measures the pairs this app actually
 * renders.
 *
 * WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text and for the boundary of
 * a UI component. Chips carry small text, so they are held to 4.5.
 *
 * Exits non-zero on a failure, so it can gate a commit if you ever want it to.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/index.css'), 'utf8');

/**
 * Every `--color-x-y: #hex` in the @theme block — and ONLY that block.
 *
 * Later in the same file `.report-sheet` redefines the same token names back to
 * the print palette, on purpose. Parsing the whole stylesheet let those win by
 * being last, and the neutral checks silently measured white paper instead of
 * the portal's beige.
 */
const THEME_START = css.indexOf('@theme');
const THEME = css.slice(THEME_START, css.indexOf('\n}', THEME_START));
const TOKENS = Object.fromEntries(
  [...THEME.matchAll(/--color-([a-z]+-?\d*):\s*(#[0-9a-fA-F]{3,8})/g)].map(m => [m[1], m[2]])
);

const SURFACE = {
  page: '#f5eee1',      // html/body
  card: TOKENS['white'] ?? '#fbf6ec',
  subtle: TOKENS['slate-100'],
};

function srgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
}

/** Relative luminance, WCAG 2.1 §relative-luminance. */
function luminance(hex) {
  const [r, g, b] = srgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** The hues rebuilt as pastels. The neutrals are checked separately below. */
const HUES = ['indigo', 'red', 'amber', 'emerald', 'teal', 'sky', 'blue', 'violet', 'orange', 'rose'];

const checks = [];
const add = (label, fg, bg, min) => checks.push({ label, fg, bg, min, got: ratio(fg, bg) });

for (const hue of HUES) {
  const t = shade => TOKENS[`${hue}-${shade}`];
  if (!t(50)) continue;

  // The chip pattern used all over the app: `bg-<hue>-50 text-<hue>-700`.
  add(`${hue}: ink 700 on its own 50 tint`, t(700), t(50), 4.5);
  add(`${hue}: ink 700 on its own 100 tint`, t(700), t(100), 4.5);
  // Selected states are a tint with 800 ink rather than a solid fill.
  add(`${hue}: ink 800 on its own 100 tint`, t(800), t(100), 4.5);
  // Figures and labels printed straight onto the page, e.g. a stat value.
  add(`${hue}: 600 on the card`, t(600), SURFACE.card, 4.5);
  add(`${hue}: 600 on the page`, t(600), SURFACE.page, 4.5);
  // A filled dot or bar has to be visible against the surface behind it, but
  // carries no text — the 3:1 component rule, not the 4.5 text one.
  add(`${hue}: 400 fill against the card`, t(400), SURFACE.card, 3);
}

// Solid buttons: cream on the accent, which is the one place the palette puts
// light text on colour.
add('accent: cream text on the 600 button', SURFACE.card, TOKENS['indigo-600'], 4.5);
add('accent: cream text on the 700 hover', SURFACE.card, TOKENS['indigo-700'], 4.5);

// The neutral ladder, which carries almost all of the reading in the portal.
add('body text on the card', TOKENS['slate-700'], SURFACE.card, 4.5);
add('headings on the card', TOKENS['slate-900'], SURFACE.card, 4.5);
add('secondary text on the card', TOKENS['slate-600'], SURFACE.card, 4.5);
add('muted text on the card', TOKENS['slate-500'], SURFACE.card, 4.5);
add('placeholder/icon on the card', TOKENS['slate-400'], SURFACE.card, 3);
add('border against the card', TOKENS['slate-300'], SURFACE.card, 1.4);

/* ── The pie palette ──────────────────────────────────────────────────────
   Colour is the encoding on a pie, so softening it is only safe while the
   wedges stay apart. Measured in CIE Lab: ΔE below ~10 is "the same colour to
   most people", so 20 is a deliberately generous floor. Every wedge also has
   to stay clear of the beige it sits on. */
const PIE = ['#7ba0cd', '#dca18a', '#4fc299', '#ddb258', '#7c72b6'];

function toLab(hex) {
  const [r, g, b] = srgb(hex).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const deltaE = (a, b) => {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

PIE.forEach((colour, i) => {
  const next = PIE[(i + 1) % PIE.length];
  checks.push({
    label: `pie: wedge ${i + 1} vs wedge ${((i + 1) % PIE.length) + 1} (ΔE)`,
    fg: colour, bg: next, min: 20, got: deltaE(colour, next),
  });
  checks.push({
    label: `pie: wedge ${i + 1} against the card (ΔE)`,
    fg: colour, bg: SURFACE.card, min: 20, got: deltaE(colour, SURFACE.card),
  });
});

const failures = checks.filter(c => c.got < c.min);

for (const c of checks) {
  const ok = c.got >= c.min;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${c.got.toFixed(2).padStart(5)}:1  (min ${c.min})  ${c.label}   ${c.fg} on ${c.bg}`);
}

console.log(`\n${checks.length - failures.length}/${checks.length} pass`);
if (failures.length) {
  console.error(`\n${failures.length} pair(s) below the minimum — darken the ink or lighten the fill.`);
  process.exit(1);
}
