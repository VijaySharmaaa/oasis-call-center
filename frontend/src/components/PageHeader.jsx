import { PRESETS, usePageChrome } from '../contexts/PageChromeContext';

function fmtClock(d) {
  if (!d) return null;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * The header every page wears: title, the auto-refresh switch, and the date
 * filters. It reads and writes PageChromeContext, so the controls act on
 * whichever page is mounted without this component knowing which that is.
 *
 * @param {string}  title       page name
 * @param {node}    subtitle    counts and status — the page owns the wording
 * @param {boolean} showFilters false on pages with nothing to filter by date
 *                              (Agents, Stations), which still want the rest
 * @param {string}  minDate     oldest selectable day, from the data itself
 * @param {node}    children    page-specific actions, right of the refresh button
 */
export default function PageHeader({ title, subtitle, showFilters = true, minDate, children }) {
  const {
    preset, setPreset,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    isFiltered,
    autoRefresh, setAutoRefresh,
    intervalMs, refreshedAt, refreshNow,
  } = usePageChrome();

  const everySec = Math.round(intervalMs / 1000);

  return (
    <div className="mb-6 print:hidden">
      {/* Row 1 — identity and actions */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">
              {subtitle}
              {autoRefresh && <> · auto-refreshes every {everySec}s</>}
              {refreshedAt && <> · updated {fmtClock(refreshedAt)}</>}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 self-start shrink-0">
          {/* Auto-refresh switch. A real checkbox so it is keyboard reachable
              and announced; the styling rides on peer-checked. */}
          <label
            title={autoRefresh ? `Auto-refreshing every ${everySec}s` : 'Auto-refresh is off'}
            className="flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-300 dark:border-zinc-700 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {/* Track and knob are both SIBLINGS of the input: peer-* variants
                only reach siblings, so a knob nested inside the track would
                never pick up peer-checked and would sit still. */}
            <span className="relative inline-block w-9 h-5 shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              <span className="absolute inset-0 rounded-full bg-slate-300 dark:bg-zinc-600 peer-checked:bg-indigo-600 transition-colors duration-200" />
              <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-4" />
            </span>
            <span className="text-sm text-slate-600 dark:text-zinc-300 whitespace-nowrap">
              Auto sync
              {autoRefresh && (
                <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse align-middle" />
              )}
            </span>
          </label>

          <button
            onClick={() => refreshNow(false)}
            title="Refresh now"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
            </svg>
          </button>

          {children}
        </div>
      </div>

      {/* Row 2 — the date axis */}
      {showFilters && (
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-zinc-700 overflow-hidden">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-slate-300 dark:border-zinc-700 ${
                  preset === p.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/>
          </svg>

          <div className="flex items-center gap-1.5">
            <label htmlFor="chrome-date-from" className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
            <input
              id="chrome-date-from"
              type="date"
              value={dateFrom}
              min={minDate || undefined}
              max={dateTo || undefined}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="chrome-date-to" className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
            <input
              id="chrome-date-to"
              type="date"
              value={dateTo}
              min={dateFrom || minDate || undefined}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {isFiltered && (
            <>
              <button
                onClick={() => setPreset('all')}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
              >
                Reset
              </button>
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Filtered</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
