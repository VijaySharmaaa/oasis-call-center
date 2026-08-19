import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * State shared by the common page header and whichever page is mounted.
 *
 * Two things used to be copy-pasted into every page: a date-range filter and a
 * setInterval that silently re-fetched. Both now live here, so the header can
 * drive "the page we are on" without knowing anything about it — a page hands
 * over its loader via usePageRefresh() and reads the range via usePageChrome().
 *
 * The range survives navigation on purpose: an operator narrowing to today and
 * moving from Calls to Emails means the same day, not a reset filter.
 */
const PageChromeContext = createContext(null);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar date as YYYY-MM-DD — never toISOString(), which is UTC and
 *  rolls over a day early for IST. */
export function toDateInput(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Empty strings mean "no bound", which is what the All time preset selects. */
export function rangeForPreset(preset, now = new Date()) {
  const today = toDateInput(now);
  switch (preset) {
    case 'today': return { dateFrom: today, dateTo: today };
    case '7d':    return { dateFrom: toDateInput(new Date(now.getTime() - 6 * DAY_MS)), dateTo: today };
    case 'all':   return { dateFrom: '', dateTo: '' };
    default:      return null;    // 'custom' is whatever the pickers hold
  }
}

export const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 days' },
  { id: 'all',   label: 'All' },
];

export function PageChromeProvider({ children }) {
  // 'all' matches the behaviour every page had before the header existed:
  // unbounded unless the operator narrows it.
  const [preset, setPresetState] = useState('all');
  const [dateFrom, setDateFromState] = useState('');
  const [dateTo,   setDateToState]   = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);

  // The mounted page's loader. A ref, not state, so re-registering on every
  // render of the page cannot re-arm the interval below.
  const refreshRef  = useRef(null);
  const intervalRef = useRef(5000);
  const [intervalMs, setIntervalMs] = useState(5000);

  const registerRefresh = useCallback((fn, ms) => {
    refreshRef.current  = fn;
    intervalRef.current = ms;
    setIntervalMs(ms);
  }, []);

  const clearRefresh = useCallback(() => {
    refreshRef.current = null;
  }, []);

  /** silent=true skips the page's spinner — what the auto tick uses. */
  const refreshNow = useCallback((silent = false) => {
    const fn = refreshRef.current;
    if (!fn) return;
    fn(silent);
    setRefreshedAt(new Date());
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      // A hidden tab has no reader, so polling it only burns quota and battery.
      if (!document.hidden) refreshNow(true);
    }, intervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, intervalMs, refreshNow]);

  const setPreset = useCallback(preset => {
    setPresetState(preset);
    const range = rangeForPreset(preset);
    if (range) {
      setDateFromState(range.dateFrom);
      setDateToState(range.dateTo);
    }
  }, []);

  // Typing in either picker is by definition a custom range.
  const setDateFrom = useCallback(value => { setDateFromState(value); setPresetState('custom'); }, []);
  const setDateTo   = useCallback(value => { setDateToState(value);   setPresetState('custom'); }, []);

  const value = useMemo(() => ({
    preset, setPreset,
    dateFrom, setDateFrom,
    dateTo,   setDateTo,
    isFiltered: !!(dateFrom || dateTo),
    autoRefresh, setAutoRefresh,
    intervalMs,
    refreshedAt,
    refreshNow,
    registerRefresh, clearRefresh,
  }), [preset, setPreset, dateFrom, setDateFrom, dateTo, setDateTo, autoRefresh,
       intervalMs, refreshedAt, refreshNow, registerRefresh, clearRefresh]);

  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>;
}

export function usePageChrome() {
  const ctx = useContext(PageChromeContext);
  if (!ctx) throw new Error('usePageChrome must be used inside <PageChromeProvider>');
  return ctx;
}

/**
 * Hand the header this page's loader, so the refresh button and the auto tick
 * both drive it.
 *
 * `load` is called as load(silent). Wrap it in useCallback on the page, or the
 * registration re-runs every render — harmless, but noisy.
 */
export function usePageRefresh(load, intervalMs = 5000) {
  const { registerRefresh, clearRefresh } = usePageChrome();
  useEffect(() => {
    registerRefresh(load, intervalMs);
    return clearRefresh;
  }, [load, intervalMs, registerRefresh, clearRefresh]);
}
