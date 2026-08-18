import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { initiateCall, pollClick2Call } from '../hooks/useCalls';

const API = import.meta.env.VITE_API_URL ?? '';

const CATEGORIES = ['General Inquiry', 'Technical Issue', 'Billing', 'Complaint', 'Service Request', 'Follow Up', 'Others'];
const PRIORITIES  = ['Low', 'Medium', 'High', 'Urgent'];
const STATUSES    = ['Open', 'In Progress', 'Resolved', 'Closed'];

export const STATUS_STYLE = {
  'Open':        'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  'In Progress': 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  'Resolved':    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  'Closed':      'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400',
};

export const PRIORITY_STYLE = {
  Low:    'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400',
  Medium: 'bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400',
  High:   'bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400',
  Urgent: 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400',
};

const TIMELINE_ICON = {
  created:          { color: 'bg-indigo-500', icon: '✦' },
  status_changed:   { color: 'bg-blue-500',   icon: '⇄' },
  priority_changed: { color: 'bg-orange-500', icon: '↑' },
  note:             { color: 'bg-slate-400 dark:bg-zinc-600', icon: '✎' },
};

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export function Badge({ text, style }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>{text}</span>;
}

export default function TicketDetailModal({ ticketId, onClose, onUpdated, onDeleted }) {
  const { token, isAdmin, user } = useAuth();
  const [ticket,    setTicket]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [note,      setNote]      = useState('');
  const [saving,    setSaving]    = useState(false);
  const [dialState, setDialState] = useState(null); // null|'loading'|'polling'|'connected'|'initiated'|'error'

  async function handleDial() {
    setDialState('loading');
    try {
      const since = Date.now();
      const res   = await initiateCall(ticket.customer_number, user?.agent_number, token);
      const ok    = res.status === 'Success' || res.status === 'success';
      if (!ok) { setDialState('error'); setTimeout(() => setDialState(null), 3000); return; }
      setDialState('polling');
      pollClick2Call(ticket.customer_number, since, token, {
        onConfirmed: () => { setDialState('connected'); setTimeout(() => setDialState(null), 4000); },
        onTimeout:   () => { setDialState('initiated'); setTimeout(() => setDialState(null), 4000); },
      });
    } catch {
      setDialState('error');
      setTimeout(() => setDialState(null), 3000);
    }
  }

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/tickets/${ticketId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTicket(data);
    } catch {}
    finally { setLoading(false); }
  }, [ticketId, token]);

  useEffect(() => { load(); }, [load]);

  async function updateField(updates) {
    setSaving(true);
    await fetch(`${API}/api/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(updates),
    });
    await load();
    onUpdated?.();
    setSaving(false);
  }

  async function addNote() {
    if (!note.trim()) return;
    setSaving(true);
    await fetch(`${API}/api/tickets/${ticketId}/note`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ note }),
    });
    setNote('');
    await load();
    setSaving(false);
  }

  async function deleteTicket() {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    await fetch(`${API}/api/tickets/${ticketId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    onDeleted?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-zinc-700 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div>
            {loading ? <div className="h-4 w-24 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" /> : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400">{ticket?.ticket_number}</span>
                  {ticket && <Badge text={ticket.status}   style={STATUS_STYLE[ticket.status]   ?? ''} />}
                  {ticket && <Badge text={ticket.priority} style={PRIORITY_STYLE[ticket.priority] ?? ''} />}
                </div>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100 mt-1">{ticket?.title}</h2>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-4">
            {ticket?.customer_number && (
              <button
                onClick={handleDial}
                disabled={dialState === 'loading' || dialState === 'polling'}
                title={
                  dialState === 'polling'   ? 'Waiting for confirmation…' :
                  dialState === 'connected' ? 'Call connected!' :
                  dialState === 'initiated' ? 'Call initiated' :
                  dialState === 'error'     ? 'Call failed' :
                  `Call ${ticket.customer_number}`
                }
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  dialState === 'connected' ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' :
                  dialState === 'initiated' ? 'bg-sky-100 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800' :
                  dialState === 'error'     ? 'bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' :
                  dialState === 'loading' || dialState === 'polling' ? 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 border-slate-200 dark:border-zinc-700 cursor-wait' :
                  'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/50'
                }`}
              >
                {dialState === 'loading' ? (
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="25" strokeDashoffset="6"/></svg>
                ) : dialState === 'polling' ? (
                  <svg className="w-3.5 h-3.5 animate-pulse" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="2"/><path d="M4 8a4 4 0 008 0M2 8a6 6 0 0012 0"/></svg>
                ) : dialState === 'connected' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8l3.5 3.5L13 4"/></svg>
                ) : dialState === 'error' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M3.654 1.328a.678.678 0 00-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 004.168 6.608 17.569 17.569 0 006.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 00-.063-1.015l-2.307-1.794a.678.678 0 00-.58-.122l-2.19.547a1.745 1.745 0 01-1.657-.459L5.482 8.062a1.745 1.745 0 01-.46-1.657l.548-2.19a.678.678 0 00-.122-.58L3.654 1.328z"/></svg>
                )}
                {!dialState && 'Call'}
                {dialState === 'connected' && 'Connected'}
                {dialState === 'initiated' && 'Initiated'}
                {dialState === 'error'     && 'Failed'}
              </button>
            )}
            {ticket && (
              <button onClick={deleteTicket} className="px-2.5 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-900/40 transition-colors">
                Delete
              </button>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-zinc-500">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Info grid */}
            <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 gap-4 border-b border-slate-100 dark:border-zinc-800">
              {[
                // Call tickets carry a number, email tickets an address; only
                // one is ever set, so show whichever identifies this customer.
                ['Customer',   [ticket.customer_name, ticket.customer_number || ticket.customer_email].filter(Boolean).join(' · ')],
                ['Source',     ticket.source === 'email' ? 'Email' : 'Call'],
                ['Agent',      ticket.agent_name ? `${ticket.agent_name} (${ticket.agent_number})` : ticket.agent_number || '—'],
                ['Category',   ticket.category],
                ['Created by', ticket.created_by_name],
                ['Created',    fmtDate(ticket.created_at)],
                ['Updated',    fmtDate(ticket.updated_at)],
              ].map(([label, val]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mb-0.5">{label}</p>
                  <p className="text-sm text-slate-800 dark:text-zinc-200 font-medium break-words">{val || '—'}</p>
                </div>
              ))}
              {ticket.email_subject && (
                <div className="col-span-2 sm:col-span-3 min-w-0">
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mb-0.5">Email subject</p>
                  <p className="text-sm text-slate-700 dark:text-zinc-300 break-words">{ticket.email_subject}</p>
                </div>
              )}
              {ticket.description && (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mb-0.5">Description</p>
                  <p className="text-sm text-slate-700 dark:text-zinc-300 whitespace-pre-wrap">{ticket.description}</p>
                </div>
              )}
            </div>

            {/* Status + Priority controls */}
            <div className="px-6 py-3 flex flex-wrap gap-3 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-zinc-400">Status</span>
                <select
                  value={ticket.status}
                  disabled={saving}
                  onChange={e => updateField({ status: e.target.value })}
                  className="px-2 py-1 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-zinc-400">Priority</span>
                <select
                  value={ticket.priority}
                  disabled={saving}
                  onChange={e => updateField({ priority: e.target.value })}
                  className="px-2 py-1 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-600 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                >
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Timeline */}
            <div className="px-6 py-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-4">Timeline</p>
              <div className="relative">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-200 dark:bg-zinc-700" />
                <div className="space-y-4">
                  {(ticket.timeline ?? []).map((entry, i) => {
                    const ic = TIMELINE_ICON[entry.type] ?? TIMELINE_ICON.note;
                    return (
                      <div key={i} className="flex gap-4 relative">
                        <div className={`w-6 h-6 rounded-full ${ic.color} flex items-center justify-center text-white text-xs shrink-0 z-10`}>
                          {ic.icon}
                        </div>
                        <div className="flex-1 pb-1">
                          <p className="text-sm text-slate-700 dark:text-zinc-300">{entry.note}</p>
                          <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                            {entry.by_name} · {fmtDate(entry.at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Add note */}
            <div className="px-6 pb-5">
              <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-2">Add Note</p>
              <div className="flex gap-2">
                <textarea
                  rows={2}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Write a note or update…"
                  className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(); }}
                />
                <button
                  onClick={addNote}
                  disabled={saving || !note.trim()}
                  className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors self-end"
                >
                  {saving ? '…' : 'Add'}
                </button>
              </div>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">Ctrl+Enter to submit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
