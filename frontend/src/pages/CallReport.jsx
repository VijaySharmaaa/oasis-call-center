import { useState, useEffect, useCallback } from "react";
import {
  useCalls,
  useDateRange,
  useAgentMap,
  useStationMap,
} from "../hooks/useCalls";
import { useExportJob } from "../hooks/useExportJob";
import { useAuth } from "../contexts/AuthContext";
import CallsTable from "../components/CallsTable";
import CallTicketModal from "../components/CallTicketModal";
import InitiateCallModal from "../components/InitiateCallModal";
import Pagination from "../components/Pagination";
import ExportButton from "../components/ExportButton";
import PageHeader from "../components/PageHeader";
import StatusTabs from "../components/StatusTabs";
import { usePageChrome, usePageRefresh } from "../contexts/PageChromeContext";

const API = import.meta.env.VITE_API_URL ?? "";

const STATUS_TABS = [
  {
    value: "",
    label: "All",
    bg: ["#ffffff", "#3f3f46"],
    text: "text-slate-900 dark:text-zinc-100",
  },
  {
    value: "received",
    label: "Received",
    bg: ["#d1fae5", "rgba(6,78,59,0.4)"],
    text: "text-emerald-700 dark:text-emerald-400",
  },
  {
    value: "missed",
    label: "Missed",
    bg: ["#fee2e2", "rgba(127,29,29,0.4)"],
    text: "text-red-700 dark:text-red-400",
  },
];

export default function CallReport() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [agentNumber, setAgentNumber] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [ticketCall, setTicketCall] = useState(null);
  const [showDial, setShowDial] = useState(false);
  const [agents, setAgents] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const { token, isAdmin, user } = useAuth();
  // Only the lower bound comes from the data; there is deliberately no upper
  // ceiling, so calls arriving right now stay visible.
  const { minDate } = useDateRange(token);
  const agentMap = useAgentMap(token, isAdmin);
  const stationMap = useStationMap(token);

  // Fetch agent list for admin dropdown
  useEffect(() => {
    if (!isAdmin || !token) return;
    fetch(`${API}/api/agents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [isAdmin, token]);

  // How much of the AI queue is outstanding, headlined the same way the Emails
  // tab headlines it. Refreshed with the list, since pressing "Analyse now" on
  // a row is exactly what changes this number.
  const [aiStats, setAiStats] = useState(null);
  const loadAiStats = useCallback(() => {
    if (!token) return;
    fetch(`${API}/api/calls/analysis/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setAiStats)
      .catch(() => {});
  }, [token]);
  useEffect(loadAiStats, [loadAiStats]);

  // The date range now comes from the common header. Empty means unbounded —
  // which is also what keeps new webhook arrivals visible, since there is no
  // stale upper-date ceiling to hide them behind.
  const { dateFrom, dateTo } = usePageChrome();
  const effectiveFrom = dateFrom;
  const effectiveTo = dateTo;
  const isFiltered = !!(dateFrom || dateTo || search || status || agentNumber);

  // Narrowing the range while on a later page would strand the operator on an
  // empty page of a now-shorter list.
  useEffect(() => { setPage(1); }, [dateFrom, dateTo]);

  const { calls, total, loading, error, refetch } = useCalls({
    search,
    status,
    page,
    pageSize,
    token,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    agentNumber,
    sortBy,
    sortDir,
  });
  function handleSearch(e) {
    setSearch(e.target.value);
    setPage(1);
  }
  function handleStatus(val) {
    setStatus(val);
    setPage(1);
  }
  // Dates are the header's job now; only the agent filter is left to clear.
  function clearAgent() {
    setAgentNumber("");
    setPage(1);
  }

  // The header's switch and refresh button drive this page's refetch. The
  // queue headline rides along with it, because a row that finishes analysing
  // is one fewer outstanding job.
  const refreshAll = useCallback(() => { refetch(); loadAiStats(); }, [refetch, loadAiStats]);
  usePageRefresh(refreshAll, 5000);

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  }

  const {
    runExport,
    exporting,
    label: exportLabel,
  } = useExportJob({
    jobsEndpoint: "/api/calls/export/jobs",
    token,
    fallbackName: `call-report-${effectiveFrom || "all"}-to-${effectiveTo || "all"}.csv`,
  });

  function handleExport() {
    const payload = {};
    if (search) payload.search = search;
    if (status) payload.status = status;
    if (effectiveFrom) payload.dateFrom = `${effectiveFrom}T00:00`;
    if (effectiveTo) payload.dateTo = `${effectiveTo}T23:59`;
    if (agentNumber) payload.agentNumber = agentNumber;
    runExport(payload);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {ticketCall && (
        <CallTicketModal
          call={ticketCall}
          onClose={() => setTicketCall(null)}
        />
      )}
      {showDial && (
        <InitiateCallModal
          onClose={() => setShowDial(false)}
          onSuccess={refetch}
          defaultAgentNumber={!isAdmin ? user?.agent_number : ""}
        />
      )}
      <PageHeader
        title="Call Report"
        subtitle={
          <>
            {total} {isFiltered ? "filtered" : "total"} records
            {/* Counted over the queue, so it is what the worker still owes —
                not a count of rows in view. */}
            {aiStats?.coverage?.remaining > 0 && (
              <>
                {" · "}
                <span className="text-amber-600 dark:text-amber-400">
                  {aiStats.coverage.remaining} awaiting AI analysis
                </span>
              </>
            )}
            {aiStats?.queue?.failed > 0 && (
              <>
                {" · "}
                <span className="text-red-600 dark:text-red-400">
                  {aiStats.queue.failed} analysis failed
                </span>
              </>
            )}
          </>
        }
        minDate={minDate}
      >
        <button
          onClick={() => setShowDial(true)}
          className="px-4 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
        >
          Initiate Call
        </button>
      </PageHeader>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10.5 10.5l3 3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={handleSearch}
            placeholder="Search caller, called, agent…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isAdmin && agents.length > 0 && (
          <select
            value={agentNumber}
            onChange={(e) => {
              setAgentNumber(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">All Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.agent_number}>
                {a.name} ({a.agent_number})
              </option>
            ))}
          </select>
        )}
        <StatusTabs tabs={STATUS_TABS} value={status} onChange={handleStatus} />
        {agentNumber && (
          <button
            onClick={clearAgent}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Clear agent
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
      {error ? (
        <div className="text-center py-16 text-red-500 dark:text-red-400">
          <p className="text-lg font-medium">Failed to connect to backend</p>
          <p className="text-sm mt-1 text-slate-500 dark:text-zinc-500">
            {error}
          </p>
        </div>
      ) : loading && calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">
            Loading calls...
          </p>
        </div>
      ) : (
        <CallsTable
          key={`${search}|${status}|${page}|${dateFrom}|${dateTo}|${agentNumber}`}
          calls={calls}
          hasFilters={!!(search || status)}
          isAgent={!isAdmin}
          agentNumber={user?.agent_number}
          agentMap={agentMap}
          stationMap={stationMap}
          token={token}
          onCreateTicket={(call) => setTicketCall(call)}
          onAnalysisQueued={refreshAll}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={toggleSort}
        />
      )}

      {/* Pagination */}
      {!error && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
