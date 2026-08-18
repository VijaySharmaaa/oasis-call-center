/**
 * Report colour assignment.
 *
 * These rules are what make five pages agree with each other: one category,
 * one colour, everywhere in the document. The tests below pin the properties
 * that break silently — a repeated hue, a cycled palette, or a pie that grows
 * past the point where slices can be told apart.
 */
import { describe, it, expect } from 'vitest';
import {
  buildCategoryColors, foldToOther,
  CATEGORY_COLORS, OTHER_COLOR, OTHER_LABEL,
  SERIES_TODAY, SERIES_PREVIOUS,
} from '../lib/reportPalette';
import { shiftDays } from '../lib/reportDate';
import { formatMoney, formatTokens } from '../lib/reportCost';

const share = names => names.map((category, i) => ({
  category, count: 100 - i, pct: 10,
}));

describe('buildCategoryColors', () => {
  it('gives each of the top categories a distinct hue', () => {
    const { colorOf } = buildCategoryColors(share(['A', 'B', 'C', 'D', 'E']));
    const used = ['A', 'B', 'C', 'D', 'E'].map(colorOf);
    expect(new Set(used).size).toBe(5);
  });

  it('assigns hues in the palette order, so the ranking is legible', () => {
    const { colorOf } = buildCategoryColors(share(['A', 'B']));
    expect(colorOf('A')).toBe(CATEGORY_COLORS[0]);
    expect(colorOf('B')).toBe(CATEGORY_COLORS[1]);
  });

  it('never cycles the palette — a sixth category is Other, not slot 1 again', () => {
    const { colorOf } = buildCategoryColors(share(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
    expect(colorOf('F')).toBe(OTHER_COLOR);
    expect(colorOf('G')).toBe(OTHER_COLOR);
    expect(colorOf('F')).not.toBe(colorOf('A'));
  });

  it('returns the same colour for a category however often it is asked', () => {
    const { colorOf } = buildCategoryColors(share(['A', 'B', 'C']));
    expect(colorOf('B')).toBe(colorOf('B'));
  });

  it('gives an unknown category the neutral, rather than throwing or picking slot 1', () => {
    const { colorOf } = buildCategoryColors(share(['A']));
    expect(colorOf('Never seen')).toBe(OTHER_COLOR);
  });

  it('survives an empty day', () => {
    const { colorOf, named, hasOther } = buildCategoryColors([]);
    expect(named).toEqual([]);
    expect(hasOther).toBe(false);
    expect(colorOf('anything')).toBe(OTHER_COLOR);
  });

  it('flags that a tail exists, so the page can say "+n more"', () => {
    expect(buildCategoryColors(share(['A', 'B', 'C', 'D', 'E', 'F'])).hasOther).toBe(true);
    expect(buildCategoryColors(share(['A', 'B'])).hasOther).toBe(false);
  });
});

describe('foldToOther', () => {
  it('keeps the pie within six segments however long the tail', () => {
    const folded = foldToOther(share(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']));
    expect(folded).toHaveLength(6);
    expect(folded[5].category).toBe(OTHER_LABEL);
  });

  it('adds no Other row when everything already fits', () => {
    const folded = foldToOther(share(['A', 'B', 'C']));
    expect(folded).toHaveLength(3);
    expect(folded.some(s => s.category === OTHER_LABEL)).toBe(false);
  });

  it('sums the tail rather than dropping it, so the pie still totals the whole', () => {
    const input = share(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const folded = foldToOther(input);
    const before = input.reduce((sum, s) => sum + s.count, 0);
    const after  = folded.reduce((sum, s) => sum + s.count, 0);
    expect(after).toBe(before);
  });

  it('reports how many categories it folded away', () => {
    const folded = foldToOther(share(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
    expect(folded[5].folded).toBe(2);
  });
});

describe('series colours', () => {
  it('keeps the today/previous lines out of the categorical palette', () => {
    // A category dot in the same blue as the "today" line would read as data.
    expect(CATEGORY_COLORS).not.toContain(SERIES_TODAY);
    expect(CATEGORY_COLORS).not.toContain(SERIES_PREVIOUS);
  });

  it('keeps the neutral out of the categorical palette', () => {
    expect(CATEGORY_COLORS).not.toContain(OTHER_COLOR);
  });

  it('ships exactly the five validated hues', () => {
    // Changing this list means re-running scripts/validate_palette.js.
    expect(CATEGORY_COLORS).toEqual(['#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']);
  });
});

/* ── date helpers ──────────────────────────────────────────────────────── */

describe('shiftDays', () => {
  it('steps back within a month', () => {
    expect(shiftDays('2026-08-18', -6)).toBe('2026-08-12');
  });

  it('rolls back across a month boundary', () => {
    expect(shiftDays('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('rolls across a year boundary', () => {
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('steps forward too', () => {
    expect(shiftDays('2026-08-18', 1)).toBe('2026-08-19');
  });

  it('returns the same day for a zero shift', () => {
    expect(shiftDays('2026-08-18', 0)).toBe('2026-08-18');
  });

  it('produces the 7-day preset window the page uses', () => {
    // "Last 7 days" must span 7 days inclusive, not 8.
    expect(shiftDays('2026-08-18', -(7 - 1))).toBe('2026-08-12');
  });
});

/* ── money formatting ──────────────────────────────────────────────────── */

describe('formatMoney', () => {
  const usd = { code: 'USD', perUsd: 1 };

  it('shows two decimals for amounts of a dollar or more', () => {
    expect(formatMoney(1.2345, usd)).toBe('$1.23');
  });

  it('keeps sub-cent spend visible instead of rounding it to $0.00', () => {
    // The failure this guards: a real day's spend printed as free.
    expect(formatMoney(0.0031, usd)).toBe('$0.0031');
    expect(formatMoney(0.0031, usd)).not.toBe('$0.00');
  });

  it('scales precision to the magnitude', () => {
    expect(formatMoney(0.25, usd)).toBe('$0.250');
  });

  it('shows an actual zero as zero', () => {
    expect(formatMoney(0, usd)).toBe('$0');
  });

  it('shows an unknown cost as a dash, never as zero', () => {
    expect(formatMoney(null, usd)).toBe('—');
    expect(formatMoney(undefined, usd)).toBe('—');
  });

  it('converts and re-symbols when a display currency is configured', () => {
    expect(formatMoney(1, { code: 'INR', perUsd: 83.5 })).toBe('₹83.50');
  });

  it('falls back to the code for a currency with no symbol', () => {
    expect(formatMoney(2, { code: 'AED', perUsd: 3.67 })).toBe('AED 7.34');
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(2_400_000)).toBe('2.4M');
  });

  it('leaves small counts alone', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(0)).toBe('0');
  });
});
