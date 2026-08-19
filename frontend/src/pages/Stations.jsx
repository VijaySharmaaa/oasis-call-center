import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import * as XLSX from "xlsx";
import PageHeader from "../components/PageHeader";
import { usePageRefresh } from "../contexts/PageChromeContext";

const API = import.meta.env.VITE_API_URL ?? "";

export default function Stations() {
  const { token } = useAuth();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [assignModal, setAssignModal] = useState(null); // null | { stationId }
  const [confirmClear, setConfirmClear] = useState(false);
  const [search, setSearch] = useState("");
  const [todayDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const [dateFilter, setDateFilter] = useState(todayDate);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setStations(data.stations ?? []);
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Rosters change rarely, so this polls far slower than the call pages.
  usePageRefresh(load, 30000);

  const filtered = stations.filter((s) => {
    if (dateFilter && s.date !== dateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const agents = s.agents || [];
      const match =
        s.station_name.toLowerCase().includes(q) ||
        s.station_number.includes(q) ||
        agents.some(
          (a) => a.name.toLowerCase().includes(q) || a.mobile.includes(q),
        );
      if (!match) return false;
    }
    return true;
  });

  async function handleDelete(id) {
    if (!confirm("Delete this station?")) return;
    await fetch(`${API}/api/stations/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  async function handleUnassign(stationId, mobile) {
    await fetch(`${API}/api/stations/${stationId}/unassign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mobile }),
    });
    load();
  }

  async function handleClearAll() {
    await fetch(`${API}/api/stations/clear-agents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setConfirmClear(false);
    load();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {bulkModal && (
        <BulkUploadModal
          token={token}
          onClose={() => setBulkModal(false)}
          onSuccess={() => { setBulkModal(false); load(); }}
        />
      )}
      {modal && (
        <StationModal
          mode={modal.mode}
          station={modal.station}
          token={token}
          onClose={() => setModal(null)}
          onSuccess={() => {
            setModal(null);
            load();
          }}
        />
      )}
      {assignModal && (
        <AssignModal
          stationId={assignModal.stationId}
          editAgent={assignModal.editAgent}
          token={token}
          onClose={() => setAssignModal(null)}
          onSuccess={() => {
            setAssignModal(null);
            load();
          }}
        />
      )}

      {/* Stations keep their own single-day picker below — it selects which
          day's roster to show, which is a different thing from the range
          filter the header offers, so the header's is hidden. */}
      <PageHeader
        title="Stations"
        showFilters={false}
        subtitle={`${filtered.length} of ${stations.length} stations`}
      />

      {/* Search + Actions row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6.5" cy="6.5" r="4.5" /><path d="M10.5 10.5l3 3" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by station, agent or number…"
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-slate-400 dark:text-zinc-500 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            onClick={(e) => { try { e.target.showPicker(); } catch { /* ignore */ } }}
            className="px-2 py-1.5 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        {(search || dateFilter !== todayDate) && (
          <button
            onClick={() => { setSearch(""); setDateFilter(todayDate); }}
            className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-600 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            Reset
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={load}
            title="Refresh"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 text-sm font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 11-1.1-3.3" /><path d="M13.5 2v3h-3" />
            </svg>
          </button>
          <button
            onClick={() => setBulkModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-sm font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
            </svg>
            Bulk Upload
          </button>
          <button
            onClick={() => setModal({ mode: "create" })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Add Station
          </button>
        </div>
      </div>

      {/* Confirm clear */}
      {confirmClear && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center justify-between">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Remove all agents from all stations? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmClear(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-600 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleClearAll}
              className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400 dark:text-zinc-500">
            Loading stations...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
          <svg
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
          </svg>
          <p className="text-sm font-medium">
            {stations.length === 0 ? "No stations yet" : "No matching stations"}
          </p>
          <p className="text-xs mt-1">
            {stations.length === 0
              ? 'Click "Add Station" to create one.'
              : "Try adjusting your filters."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Station Name</th>
                <th className="px-4 py-3 font-semibold">Station Number</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Agent Name</th>
                <th className="px-4 py-3 font-semibold">Agent Mobile</th>
                <th className="px-4 py-3 font-semibold">Received</th>
                <th className="px-4 py-3 font-semibold">Missed</th>
                <th className="px-4 py-3 font-semibold w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const agents = s.agents || [];
                const activeAgent =
                  agents.find((a) => a.active === true) || null;
                const pastAgents = agents.filter((a) => a !== activeAgent);
                return (
                  <tr
                    key={s.id}
                    className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {s.station_name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 font-mono">
                      {s.station_number}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-zinc-400">
                      {s.date || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {activeAgent ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                              <span className="text-sm font-medium text-slate-900 dark:text-white">
                                {activeAgent.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                                Active
                              </span>
                              <button
                                onClick={() =>
                                  setAssignModal({
                                    stationId: s.id,
                                    editAgent: activeAgent,
                                  })
                                }
                                title="Edit Agent"
                                className="w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-zinc-500 hover:text-indigo-500 transition-colors"
                              >
                                <svg
                                  className="w-3 h-3"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M11.5 1.5l3 3L5 14H2v-3z" />
                                </svg>
                              </button>
                              <button
                                onClick={() =>
                                  handleUnassign(s.id, activeAgent.mobile)
                                }
                                title="Remove Agent"
                                className="w-5 h-5 flex items-center justify-center rounded text-slate-400 dark:text-zinc-500 hover:text-red-500 transition-colors"
                              >
                                <svg
                                  className="w-3 h-3"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                >
                                  <path d="M4 4l8 8M12 4l-8 8" />
                                </svg>
                              </button>
                            </div>
                            <div className="flex items-center gap-2.5 pl-3.5 mt-0.5">
                              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 1l-5 5-3-3"/><path d="M14 5.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-6"/></svg>
                                {activeAgent.received || 0}
                              </span>
                              <span className="flex items-center gap-0.5 text-[10px] text-red-500 dark:text-red-400 font-medium">
                                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L5 11M5 5l6 6"/><path d="M14 5.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-6"/></svg>
                                {activeAgent.missed || 0}
                              </span>
                            </div>
                            {activeAgent.assigned_at && (
                              <p className="text-[10px] text-slate-400 dark:text-zinc-600 pl-3.5">
                                {new Date(
                                  activeAgent.assigned_at,
                                ).toLocaleString("en-IN", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}
                              </p>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-zinc-500 italic">
                            No active agent
                          </span>
                        )}
                        {pastAgents.length > 0 && (
                          <div
                            className={`${activeAgent ? "mt-1.5" : "mt-1"} pl-3.5 border-l-2 border-slate-200 dark:border-zinc-700 space-y-1`}
                          >
                            {pastAgents.map((a, i) => (
                              <div key={i}>
                                <span className="text-xs text-slate-400 dark:text-zinc-500">
                                  {a.name} · {a.mobile}
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-emerald-500/70 ml-1">
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 1l-5 5-3-3"/></svg>{a.received || 0}
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-[9px] text-red-400/70 ml-0.5">
                                  <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L5 11M5 5l6 6"/></svg>{a.missed || 0}
                                </span>
                                {a.assigned_at && (
                                  <p className="text-[9px] text-slate-300 dark:text-zinc-600">
                                    {new Date(a.assigned_at).toLocaleString(
                                      "en-IN",
                                      {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      },
                                    )}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-zinc-400 font-mono">
                      {activeAgent?.mobile || "—"}
                    </td>
                    <td className="px-4 py-3 text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                      {s.received}
                    </td>
                    <td className="px-4 py-3 text-red-600 dark:text-red-400 font-semibold tabular-nums">
                      {s.missed}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setAssignModal({ stationId: s.id })}
                          title="Assign New Agent"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <line x1="19" y1="8" x2="19" y2="14" />
                            <line x1="22" y1="11" x2="16" y2="11" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setModal({ mode: "edit", station: s })}
                          title="Edit Station"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
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
                            <path d="M11.5 1.5l3 3L5 14H2v-3z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          title="Delete Station"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
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
                            <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BulkUploadModal({ token, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError('');
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = data.map(r => ({
          station_name: String(r['Support Station'] || r['Station Name'] || r['station_name'] || '').trim(),
          station_number: String(r['Support Station Number'] || r['Station Number'] || r['station_number'] || '').trim(),
          agent_name: String(r['Name'] || r['Agent Name'] || r['agent_name'] || '').trim(),
          agent_mobile: String(r['Mobile Numbers'] || r['Mobile Number'] || r['Agent Mobile'] || r['agent_mobile'] || '').trim(),
        }));
        setPreview(rows);
      } catch {
        setError('Failed to parse file. Make sure it is a valid .xlsx or .csv file.');
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleUpload() {
    if (!preview.length) return;
    setUploading(true); setError('');
    try {
      const res = await fetch(`${API}/api/stations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows: preview, date: todayStr() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Upload failed'); setUploading(false); return; }
      setResult(data);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Support Station', 'Support Station Number', 'Name', 'Mobile Numbers'],
      ['SN-1', '8448963344', '', ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stations');
    XLSX.writeFile(wb, 'stations-template.xlsx');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Bulk Upload Stations</h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {result ? (
          <div className="space-y-2">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Upload complete</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">Created: {result.created} · Updated: {result.updated} · Skipped: {result.skipped}</p>
            </div>
            <div className="flex justify-end">
              <button onClick={onSuccess} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-zinc-700 rounded-lg cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors">
                <svg className="w-5 h-5 text-slate-400 dark:text-zinc-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1"/>
                </svg>
                <span className="text-sm text-slate-500 dark:text-zinc-400">{file ? file.name : 'Choose .xlsx or .csv file'}</span>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
              </label>
              <button onClick={downloadTemplate} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-xs text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap">
                Template
              </button>
            </div>

            {preview.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mb-2">{preview.length} rows found</p>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 text-left">
                        <th className="px-3 py-2">Station</th>
                        <th className="px-3 py-2">Number</th>
                        <th className="px-3 py-2">Agent</th>
                        <th className="px-3 py-2">Mobile</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-zinc-800/60">
                          <td className="px-3 py-1.5 text-slate-700 dark:text-zinc-300">{r.station_name || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-500 dark:text-zinc-400 font-mono">{r.station_number || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-700 dark:text-zinc-300">{r.agent_name || <span className="text-slate-400 italic">—</span>}</td>
                          <td className="px-3 py-1.5 text-slate-500 dark:text-zinc-400 font-mono">{r.agent_mobile || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
              <button onClick={handleUpload} disabled={!preview.length || uploading} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {uploading ? 'Uploading...' : `Upload ${preview.length} Stations`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function StationModal({ mode, station, token, onClose, onSuccess }) {
  const [name, setName] = useState(station?.station_name || "");
  const [number, setNumber] = useState(station?.station_number || "");
  const [agentName, setAgentName] = useState("");
  const [agentMobile, setAgentMobile] = useState("");
  const [date, setDate] = useState(todayStr());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !number.trim()) {
      setError("Station name and number are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url =
        mode === "edit"
          ? `${API}/api/stations/${station.id}`
          : `${API}/api/stations`;
      const body = { station_name: name.trim(), station_number: number.trim() };
      // Include agent if provided (for create mode)
      if (mode !== "edit" && agentName.trim() && agentMobile.trim()) {
        body.agent = { name: agentName.trim(), mobile: agentMobile.trim() };
        body.date = date;
      }
      const res = await fetch(url, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        setSaving(false);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4"
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {mode === "edit" ? "Edit Station" : "New Station"}
        </h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
            Station Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
            Station Number *
          </label>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        {mode !== "edit" && (
          <>
            <div className="border-t border-slate-200 dark:border-zinc-800 pt-3">
              <p className="text-xs text-slate-400 dark:text-zinc-500 uppercase tracking-wide font-semibold mb-2">
                Assign Agent (optional)
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
                Agent Name
              </label>
              <input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Leave blank to skip"
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
                Agent Mobile Number
              </label>
              <input
                value={agentMobile}
                onChange={(e) => setAgentMobile(e.target.value)}
                placeholder="Leave blank to skip"
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.target.showPicker();
                  } catch { /* ignore */ }
                }}
                className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : mode === "edit" ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AssignModal({ stationId, editAgent, token, onClose, onSuccess }) {
  const isEdit = !!editAgent;
  const [name, setName] = useState(editAgent?.name || "");
  const [mobile, setMobile] = useState(editAgent?.mobile || "");
  const [date, setDate] = useState(todayStr());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) {
      setError("Agent name and mobile are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // If editing, remove old agent first then add updated one
      if (isEdit) {
        await fetch(`${API}/api/stations/${stationId}/unassign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ mobile: editAgent.mobile }),
        });
      }
      const res = await fetch(`${API}/api/stations/${stationId}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim(),
          date,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        setSaving(false);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4"
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {isEdit ? "Edit Agent" : "Assign Agent"}
        </h2>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
            Agent Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
            Agent Mobile Number *
          </label>
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? "Assigning..." : "Assign"}
          </button>
        </div>
      </form>
    </div>
  );
}
