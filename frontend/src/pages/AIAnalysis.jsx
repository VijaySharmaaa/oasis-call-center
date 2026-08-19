import { useState, useEffect, useCallback, useRef, forwardRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDateRange, useAgentMap } from '../hooks/useCalls';
import PageHeader from '../components/PageHeader';
import StatusTabs from '../components/StatusTabs';
import { usePageChrome, usePageRefresh } from '../contexts/PageChromeContext';
import { useExportJob } from '../hooks/useExportJob';
import TranscriptionModal from '../components/TranscriptionModal';
import AudioPlayer from '../components/AudioPlayer';
import Pagination from '../components/Pagination';
import ExportButton from '../components/ExportButton';

const API = import.meta.env.VITE_API_URL ?? '';

function formatDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return str; }
}

function formatDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Which queue's verdicts to read. Two workers produce them — one reads
 * recordings, one reads correspondence — but a verdict has the same shape
 * either way, so they list together and this narrows to one when an operator
 * wants only one.
 */
const SOURCE_TABS = [
  { value: 'all',    label: 'All',    bg: ['#fbf6ec', '#fbf6ec'], text: 'text-slate-900' },
  { value: 'calls',  label: 'Calls',  bg: ['#f6dbd2', '#f6dbd2'], text: 'text-indigo-800' },
  // Teal, not the accent: this separates the two queues, and both tabs in one
  // hue would say nothing. Pastel teal, matching the token ramp.
  { value: 'emails', label: 'Emails', bg: ['#cfe7e7', '#cfe7e7'], text: 'text-teal-800' },
];

/** The one-glance marker for which queue a row came from. */
function SourceBadge({ source }) {
  const isEmail = source === 'email';
  return (
    <span
      title={isEmail ? 'Analysed from a correspondence' : 'Analysed from a recording'}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
        isEmail
          ? 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400'
          : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
      }`}
    >
      {isEmail ? (
        <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
        </svg>
      ) : (
        <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 004.168 6.608 17.6 17.6 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z"/>
        </svg>
      )}
      {isEmail ? 'Email' : 'Call'}
    </span>
  );
}

const CATEGORY_COLORS = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
];

function useCategoryColor(category, categories) {
  const idx = categories.indexOf(category);
  return CATEGORY_COLORS[(idx >= 0 ? idx : 0) % CATEGORY_COLORS.length];
}

export default function AIAnalysis() {
  const { token, isAdmin, user } = useAuth();
  // Only the lower bound comes from the data; no upper ceiling, so freshly
  // analysed calls stay visible.
  const { minDate } = useDateRange(token);
  const agentMap = useAgentMap(token, isAdmin);
  // Date range and the auto-sync switch come from the common header.
  const { dateFrom, dateTo } = usePageChrome();

  const [analyses,    setAnalyses]    = useState([]);
  const [total,       setTotal]       = useState(0);
  const [categories,  setCategories]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(25);
  const [search,      setSearch]      = useState('');
  const [category,    setCategory]    = useState('');
  const [selected,    setSelected]    = useState(null);
  const [sortBy,      setSortBy]      = useState('created_at');
  const [sortDir,     setSortDir]     = useState('desc');
  const [bugsOnly,    setBugsOnly]    = useState(false);
  const [source,      setSource]      = useState('all');
  const [counts,      setCounts]      = useState({ calls: 0, emails: 0 });
  const [bugCategory, setBugCategory] = useState('');
  const [bugCategories, setBugCategories] = useState([]);
  const [callCategory, setCallCategory] = useState('');
  const [callCategories, setCallCategories] = useState([]);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState({
    source: true, category: true, sub_category: true, ai_insight: false, bug: true, bug_desc: true,
    resolved: false, score: false, quality: true, caller: false, agent: true, duration: false, date: true, recording: true,
  });
  const colMenuRef = useRef(null);
  // Agent-only: map of call_id → tickets[]
  const [ticketMap,   setTicketMap]   = useState({});

  const effectiveFrom = dateFrom;
  const effectiveTo   = dateTo;

  // For agents: fetch tickets keyed by call_id whenever analysis rows change
  useEffect(() => {
    if (isAdmin || analyses.length === 0) return;
    fetch(`${API}/api/tickets?limit=200&offset=0&agentNumber=${encodeURIComponent(user?.agent_number ?? '')}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const map = {};
        for (const t of data.tickets ?? []) {
          if (t.call_id) {
            if (!map[t.call_id]) map[t.call_id] = [];
            map[t.call_id].push(t);
          }
        }
        setTicketMap(map);
      })
      .catch(() => {});
  }, [isAdmin, analyses, token, user?.agent_number]);

  // Close column menu on outside click
  useEffect(() => {
    if (!colMenuOpen) return;
    function handleClick(e) { if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [colMenuOpen]);

  function toggleCol(col) { setVisibleCols(v => ({ ...v, [col]: !v[col] })); }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  }

  const isFirstLoad = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize, sortBy, sortDir });
      if (search)        params.append('search',   search);
      if (category)      params.append('category', category);
      if (effectiveFrom) params.append('dateFrom', `${effectiveFrom}T00:00`);
      if (effectiveTo)   params.append('dateTo',   `${effectiveTo}T23:59`);
      if (bugsOnly)      params.append('bugsOnly', '1');
      if (bugCategory)   params.append('bugCategory', bugCategory);
      if (callCategory)  params.append('callCategory', callCategory);
      if (source)        params.append('source', source);

      const res  = await fetch(`${API}/api/analysis?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) { if (!silent) setError(data.error || 'Failed to load'); return; }
      setAnalyses(data.analyses ?? []);
      setTotal(data.total ?? 0);
      if (data.categories?.length) setCategories(data.categories);
      if (data.bugCategories?.length) setBugCategories(data.bugCategories);
      if (data.callCategories?.length) setCallCategories(data.callCategories);
      setCounts(data.counts ?? { calls: 0, emails: 0 });
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [token, page, pageSize, search, category, effectiveFrom, effectiveTo, sortBy, sortDir, bugsOnly, bugCategory, callCategory, source]);

  useEffect(() => { load(); }, [load]);

  // The header owns the timer and the manual refresh button.
  usePageRefresh(load, 10000);

  // Narrowing the range while on a later page would strand the operator on an
  // empty page of a now-shorter list.
  useEffect(() => { setPage(1); }, [dateFrom, dateTo]);

  // Dates are cleared from the header's Reset, not here.
  function clearFilters() { setSearch(''); setCategory(''); setBugsOnly(false); setBugCategory(''); setCallCategory(''); setPage(1); }
  const isFiltered = !!(search || category || dateFrom || dateTo || bugsOnly || bugCategory || callCategory);

  const { runExport, exporting, label: exportLabel } = useExportJob({
    jobsEndpoint: '/api/analysis/export/jobs',
    token,
    fallbackName: `ai-analysis-${new Date().toISOString().slice(0,10)}.csv`,
  });

  function handleExport() {
    const payload = {};
    if (search) payload.search = search;
    if (category) payload.category = category;
    if (callCategory) payload.callCategory = callCategory;
    if (bugCategory) payload.bugCategory = bugCategory;
    if (bugsOnly) payload.bugsOnly = '1';
    // The CSV follows the toggle, so it can never hold a different set of rows
    // than the table it was taken from.
    payload.source = source;
    if (effectiveFrom) payload.dateFrom = `${effectiveFrom}T00:00`;
    if (effectiveTo) payload.dateTo = `${effectiveTo}T23:59`;
    runExport(payload);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {selected && (
        <TranscriptionModal
          call={{ ...selected.call, call_id: selected.call_id }}
          token={token}
          onClose={() => setSelected(null)}
        />
      )}

      <PageHeader
        title="AI Analysis"
        subtitle={
          <>
            {total} {isFiltered ? 'filtered' : 'analysed'} record{total === 1 ? '' : 's'}
            {/* Named rather than merely counted: the two queues drain at very
                different rates, and one number hides which is behind. */}
            {source === 'all' && (counts.calls > 0 || counts.emails > 0) && (
              <> · {counts.calls} call{counts.calls === 1 ? '' : 's'} · {counts.emails} email{counts.emails === 1 ? '' : 's'}</>
            )}
          </>
        }
        minDate={minDate}
      >
        {isFiltered && (
          <button
            onClick={() => { clearFilters(); setSortBy('created_at'); setSortDir('desc'); }}
            className="px-3 h-9 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </PageHeader>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <StatusTabs
          tabs={SOURCE_TABS}
          value={source}
          onChange={v => { setSource(v); setPage(1); }}
        />
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search category, insight, call ID, sender…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {callCategories.length > 0 && (
          <select
            value={callCategory}
            onChange={e => { setCallCategory(e.target.value); setPage(1); }}
            className={`px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm font-medium focus:outline-none transition-colors ${callCategory ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-white'}`}
          >
            <option value="">All Categories</option>
            {callCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1); }}
            className={`px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm font-medium focus:outline-none transition-colors ${category ? 'text-violet-600 dark:text-violet-400' : 'text-slate-900 dark:text-white'}`}
          >
            <option value="">All Sub-Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button
          onClick={() => { setBugsOnly(b => !b); setPage(1); }}
          className={`relative px-3 py-2 rounded-lg text-sm font-medium border transition-colors inline-flex items-center gap-2 ${
            bugsOnly
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700'
              : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border-slate-300 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800'
          }`}
        >
          <span className={`inline-block w-8 h-4 rounded-full transition-colors ${bugsOnly ? 'bg-red-500' : 'bg-slate-300 dark:bg-zinc-600'}`}>
            <span className={`block w-3.5 h-3.5 mt-px rounded-full bg-white shadow transition-transform ${bugsOnly ? 'translate-x-[17px]' : 'translate-x-px'}`} />
          </span>
          Bugs Only
        </button>
        {bugCategories.length > 0 && (
          <select
            value={bugCategory}
            onChange={e => { setBugCategory(e.target.value); setPage(1); }}
            className={`px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm font-medium focus:outline-none transition-colors ${bugCategory ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}
          >
            <option value="">All Bug Types</option>
            {bugCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <ExportButton onClick={handleExport} exporting={exporting} label={exportLabel} className="ml-auto">Export CSV</ExportButton>
      </div>

      {/* Content */}
      {error ? (
        <div className="text-center py-16 text-red-500 dark:text-red-400">
          <p className="text-lg font-medium">Failed to load</p>
          <p className="text-sm mt-1 text-slate-500 dark:text-zinc-500">{error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading analyses...</p>
        </div>
      ) : analyses.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/>
          </svg>
          <p className="text-sm font-medium">
            No analysed {source === 'emails' ? 'emails' : source === 'calls' ? 'calls' : 'records'} found
          </p>
          {isFiltered && <p className="text-xs mt-1">Try adjusting your filters.</p>}
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                  {visibleCols.source && <th className="px-4 py-3 font-semibold">Source</th>}
                  {visibleCols.category && <SortTh col="call_category" label="Category" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  {visibleCols.sub_category && <th className="px-4 py-3 font-semibold">Sub-Category</th>}
                  {isAdmin ? (
                    <>
                      {visibleCols.ai_insight && <th className="px-4 py-3 font-semibold">AI Insight</th>}
                      {visibleCols.bug && <SortTh col="bug_category" label="Bug" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                      {visibleCols.bug_desc && <th className="px-4 py-3 font-semibold">Bug Description</th>}
                    </>
                  ) : (
                    <th className="px-4 py-3 font-semibold">Tickets</th>
                  )}
                  {visibleCols.resolved && <SortTh col="call_resolved" label="Resolved" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  {visibleCols.score && <SortTh col="agent_score" label="Score" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  {visibleCols.quality && <SortTh col="audio_quality" label="Quality" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  {visibleCols.caller && <th className="px-4 py-3 font-semibold">Caller / Sender</th>}
                  {isAdmin && visibleCols.agent && <th className="px-4 py-3 font-semibold">Agent</th>}
                  {visibleCols.duration && <th className="px-4 py-3 font-semibold">Duration</th>}
                  {visibleCols.date && <SortTh col="created_at" label="Date" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  {visibleCols.recording && <SortTh col="recording" label="Recording / Subject" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />}
                  <th className="px-4 py-3 font-semibold w-10">
                    <div className="relative" ref={colMenuRef}>
                      <button
                        onClick={() => setColMenuOpen(o => !o)}
                        title="Toggle Columns"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1" fill="currentColor"/><circle cx="11" cy="8" r="1" fill="currentColor"/><circle cx="7" cy="12" r="1" fill="currentColor"/>
                        </svg>
                      </button>
                      {colMenuOpen && (
                        <div className="absolute right-0 top-9 z-30 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-lg p-2 w-48">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-zinc-500 px-2 py-1 font-semibold">Show Columns</p>
                          {[
                            ['source', 'Source'],
                            ['category', 'Category'],
                            ['sub_category', 'Sub-Category'],
                            ['ai_insight', 'AI Insight'],
                            ['bug', 'Bug'],
                            ['bug_desc', 'Bug Description'],
                            ['resolved', 'Resolved'],
                            ['score', 'Score'],
                            ['quality', 'Quality'],
                            ['caller', 'Caller / Sender'],
                            ['agent', 'Agent'],
                            ['duration', 'Duration'],
                            ['date', 'Date'],
                            ['recording', 'Recording / Subject'],
                          ].map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-zinc-800 cursor-pointer text-sm text-slate-700 dark:text-zinc-300">
                              <input type="checkbox" checked={visibleCols[key]} onChange={() => toggleCol(key)} className="rounded border-slate-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500" />
                              {label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {analyses.map(a => (
                  <AnalysisRow
                    // Two id spaces meet here — a call id and an email address —
                    // and only the pair is guaranteed unique.
                    key={`${a.source}:${a.id ?? a.call_id}`}
                    analysis={a}
                    categories={categories}
                    callCategories={callCategories}
                    agentMap={agentMap}
                    isAdmin={isAdmin}
                    cols={visibleCols}
                    tickets={ticketMap[a.call_id] ?? []}
                    onView={() => setSelected(a)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page} pageSize={pageSize} total={total}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}

function VerifiedIcon() {
  return (
    <svg title="Verified" className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/>
    </svg>
  );
}

const STATUS_BADGE = {
  Open:        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'In Progress':'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  Resolved:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Closed:      'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const AnalysisRow = forwardRef(function AnalysisRow({ analysis, categories, callCategories = [], agentMap = {}, isAdmin, tickets = [], cols = {}, onView }, ref) {
  // `primary_category` is the field the server normalises both queues onto;
  // the fallback keeps a client that is ahead of a stale server rendering.
  const primaryCategory = analysis.primary_category ?? analysis.call_category;
  const catColor = useCategoryColor(primaryCategory, callCategories);
  const isEmail = analysis.source === 'email';
  const call  = analysis.call;
  const email = analysis.email;

  return (
    <tr ref={ref} className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors">
      {cols.source && <td className="px-4 py-3">
        <SourceBadge source={analysis.source} />
      </td>}
      {cols.category && <td className="px-4 py-3">
        {primaryCategory
          ? <span className={`px-2.5 py-1 rounded-md text-xs font-medium inline-block whitespace-nowrap ${catColor}`}>{primaryCategory}</span>
          : <span className="text-slate-400 dark:text-zinc-500 text-xs italic">Uncategorised</span>}
      </td>}
      {cols.sub_category && <td className="px-4 py-3">
        {analysis.ai_insight && analysis.ai_insight !== '-'
          ? <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 inline-block">{analysis.ai_insight}</span>
          : <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>}
      </td>}

      {isAdmin ? (
        <>
          {cols.ai_insight && <td className="px-4 py-3 text-xs max-w-[200px]">
            {analysis.ai_insight
              ? <span className="font-medium text-amber-700 dark:text-amber-400">{analysis.ai_insight}</span>
              : <span className="text-slate-400 dark:text-zinc-500">—</span>}
          </td>}
          {cols.bug && <td className="px-4 py-3">
            {analysis.bug_category && analysis.bug_category !== '-' && analysis.bug_category !== 'Uncategorised'
              ? <span className="inline-block px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 font-medium text-xs whitespace-nowrap">
                  {analysis.bug_category}
                </span>
              : analysis.bug_category === 'Uncategorised'
                ? <span className="text-slate-400 dark:text-zinc-500 text-xs italic">Uncategorised</span>
                : <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>}
          </td>}
          {cols.bug_desc && <td className="px-4 py-3 max-w-[300px]">
            {analysis.bugs && analysis.bugs !== '-'
              ? <p className="text-xs text-red-600/80 dark:text-red-400/80 leading-relaxed">{analysis.bugs}</p>
              : <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>}
          </td>}
        </>
      ) : (
        <td className="px-4 py-3 max-w-[200px]">
          {tickets.length === 0 ? (
            <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>
          ) : (
            <div className="flex flex-col gap-1">
              {tickets.map(t => (
                <span key={t._id} title={t.title} className={`px-2 py-0.5 rounded-full text-xs font-medium truncate block ${STATUS_BADGE[t.status] ?? STATUS_BADGE.Open}`}>
                  {t.title}
                </span>
              ))}
            </div>
          )}
        </td>
      )}

      {cols.resolved && <td className="px-4 py-3">
        <ResolvedBadge value={analysis.call_resolved} />
      </td>}
      {cols.score && <td className="px-4 py-3">
        <AgentScore score={analysis.agent_score} />
      </td>}
      {cols.quality && <td className="px-4 py-3">
        <AudioBadge quality={analysis.audio_quality} />
      </td>}
      {cols.caller && <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 text-xs max-w-[200px]">
        {isEmail
          ? <span className="truncate block" title={email?.participant_email}>
              {email?.participant_name || email?.participant_email || '—'}
            </span>
          : <span className="tabular-nums">{call?.caller_number || '—'}</span>}
      </td>}
      {isAdmin && cols.agent && (
        <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 text-xs">
          {isEmail ? (
            <span className="text-slate-400 dark:text-zinc-500">—</span>
          ) : (
            <span className="flex items-center gap-1">
              {agentMap[call?.agent_number] && <VerifiedIcon />}
              {agentMap[call?.agent_number] || call?.agent_name || call?.agent_number || '—'}
            </span>
          )}
        </td>
      )}
      {cols.duration && <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 tabular-nums text-xs">
        {isEmail
          ? (analysis.message_count ?? email?.message_count
              ? `${analysis.message_count ?? email?.message_count} msg`
              : '—')
          : formatDuration(call?.duration)}
      </td>}
      {cols.date && <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 text-xs whitespace-nowrap">
        {formatDate(isEmail ? (email?.last_message_at || analysis.created_at)
                            : (call?.call_start_time || analysis.created_at))}
      </td>}
      {cols.recording && <td className="px-4 py-3">
        {isEmail
          /* The subject is the mail equivalent of the thing you would press
             play on: what this verdict was formed from. */
          ? <span className="text-xs text-slate-500 dark:text-zinc-400 truncate block max-w-[220px]" title={email?.last_subject}>
              {email?.last_subject || '—'}
            </span>
          : call?.call_recording && call?.agent_answer_time
            ? <AudioPlayer src={call.call_recording} />
            : <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>}
      </td>}
      <td className="px-4 py-3">
        {/* A transcription is what a recording produced; mail was already text,
            and it is read in the Emails tab where the whole chain is. */}
        {!isEmail && (
          <button
            onClick={onView}
            title="View Transcription"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="12" rx="2"/>
              <path d="M5 6h6M5 9h4"/>
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
});

function ResolvedBadge({ value }) {
  if (!value) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const map = {
    Yes:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    No:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${map[value] ?? map.No}`}>
      {value}
    </span>
  );
}

function AgentScore({ score }) {
  if (score === null || score === undefined) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const color =
    score >= 8 ? 'text-emerald-600 dark:text-emerald-400' :
    score >= 5 ? 'text-amber-600 dark:text-amber-400' :
                 'text-red-600 dark:text-red-400';
  return (
    <span className={`text-sm font-bold tabular-nums ${color}`}>
      {score}<span className="text-xs font-normal text-slate-400 dark:text-zinc-500">/10</span>
    </span>
  );
}

function AudioBadge({ quality }) {
  if (!quality?.rating) return <span className="text-slate-400 dark:text-zinc-500 text-xs">—</span>;
  const map = {
    Good:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    Poor:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span
      title={quality.issues && quality.issues !== '-' ? quality.issues : undefined}
      className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap cursor-default ${map[quality.rating] ?? map.Moderate}`}
    >
      {quality.rating}
    </span>
  );
}

function SortTh({ col, label, sortBy, sortDir, onSort }) {
  const active = sortBy === col;
  return (
    <th
      className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors whitespace-nowrap"
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'desc'
            ? <svg className="w-3 h-3 text-indigo-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 11l-4-5h8l-4 5z"/></svg>
            : <svg className="w-3 h-3 text-indigo-500" viewBox="0 0 16 16" fill="currentColor"><path d="M8 5l4 5H4l4-5z"/></svg>
        ) : (
          <svg className="w-3 h-3 opacity-30" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3l3 4H5l3-4zm0 10l-3-4h6l-3 4z"/></svg>
        )}
      </span>
    </th>
  );
}
