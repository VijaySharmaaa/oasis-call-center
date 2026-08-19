import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtDate } from '../components/TicketDetailModal';
import { useDateRange } from '../hooks/useCalls';
import EmailConversationModal from '../components/EmailConversationModal';
import EmailTicketModal from '../components/EmailTicketModal';
import TagChips, { tagsOf } from '../components/TagChips';
import AnalysisStatus, { analysisStateOf } from '../components/AnalysisStatus';
import PageHeader from '../components/PageHeader';
import { usePageChrome, usePageRefresh } from '../contexts/PageChromeContext';
import Pagination from '../components/Pagination';
import ColorSelect from '../components/ColorSelect';
import StatusTabs from '../components/StatusTabs';
import ExportButton from '../components/ExportButton';
import { useExportJob } from '../hooks/useExportJob';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Read state is the one thing this list is primarily triaged by, so it gets the
 * pill row the Call Report gives to Received/Missed rather than a dropdown.
 */
const READ_TABS = [
  { value: '',      label: 'All',    bg: ['#ffffff', '#3f3f46'],            text: 'text-slate-900 dark:text-zinc-100' },
  { value: 'true',  label: 'Unread', bg: ['#e0e7ff', 'rgba(49,46,129,0.5)'], text: 'text-indigo-700 dark:text-indigo-400' },
  { value: 'false', label: 'Read',   bg: ['#d1fae5', 'rgba(6,78,59,0.4)'],   text: 'text-emerald-700 dark:text-emerald-400' },
];

/**
 * Whether anyone has written back. Measured over the whole chain, so a
 * candidate answered last week who has written again since counts as replied
 * and still shows up under Unread — which is the pair of facts a triage pass
 * actually needs.
 */
const REPLIED_OPTIONS = [
  { value: '',      label: 'Any Reply State' },
  { value: 'true',  label: 'Replied',     dot: 'bg-emerald-500' },
  { value: 'false', label: 'Not Replied', dot: 'bg-amber-500' },
];

const REPLIED_COLORS = {
  'true':  'text-emerald-600 dark:text-emerald-400',
  'false': 'text-amber-600 dark:text-amber-400',
};

/**
 * Two different questions in one dropdown, deliberately: the first pair asks
 * whether a verdict was ever produced, the rest ask where the chain stands in
 * the queue right now. They are not exclusive — a chain analysed last week that
 * has had a reply since is both Analysed and Awaiting — and an operator wants
 * to be able to ask either.
 */
const ANALYSIS_OPTIONS = [
  { value: '',           label: 'Any Analysis' },
  { value: 'analysed',   label: 'Analysed',      dot: 'bg-emerald-500' },
  { value: 'unanalysed', label: 'Not Analysed',  dot: 'bg-slate-400' },
  { value: 'awaiting',   label: 'Awaiting',      dot: 'bg-amber-500' },
  { value: 'queued',     label: 'Queued',        dot: 'bg-slate-400' },
  { value: 'processing', label: 'Analysing',     dot: 'bg-sky-500' },
  { value: 'failed',     label: 'Failed',        dot: 'bg-red-500' },
];

const ANALYSIS_COLORS = {
  analysed:   'text-emerald-600 dark:text-emerald-400',
  unanalysed: 'text-slate-500 dark:text-zinc-400',
  awaiting:   'text-amber-600 dark:text-amber-400',
  queued:     'text-slate-500 dark:text-zinc-400',
  processing: 'text-sky-600 dark:text-sky-400',
  failed:     'text-red-600 dark:text-red-400',
};

/**
 * The mailbox as a list of PEOPLE.
 *
 * Every row is one correspondent and everything they have written — replies,
 * follow-ups, and the fresh threads candidates start for a problem they already
 * raised. Opening one shows the exchange as a chat, and the AI verdict beside
 * it was formed from the whole chain rather than from a single message.
 */

/** Unread means unread in Gmail AND not yet opened by anyone in Oasis. */
function isUnread(conversation) {
  return (conversation.unread_count || 0) > 0;
}

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

/** How many messages the chain holds — the cue that a row is a conversation. */
function MessageCount({ conversation }) {
  if ((conversation.message_count || 0) < 2) return null;
  return (
    <span
      title={`${conversation.message_count} messages${conversation.outbound_count ? ` · ${conversation.outbound_count} from support` : ''}`}
      className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"
    >
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 5.5A2 2 0 014.5 3.5h7a2 2 0 012 2v4a2 2 0 01-2 2H7l-3 2.5V11.5a2 2 0 01-1.5-2v-4z"/>
      </svg>
      {conversation.message_count}
    </span>
  );
}

export default function Emails() {
  const { token, isAdmin } = useAuth();

  const [conversations, setConversations] = useState([]);
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
  const [replied,     setReplied]     = useState('');
  const [analysis,    setAnalysis]    = useState('');
  const [selectedId,  setSelectedId]  = useState(null);
  const [ticketEmail, setTicketEmail] = useState(null);

  // Date range and the auto-sync switch come from the common header.
  const { dateFrom, dateTo } = usePageChrome();
  const { minDate } = useDateRange(token);

  // The header can narrow the range while the operator sits on page 5, which
  // would otherwise land them on an empty page of a now-shorter list.
  useEffect(() => { setPage(1); }, [dateFrom, dateTo]);

  // Everything this page owns. The date range is the header's and is shared
  // across tabs, so it counts towards "is this list filtered" but not towards
  // what the Clear button can undo.
  const pageFilters = !!(search || unread || attachments || replied || analysis || category);
  const isFiltered = pageFilters || !!(dateFrom || dateTo);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: pageSize, offset: (page - 1) * pageSize });
      if (search)      params.append('search', search);
      if (unread)      params.append('unread', unread);
      if (attachments) params.append('hasAttachments', 'true');
      if (replied)     params.append('replied', replied);
      if (analysis)    params.append('analysisStatus', analysis);
      if (category)    params.append('category', category);
      if (dateFrom)    params.append('dateFrom', `${dateFrom}T00:00`);
      if (dateTo)      params.append('dateTo',   `${dateTo}T23:59`);

      const headers = { Authorization: `Bearer ${token}` };
      const [listRes, statusRes, aiRes] = await Promise.all([
        fetch(`${API}/api/emails/conversations?${params}`, { headers }),
        fetch(`${API}/api/emails/sync-status`,              { headers }),
        fetch(`${API}/api/emails/analysis/stats`,           { headers }),
      ]);
      const data = await listRes.json();
      setConversations(data.conversations ?? []);
      setTotal(data.total ?? 0);
      setUnreadCount(data.unreadCount ?? 0);
      setStatus(await statusRes.json().catch(() => null));
      setAiStats(await aiRes.json().catch(() => null));
    } catch {}
    finally { if (!silent) setLoading(false); }
  }, [token, page, pageSize, search, unread, attachments, replied, analysis, category, dateFrom, dateTo]);

  // The category list changes only when the taxonomy does — fetch it once.
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/emails/categories`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setCategories(d.schema ?? []))
      .catch(() => {});
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Slower than the Tickets page (5s) because the server only polls Gmail once
  // a minute anyway — the header runs the timer at whatever a page declares.
  usePageRefresh(load, 15_000);

  /* Opening a chain marks the whole chain read: in a shared mailbox the unit
     somebody picks up is the person, not one message. The row updates
     immediately rather than waiting for the next poll, and a failure is silent
     — a lost read marker is not worth interrupting someone mid-triage. */
  function openConversation(conversation) {
    setSelectedId(conversation.id);
    if (!isUnread(conversation)) return;

    setConversations(list => list.map(c => (c.id === conversation.id ? { ...c, unread_count: 0 } : c)));
    setUnreadCount(n => Math.max(0, n - 1));

    fetch(`${API}/api/emails/conversations/${encodeURIComponent(conversation.id)}/read`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ read: true }),
    }).catch(() => {});
  }

  /* The same job-based export the call report uses: queue, poll, download. It
     exports CONVERSATIONS — one row per sender, carrying their whole chain and
     the one verdict formed from it — because that is what the table shows. */
  const { runExport, exporting, label: exportLabel } = useExportJob({
    jobsEndpoint: '/api/emails/conversations/export/jobs',
    token,
    fallbackName: `email-report-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv`,
  });

  /* Every filter currently narrowing the table goes with it. An export that
     quietly ignores the filters on screen is the one thing worse than no
     export — the operator cannot tell the difference until the numbers are
     already in a meeting. */
  /* Clears everything this page owns. The date range belongs to the header and
     is left alone: it is shared across tabs, and resetting it here would widen
     a window the operator set somewhere else. */
  function clearFilters() {
    setSearch('');
    setUnread('');
    setReplied('');
    setAnalysis('');
    setAttachments('');
    setCategory('');
    setPage(1);
  }

  function handleExport() {
    const payload = {};
    if (search)      payload.search = search;
    if (unread)      payload.unread = unread;
    if (attachments) payload.hasAttachments = 'true';
    if (replied)     payload.replied = replied;
    if (analysis)    payload.analysisStatus = analysis;
    if (category)    payload.category = category;
    if (dateFrom)    payload.dateFrom = `${dateFrom}T00:00`;
    if (dateTo)      payload.dateTo   = `${dateTo}T23:59`;
    runExport(payload);
  }

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
      {selectedId && (
        <EmailConversationModal
          conversationId={selectedId}
          onClose={() => setSelectedId(null)}
          // A reply changes the chain's shape — message count, last activity,
          // and where it sorts in the list.
          onReplied={() => load(true)}
          onRead={(id, read) => {
            setConversations(list => list.map(c => (c.id === id ? { ...c, unread_count: read ? 0 : 1 } : c)));
            setUnreadCount(n => (read ? Math.max(0, n - 1) : n + 1));
          }}
        />
      )}
      {ticketEmail && <EmailTicketModal email={ticketEmail} onClose={() => setTicketEmail(null)} />}

      <PageHeader
        title="Emails"
        minDate={minDate}
        subtitle={
          <>
            {total} {isFiltered ? 'filtered' : 'total'} sender{total === 1 ? '' : 's'}
            {unreadCount > 0 && <> · <span className="text-indigo-600 dark:text-indigo-400 font-medium">{unreadCount} unread</span></>}
            {status?.mailbox && <> · {status.mailbox}</>}
            {status?.phase === 'backfill' && <> · <span className="text-amber-600 dark:text-amber-400">backfilling…</span></>}
            {aiStats?.coverage?.remaining > 0 && (
              <> · <span className="text-amber-600 dark:text-amber-400">{aiStats.coverage.remaining} awaiting AI analysis</span></>
            )}
            {aiStats?.queue?.failed > 0 && (
              <> · <span className="text-red-600 dark:text-red-400">{aiStats.queue.failed} analysis failed</span></>
            )}
          </>
        }
      >
        {/* Pulling from Gmail is a different act from re-reading our own copy,
            and it costs API quota — so it stays an explicit admin action rather
            than riding on the auto-sync tick. */}
        {isAdmin && (
          <button
            onClick={syncNow}
            disabled={syncing || notConfigured}
            title="Fetch new mail from Gmail now"
            className="px-3 h-9 flex items-center gap-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {syncing && <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />}
            {syncing ? 'Syncing…' : 'Sync Gmail'}
          </button>
        )}
      </PageHeader>

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
        <StatusTabs
          tabs={READ_TABS}
          value={unread}
          onChange={v => { setUnread(v); setPage(1); }}
        />
        <ColorSelect
          value={replied}
          onChange={v => { setReplied(v); setPage(1); }}
          options={REPLIED_OPTIONS}
          placeholder="Any Reply State"
          colorMap={REPLIED_COLORS}
        />
        <ColorSelect
          value={analysis}
          onChange={v => { setAnalysis(v); setPage(1); }}
          options={ANALYSIS_OPTIONS}
          placeholder="Any Analysis"
          colorMap={ANALYSIS_COLORS}
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
        {pageFilters && (
          <button
            onClick={clearFilters}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Clear filters
          </button>
        )}
        <ExportButton
          onClick={handleExport}
          exporting={exporting}
          label={exportLabel}
          className="ml-auto"
        />
      </div>

      {/* Table */}
      {loading && conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading emails…</p>
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>
          </svg>
          <p className="text-lg font-medium">{isFiltered ? 'No senders match these filters' : 'No emails yet'}</p>
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
                  {['Sender', 'Latest Subject', 'AI Insight', 'Category', 'Sub-category', '', 'Last Activity', ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conversations.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => openConversation(c)}
                    className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 max-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        {isUnread(c) && <span title={`${c.unread_count} unread`} className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                        <span
                          title={c.participant_email}
                          className={`truncate ${isUnread(c) ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-600 dark:text-zinc-300'}`}
                        >
                          {c.participant_name || c.participant_email || '—'}
                        </span>
                        <MessageCount conversation={c} />
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 max-w-[260px] truncate ${isUnread(c) ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'}`}>
                      {c.last_subject || '—'}
                    </td>
                    {/* Falls back to the latest snippet until the worker gets to it. */}
                    <td className="px-3 py-2.5 max-w-[240px] truncate text-xs">
                      {c.ai_insight && c.ai_insight !== '-'
                        ? <span className="text-slate-600 dark:text-zinc-300">{c.ai_insight}</span>
                        : <span className="text-slate-400 dark:text-zinc-500 italic">{c.analysed_at ? '—' : c.last_inbound_snippet || c.last_snippet}</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[220px] text-xs">
                      {/* A chain with no verdict yet shows its queue state in
                          place of TagChips' bare "pending", which says less and
                          offers nothing to press. */}
                      {tagsOf(c).length > 0
                        ? <TagChips item={c} max={2} />
                        : !analysisStateOf(c, { showAnalysed: true }) && <span className="text-slate-300 dark:text-zinc-600">—</span>}
                      <AnalysisStatus
                        item={c}
                        analyseUrl={`/api/emails/conversations/${encodeURIComponent(c.id)}/analyse`}
                        onQueued={() => load(true)}
                        showAnalysed
                        className="mt-1"
                      />
                    </td>
                    <td className="px-3 py-2.5 max-w-[200px] truncate text-slate-500 dark:text-zinc-400 text-xs">{c.sub_category || '—'}</td>
                    <td className="px-3 py-2.5">
                      {c.has_attachments && (
                        <svg title="Has attachments" className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 7l-5.5 5.5a3 3 0 01-4.2-4.2L8.5 3a2 2 0 012.8 2.8l-5.3 5.3a1 1 0 01-1.4-1.4L9 5"/>
                        </svg>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 dark:text-zinc-500 text-xs whitespace-nowrap">{fmtDate(c.last_message_at)}</td>
                    <td className="px-3 py-2.5">
                      <TicketBtn onClick={e => {
                        e.stopPropagation();
                        setTicketEmail({
                          id: c.last_inbound_id || c.last_message_id,
                          from_email: c.participant_email,
                          from_name:  c.participant_name,
                          subject:    c.last_subject,
                        });
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => openConversation(c)}
                className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className={`text-sm truncate ${isUnread(c) ? 'font-bold text-slate-900 dark:text-zinc-100' : 'font-medium text-slate-600 dark:text-zinc-300'}`}>
                    {c.participant_name || c.participant_email || '—'}
                  </span>
                  <div className="shrink-0 flex items-center gap-1">
                    <MessageCount conversation={c} />
                    <span className="text-xs text-slate-400 dark:text-zinc-500">{fmtDate(c.last_message_at)}</span>
                    <TicketBtn onClick={e => {
                      e.stopPropagation();
                      setTicketEmail({
                        id: c.last_inbound_id || c.last_message_id,
                        from_email: c.participant_email,
                        from_name:  c.participant_name,
                        subject:    c.last_subject,
                      });
                    }} />
                  </div>
                </div>
                <p className={`text-sm mb-1 ${isUnread(c) ? 'font-semibold text-slate-900 dark:text-zinc-100' : 'text-slate-700 dark:text-zinc-300'}`}>{c.last_subject}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 line-clamp-2">{c.last_inbound_snippet || c.last_snippet}</p>
                {c.category && (
                  <div className="mt-2">
                    <TagChips item={c} max={3} showSub />
                  </div>
                )}
                {/* Outside the block above, because the rows that most need
                    this are exactly the ones with no category yet. */}
                <AnalysisStatus
                  item={c}
                  analyseUrl={`/api/emails/conversations/${encodeURIComponent(c.id)}/analyse`}
                  onQueued={() => load(true)}
                  showAnalysed
                  className="mt-2"
                />
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
