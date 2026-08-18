/**
 * The feedback-loop pair — pages 4 and 5.
 *
 * TWO CHARTS, NOT ONE WITH TWO AXES. Minutes and counts share no unit, so
 * plotting them against a common scale would invent a relationship that is not
 * in the data. They are drawn as two aligned single-measure charts on the same
 * category rows, which is what makes them comparable line by line.
 *
 * Each row is labelled and carries its own value, so the bars are read, not
 * estimated. Where a measure has no data the row says so rather than drawing a
 * zero-length bar that would read as "instant" or "never".
 */

const TRACK = '#f1f5f9';

/** Minutes → the shortest sensible human string. */
function humanMinutes(mins) {
  if (mins === null || mins === undefined) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function Bar({ value, max, color, muted }) {
  const pct = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: TRACK }}>
      {pct > 0 && (
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: muted ? '#94a3b8' : color }}
        />
      )}
    </div>
  );
}

/**
 * @param {object[]} rows        feedback rows from the API, ranked
 * @param {Function} colorOf     category → colour
 * @param {string}   secondLabel heading for the right-hand chart
 * @param {string}   secondKey   row field the right-hand chart plots
 * @param {boolean}  secondAvailable false when the system captures no such data
 */
export default function FeedbackBars({
  rows = [], colorOf, secondLabel, secondKey, secondAvailable = true, emptyNote,
}) {
  if (rows.length === 0) {
    return <p className="text-[11px] text-slate-400 py-4">{emptyNote || 'Nothing to report for this day.'}</p>;
  }

  const maxMins   = Math.max(0, ...rows.map(r => r.avgResolutionMins || 0));
  const maxSecond = Math.max(0, ...rows.map(r => r[secondKey] || 0));

  return (
    <div>
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-4 text-[9px] uppercase tracking-wide text-slate-400 pb-1 border-b border-slate-200">
        <span>Issue</span>
        <span>Avg time to resolve</span>
        <span>{secondLabel}</span>
      </div>

      <ul className="divide-y divide-slate-100">
        {rows.map(row => {
          const mins = humanMinutes(row.avgResolutionMins);
          return (
            <li key={row.category} className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-4 items-center py-1.5">
              {/* The coloured square is the icon tying this issue to every
                  other page; the name beside it carries the identity. */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span data-category={row.category} className="w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: colorOf(row.category) }} />
                <span className="text-[11px] text-slate-700 truncate" title={row.category}>{row.category}</span>
                <span className="text-[10px] text-slate-400 tabular-nums shrink-0">×{row.total}</span>
              </div>

              <div>
                <Bar value={row.avgResolutionMins || 0} max={maxMins} color={colorOf(row.category)} />
                <div className="flex items-baseline gap-1 mt-0.5">
                  {mins ? (
                    <>
                      <span className="text-[10px] tabular-nums font-semibold text-slate-900">{mins}</span>
                      {/* An average over 2 of 40 must not read like an average over 40. */}
                      <span className="text-[9px] text-slate-400">from {row.resolvedCount} ticket{row.resolvedCount === 1 ? '' : 's'}</span>
                    </>
                  ) : (
                    <span className="text-[9px] text-slate-400">no resolved ticket</span>
                  )}
                </div>
              </div>

              <div>
                {secondAvailable ? (
                  <>
                    <Bar value={row[secondKey] || 0} max={maxSecond} color={colorOf(row.category)} />
                    <div className="mt-0.5 text-[10px] tabular-nums font-semibold text-slate-900">
                      {row[secondKey] || 0}
                      <span className="text-[9px] font-normal text-slate-400"> of {row.total}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <Bar value={0} max={1} color="#cbd5e1" muted />
                    <div className="mt-0.5 text-[9px] text-slate-400">not captured</div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
