import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import TicketDetailModal, { STATUS_STYLE, PRIORITY_STYLE, fmtDate, Badge } from './TicketDetailModal';
import CreateTicketModal from './CreateTicketModal';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * The email-side twin of CallTicketModal: everything already raised for this
 * sender, plus a way to open a new one. Scoped by address rather than by
 * message, so a follow-up mail from the same person shows the earlier tickets.
 */
export default function EmailTicketModal({ email, onClose }) {
  const { token } = useAuth();
  const customerEmail = email?.from_email || '';

  const [tickets,    setTickets]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ customerEmail, limit: 50 });
      const res  = await fetch(`${API}/api/tickets?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setTickets(data.tickets ?? []);
    } catch {}
    finally { setLoading(false); }
  }, [customerEmail, token]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  if (selectedId) {
    return (
      <TicketDetailModal
        ticketId={selectedId}
        onClose={() => { setSelectedId(null); loadTickets(); }}
        onUpdated={loadTickets}
        onDeleted={() => { setSelectedId(null); loadTickets(); }}
      />
    );
  }

  if (showCreate) {
    return (
      <CreateTicketModal
        email={email}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); loadTickets(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-zinc-700">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">Tickets</h2>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 break-all">Sender · {customerEmail || '—'}</p>
          </div>
          <button onClick={onClose} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>

        {/* Ticket list */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-400 dark:text-zinc-500">Loading…</div>
          ) : tickets.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-400 dark:text-zinc-500">No existing tickets for this sender</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-zinc-800">
              {tickets.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className="w-full text-left px-6 py-3.5 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{t.ticket_number}</span>
                        <Badge text={t.status}   style={STATUS_STYLE[t.status]   ?? ''} />
                        <Badge text={t.priority} style={PRIORITY_STYLE[t.priority] ?? ''} />
                      </div>
                      <p className="text-sm text-slate-800 dark:text-zinc-200 font-medium truncate">{t.title}</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{fmtDate(t.created_at)}</p>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 dark:text-zinc-600 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3l5 5-5 5"/>
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400 dark:text-zinc-500">
            {tickets.length} existing ticket{tickets.length !== 1 ? 's' : ''}
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="shrink-0 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v10M3 8h10"/>
            </svg>
            Create New Ticket
          </button>
        </div>
      </div>
    </div>
  );
}
