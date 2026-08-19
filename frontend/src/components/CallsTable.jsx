import { useState } from 'react';
import AudioPlayer from './AudioPlayer';
import TranscriptionModal from './TranscriptionModal';
import TagChips, { tagsOf } from './TagChips';
import AnalysisStatus, { analysisStateOf } from './AnalysisStatus';
import { initiateCall, pollClick2Call } from '../hooks/useCalls';

const SYSTEM_NUMBER = '8037126236';

function formatDuration(sec) {
  if (!sec || sec === 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return str;
  }
}

function StatusBadge({ call }) {
  return call.agent_answer_time ? (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Received</span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">Missed</span>
  );
}

function VerifiedIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" viewBox="0 0 16 16" fill="currentColor" title="Verified agent">
      <path fillRule="evenodd" d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.22 5.47a.75.75 0 00-1.06-1.06L7 8.56 5.84 7.4a.75.75 0 00-1.06 1.06l1.69 1.69a.75.75 0 001.06 0l3.69-3.69z" clipRule="evenodd"/>
    </svg>
  );
}

function TranscriptBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="View Transcription"
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="2"/>
        <path d="M5 6h6M5 9h4"/>
      </svg>
    </button>
  );
}


function SortTh({ col, label, sortBy, sortDir, onSort, className = '' }) {
  const active = sortBy === col;
  return (
    <th className={`px-3 py-2.5 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-zinc-200 transition-colors whitespace-nowrap ${className}`} onClick={() => onSort?.(col)}>
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

function TicketBtn({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Create Ticket"
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v2a1.5 1.5 0 010 3v2A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-2a1.5 1.5 0 010-3v-2z"/>
        <path d="M8 6v4M6 8h4"/>
      </svg>
    </button>
  );
}

function normalizeNum(n) { return (n || '').replace(/\D/g, '').slice(-10); }

function resolveStation(number, stationMap) {
  if (!number || !stationMap) return null;
  const norm = normalizeNum(number);
  for (const [sNum, info] of Object.entries(stationMap)) {
    if (normalizeNum(sNum) === norm) return info;
  }
  return null;
}

export default function CallsTable({ calls, hasFilters = false, isAgent = false, agentNumber, agentMap = {}, stationMap = {}, token, onCreateTicket, onAnalysisQueued, sortBy, sortDir, onSort }) {
  const [transcriptCall, setTranscriptCall] = useState(null);
  const [dialState,      setDialState]      = useState({});  // { [call.id]: 'loading'|'success'|'error' }

  async function handleDial(call) {
    setDialState(s => ({ ...s, [call.id]: 'loading' }));
    try {
      const since = Date.now();
      const res   = await initiateCall(call.caller_number, agentNumber, token, call.call_id);
      const ok    = res.status === 'Success' || res.status === 'success';
      if (!ok) {
        setDialState(s => ({ ...s, [call.id]: 'error' }));
        setTimeout(() => setDialState(s => { const n = { ...s }; delete n[call.id]; return n; }), 3000);
        return;
      }
      // BuzzDial accepted — poll for webhook confirmation for 20s
      setDialState(s => ({ ...s, [call.id]: 'polling' }));
      pollClick2Call(call.caller_number, since, token, {
        onConfirmed: () => {
          setDialState(s => ({ ...s, [call.id]: 'connected' }));
        },
        onTimeout: () => {
          // BuzzDial said success but webhook didn't arrive — reset to allow retry
          setDialState(s => { const n = { ...s }; delete n[call.id]; return n; });
        },
      });
    } catch {
      setDialState(s => ({ ...s, [call.id]: 'error' }));
      setTimeout(() => setDialState(s => { const n = { ...s }; delete n[call.id]; return n; }), 3000);
    }
  }

  function DialBtn({ call }) {
    const isMissed = !call.agent_answer_time;
    if (!isMissed || call.caller_number === SYSTEM_NUMBER) return null;
    const calledBack = !!call.called_back_by;
    const state = calledBack ? 'connected' : dialState[call.id];
    if (calledBack) {
      return (
        <span
          title="Call Resolved"
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l3.5 3.5L13 4"/>
          </svg>
        </span>
      );
    }
    return (
      <button
        onClick={e => { e.stopPropagation(); handleDial(call); }}
        disabled={state === 'loading'}
        title={
          state === 'polling'   ? 'Waiting for confirmation…' :
          state === 'connected' ? 'Call Resolved' :
          state === 'initiated' ? 'Call initiated (no webhook yet)' :
          `Call back ${call.caller_number}`
        }
        className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
          state === 'connected' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' :
          state === 'initiated' ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400' :
          state === 'error'     ? 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400' :
          state === 'loading' || state === 'polling' ? 'text-slate-300 dark:text-zinc-600 cursor-wait' :
          'text-slate-400 dark:text-zinc-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400'
        }`}
      >
        {state === 'loading' ? (
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25" strokeDashoffset="6"/>
          </svg>
        ) : state === 'polling' ? (
          <svg className="w-3.5 h-3.5 animate-pulse" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="2"/><path d="M4 8a4 4 0 008 0M2 8a6 6 0 0012 0"/>
          </svg>
        ) : state === 'connected' ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l3.5 3.5L13 4"/>
          </svg>
        ) : state === 'error' ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13"/>
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.6 17.6 0 004.168 6.608 17.6 17.6 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z"/>
          </svg>
        )}
      </button>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400 dark:text-zinc-500">
        <div className="flex justify-center mb-3">
          {hasFilters ? (
            <svg className="w-10 h-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          ) : (
            <svg className="w-10 h-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.09-1.09a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
          )}
        </div>
        <p className="text-lg font-medium">{hasFilters ? 'No matching records' : 'No call records yet'}</p>
        <p className="text-sm mt-1">
          {hasFilters
            ? 'Try adjusting your search or filter.'
            : 'Calls will appear here once BuzzDial sends webhook events.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {transcriptCall && (
        <TranscriptionModal call={transcriptCall} token={token} onClose={() => setTranscriptCall(null)} />
      )}

      {/* ── Mobile / Tablet card view (< lg) ── */}
      <div className="lg:hidden space-y-3">
        {calls.map(call => (
          <div
            key={call.id}
            className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-4 transition-colors"
          >
            {/* Top row: numbers + status */}
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">
                      {call.caller_number === SYSTEM_NUMBER ? (call.agent_number || call.caller_number) : (call.caller_number || '—')}
                    </span>
                    {call.caller_number === SYSTEM_NUMBER && (
                      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">C2C</span>
                    )}
                  </div>
                  <span className="text-slate-400 dark:text-zinc-500 text-xs">→</span>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">
                      {call.called_number === SYSTEM_NUMBER ? (call.agent_number || call.called_number) : (call.called_number || '—')}
                    </span>
                    {call.called_number === SYSTEM_NUMBER && (
                      <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">C2C</span>
                    )}
                  </div>
                </div>
                {!isAgent && (() => {
                  const station = resolveStation(call.agent_number, stationMap);
                  if (station) {
                    const hasAgents = station.agents?.length > 0;
                    return (
                      <div className="mt-1">
                        {hasAgents ? (
                          station.agents.map((a, i) => (
                            <div key={i}>
                              <p className="text-xs text-slate-500 dark:text-zinc-400">{a.name} · {a.mobile}</p>
                              <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">Temp Staff</span>
                            </div>
                          ))
                        ) : (
                          <div>
                            <p className="text-xs text-slate-500 dark:text-zinc-400">{station.station_name} · {call.agent_number || '—'}</p>
                            <span className="text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">STATION</span>
                          </div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400 mt-1">
                      {agentMap[call.agent_number] && <VerifiedIcon />}
                      {agentMap[call.agent_number] || call.agent_name || '—'} · {call.agent_number || '—'}
                    </p>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1.5">
                <StatusBadge call={call} />
                <DialBtn call={call} />
              </div>
            </div>

            {/* Middle row: times + durations */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div>
                <p className="text-slate-400 dark:text-zinc-500">Start</p>
                <p className="text-slate-700 dark:text-zinc-300">{formatDate(call.call_start_time || call.created_at)}</p>
              </div>
              <div>
                <p className="text-slate-400 dark:text-zinc-500">End</p>
                <p className="text-slate-700 dark:text-zinc-300">{formatDate(call.call_end_time)}</p>
              </div>
              <div>
                <p className="text-slate-400 dark:text-zinc-500">Duration</p>
                <p className="text-slate-700 dark:text-zinc-300">{formatDuration(call.duration)}</p>
              </div>
              {call.agent_answer_time && (
                <div>
                  <p className="text-slate-400 dark:text-zinc-500">Agent Duration</p>
                  <p className="text-slate-700 dark:text-zinc-300">{formatDuration(call.agent_duration)}</p>
                </div>
              )}
              {call.keypress && (
                <div>
                  <p className="text-slate-400 dark:text-zinc-500">Keypress</p>
                  <p className="text-slate-700 dark:text-zinc-300 tabular-nums">{call.keypress}</p>
                </div>
              )}
            </div>

            {/* Category / Sub-Category */}
            {(call.category || call.sub_category) && (
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <p className="text-slate-400 dark:text-zinc-500">Category</p>
                  <TagChips item={call} max={3} className="mt-0.5" />
                </div>
                <div>
                  <p className="text-slate-400 dark:text-zinc-500">Sub-Category</p>
                  <p className="text-slate-700 dark:text-zinc-300">{call.sub_category || '—'}</p>
                </div>
              </div>
            )}

            {/* Queue state sits outside the block above, because the rows that
                most need it are exactly the ones with no category yet. */}
            <AnalysisStatus
              item={call}
              analyseUrl={`/api/calls/${encodeURIComponent(call.call_id)}/analyse`}
              onQueued={onAnalysisQueued}
              className="mb-3"
            />

            {/* Recording + Transcription + Ticket + Delete */}
            <div className="flex items-center gap-2">
              {onCreateTicket && (
                <TicketBtn onClick={e => { e.stopPropagation(); onCreateTicket(call); }} />
              )}
              {call.call_recording && call.agent_answer_time ? (
                <>
                  <AudioPlayer src={call.call_recording} />
                  <TranscriptBtn onClick={() => setTranscriptCall(call)} />
                </>
              ) : (
                <p className="text-xs text-slate-300 dark:text-zinc-600">No recording</p>
              )}
            </div>

          </div>
        ))}
      </div>

      {/* ── Desktop table view (lg+) ── */}
      <div className="hidden lg:block overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Caller</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Called</th>
              {!isAgent && <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Agent Name</th>}
              {!isAgent && <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Agent No.</th>}
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Keypress</th>
              <SortTh col="call_start_time" label="Start Time" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortTh col="agent_answer_time" label="Answer Time" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">End Time</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Duration</th>
              <SortTh col="agent_duration" label="Agent Duration" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Status</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Category</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Sub-Category</th>
              <SortTh col="recording" label="Recording" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr
                  key={call.id}
                  className="border-t border-slate-100 dark:border-zinc-800/60 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-700 dark:text-zinc-300 font-medium tabular-nums">
                        {call.caller_number === SYSTEM_NUMBER ? (call.agent_number || call.caller_number) : (call.caller_number || '—')}
                      </span>
                      {call.caller_number === SYSTEM_NUMBER && (
                        <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">C2C</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-900 dark:text-zinc-200 font-medium tabular-nums">
                        {call.called_number === SYSTEM_NUMBER ? (call.agent_number || call.called_number) : (call.called_number || '—')}
                      </span>
                      {call.called_number === SYSTEM_NUMBER && (
                        <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-medium">C2C</span>
                      )}
                    </div>
                  </td>
                  {!isAgent && (() => {
                    const station = resolveStation(call.agent_number, stationMap);
                    if (station) {
                      const hasAgents = station.agents?.length > 0;
                      return (
                        <>
                          <td className="px-3 py-2 text-slate-700 dark:text-zinc-300">
                            <div>
                              {hasAgents ? station.agents.map((a, i) => (
                                <div key={i}>
                                  <p className="text-sm">{a.name}</p>
                                  <span className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">Temp Staff</span>
                                </div>
                              )) : (
                                <div>
                                  <p className="text-sm">{station.station_name}</p>
                                  <span className="text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">STATION</span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 tabular-nums">
                            {hasAgents ? station.agents.map((a, i) => <p key={i}>{a.mobile}</p>) : (call.agent_number || '—')}
                          </td>
                        </>
                      );
                    }
                    return (
                      <>
                        <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 whitespace-nowrap">
                          <span className="flex items-center gap-1">
                            {agentMap[call.agent_number] && <VerifiedIcon />}
                            {agentMap[call.agent_number] || call.agent_name || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 tabular-nums">{call.agent_number || '—'}</td>
                      </>
                    );
                  })()}
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 tabular-nums text-center">{call.keypress || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs">{formatDate(call.call_start_time || call.created_at)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs">{formatDate(call.agent_answer_time)}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-zinc-400 whitespace-nowrap text-xs">{formatDate(call.call_end_time)}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 tabular-nums">{formatDuration(call.duration)}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-zinc-300 tabular-nums">{call.agent_answer_time ? formatDuration(call.agent_duration) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusBadge call={call} />
                      <DialBtn call={call} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[220px]">
                    {/* A call with no verdict yet shows its queue state in place
                        of TagChips' bare "pending", which says less and offers
                        nothing to press. */}
                    {tagsOf(call).length > 0
                      ? <TagChips item={call} max={2} />
                      : !analysisStateOf(call) && <span className="text-slate-300 dark:text-zinc-600">—</span>}
                    <AnalysisStatus
                      item={call}
                      analyseUrl={`/api/calls/${encodeURIComponent(call.call_id)}/analyse`}
                      onQueued={onAnalysisQueued}
                      className="mt-1"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-zinc-300 text-xs whitespace-nowrap">{call.sub_category || '—'}</td>
                  <td className="px-3 py-2 min-w-[200px]">
                    {call.call_recording && call.agent_answer_time ? (
                      <AudioPlayer src={call.call_recording} />
                    ) : (
                      <span className="text-slate-300 dark:text-zinc-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {onCreateTicket && (
                        <TicketBtn onClick={e => { e.stopPropagation(); onCreateTicket(call); }} />
                      )}
                      {call.call_recording && (
                        <TranscriptBtn onClick={() => setTranscriptCall(call)} />
                      )}
                    </div>
                  </td>
                </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
