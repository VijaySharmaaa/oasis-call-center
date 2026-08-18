import { SERIES_TODAY, SERIES_PREVIOUS, OTHER_LABEL } from '../../lib/reportPalette';

/**
 * Volume over time for one channel.
 *
 * Two lines on ONE shared y-axis: the selected window in blue, the equally long
 * window before it in red. Both count the same thing in the same unit, which is
 * the only condition under which two series belong on one plot — a second axis
 * would make the crossing points meaningless.
 *
 * The x axis is whatever the API bucketed by: hours for a single day, days for
 * a range. The component does not decide which; it draws the spine it is given,
 * so an empty bucket stays a visible zero instead of closing the gap.
 *
 * Each bucket with traffic carries a dot in the colour of the issue that
 * dominated it. The dot is an annotation on the blue series, not a series of
 * its own, which is why it sits on the line rather than competing with it.
 */

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** A y-axis that ends on a round number, so the gridlines are readable. */
function niceMax(value) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/** Show at most ~8 x labels, whatever the bucket count, so they never collide. */
function labelEvery(count) {
  return Math.max(1, Math.ceil(count / 8));
}

export default function Timeline({
  current = [], previous = [], colorOf, label, previousLabel, granularity = 'hour',
}) {
  const peak = Math.max(1, ...current.map(b => b.count), ...previous.map(b => b.count));
  const max  = niceMax(peak);
  const n    = Math.max(current.length, 1);

  // Buckets are plotted by position, not by key: the previous window has
  // different dates but the same length, so index is what makes them overlay.
  const x = i     => PAD.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = count => PAD.top + PLOT_H - (count / max) * PLOT_H;

  const line = series => series
    .slice(0, n)
    .map((b, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(b.count)}`)
    .join(' ');

  const ticks = [0, max / 2, max];
  const every = labelEvery(current.length);
  const hasTraffic = current.some(b => b.count > 0) || previous.some(b => b.count > 0);
  const unit = granularity === 'hour' ? 'hour' : 'day';

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Volume by ${unit}, ${label} versus ${previousLabel}`}>
        {/* Recessive grid — hairlines, never competing with the data */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#9ca3af" className="tabular-nums">
              {t}
            </text>
          </g>
        ))}

        {current.map((b, i) => (i % every === 0 ? (
          <text key={b.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">
            {granularity === 'hour' ? b.key : b.label}
          </text>
        ) : null))}

        {hasTraffic ? (
          <>
            {/* The previous window sits underneath — it is context, not the subject */}
            <path d={line(previous)} fill="none" stroke={SERIES_PREVIOUS} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" opacity="0.75" strokeDasharray="4 3" />
            <path d={line(current)} fill="none" stroke={SERIES_TODAY} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />

            {/* Dominant-issue markers. A white ring separates the dot from the
                line it sits on; a bucket with only dispositions has no dot. */}
            {current.map((b, i) => (b.count > 0 && b.topCategory ? (
              <circle key={b.key} data-category={b.topCategory} cx={x(i)} cy={y(b.count)} r="4"
                      fill={colorOf(b.topCategory)} stroke="#ffffff" strokeWidth="2">
                <title>{`${b.label} — ${b.count} · ${b.topCategory}`}</title>
              </circle>
            ) : null))}
          </>
        ) : (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="11" fill="#9ca3af">
            No traffic in either window
          </text>
        )}
      </svg>

      <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded" style={{ background: SERIES_TODAY }} />
          {label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded" style={{ background: SERIES_PREVIOUS }} />
          {previousLabel}
        </span>
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-white" style={{ background: colorOf(OTHER_LABEL) }} />
          dot = dominant issue that {unit}
        </span>
      </div>
    </div>
  );
}
