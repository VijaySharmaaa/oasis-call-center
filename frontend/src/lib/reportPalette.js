/**
 * Colour assignment for the printed daily report.
 *
 * WHY THE REPORT HAS ITS OWN PALETTE
 * The portal's category colours (AIAnalysis.jsx) are positional — the eighth
 * colour is reused for the ninth category, and the index comes from whatever
 * array happened to be in scope at render time. That is fine for a chip beside
 * a label you can read, but a report keys a pie slice, a timeline icon and a
 * bar to the same category across five pages, so the mapping has to be stable
 * and the hues have to be genuinely distinguishable.
 *
 * THE PALETTE IS VALIDATED, NOT CHOSEN BY EYE
 * These five hues clear every check — lightness band, chroma floor, all-pairs
 * CVD separation, all-pairs normal-vision floor — against a white surface.
 * Blue and red are deliberately absent: the timeline reserves them for the
 * today/previous-day lines, and a category dot in either colour on that same
 * chart would read as a data series.
 *
 * Two documented caveats travel with this set, both discharged by the report:
 *   • worst CVD pair sits in the 6-8 band, legal only with secondary encoding —
 *     every slice, icon and bar carries a direct text label, never colour alone
 *   • three hues fall below 3:1 on white — the same labels plus the full ranked
 *     table beneath each chart provide the required relief
 *
 * Re-run before changing any hex:
 *   node scripts/validate_palette.js "#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" \
 *     --mode light --pairs all
 */

/** Categorical slots, in fixed order. Never cycled — a sixth category is "Other". */
export const CATEGORY_COLORS = [
  '#1baf7a',  // aqua
  '#eda100',  // yellow
  '#e87ba4',  // magenta
  '#008300',  // green
  '#4a3aa7',  // violet
];

/** Everything past the fifth category. Neutral by design, so it recedes. */
export const OTHER_COLOR = '#6b7280';
export const OTHER_LABEL = 'Other';

/**
 * Timeline series. The user's template fixes these: today blue, comparison red.
 * Both come from the same reference palette as the categoricals, which is why
 * neither appears in CATEGORY_COLORS.
 */
export const SERIES_TODAY    = '#2a78d6';
export const SERIES_PREVIOUS = '#e34948';

/** The report's red furniture — page borders and section rules. */
export const RULE_COLOR   = '#c0392b';
export const BORDER_COLOR = '#9b2c2c';

/**
 * Build one category → colour map for the whole report.
 *
 * Ranked once, from the day's total issue share, and then used unchanged on
 * every page. That is what makes the pie, the timeline icons and the feedback
 * bars agree: within a single report a category has exactly one colour, so a
 * reader who learns it on page 1 still knows it on page 5.
 *
 * Only the top five get a hue. A sixth would push the pie past the six-segment
 * limit where slices stop being separable, so the tail folds into "Other" —
 * and the ranked table beside each chart still lists every category by name,
 * which is where the long tail is meant to be read.
 *
 * @param {Array<{category: string}>} issueShare ranked, highest first
 * @returns {{colorOf: (c: string) => string, named: string[], hasOther: boolean}}
 */
export function buildCategoryColors(issueShare = []) {
  const named = issueShare.slice(0, CATEGORY_COLORS.length).map(s => s.category);
  const map = new Map(named.map((category, i) => [category, CATEGORY_COLORS[i]]));

  return {
    colorOf: category => map.get(category) ?? OTHER_COLOR,
    named,
    hasOther: issueShare.length > named.length,
  };
}

/**
 * Collapse a ranked list to the coloured head plus a single "Other" row.
 * Used by the pie, which must not exceed six segments.
 */
export function foldToOther(issueShare = [], keep = CATEGORY_COLORS.length) {
  const head = issueShare.slice(0, keep);
  const tail = issueShare.slice(keep);
  if (tail.length === 0) return head;

  return [...head, {
    category: OTHER_LABEL,
    count:    tail.reduce((sum, s) => sum + s.count, 0),
    pct:      Math.round(tail.reduce((sum, s) => sum + s.pct, 0) * 10) / 10,
    isOther:  true,
    folded:   tail.length,
  }];
}
