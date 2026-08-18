import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportSheets from '../components/report/ReportSheets';
import { todayStr, shiftDays } from '../lib/reportDate';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Range presets. "All time" resolves against the earliest reportable day, which
 * the API reports — guessing a start date would silently clip the very history
 * the preset exists to cover.
 */
const PRESETS = [
  { id: 'today',  label: 'Today',        days: 1 },
  { id: '7d',     label: 'Last 7 days',  days: 7 },
  { id: '30d',    label: 'Last 30 days', days: 30 },
  { id: 'all',    label: 'All time',     days: null },
  { id: 'custom', label: 'Custom',       days: null },
];

const CHANNELS = [
  { id: 'all',    label: 'Calls + Mails', pages: 5 },
  { id: 'calls',  label: 'Calls only',    pages: 3 },
  { id: 'emails', label: 'Mails only',    pages: 3 },
];

/**
 * The report — five A4 sheets for both channels, three for one, printed from
 * the browser.
 *
 * This owns the window, the channel and fetching; ReportSheets owns the paper.
 * Everything outside the sheets is print:hidden, so what reaches the printer is
 * the report and nothing else.
 */
export default function Reports() {
  const { token, isAdmin } = useAuth();

  const [preset,  setPreset]  = useState('today');
  const [channel, setChannel] = useState('all');
  const [from,    setFrom]    = useState(todayStr);
  const [to,      setTo]      = useState(todayStr);
  const [bounds,  setBounds]  = useState(null);

  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // The earliest day there is anything to report on, so "All time" is a real
  // span rather than an arbitrary one.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/reports/range`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled && data) setBounds(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  function applyPreset(id) {
    setPreset(id);
    const today = todayStr();
    const chosen = PRESETS.find(p => p.id === id);

    if (id === 'all') {
      setFrom(bounds?.minDate || shiftDays(today, -29));
      setTo(today);
    } else if (chosen?.days) {
      setFrom(shiftDays(today, -(chosen.days - 1)));
      setTo(today);
    }
    // 'custom' keeps whatever the two date inputs already hold.
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to, channel });
      const res = await fetch(`${API}/api/reports/summary?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Report failed (${res.status})`);
      }
      setReport(await res.json());
    } catch (err) {
      setError(err.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [token, from, to, channel]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-slate-500 dark:text-zinc-400">
        The report covers every agent&apos;s calls, so it is available to admins only.
      </div>
    );
  }

  const pages = CHANNELS.find(c => c.id === channel)?.pages ?? 5;
  const spanDays = report?.days;

  const pill = (active) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
      active
        ? 'bg-indigo-600 border-indigo-600 text-white'
        : 'bg-white dark:bg-zinc-900 border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
    }`;

  return (
    <div className="p-4 lg:p-6 bg-slate-100 dark:bg-zinc-950 min-h-full print:bg-white print:p-0">
      <div className="print:hidden max-w-[794px] mx-auto mb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Report</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
              {pages} pages
              {spanDays ? ` · ${spanDays === 1 ? 'one day' : `${spanDays} days`}` : ''}
              {' '}· print or save as PDF from your browser
            </p>
          </div>
          <button
            onClick={() => window.print()}
            disabled={!report}
            className="ml-auto px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            Print / Save PDF
          </button>
        </div>

        {/* Filters in one row above the report, so the window and the channel
            are read together — they are the two things that define it. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => applyPreset(p.id)} className={pill(preset === p.id)}>
              {p.label}
            </button>
          ))}
          <span className="w-px h-5 bg-slate-300 dark:bg-zinc-700 mx-1" />
          {CHANNELS.map(c => (
            <button key={c.id} onClick={() => setChannel(c.id)} className={pill(channel === c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-slate-400 dark:text-zinc-500">From</label>
          <input
            type="date"
            value={from}
            max={to}
            min={bounds?.minDate || undefined}
            onChange={e => { setFrom(e.target.value); setPreset('custom'); }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <label className="text-xs text-slate-400 dark:text-zinc-500">To</label>
          <input
            type="date"
            value={to}
            min={from}
            max={bounds?.maxDate || undefined}
            onChange={e => { setTo(e.target.value); setPreset('custom'); }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="print:hidden flex flex-col items-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Building report…</p>
        </div>
      )}

      {error && !loading && (
        <div className="print:hidden max-w-[794px] mx-auto p-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {report && !loading && <ReportSheets report={report} />}
    </div>
  );
}
