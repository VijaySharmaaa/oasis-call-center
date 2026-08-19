import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  useStats,
  useCalls,
  useDateRange,
  useAgentMap,
} from "../hooks/useCalls";
import Pagination from "../components/Pagination";
import { useAuth } from "../contexts/AuthContext";
import PageHeader from "../components/PageHeader";
import { usePageChrome, usePageRefresh } from "../contexts/PageChromeContext";

const API = import.meta.env.VITE_API_URL ?? "";

function fmtDuration(s) {
  if (!s) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const TICKET_COLORS = {
  Open: {
    ring: "#b8832d",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-400",
  },
  "In Progress": {
    ring: "#6091bb",
    text: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-400",
  },
  Resolved: {
    ring: "#5e9970",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-400",
  },
  Closed: {
    ring: "#8a7f6d",
    text: "text-slate-500 dark:text-zinc-400",
    dot: "bg-slate-400",
  },
};

function TicketDonut({ stats }) {
  const entries = Object.entries(TICKET_COLORS).map(([status, c]) => ({
    status,
    count: stats[status] || 0,
    ...c,
  }));
  const total = entries.reduce((s, e) => s + e.count, 0);
  const R = 48;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg
      viewBox="0 0 120 120"
      className="w-32 h-32 lg:w-24 lg:h-24 min-[1544px]:w-28 min-[1544px]:h-28 shrink-0"
    >
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke="#e6dac5"
        strokeWidth="16"
        className="dark:hidden"
      />
      <circle
        cx="60"
        cy="60"
        r={R}
        fill="none"
        stroke="#e6dac5"
        strokeWidth="16"
        className="hidden dark:block"
      />
      {total > 0 &&
        entries.map((e) => {
          const dash = (e.count / total) * C;
          const seg = (
            <circle
              key={e.status}
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={e.ring}
              strokeWidth="16"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
              className="animate-donut"
              style={{ "--circumference": C }}
            />
          );
          offset += dash;
          return seg;
        })}
      <text
        x="60"
        y="56"
        textAnchor="middle"
        fontSize="18"
        fontWeight="700"
        fill="currentColor"
      >
        {total}
      </text>
      <text x="60" y="70" textAnchor="middle" fontSize="9" fill="#8a7f6d">
        Tickets
      </text>
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 5.5A1.5 1.5 0 013.5 4h9A1.5 1.5 0 0114 5.5v1a1.5 1.5 0 010 3v1A1.5 1.5 0 0112.5 12h-9A1.5 1.5 0 012 10.5v-1a1.5 1.5 0 010-3v-1z" />
      <path d="M9 8h.01" />
    </svg>
  );
}

function AnimatedNumber({ value, duration = 1000, format }) {
  const num = typeof value === "number" ? value : parseInt(value) || 0;
  const [display, setDisplay] = useState(num);
  const prev = useRef(num);

  useEffect(() => {
    const from = prev.current;
    const to = num;
    if (from === to) return;
    const start = performance.now();
    let raf;
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setDisplay(Math.round(from + (to - from) * ease));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    prev.current = to;
    return () => cancelAnimationFrame(raf);
  }, [num, duration]);

  return format ? format(display) : display.toLocaleString("en-IN");
}

function StatCard({ label, value, rawSeconds, color, icon }) {
  const isNum = typeof value === "number" || /^\d+$/.test(value);
  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl px-4 py-4 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-500 dark:text-zinc-500 uppercase tracking-wide font-medium">
          {label}
        </p>
        <span className="text-slate-300 dark:text-zinc-700">{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>
        {rawSeconds != null ? (
          <AnimatedNumber value={rawSeconds} format={(v) => fmtDuration(v)} />
        ) : isNum ? (
          <AnimatedNumber value={value} />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

/**
 * The two halves of the Dashboard: what came in by phone, and what came in by
 * mail. They are deliberately the same shape — a headline tile carrying the
 * counts, then the detail beneath — so the eye can compare the channels rather
 * than learn two layouts.
 */

/** One number inside a tile. Small enough to sit four-across in half a page. */
function TileStat({ label, value, rawSeconds, color }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-zinc-500 font-medium truncate">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>
        {rawSeconds != null
          ? <AnimatedNumber value={rawSeconds} format={v => fmtDuration(v)} />
          : typeof value === "number"
            ? <AnimatedNumber value={value} />
            : value}
      </p>
    </div>
  );
}

const TILE_TONES = {
  calls: {
    idle: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400",
    open: "bg-indigo-600 text-white",
    ring: "hover:border-indigo-300 dark:hover:border-indigo-700",
  },
  mail: {
    idle: "bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400",
    open: "bg-teal-600 text-white",
    ring: "hover:border-teal-300 dark:hover:border-teal-700",
  },
};

/**
 * A channel's headline: an icon, four numbers, and the list behind them.
 *
 * The WHOLE card is the control. Half a card that responds to a click teaches
 * people to hunt for the live part, and the numbers are the thing being asked
 * about — so pressing any of them opens the rows they summarise. It stays a
 * div with role=button rather than a real <button> only because the numbers are
 * paragraphs, which a button may not contain.
 *
 * It opens the table in place; it deliberately does not navigate. Leaving the
 * page to answer "which calls?" loses the range, the other half, and the reason
 * you asked.
 */
function StatTile({ tone, icon, stats, open, onToggle, openLabel, closeLabel, note }) {
  const colors = TILE_TONES[tone] ?? TILE_TONES.calls;

  function onKeyDown(e) {
    // Enter and Space are what a button answers to; without this the card is
    // reachable by keyboard and does nothing.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={open ? closeLabel : openLabel}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={`w-full text-left bg-white dark:bg-zinc-900 border rounded-xl p-4 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        open
          ? "border-slate-300 dark:border-zinc-700"
          : `border-slate-200 dark:border-zinc-800 ${colors.ring}`
      }`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`shrink-0 w-14 h-14 rounded-xl flex items-center justify-center transition-colors ${
            open ? colors.open : colors.idle
          }`}
        >
          {icon}
        </span>

        <div className="grid grid-cols-2 min-[420px]:grid-cols-4 gap-3 flex-1 min-w-0">
          {stats.map(s => <TileStat key={s.label} {...s} />)}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400 dark:text-zinc-500 min-w-0 truncate">{note}</p>
        <span className="text-xs text-indigo-600 dark:text-indigo-400 shrink-0">
          {open ? "Hide" : "Show"} list
        </span>
      </div>
    </div>
  );
}

const PHONE_ICON = (
  <svg className="w-6 h-6" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 004.168 6.608 17.6 17.6 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z" />
  </svg>
);

const MAIL_ICON = (
  <svg className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
  </svg>
);

/** Shared chrome for both expandable tables, so they read as one feature. */
function ListShell({ loading, error, empty, children, footer }) {
  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5">
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-8 flex flex-col items-center">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
        <p className="text-xs text-slate-400 dark:text-zinc-500">Loading…</p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
      {empty}
      {footer}
    </div>
  );
}

/**
 * Every call in the selected range.
 *
 * Rendered only while open, so the hook inside it does not poll for a list
 * nobody is looking at. Missed calls carry a red row: on this screen they are
 * the actionable ones, and colour is what makes them findable in a long list
 * without reading the status column.
 */
function CallListPanel({ token, dateFrom, dateTo, agentMap }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { calls, total, loading, error } = useCalls({ token, page, pageSize, dateFrom, dateTo });

  return (
    <ListShell
      loading={loading && calls.length === 0}
      error={error && `Could not load the call list: ${error}`}
      footer={total > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={total}
          onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    >
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="bg-slate-100 dark:bg-zinc-900/80 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
            {["Caller", "Receiver", "Time", "Duration", "Status"].map(h => (
              <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calls.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400 dark:text-zinc-500">
                No calls in this range
              </td>
            </tr>
          ) : (
            calls.map(call => {
              const missed = !call.agent_answer_time;
              return (
                <tr
                  key={call.id}
                  className={`border-t border-slate-100 dark:border-zinc-800/60 transition-colors ${
                    missed
                      ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50"
                      : "hover:bg-slate-50 dark:hover:bg-zinc-900/50"
                  }`}
                >
                  <td className={`px-3 py-2 tabular-nums font-medium ${
                    missed ? "text-red-700 dark:text-red-400" : "text-slate-700 dark:text-zinc-300"
                  }`}>
                    {call.caller_number || "—"}
                  </td>
                  {/* The agent who took it. A missed call was answered by
                      nobody, so the number that was dialled is all there is. */}
                  <td className="px-3 py-2 text-slate-600 dark:text-zinc-300 text-xs max-w-[160px] truncate">
                    {agentMap[call.agent_number] || call.agent_name ||
                      (missed ? call.called_number : call.agent_number) || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 text-xs whitespace-nowrap">
                    {fmtDate(call.call_start_time || call.created_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 tabular-nums text-xs">
                    {call.duration ? fmtDuration(call.duration) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                      missed
                        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    }`}>
                      {missed ? "Missed" : "Received"}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </ListShell>
  );
}

/**
 * Every correspondent in the selected range — the mail twin of the call list.
 *
 * One row per person rather than per message, because that is the unit the
 * mailbox is worked in. Unread rows are tinted amber, the same colour the tile
 * gives the Unread figure, so the highlight and the number it came from agree.
 */
function MailListPanel({ token, dateFrom, dateTo }) {
  const [state, setState] = useState({ rows: [], total: 0, loading: true, error: "" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const params = new URLSearchParams({ limit: "25", offset: "0" });
    if (dateFrom) params.append("dateFrom", `${dateFrom}T00:00`);
    if (dateTo) params.append("dateTo", `${dateTo}T23:59`);

    fetch(`${API}/api/emails/conversations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setState({ rows: data.conversations ?? [], total: data.total ?? 0, loading: false, error: "" });
      })
      .catch(err => {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: err.message }));
      });

    return () => { cancelled = true; };
  }, [token, dateFrom, dateTo]);

  return (
    <ListShell
      loading={state.loading}
      error={state.error && `Could not load the mail list: ${state.error}`}
      footer={state.total > state.rows.length && (
        <p className="px-3 py-2 text-xs text-slate-400 dark:text-zinc-500 border-t border-slate-100 dark:border-zinc-800/60">
          Showing {state.rows.length} of {state.total} senders
        </p>
      )}
    >
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="bg-slate-100 dark:bg-zinc-900/80 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
            {["Sender", "Latest Subject", "Last Activity", "Messages", "Status"].map(h => (
              <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400 dark:text-zinc-500">
                No mail in this range
              </td>
            </tr>
          ) : (
            state.rows.map(c => {
              const unread = (c.unread_count || 0) > 0;
              return (
                <tr
                  key={c.id}
                  className={`border-t border-slate-100 dark:border-zinc-800/60 transition-colors ${
                    unread
                      ? "bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50"
                      : "hover:bg-slate-50 dark:hover:bg-zinc-900/50"
                  }`}
                >
                  <td className={`px-3 py-2 max-w-[160px] truncate font-medium ${
                    unread ? "text-amber-800 dark:text-amber-300" : "text-slate-700 dark:text-zinc-300"
                  }`} title={c.participant_email}>
                    {c.participant_name || c.participant_email || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-zinc-300 text-xs max-w-[200px] truncate">
                    {c.last_subject || "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 text-xs whitespace-nowrap">
                    {fmtDate(c.last_message_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 tabular-nums text-xs">
                    {c.message_count ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${
                      unread
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    }`}>
                      {unread ? `${c.unread_count} unread` : "Read"}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </ListShell>
  );
}

export default function Dashboard({ onNavigate }) {
  const { token, isAdmin } = useAuth();
  // Lower bound only — no upper ceiling, so today's calls always count.
  const { minDate } = useDateRange(token);
  // Date range and the auto-sync switch come from the common header.
  const { dateFrom, dateTo } = usePageChrome();

  const effectiveFrom = dateFrom;
  const effectiveTo = dateTo;

  const { stats, refetch: refetchStats } = useStats(token, {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
  });
  const s = stats ?? {};

  // Mailbox counters for the same window the call stats use, so the two halves
  // of the Dashboard always describe the same slice of time.
  const [emailStats, setEmailStats] = useState(null);
  const loadEmailStats = useCallback(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (effectiveFrom) params.append("dateFrom", `${effectiveFrom}T00:00`);
    if (effectiveTo) params.append("dateTo", `${effectiveTo}T23:59`);
    fetch(`${API}/api/emails/stats/summary?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setEmailStats)
      .catch(() => {});
  }, [token, effectiveFrom, effectiveTo]);
  useEffect(loadEmailStats, [loadEmailStats]);
  const em = emailStats ?? {};

  // The call list is opened from the tile's icon and is closed by default: it
  // is the detail behind the four numbers, not a fourth panel competing with
  // them.
  const [showCallList, setShowCallList] = useState(false);
  const [showMailList, setShowMailList] = useState(false);

  /**
   * The two channels' category counts, added together.
   *
   * Calls and mail are categorised from ONE taxonomy, so "Payment & Fee" means
   * the same thing whichever way it arrived and the two counts add up. Each
   * endpoint sends its top slice plus a grand total; the slices merge for the
   * wedges and the totals add for the denominator, so the tail that neither
   * slice carries still shows up as "Other" rather than silently shrinking the
   * whole.
   */
  const mergedCategories = useMemo(() => {
    const byCategory = new Map();
    const add = (category, count) => {
      if (!category || !count) return;
      byCategory.set(category, (byCategory.get(category) ?? 0) + count);
    };

    // The call summary names the field `total`, the mail one `count`.
    for (const c of s.categoryBreakdown ?? []) add(c.category, c.total);
    for (const c of em.topCategories ?? []) add(c.category, c.count);

    const items = [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const listed = items.reduce((n, i) => n + i.count, 0);
    // Falls back to what is on screen when a server predates either total.
    const total = Math.max((s.categoryTotal ?? 0) + (em.categoryTotal ?? 0), listed);

    return { items, total };
  }, [s.categoryBreakdown, s.categoryTotal, em.topCategories, em.categoryTotal]);
  // Names for the Receiver column — the same lookup the Call Report uses, so a
  // verified agent reads the same on both screens.
  const agentMap = useAgentMap(token, isAdmin);

  // The header's auto-sync switch and refresh button drive the stats reload —
  // both halves of it, since one range governs both.
  const refreshAll = useCallback(() => {
    refetchStats();
    loadEmailStats();
  }, [refetchStats, loadEmailStats]);
  usePageRefresh(refreshAll, 5000);

  const [agentTickets, setAgentTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketStats, setTicketStats] = useState({
    Open: 0,
    "In Progress": 0,
    Resolved: 0,
    Closed: 0,
  });

  useEffect(() => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };

    if (!isAdmin) {
      fetch(`${API}/api/tickets?limit=50&offset=0&status=Open`, { headers })
        .then((r) => r.json())
        .then((data) => {
          setAgentTickets(data.tickets ?? []);
          setTicketsLoading(false);
        })
        .catch(() => {
          setTicketsLoading(false);
        });
    }

    // Fetch ticket counts by status for the donut
    const statuses = ["Open", "In Progress", "Resolved", "Closed"];
    Promise.all(
      statuses.map((s) =>
        fetch(
          `${API}/api/tickets?limit=1&offset=0&status=${encodeURIComponent(s)}`,
          { headers },
        )
          .then((r) => r.json())
          .then((d) => [s, d.total ?? 0]),
      ),
    )
      .then((results) => {
        setTicketStats(Object.fromEntries(results));
      })
      .catch(() => {
        /* network error */
      });
  }, [isAdmin, token]);


  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Dashboard"
        subtitle="Overview"
        minDate={minDate}
      />


      {/* Two halves: what came in by phone, and what came in by mail.
          Equal columns on purpose — the point of the split is that the two
          channels are read side by side, not one above the other. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 items-start">

        {/* ── Calls ─────────────────────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-zinc-500">
              Calls
            </p>
            {onNavigate && (
              <button
                onClick={() => onNavigate("call-report")}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View all →
              </button>
            )}
          </div>

          <StatTile
            tone="calls"
            icon={PHONE_ICON}
            open={showCallList}
            onToggle={() => setShowCallList(o => !o)}
            openLabel="Show the call list"
            closeLabel="Hide the call list"
            note={`${s.recorded ?? 0} with a recording`}
            stats={[
              { label: "Total",        value: s.total ?? "—",    color: "text-slate-900 dark:text-zinc-100" },
              { label: "Received",     value: s.received ?? "—", color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Missed",       value: s.missed ?? "—",   color: "text-red-500 dark:text-red-400" },
              { label: "Avg Duration", rawSeconds: s.avgDuration, color: "text-violet-600 dark:text-violet-400" },
            ]}
          />

          {/* Mounted only while open: the hook inside polls, and there is no
              sense polling for a list nobody has asked to see. */}
          {showCallList && (
            <CallListPanel
              token={token}
              dateFrom={effectiveFrom}
              dateTo={effectiveTo}
              agentMap={agentMap}
            />
          )}

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col max-h-[520px] overflow-hidden">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
                Call Categories
              </p>
              <span className="text-xs text-slate-400 dark:text-zinc-500">by call</span>
            </div>
            {/* `total` is the field name on the call stats endpoint, `count`
                on the mail one — one shape for one component. */}
            <CategoryBars
              items={(s.categoryBreakdown ?? []).map(c => ({ category: c.category, count: c.total }))}
              tone="calls"
            />
          </div>
        </div>

        {/* ── Mail ──────────────────────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 dark:text-zinc-500">
              Mail
            </p>
            {onNavigate && (
              <button
                onClick={() => onNavigate("emails")}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                View all →
              </button>
            )}
          </div>

          <StatTile
            tone="mail"
            icon={MAIL_ICON}
            open={showMailList}
            onToggle={() => setShowMailList(o => !o)}
            openLabel="Show the mail list"
            closeLabel="Hide the mail list"
            note={
              em.total > 0
                ? `${em.conversations ?? 0} sender${em.conversations === 1 ? "" : "s"}` +
                  (em.awaitingAnalysis > 0 ? ` · ${em.awaitingAnalysis} awaiting AI analysis` : "")
                : "No mail in this range"
            }
            stats={[
              { label: "Total",   value: em.total ?? "—",   color: "text-slate-900 dark:text-zinc-100" },
              { label: "Replies", value: em.replies ?? "—", color: "text-sky-600 dark:text-sky-400" },
              { label: "Unread",  value: em.unread ?? "—",  color: "text-amber-600 dark:text-amber-400" },
              { label: "Read",    value: em.read ?? "—",    color: "text-emerald-600 dark:text-emerald-400" },
            ]}
          />

          {showMailList && (
            <MailListPanel token={token} dateFrom={effectiveFrom} dateTo={effectiveTo} />
          )}

          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col max-h-[520px] overflow-hidden">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
                Email Categories
              </p>
              <span className="text-xs text-slate-400 dark:text-zinc-500">by sender</span>
            </div>
            <CategoryBars items={em.topCategories ?? []} tone="mail" />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div
        className={`grid grid-cols-1 gap-4 mb-6 ${isAdmin ? "lg:grid-cols-2" : "hidden"}`}
      >
        {/* Ticket Status donut — admin only */}
        {isAdmin && (
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 transition-colors">
            <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 mb-2">
              Ticket Status
            </p>
            <div className="flex items-center gap-4">
              <TicketDonut stats={ticketStats} />
              <div className="flex flex-col justify-center gap-2.5 min-[1544px]:grid min-[1544px]:grid-cols-2 min-[1544px]:gap-x-6 min-[1544px]:gap-y-3">
                {Object.entries(TICKET_COLORS).map(([status, c]) => {
                  const count = ticketStats[status] || 0;
                  return (
                    <div key={status} className="flex items-center gap-2">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${c.dot} shrink-0`}
                      />
                      <span className={`text-sm font-bold ${c.text}`}>
                        <AnimatedNumber value={count} duration={500} />
                      </span>
                      <span className="text-xs text-slate-500 dark:text-zinc-400">
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Beside the donut on purpose: both are circular, both are read as
            shares of one whole, and this row had a half standing empty.

            The bar list in each channel ranks its own categories; this answers
            what neither can — how the work divides across everything that came
            in, by phone and by mail together. They share one taxonomy, so the
            sum is meaningful. Admin-only, as this panel has always been. */}
        {isAdmin && (
          <AICategoryPie
            items={mergedCategories.items}
            total={mergedCategories.total}
            onNavigate={onNavigate}
          />
        )}
      </div>

      {/* Neither channel: bugs the AI found across the calls, or the agent's
          own ticket queue. It sits below the split rather than inside a half. */}
      <div className="space-y-4">
        {/* AI Insights & Bugs (admin) / My Tickets (agent) */}
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors flex flex-col max-h-[520px] overflow-hidden">
          {isAdmin ? (
            <>
              <div className="flex items-center justify-between mb-4 shrink-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
                  AI Insights
                </p>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate("ai-analysis")}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    View All →
                  </button>
                )}
              </div>
              <TopBugsList items={s.topBugs ?? []} />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4 shrink-0">
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">
                  Open Tickets
                </p>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate("tickets")}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    View all →
                  </button>
                )}
              </div>
              <AgentTicketsList
                tickets={agentTickets}
                loading={ticketsLoading}
              />
            </>
          )}
        </div>

      </div>
    </div>
  );
}


/** What the mailbox is about, counted per sender rather than per message. */
/**
 * What a channel is about, as a bar per category.
 *
 * Shared by both halves rather than written twice: the two lists answer the
 * same question of different traffic, and a reader comparing them should not
 * have to work out whether a difference in the drawing means a difference in
 * the data. The tone is the only thing that varies, matching each half's tile.
 */
const CATEGORY_TONES = {
  calls: { label: 'text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-400 dark:bg-indigo-500' },
  mail:  { label: 'text-teal-600 dark:text-teal-400',     bar: 'bg-teal-400 dark:bg-teal-500' },
};

function CategoryBars({ items, tone = 'mail', empty = 'Nothing analysed yet' }) {
  if (!items.length)
    return (
      <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center flex-1">
        {empty}
      </p>
    );
  const colors = CATEGORY_TONES[tone] ?? CATEGORY_TONES.mail;
  // Scaled against the largest, so the bars compare within a panel rather than
  // across two panels counting different things.
  const maxCount = items[0]?.count || 1;
  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      {items.map((item, i) => (
        <div
          key={item.category}
          className="flex items-center gap-3 animate-fade-in"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium truncate ${colors.label}`} title={item.category}>
                {item.category}
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 shrink-0 ml-2">
                <AnimatedNumber value={item.count} duration={400} />
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800">
              <div
                className={`h-full rounded-full animate-bar ${colors.bar}`}
                style={{
                  width: `${Math.round((item.count / maxCount) * 100)}%`,
                  animationDelay: `${i * 50 + 100}ms`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MailIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 5L3 9l5 4V10.5c4 0 6.5 1.5 8 4.5 0-5-2.5-8-8-8V5z" />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="15" height="11" rx="2" />
      <path d="M2.5 7l7.5 5 7.5-5" />
      <circle cx="16" cy="5" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ReadIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="5" width="15" height="11" rx="2" />
      <path d="M5.5 9.5l3 3 6-6" />
    </svg>
  );
}

function DurationBar({ label, value, color, max }) {
  const reference = max != null ? max : value;
  const pct =
    reference > 0 ? Math.min(100, Math.round((value / reference) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-slate-500 dark:text-zinc-400">
          {label}
        </span>
        <span className="text-xs font-medium text-slate-700 dark:text-zinc-300">
          {fmtDuration(value)}
        </span>
      </div>
      <div className="h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


function TopBugsList({ items }) {
  if (!items.length)
    return (
      <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center flex-1">
        No bugs reported yet
      </p>
    );
  const maxCount = items[0]?.count || 1;
  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      {items.map((item, i) => (
        <div
          key={item.category}
          className="flex items-center gap-3 animate-fade-in"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-red-600 dark:text-red-400 truncate">
                {item.category}
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-zinc-200 shrink-0 ml-2">
                <AnimatedNumber value={item.count} duration={400} />
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-red-400 dark:bg-red-500 animate-bar"
                style={{
                  width: `${Math.round((item.count / maxCount) * 100)}%`,
                  animationDelay: `${i * 50 + 100}ms`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── AI category mix ──────────────────────────────────────────────────────
   The slots below are the validated categorical palette — light step first,
   dark step second — written as whole class strings so Tailwind's scanner sees
   them. Their ORDER is the colour-blind-safety mechanism rather than a taste
   call: this sequence is the one that clears the adjacent-pair separation gates
   in both modes, including the wrap from the last wedge back to the first. So
   slots are handed out in order and never cycled. Past five categories the tail
   folds into `Other`, which is deliberately neutral: grey reads as a residual,
   where a sixth hue would read as one more identity. */
/* Softened to pastel for the beige portal — HUE HELD EXACTLY, chroma and
   lightness moved, so the ordering above still means what it says. The change
   was measured, not eyeballed (scripts/check-contrast.mjs re-runs it):

     adjacent ΔE   min 32.6 → 25.8   still far above confusable
     ΔE vs card    min 60.6 → 35.4   no wedge sinks into the beige

   The tightest pair is the same one it always was (the violet→blue wrap), so
   softening did not introduce a new constraint, it scaled the existing margin.
   Each wedge also carries its label, count and percentage in the legend beside
   it, which is the secondary encoding this palette's notes have always relied
   on. Re-measure before touching a hex. */
const AI_PIE_SLOTS = [
  { fill: 'fill-[#7ba0cd] dark:fill-[#7ba0cd]', dot: 'bg-[#7ba0cd] dark:bg-[#7ba0cd]' },
  { fill: 'fill-[#dca18a] dark:fill-[#dca18a]', dot: 'bg-[#dca18a] dark:bg-[#dca18a]' },
  { fill: 'fill-[#4fc299] dark:fill-[#4fc299]', dot: 'bg-[#4fc299] dark:bg-[#4fc299]' },
  { fill: 'fill-[#ddb258] dark:fill-[#ddb258]', dot: 'bg-[#ddb258] dark:bg-[#ddb258]' },
  { fill: 'fill-[#7c72b6] dark:fill-[#7c72b6]', dot: 'bg-[#7c72b6] dark:bg-[#7c72b6]' },
];
const AI_PIE_OTHER = { fill: 'fill-[#a8a8a5]', dot: 'bg-[#a8a8a5]' };

/** A wedge from `from` to `to`, in radians clockwise from twelve o'clock. */
function wedgePath(cx, cy, r, from, to) {
  const point = a => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(3)} ${y1.toFixed(3)} `
       + `A ${r} ${r} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
}

/** One decimal below 10%, whole numbers above — a pie is read at a glance. */
function fmtPct(n) {
  return `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`;
}

/**
 * How the categories divide the whole, as a share each — calls and mail
 * together, since both are drawn from one taxonomy.
 *
 * The bar list in each half ranks its own channel; this answers the other half of the
 * question — whether the leader is most of the traffic or merely first among
 * many. `total` is every categorised issue, not just the ten the list carries,
 * so the shares are shares of something a reader would recognise as the whole
 * rather than of an arbitrary top slice.
 *
 * One row per (call, tag): a call raising two issues counts in both, so the
 * whole here is the number of ISSUES, not of calls.
 */
function AICategoryPie({ items, total, onNavigate }) {
  const [active, setActive] = useState(null);

  const listed = items.reduce((n, i) => n + i.count, 0);
  // Older servers do not send the grand total; what is on screen is then the
  // best whole available, and it is at least self-consistent.
  const denom = Math.max(total ?? 0, listed);

  const top = items.slice(0, AI_PIE_SLOTS.length);
  const rest = denom - top.reduce((n, i) => n + i.count, 0);
  const slices = [
    ...top.map((it, i) => ({ ...it, ...AI_PIE_SLOTS[i] })),
    ...(rest > 0 ? [{ category: 'Other', count: rest, ...AI_PIE_OTHER }] : []),
  ];

  let angle = 0;
  const wedges = slices.map(sl => {
    const from = angle;
    angle += (sl.count / denom) * 2 * Math.PI;
    return { ...sl, from, to: angle, pct: (sl.count / denom) * 100 };
  });

  const shown = active === null ? null : wedges[active];

  return (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 transition-colors">
      <div className="flex items-center justify-between gap-3 mb-4">
        <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200 shrink-0">
          Category Mix
        </p>
        <span className="text-xs text-slate-400 dark:text-zinc-500 truncate">
          {shown
            ? `${shown.category} · ${shown.count} of ${denom}`
            : `${denom} categorised issue${denom === 1 ? '' : 's'}`}
        </span>
        {onNavigate && (
          <button
            onClick={() => onNavigate('ai-analysis')}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
          >
            View All →
          </button>
        )}
      </div>

      {!denom || !wedges.length ? (
        <p className="text-sm text-slate-400 dark:text-zinc-500 py-8 text-center">
          No categories identified yet
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <svg
            viewBox="0 0 200 200"
            className="w-40 h-40 sm:w-44 sm:h-44 shrink-0"
            role="img"
            aria-label={`Share of AI-identified categories: ${wedges
              .map(w => `${w.category} ${fmtPct(w.pct)}`)
              .join(', ')}`}
          >
            {/* A lone category is a full turn, and a full-turn arc has the same
                start and end point — it would draw nothing. */}
            {wedges.length === 1 ? (
              <circle
                cx="100"
                cy="100"
                r="88"
                strokeWidth="2"
                className={`${wedges[0].fill} stroke-white dark:stroke-zinc-900`}
              />
            ) : (
              wedges.map((w, i) => (
                <path
                  key={w.category}
                  d={wedgePath(100, 100, 88, w.from, w.to)}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  opacity={active === null || active === i ? 1 : 0.3}
                  className={`${w.fill} stroke-white dark:stroke-zinc-900 transition-opacity duration-150`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                >
                  <title>{`${w.category} — ${w.count} (${fmtPct(w.pct)})`}</title>
                </path>
              ))
            )}
          </svg>

          {/* Three of the fills sit under 3:1 against the beige card ground, so
              the shares are spelled out here rather than left to the wedge
              alone. Width-capped: stretched across a full-width card the counts
              drift so far from the names they stop reading as one row. */}
          <ul className="min-w-0 w-full sm:max-w-md space-y-1">
            {wedges.map((w, i) => (
              <li
                key={w.category}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                  active === i ? 'bg-slate-50 dark:bg-zinc-800/60' : ''
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${w.dot}`} />
                <span
                  className="flex-1 min-w-0 truncate text-xs font-medium text-slate-600 dark:text-zinc-300"
                  title={w.category}
                >
                  {w.category}
                </span>
                <span className="text-xs text-slate-400 dark:text-zinc-500 shrink-0 tabular-nums">
                  {w.count}
                </span>
                <span className="w-12 text-right text-xs font-bold text-slate-700 dark:text-zinc-200 shrink-0 tabular-nums">
                  {fmtPct(w.pct)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const PRIORITY_COLOR = {
  High: "text-red-600 dark:text-red-400",
  Medium: "text-amber-600 dark:text-amber-400",
  Low: "text-slate-500 dark:text-zinc-400",
};

function AgentTicketsList({ tickets, loading }) {
  if (loading)
    return (
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
        <p className="text-xs text-slate-400 dark:text-zinc-500">Loading…</p>
      </div>
    );
  if (!tickets.length)
    return (
      <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center">
        No open tickets
      </p>
    );
  return (
    <div className="flex-1 overflow-y-auto space-y-2">
      {tickets.map((t) => (
        <div
          key={t._id}
          className="flex items-start justify-between gap-3 pb-2 border-b border-slate-50 dark:border-zinc-800/50 last:border-0"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-700 dark:text-zinc-200 truncate">
              {t.title}
            </p>
            {t.customer_number && (
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 tabular-nums">
                {t.customer_number}
              </p>
            )}
          </div>
          <span
            className={`text-xs font-medium shrink-0 ${PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.Low}`}
          >
            {t.priority ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3.5A1.5 1.5 0 013.5 2h.879a1 1 0 01.958.713l.66 2.2a1 1 0 01-.23 1.002L4.5 6.5s1 2 5 5l1.085-1.267a1 1 0 011.003-.23l2.2.66A1 1 0 0114 11.62V12.5A1.5 1.5 0 0112.5 14C6.7 14 2 9.3 2 3.5z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 4L6 11 3 8" />
    </svg>
  );
}
function MissedIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l10 10M13 4L6 11 3 8" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}
