import { useState, useEffect, useLayoutEffect, useRef } from "react";
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

function StatusTabs({ status, onStatus }) {
  const sliderRef = useRef(null);
  const tabRefs = useRef({});
  const activeTab =
    STATUS_TABS.find((t) => t.value === status) || STATUS_TABS[0];
  const isDark = document.documentElement.classList.contains("dark");

  useLayoutEffect(() => {
    const el = tabRefs.current[status];
    const slider = sliderRef.current;
    if (el && slider) {
      slider.style.transform = `translateX(${el.offsetLeft}px)`;
      slider.style.width = `${el.offsetWidth}px`;
      slider.style.backgroundColor = activeTab.bg[isDark ? 1 : 0];
    }
  }, [status, activeTab, isDark]);

  return (
    <div className="relative flex gap-1 bg-slate-100 dark:bg-zinc-800/60 rounded-lg p-1">
      <div
        ref={sliderRef}
        className="absolute top-1 bottom-1 left-0 rounded-md shadow-sm will-change-transform"
        style={{
          transition:
            "transform 300ms cubic-bezier(0.4,0,0.2,1), width 300ms cubic-bezier(0.4,0,0.2,1), background-color 300ms cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.value}
          ref={(el) => {
            tabRefs.current[tab.value] = el;
          }}
          onClick={() => onStatus(tab.value)}
          className={`relative z-10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-300 whitespace-nowrap ${
            status === tab.value
              ? tab.text
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function CallReport() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [agentNumber, setAgentNumber] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [ticketCall, setTicketCall] = useState(null);
  const [showDial, setShowDial] = useState(false);
  const [agents, setAgents] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const { token, isAdmin, user } = useAuth();
  const { minDate, maxDate } = useDateRange(token);
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

  // effectiveFrom uses the oldest call date as default lower bound.
  // effectiveTo is intentionally left empty when no user filter is set so that
  // new webhook arrivals are never hidden by a stale upper-date ceiling.
  const effectiveFrom = dateFrom || minDate;
  const effectiveTo = dateTo || maxDate;
  const isFiltered = !!(dateFrom || dateTo || search || status || agentNumber);

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
  function handleDateFrom(e) {
    const val = e.target.value;
    setDateFrom(val);
    if (effectiveTo && val > effectiveTo) setDateTo(val);
    setPage(1);
  }
  function handleDateTo(e) {
    const val = e.target.value;
    setDateTo(val);
    if (effectiveFrom && val < effectiveFrom) setDateFrom(val);
    setPage(1);
  }
  function clearDates() {
    setDateFrom("");
    setDateTo("");
    setAgentNumber("");
    setPage(1);
  }

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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Call Report
          </h1>
          <p className="text-sm text-slate-500 dark:text-zinc-500 mt-0.5">
            {total} {isFiltered ? "filtered" : "total"} records · auto-refreshes
            every 5s
          </p>
        </div>
        <div className="flex gap-2 self-start">
          <button
            onClick={refetch}
            title="Refresh"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3" />
              <path d="M13.5 2v3h-3" />
            </svg>
          </button>
          <button
            onClick={() => setShowDial(true)}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            Initiate Call
          </button>
        </div>
      </div>

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
        <StatusTabs status={status} onStatus={handleStatus} />
        <svg
          className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0 hidden sm:block"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M5 1v4M11 1v4M2 7h12" />
        </svg>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">
            From
          </label>
          <input
            type="date"
            value={effectiveFrom}
            max={effectiveTo}
            onChange={handleDateFrom}
            className="px-1.5 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-slate-400 dark:text-zinc-500 shrink-0">
            To
          </label>
          <input
            type="date"
            value={effectiveTo}
            min={effectiveFrom}
            onChange={handleDateTo}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {isFiltered && (
          <button
            onClick={clearDates}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
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
