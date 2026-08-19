import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import * as XLSX from "xlsx";
import Pagination from "../components/Pagination";
import PageHeader from "../components/PageHeader";
import { usePageRefresh } from "../contexts/PageChromeContext";

const API = import.meta.env.VITE_API_URL ?? "";

function useAgents(token) {
  const [agents, setAgents] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [unverified, setUnverified] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
    try {
      const [agentsRes, metricsRes, unverifiedRes] = await Promise.all([
        fetch(`${API}/api/agents`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/agents/metrics`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/agents/unverified`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const agentsData = await agentsRes.json();
      const metricsData = await metricsRes.json();
      const unverifiedData = await unverifiedRes.json();
      if (!agentsRes.ok) {
        setError(agentsData.error || `Error ${agentsRes.status}`);
        return;
      }
      setAgents(agentsData.agents || []);
      setMetrics(metricsData.metrics || {});
      setUnverified(unverifiedData.unverified || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, metrics, unverified, loading, error, refetch: fetchAgents };
}

function fmt(sec) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtTotal(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const PAGE_SIZES = [10, 25, 50, 100];

export default function Agents() {
  const { token } = useAuth();
  const { agents, metrics, unverified, loading, error, refetch } =
    useAgents(token);

  // A roster changes rarely, so this polls far slower than the call pages.
  usePageRefresh(refetch, 30000);

  const [exporting, setExporting] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [modal, setModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState(null); // 'received' | 'totalDuration' | 'avgDuration' | 'avgScore' | 'resolvedPct'
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  function handleExport() {
    setExporting(true);
    try {
      const rows = sorted.map((a) => {
        const m = metrics[a.agent_number] ?? {};
        return {
          "Agent Name": a.name,
          "Agent Number": a.agent_number,
          "Calls Received": m.received ?? "",
          "Total Duration (s)": m.totalDuration ?? "",
          "Avg Duration (s)": m.avgDuration ?? "",
          "Avg Score": m.avgScore ?? "",
          "Resolved %": m.resolvedPct != null ? `${m.resolvedPct}%` : "",
          "Created At": a.created_at
            ? new Date(a.created_at).toLocaleString("en-IN")
            : "",
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Agents");
      XLSX.writeFile(
        wb,
        `agents_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (e) {
      console.error("Export failed", e);
    } finally {
      setExporting(false);
    }
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  }

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.agent_number.includes(search),
  );

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = metrics[a.agent_number]?.[sortKey] ?? -1;
        const bv = metrics[b.agent_number]?.[sortKey] ?? -1;
        return sortDir === "desc" ? bv - av : av - bv;
      })
    : filtered;

  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  function SortIcon({ col }) {
    if (sortKey !== col)
      return (
        <svg
          className="w-3 h-3 opacity-30"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 3l3 4H5l3-4zm0 10l-3-4h6l-3 4z" />
        </svg>
      );
    return sortDir === "desc" ? (
      <svg
        className="w-3 h-3 text-indigo-500"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M8 11l-4-5h8l-4 5z" />
      </svg>
    ) : (
      <svg
        className="w-3 h-3 text-indigo-500"
        viewBox="0 0 16 16"
        fill="currentColor"
      >
        <path d="M8 5l4 5H4l4-5z" />
      </svg>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* An agent roster has no date axis, so the filters are hidden — but the
          auto-sync switch and refresh button still belong here. */}
      <PageHeader
        title="Agents"
        showFilters={false}
        subtitle={
          <>
            {agents.length} registered
            {unverified.length > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {unverified.length} unverified
              </span>
            )}
          </>
        }
      />

      {/* Search + Actions row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or number…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={handleExport}
            disabled={exporting || agents.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 10V2M5 5l3-3 3 3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
            </svg>
            {exporting ? "Exporting…" : "Export"}
          </button>
          <button
            onClick={() => setShowBulk(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-sm font-medium transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
            </svg>
            Bulk Upload
          </button>
          <button
            onClick={() => setModal({ mode: "create" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Agent
          </button>
        </div>
      </div>

      {/* Table */}
      {error ? (
        <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">Loading agents...</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM6 8a2 2 0 11-4 0 2 2 0 014 0zM10 13a4 4 0 014 4v1H6v-1a4 4 0 014-4z" />
          </svg>
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-xs mt-1">
            Click "Add Agent" to create the first one.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Agent Name</th>
                <th className="px-4 py-3 font-semibold">Agent Number</th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                  onClick={() => toggleSort("received")}
                >
                  <span className="flex items-center gap-1">
                    Calls Received <SortIcon col="received" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                  onClick={() => toggleSort("avgDuration")}
                >
                  <span className="flex items-center gap-1">
                    Avg Duration <SortIcon col="avgDuration" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                  onClick={() => toggleSort("totalDuration")}
                >
                  <span className="flex items-center gap-1">
                    Total Duration <SortIcon col="totalDuration" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                  onClick={() => toggleSort("avgScore")}
                >
                  <span className="flex items-center gap-1">
                    Avg Score <SortIcon col="avgScore" />
                  </span>
                </th>
                <th
                  className="px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors"
                  onClick={() => toggleSort("resolvedPct")}
                >
                  <span className="flex items-center gap-1">
                    Resolved % <SortIcon col="resolvedPct" />
                  </span>
                </th>
                <th className="px-4 py-3 font-semibold">Tickets</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Password</th>
                <th className="px-4 py-3 font-semibold w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((agent) => (
                <tr
                  key={agent.id}
                  className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-900 dark:text-zinc-100 font-medium">
                        {agent.name}
                      </span>
                      <svg
                        title="Verified"
                        className="w-3.5 h-3.5 text-indigo-500 shrink-0"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 tabular-nums">
                    {agent.agent_number}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {metrics[agent.agent_number]?.received ? (
                      <span className="font-medium text-slate-700 dark:text-zinc-200">
                        {metrics[agent.agent_number].received}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-zinc-500">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 tabular-nums">
                    {fmt(metrics[agent.agent_number]?.avgDuration)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-zinc-300 tabular-nums">
                    {fmtTotal(metrics[agent.agent_number]?.totalDuration)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {(() => {
                      const s = metrics[agent.agent_number]?.avgScore;
                      if (s === null || s === undefined)
                        return (
                          <span className="text-slate-400 dark:text-zinc-500">
                            —
                          </span>
                        );
                      const color =
                        s >= 8
                          ? "text-emerald-600 dark:text-emerald-400"
                          : s >= 5
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400";
                      return (
                        <span className={`font-bold ${color}`}>
                          {s}
                          <span className="text-xs font-normal text-slate-400 dark:text-zinc-500">
                            /10
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {(() => {
                      const p = metrics[agent.agent_number]?.resolvedPct;
                      if (p === null || p === undefined)
                        return (
                          <span className="text-slate-400 dark:text-zinc-500">
                            —
                          </span>
                        );
                      const color =
                        p >= 70
                          ? "text-emerald-600 dark:text-emerald-400"
                          : p >= 40
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-red-600 dark:text-red-400";
                      return (
                        <span className={`font-bold ${color}`}>
                          {p}
                          <span className="text-xs font-normal text-slate-400 dark:text-zinc-500">
                            %
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const t = metrics[agent.agent_number]?.tickets;
                      if (!t || t.total === 0) return <span className="text-slate-400 dark:text-zinc-500">—</span>;
                      return (
                        <div className="flex items-center gap-1.5 text-xs">
                          {t.open > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">{t.open} Open</span>}
                          {t.inProg > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400 font-medium">{t.inProg} In Prog</span>}
                          {t.resolved > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">{t.resolved} Done</span>}
                          {t.closed > 0 && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 font-medium">{t.closed} Closed</span>}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 text-xs">
                    {agent.created_at
                      ? new Date(agent.created_at).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {agent.must_change_password ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Default
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Custom
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {/* Edit */}
                      <button
                        onClick={() => setModal({ mode: "edit", agent })}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        title="Edit"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 2l3 3-8 8H3v-3L11 2z" />
                        </svg>
                      </button>
                      {/* Reset Password */}
                      <button
                        onClick={() => setResetTarget(agent)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                        title="Reset Password"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="7" width="10" height="8" rx="1.5" />
                          <path d="M5 7V5a3 3 0 016 0v2" />
                          <circle cx="8" cy="11" r="1" />
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => setDeleteTarget(agent)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        title="Delete"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!error && !loading && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Unverified Agents Section */}
      {unverified.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-base font-semibold text-slate-800 dark:text-zinc-200">
              Unverified Agents
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {unverified.length}
            </span>
            <p className="text-xs text-slate-500 dark:text-zinc-500">
              Found in call records but not registered — click Verify to grant
              dashboard access.
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-left text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold">Agent Name</th>
                  <th className="px-4 py-3 font-semibold">Agent Number</th>
                  <th className="px-4 py-3 font-semibold">Calls Found</th>
                  <th className="px-4 py-3 font-semibold w-28"></th>
                </tr>
              </thead>
              <tbody>
                {unverified.map((a) => (
                  <tr
                    key={a.agent_number}
                    className="border-t border-amber-100 dark:border-amber-900/30 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-700 dark:text-zinc-300 font-medium">
                      {a.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 tabular-nums">
                      {a.agent_number}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 tabular-nums">
                      {a.calls}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setVerifyTarget(a)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                      >
                        Verify
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk Upload modal */}
      {showBulk && (
        <BulkUploadModal
          token={token}
          onClose={() => setShowBulk(false)}
          onSuccess={() => {
            setShowBulk(false);
            refetch();
          }}
        />
      )}

      {/* Create / Edit modal */}
      {modal && (
        <AgentModal
          mode={modal.mode}
          agent={modal.agent}
          token={token}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
            refetch();
          }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteConfirm
          agent={deleteTarget}
          token={token}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null);
            refetch();
          }}
        />
      )}

      {/* Reset password confirm */}
      {resetTarget && (
        <ResetPasswordConfirm
          agent={resetTarget}
          token={token}
          onClose={() => setResetTarget(null)}
          onSuccess={() => {
            setResetTarget(null);
            refetch();
          }}
        />
      )}

      {/* Verify confirm */}
      {verifyTarget && (
        <VerifyConfirm
          agent={verifyTarget}
          token={token}
          onClose={() => setVerifyTarget(null)}
          onSuccess={() => {
            setVerifyTarget(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

// ── Agent Create / Edit Modal ─────────────────────────────────────────────────

function AgentModal({ mode, agent, token, onClose, onSuccess }) {
  const [name, setName] = useState(agent?.name ?? "");
  const [agent_number, setAgentNumber] = useState(agent?.agent_number ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const url =
        mode === "create"
          ? `${API}/api/agents`
          : `${API}/api/agents/${agent.id}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, agent_number }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Request failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            {mode === "create" ? "Add Agent" : "Edit Agent"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {mode === "create" && (
          <div className="mb-4 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Default password will be the agent's number. They will be prompted
              to set a new password on first login.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1.5">
              Agent Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              required
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1.5">
              Agent Number *
            </label>
            <input
              type="text"
              value={agent_number}
              onChange={(e) => setAgentNumber(e.target.value)}
              placeholder="e.g. 9876543210"
              required
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading
                ? "Saving…"
                : mode === "create"
                  ? "Create Agent"
                  : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ agent, token, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/agents/${agent.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Delete failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mb-2">
          Delete Agent
        </h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
          Are you sure you want to delete{" "}
          <span className="font-medium text-slate-700 dark:text-zinc-200">
            {agent.name}
          </span>{" "}
          ({agent.agent_number})? This cannot be undone.
        </p>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk Upload Modal ─────────────────────────────────────────────────────────

function BulkUploadModal({ token, onClose, onSuccess }) {
  const fileRef = useRef();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" });
        const parsed = data
          .map((r) => {
            const norm = Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k.toLowerCase().replace(/\s+/g, "_"),
                String(v).trim(),
              ]),
            );
            return {
              name: norm.name || norm.agent_name || "",
              agent_number:
                norm.agent_number ||
                norm.number ||
                norm.phone ||
                norm.mobile ||
                "",
            };
          })
          .filter((r) => r.name || r.agent_number);
        setRows(parsed);
      } catch {
        setError("Failed to parse file. Make sure it is a valid .xlsx file.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleUpload() {
    if (!rows.length) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/agents/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agents: rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "agent_number"],
      ["Rahul Sharma", "9876543210"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agents");
    XLSX.writeFile(wb, "agents-template.xlsx");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            Bulk Upload Agents
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-lg border border-slate-200 dark:border-zinc-700">
            <div>
              <p className="text-xs font-medium text-slate-700 dark:text-zinc-300">
                Required columns: <span className="font-mono">name</span>,{" "}
                <span className="font-mono">agent_number</span>
              </p>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                Default password will be each agent's number
              </p>
            </div>
            <button
              onClick={downloadTemplate}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors shrink-0 ml-3"
            >
              Template
            </button>
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 dark:border-zinc-700 rounded-xl cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors"
          >
            <svg
              className="w-8 h-8 text-slate-300 dark:text-zinc-600"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1M8 2v8M5 7l3-3 3 3" />
            </svg>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Click to select{" "}
              <span className="font-medium text-indigo-600 dark:text-indigo-400">
                .xlsx
              </span>{" "}
              file
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          {rows.length > 0 && !result && (
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mb-2">
                {rows.length} agent{rows.length !== 1 ? "s" : ""} found —
                preview
              </p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-zinc-700">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Agent Number
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        className="border-t border-slate-100 dark:border-zinc-800"
                      >
                        <td
                          className={`px-3 py-1.5 ${!r.name ? "text-red-500" : "text-slate-700 dark:text-zinc-300"}`}
                        >
                          {r.name || "⚠ missing"}
                        </td>
                        <td
                          className={`px-3 py-1.5 tabular-nums ${!r.agent_number ? "text-red-500" : "text-slate-700 dark:text-zinc-300"}`}
                        >
                          {r.agent_number || "⚠ missing"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-1.5">
              <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                <span className="text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
                  {result.added.length} agent
                  {result.added.length !== 1 ? "s" : ""} added
                </span>
              </div>
              {result.skipped.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                    {result.skipped.length} skipped (already exist)
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    {result.skipped.join(", ")}
                  </p>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {result.errors.length} row
                    {result.errors.length !== 1 ? "s" : ""} had errors (missing
                    name or number)
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 flex gap-3">
          <button
            onClick={result ? onSuccess : onClose}
            className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-sm"
          >
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={handleUpload}
              disabled={loading || rows.length === 0}
              className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {loading
                ? "Uploading…"
                : `Upload ${rows.length > 0 ? rows.length + " Agents" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
// ── Verify Confirm ────────────────────────────────────────────────────────────

function VerifyConfirm({ agent, token, onClose, onSuccess }) {
  const [name, setName] = useState(agent.name || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          agent_number: agent.agent_number,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to verify agent");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <svg
            className="w-5 h-5 text-indigo-500"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.28 5.78a.75.75 0 00-1.06-1.06L7 8.94 5.78 7.72a.75.75 0 00-1.06 1.06l1.75 1.75a.75.75 0 001.06 0l3.75-3.75z"
              clipRule="evenodd"
            />
          </svg>
          <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100">
            Verify Agent
          </h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
          This will register{" "}
          <span className="font-mono font-medium text-slate-700 dark:text-zinc-200">
            {agent.agent_number}
          </span>{" "}
          and allow them to log in. Default password will be their number.
        </p>
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-500 dark:text-zinc-400 mb-1.5">
            Agent Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {error && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-3">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleVerify}
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Verifying…" : "Verify & Register"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Confirm ────────────────────────────────────────────────────

function ResetPasswordConfirm({ agent, token, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/agents/${agent.id}/reset-password`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Reset failed");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mb-2">
          Reset Password
        </h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">
          Reset password for{" "}
          <span className="font-medium text-slate-700 dark:text-zinc-200">
            {agent.name}
          </span>
          ? Their password will be reset to their agent number{" "}
          <span className="font-mono font-medium text-slate-700 dark:text-zinc-200">
            {agent.agent_number}
          </span>{" "}
          and they will be required to set a new one on next login.
        </p>
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            disabled={loading}
            className="flex-1 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Resetting…" : "Reset Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
