import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDateRange, useAgentMap } from '../hooks/useCalls';
import TicketDetailModal, { STATUS_STYLE, PRIORITY_STYLE, fmtDate, Badge } from '../components/TicketDetailModal';
import Pagination from '../components/Pagination';
import ColorSelect from '../components/ColorSelect';

const API = import.meta.env.VITE_API_URL ?? '';

const STATUS_COLORS = {
  'Open':        'text-amber-600 dark:text-amber-400',
  'In Progress': 'text-sky-600 dark:text-sky-400',
  'Resolved':    'text-emerald-600 dark:text-emerald-400',
  'Closed':      'text-slate-500 dark:text-zinc-400',
};

const PRIORITY_COLORS = {
  'Low':    'text-slate-500 dark:text-zinc-400',
  'Medium': 'text-amber-600 dark:text-amber-400',
  'High':   'text-orange-600 dark:text-orange-400',
  'Urgent': 'text-red-600 dark:text-red-400',
};

const SOURCE_COLORS = {
  'call':  'text-emerald-600 dark:text-emerald-400',
  'email': 'text-indigo-600 dark:text-indigo-400',
};

/** Tickets written before the email source existed have no `source` field. */
function isEmailTicket(t) { return t.source === 'email'; }

/** A phone icon for call tickets, an envelope for email ones. */
function SourceIcon({ ticket }) {
  return isEmailTicket(ticket) ? (
    <svg title="From email" className="w-3.5 h-3.5 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M1.5 5l6.5 4 6.5-4"/>
    </svg>
  ) : (
    <svg title="From call" className="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 004.168 6.608 17.569 17.569 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z"/>
    </svg>
  );
}


/* ──────────────────────────────────────────────────────────── */
/* Tickets Page                                                 */
/* ──────────────────────────────────────────────────────────── */

export default function Tickets() {
  const { token, isAdmin } = useAuth();
  const { minDate, maxDate } = useDateRange(token);
  const agentMap = useAgentMap(token, isAdmin);

  const [tickets,        setTickets]        = useState([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(true);
  const [page,           setPage]           = useState(1);
  const [pageSize,       setPageSize]       = useState(25);
  const [search,         setSearch]         = useState('');
  const [statusFilter,   setStatusFilter]   = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter,   setSourceFilter]   = useState('');
  const [dateFrom,       setDateFrom]       = useState('');
  const [dateTo,         setDateTo]         = useState('');
  const [selectedId,     setSelectedId]     = useState(null);

  const effectiveFrom  = dateFrom || minDate;
  const effectiveTo    = dateTo   || maxDate;
  const isDateFiltered = !!(dateFrom || dateTo);
  const isFiltered     = !!(search || statusFilter || priorityFilter || categoryFilter || sourceFilter || dateFrom || dateTo);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize });
      if (search)         params.append('search',   search);
      if (statusFilter)   params.append('status',   statusFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (categoryFilter) params.append('category', categoryFilter);
      if (sourceFilter)   params.append('source',   sourceFilter);
      if (effectiveFrom)  params.append('dateFrom', `${effectiveFrom}T00:00`);
      if (effectiveTo)    params.append('dateTo',   `${effectiveTo}T23:59`);

      const res  = await fetch(`${API}/api/tickets?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
    } catch {}
    finally { if (!silent) setLoading(false); }
  }, [token, page, pageSize, search, statusFilter, priorityFilter, categoryFilter, sourceFilter, effectiveFrom, effectiveTo]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 seconds, only when tab is visible (silent — no spinner)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) load(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {selectedId && (
        <TicketDetailModal
          ticketId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={load}
          onDeleted={load}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Tickets</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">{total} {isFiltered ? 'filtered' : 'total'} tickets · auto-refreshes every 5s</p>
        </div>
        <button onClick={load} title="Refresh" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors self-start">
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
          </svg>
        </button>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search ticket, customer, title…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <ColorSelect
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1); }}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'Open', label: 'Open', dot: 'bg-amber-500' },
            { value: 'In Progress', label: 'In Progress', dot: 'bg-sky-500' },
            { value: 'Resolved', label: 'Resolved', dot: 'bg-emerald-500' },
            { value: 'Closed', label: 'Closed', dot: 'bg-slate-400' },
          ]}
          placeholder="All Statuses"
          colorMap={STATUS_COLORS}
        />
        <ColorSelect
          value={priorityFilter}
          onChange={v => { setPriorityFilter(v); setPage(1); }}
          options={[
            { value: '', label: 'All Priorities' },
            { value: 'Low', label: 'Low', dot: 'bg-slate-400' },
            { value: 'Medium', label: 'Medium', dot: 'bg-amber-500' },
            { value: 'High', label: 'High', dot: 'bg-orange-500' },
            { value: 'Urgent', label: 'Urgent', dot: 'bg-red-500' },
          ]}
          placeholder="All Priorities"
          colorMap={PRIORITY_COLORS}
        />
        <ColorSelect
          value={categoryFilter}
          onChange={v => { setCategoryFilter(v); setPage(1); }}
          options={[
            { value: '', label: 'All Categories' },
            ...['General Inquiry', 'Technical Issue', 'Billing', 'Complaint', 'Service Request', 'Follow Up', 'Others'].map(c => ({ value: c, label: c })),
          ]}
          placeholder="All Categories"
          colorMap={{}}
        />
        <ColorSelect
          value={sourceFilter}
          onChange={v => { setSourceFilter(v); setPage(1); }}
          options={[
            { value: '',      label: 'All Sources' },
            { value: 'call',  label: 'From Calls',  dot: 'bg-emerald-500' },
            { value: 'email', label: 'From Emails', dot: 'bg-indigo-500' },
          ]}
          placeholder="All Sources"
          colorMap={SOURCE_COLORS}
        />
        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
          <input
            type="date"
            value={effectiveFrom}
            max={effectiveTo}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
          <input
            type="date"
            value={effectiveTo}
            min={effectiveFrom}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isDateFiltered && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        )}
        {isDateFiltered && (
          <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Filtered</span>
        )}
      </div>

      {/* Table */}
      {loading && tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading tickets...</p>
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9a1 1 0 011-1h18a1 1 0 011 1v2a2 2 0 000 4v2a1 1 0 01-1 1H3a1 1 0 01-1-1v-2a2 2 0 000-4V9z"/>
            <path d="M10 12h4"/>
          </svg>
          <p className="text-lg font-medium">No tickets yet</p>
          <p className="text-sm mt-1">Create a ticket from the Call Report or the Emails page.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                  {['#', 'Customer', 'Contact', 'Title', 'Category', 'Agent', 'Priority', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h === 'Actions' ? '' : h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-semibold whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        <SourceIcon ticket={t} />
                        {t.ticket_number}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300">{t.customer_name || '—'}</td>
                    <td
                      title={t.customer_email || t.customer_number || ''}
                      className={`px-3 py-2.5 text-slate-500 dark:text-zinc-400 max-w-[200px] truncate ${isEmailTicket(t) ? '' : 'tabular-nums'}`}
                    >
                      {t.customer_number || t.customer_email || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-900 dark:text-zinc-100 font-medium max-w-[220px] truncate">{t.title}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-zinc-400 text-xs whitespace-nowrap">{t.category}</td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-zinc-300 text-xs">
                      <span className="flex items-center gap-1">
                        {agentMap[t.agent_number] && (
                          <svg title="Verified" className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                            <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/>
                          </svg>
                        )}
                        {agentMap[t.agent_number] || t.agent_name || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5"><Badge text={t.priority} style={PRIORITY_STYLE[t.priority] ?? ''} /></td>
                    <td className="px-3 py-2.5"><Badge text={t.status}   style={STATUS_STYLE[t.status]   ?? ''} /></td>
                    <td className="px-3 py-2.5 text-slate-400 dark:text-zinc-500 text-xs whitespace-nowrap">{fmtDate(t.created_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <button className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">View →</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {tickets.map(t => (
              <div
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    <SourceIcon ticket={t} />
                    {t.ticket_number}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge text={t.priority} style={PRIORITY_STYLE[t.priority] ?? ''} />
                    <Badge text={t.status}   style={STATUS_STYLE[t.status]   ?? ''} />
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 mb-1">{t.title}</p>
                <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400 flex-wrap">
                  <span className="break-all">{t.customer_name ? `${t.customer_name} · ` : ''}{t.customer_number || t.customer_email || '—'} ·</span>
                  {agentMap[t.agent_number] && (
                    <svg title="Verified" className="w-3 h-3 text-indigo-500 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z" clipRule="evenodd"/>
                    </svg>
                  )}
                  <span>{agentMap[t.agent_number] || t.agent_name || '—'} · {fmtDate(t.created_at)}</span>
                </div>
              </div>
            ))}
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


