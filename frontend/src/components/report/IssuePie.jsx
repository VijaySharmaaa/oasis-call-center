import { foldToOther, OTHER_LABEL } from '../../lib/reportPalette';

/**
 * Share of issue mentions by category — the page 1 pie.
 *
 * Part-to-whole at a glance, so it is capped at six segments: the five
 * coloured categories plus a folded "Other". Past that, slices stop being
 * separable and the ranked table beside it is the honest place to read the
 * tail — which is why the table is not optional decoration here, it is the
 * relief that lets the low-contrast hues ship at all.
 *
 * A 2px surface-coloured gap separates neighbouring slices, so identity never
 * rests on the hue boundary alone.
 */

const SIZE = 200;
const R = 78;
const CENTER = SIZE / 2;

/** Polar → cartesian, with 0° at twelve o'clock. */
function point(angleDeg, radius) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

function arcPath(startDeg, endDeg) {
  const [x1, y1] = point(startDeg, R);
  const [x2, y2] = point(endDeg, R);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${CENTER} ${CENTER} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export default function IssuePie({ issueShare = [], mentions = 0, colorOf }) {
  const slices = foldToOther(issueShare);

  if (mentions === 0 || slices.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[11px] text-slate-400">
        No issues categorised on this day
      </div>
    );
  }

  // Percentages are recomputed from counts rather than summed from the API's
  // rounded pct, so the wedges always close exactly at 360°.
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const wedges = slices.reduce((acc, slice) => {
    const start = acc.length ? acc[acc.length - 1].end : 0;
    acc.push({ ...slice, start, end: start + (slice.count / total) * 360 });
    return acc;
  }, []);

  const colour = s => (s.isOther ? colorOf(OTHER_LABEL) : colorOf(s.category));

  return (
    <div className="flex items-center gap-5">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0" role="img"
           aria-label="Share of issue mentions by category">
        {wedges.map(w => (
          <path
            key={w.category}
            d={arcPath(w.start, w.end)}
            fill={colour(w)}
            /* The 2px gap is the surface showing through, not a drawn line. */
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {/* The legend carries the numbers: identity is never colour alone, and
          the values are what a printed report is actually read for. */}
      <ul className="flex-1 min-w-0 space-y-1">
        {wedges.map(w => (
          <li key={w.category} className="flex items-center gap-2 text-[11px] leading-tight">
            <span data-category={w.category} className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: colour(w) }} />
            <span className="flex-1 min-w-0 truncate text-slate-700">
              {w.category}
              {w.isOther && <span className="text-slate-400"> ({w.folded} more)</span>}
            </span>
            <span className="tabular-nums font-semibold text-slate-900">
              {Math.round((w.count / total) * 1000) / 10}%
            </span>
            <span className="tabular-nums text-slate-400 w-7 text-right">{w.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
