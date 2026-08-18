import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtDate } from '../components/TicketDetailModal';
import EmailDetailModal from '../components/EmailDetailModal';
import EmailTicketModal from '../components/EmailTicketModal';
import Pagination from '../components/Pagination';
import ColorSelect from '../components/ColorSelect';

const API = import.meta.env.VITE_API_URL ?? '';

const READ_COLORS = {
  'true':  'text-indigo-600 dark:text-indigo-400',
  'false': 'text-slate-500 dark:text-zinc-400',
};

/** Same affordance as the call report's row action, so it reads as one feature. */
function TicketBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Tickets for this sender"
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v2a1.5 1.5 0 010 3v2A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-2a1.5 1.5 0 010-3v-2z"/>
        <path d="M8 6v4M6 8h4"/>
      </svg>
    </button>
  );
}

export default function Emails() {
  const { token, isAdmin } = useAuth();

  const [emails,      setEmails]      = useState([]);
  const [total,       setTotal]       = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status,      setStatus]      = useState(null);
  const [aiStats,     setAiStats]     = useState(null);
  const [categories,  setCategories]  = useState([]);
  const [category,    setCategory]    = useState('');
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [page,        setPage]        = useState(1);
  const [pageSize,    setPageSize]    = useState(25);
  const [search,      setSearch]      = useState('');
  const [unread,      setUnread]      = useState('');
  const [attachments, setAttachments] = useState('');
  const [dateFrom,    setDateFrom]    = useState('');
  const [dateTo,      setDateTo]      = useState('');
  const [selectedId,  setSelectedId]  = useState(null);
  const [ticketEmail, setTicketEmail] = useState(null);

  const isFiltered = !!(search || unread || attachments || dateFrom || dateTo || category);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize });
      if (search)      params.append('search', search);
      if (unread)      params.append('unread', unread);
      if (attachments) params.append('hasAttachments', 'true');
      if (category)    params.append('category', category);
      if (dateFrom)    params.append('dateFrom', `${dateFrom}T00:00`);
      if (dateTo)      params.append('dateTo',   `${dateTo}T23:59`);

      const headers = { Authorization: `Bearer ${token}` };
      const [listRes, statusRes, aiRes] = await Promise.all([
        fetch(`${API}/api/emails?${params}`,          { headers }),
        fetch(`${API}/api/emails/sync-status`,         { headers }),
        fetch(`${API}/api/emails/analysis/stats`,      { headers }),
      ]);
      const data = await listRes.json();
      setEmails(data.emails ?? []);
      setTotal(data.total ?? 0);
      setUnreadCount(data.unreadCount ?? 0);
      setStatus(await statusRes.json().catch(() => null));
      setAiStats(await aiRes.json().catch(() => null));
    } catch {}
    finally { if (!silent) setLoading(false); }
  }, [token, page, pageSize, search, unread, attachments, category, dateFrom, dateTo]);

  // The category list changes only when the taxonomy does — fetch it once.
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/emails/categories`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setCategories(d.schema ?? []))
      .catch(() => {});
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Silent refresh while the tab is visible. Slower than the Tickets page (5s)
  // because the server only polls Gmail once a minute anyway.
  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) load(true); }, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch(`${API}/api/emails/sync`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      await load(true);
    } catch {}
    finally { setSyncing(false); }
  }

  const notConfigured = status && !status.configured;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {selectedId && <EmailDetailModal emailId={selectedId} onClose={() => setSelectedId(null)} />}
      {ticketEmail && <EmailTicketModal email={ticketEmail} onClose={() => setTicketEmail(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Emails</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">
            {total} {isFiltered ? 'filtered' : 'total'}
            {unreadCount > 0 && <> · <span className="text-indigo-600 dark:text-indigo-400 font-medium">{unreadCount} unread</span></>}
            {status?.mailbox && <> · {status.mailbox}</>}
            {status?.phase === 'backfill' && <> · <span className="text-amber-600 dark:text-amber-400">backfilling…</span></>}
            {aiStats?.coverage?.remaining > 0 && (
              <> · <span className="text-amber-600 dark:text-amber-400">{aiStats.coverage.remaining} awaiting AI analysis</span></>
            )}
            {aiStats?.queue?.failed > 0 && (
              <> · <span className="text-red-600 dark:text-red-400">{aiStats.queue.failed} analysis failed</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {isAdmin && (
            <button
              onClick={syncNow}
              disabled={syncing || notConfigured}
              className="px-3 h-9 flex items-center gap-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {syncing && <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />}
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          <button onClick={() => load()} title="Refresh" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3"/><path d="M13.5 2v3h-3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Setup / error banner */}
      {notConfigured && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-sm text-amber-800 dark:text-amber-300">
          Mailbox ingestion is not configured on the server. Set <code className="font-mono text-xs">GMAIL_USER</code> and the
          service-account key in <code className="font-mono text-xs">backend/.env</code> — see <code className="font-mono text-xs">backend/.env.example</code>.
        </div>
      )}
      {status?.last_error && (
        <div className="mb-4 px-4 py-3 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          <span className="font-medium">Last sync failed:</span> {status.last_error}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5l3 3"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search sender, subject, body…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <ColorSelect
          value={unread}
          onChange={v => { setUnread(v); setPage(1); }}
          options={[
            { value: '',      label: 'All Mail' },
            { value: 'true',  label: 'Unread',  dot: 'bg-indigo-500' },
            { value: 'false', label: 'Read',    dot: 'bg-slate-400' },
          ]}
          placeholder="All Mail"
          colorMap={READ_COLORS}
        />
        <ColorSelect
          value={attachments}
          onChange={v => { setAttachments(v); setPage(1); }}
          options={[
            { value: '',     label: 'Any Content' },
            { value: 'true', label: 'With Attachments' },
          ]}
          placeholder="Any Content"
          colorMap={{}}
        />
        <ColorSelect
          value={category}
          onChange={v => { setCategory(v); setPage(1); }}
          options={[
            { value: '', label: 'All Categories' },
            // Sentinels the analysis worker can assign, surfaced explicitly so
            // they are filterable rather than hidden among real categories.
            { value: 'Uncategorised',   label: 'Uncategorised' },
            { value: 'Content Unclear', label: 'Content Unclear' },
            { value: 'Email too Short', label: 'Email too Short' },
            ...categories.map(c => ({ value: c.name, label: c.name })),
          ]}
          placeholder="All Categories"
          colorMap={{}}
        />
        <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">From</label>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => { setDateFrom(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">To</label>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => { setDateTo(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-sm text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {(dateFrom || dateTo) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Table */}
      {loading && emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading emails…</p>
        </div>
      ) : emails.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>
          </svg>
          <p className="text-lg font-medium">{isFiltered ? 'No emails match these filters' : 'No emails yet'}</p>
          <p className="text-sm mt-1">
            {isFiltered ? 'Try widening the date range or clearing the search.'
                        : status?.phase === 'backfill' ? 'The first sync is still running — this fills in as it goes.'
                        : 'Mail appears here within a minute of arriving.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                  {['From', 'Subject', 'AI Insight', 'Category', 'Sub-category', '', 'Received', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {emails.map(m => (
                  <tr
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        {m.is_unread && <span title="Unread" className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                        <span className={`truncate ${m.is_unread ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-600 dark:text-zinc-300'}`}>
                          {m.from_name || m.from_email || '—'}
                        </span>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 max-w-[280px] truncate ${m.is_unread ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'}`}>
                      {m.subject}
                    </td>
                    {/* Falls back to the raw snippet until the worker gets to it. */}
                    <td className="px-3 py-2.5 max-w-[240px] truncate text-xs">
                      {m.ai_insight && m.ai_insight !== '-'
                        ? <span className="text-slate-600 dark:text-zinc-300">{m.ai_insight}</span>
                        : <span className="text-slate-400 dark:text-zinc-500 italic">{m.analysed_at ? '—' : m.snippet}</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate text-xs">
                      {m.category
                        ? <span className="text-slate-600 dark:text-zinc-300">{m.category}</span>
                        : <span className="text-slate-300 dark:text-zinc-600">pending</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate text-slate-500 dark:text-zinc-400 text-xs">{m.sub_category || '—'}</td>
                    <td className="px-3 py-2.5">
                      {m.has_attachments && (
                        <svg title="Has attachments" className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l-5.5 5.5a3 3 0 01-4.2-4.2L8.5 3a2 2 0 012.8 2.8l-5.3 5.3a1 1 0 01-1.4-1.4L9 5"/>
                        </svg>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 dark:text-zinc-500 text-xs whitespace-nowrap">{fmtDate(m.received_at)}</td>
                    <td className="px-3 py-2.5">
                      <TicketBtn onClick={e => { e.stopPropagation(); setTicketEmail(m); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {emails.map(m => (
              <div
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-sm truncate ${m.is_unread ? 'font-bold text-slate-900 dark:text-zinc-100' : 'font-medium text-slate-600 dark:text-zinc-300'}`}>
                    {m.from_name || m.from_email || '—'}
                  </span>
                  <div className="shrink-0 flex items-center gap-1">
                    <span className="text-xs text-slate-400 dark:text-zinc-500">{fmtDate(m.received_at)}</span>
                    <TicketBtn onClick={e => { e.stopPropagation(); setTicketEmail(m); }} />
                  </div>
                </div>
                <p className={`text-sm mb-1 ${m.is_unread ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'}`}>{m.subject}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 line-clamp-2">{m.snippet}</p>
                {m.category && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                      {m.category}
                    </span>
                    {m.sub_category && (
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500">{m.sub_category}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <Pagination
            page={page} pageSize={pageSize} total={total}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}
