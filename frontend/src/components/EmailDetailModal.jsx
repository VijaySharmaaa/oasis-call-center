import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtDate } from './TicketDetailModal';
import EmailTicketModal from './EmailTicketModal';
import { tagsOf, tagKey } from './TagChips';

const API = import.meta.env.VITE_API_URL ?? '';

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Gmail's own labels are noise in the UI — only user labels are worth showing. */
const SYSTEM_LABELS = new Set([
  'INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH',
  'CHAT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

/** The AI verdict, mirroring how a call's analysis is presented. */
function AnalysisPanel({ analysis, onReanalyse, canReanalyse, busy }) {
  const status = analysis?.status;

  return (
    <div className="mt-5 pt-4 border-t border-slate-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">AI Analysis</p>
        {canReanalyse && (
          <button
            onClick={onReanalyse}
            disabled={busy}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
          >
            {busy ? 'Queueing…' : status === 'completed' ? 'Re-analyse' : 'Analyse now'}
          </button>
        )}
      </div>

      {!analysis && (
        <p className="text-sm text-slate-400 dark:text-zinc-500">Not queued for analysis yet.</p>
      )}

      {status === 'pending' && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Queued for analysis{analysis.attempts > 0 ? ` — retry ${analysis.attempts} of 5` : ''}.
        </p>
      )}
      {status === 'processing' && (
        <p className="text-sm text-sky-600 dark:text-sky-400">Analysis in progress…</p>
      )}
      {status === 'failed' && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Analysis failed: {analysis.error || 'unknown error'}
        </p>
      )}

      {status === 'completed' && (
        <div className="space-y-3">
          {/* Every issue the email raised. A candidate who asks about Aadhaar OTP
              *and* a photo upload gets both, rather than only the one they
              happened to lead with. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {tagsOf(analysis).length > 0 ? (
              tagsOf(analysis).map((tag, i) => (
                <span
                  key={tagKey(tag, i)}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    i === 0
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                      : 'bg-indigo-50/60 dark:bg-indigo-950/20 text-indigo-500 dark:text-indigo-400/80'
                  }`}
                >
                  {tag.category}
                  {tag.sub_category && tag.sub_category !== '-' && (
                    <span className="opacity-70"> · {tag.sub_category}</span>
                  )}
                </span>
              ))
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                {analysis.category || 'Uncategorised'}
              </span>
            )}
            {analysis.requested_action && analysis.requested_action !== 'Other' && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                {analysis.requested_action}
              </span>
            )}
            {(analysis.language ?? []).map(l => (
              <span key={l} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                {l}
              </span>
            ))}
          </div>

          {analysis.ai_insight && analysis.ai_insight !== '-' && (
            <Field label="Insight">{analysis.ai_insight}</Field>
          )}
          {analysis.summary && <Field label="Summary">{analysis.summary}</Field>}
          {analysis.bugs && analysis.bugs !== '-' && (
            <Field label={`Reported defect${analysis.bug_category && analysis.bug_category !== '-' ? ` · ${analysis.bug_category}` : ''}`}>
              <span className="text-amber-700 dark:text-amber-400">{analysis.bugs}</span>
            </Field>
          )}
          {analysis.model_used && (
            <p className="text-[10px] text-slate-400 dark:text-zinc-600">
              {analysis.model_used}{analysis.used_fallback ? ' (fallback)' : ''}
              {analysis.processed_at ? ` · ${fmtDate(analysis.processed_at)}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-700 dark:text-zinc-300">{children}</p>
    </div>
  );
}

export default function EmailDetailModal({ emailId, onClose, onMarkedUnread }) {
  const { token, isAdmin } = useAuth();
  const [email,   setEmail]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  // Plain text is the default view: it is inert, and the vast majority of
  // support mail is plain anyway.
  const [view,    setView]    = useState('text');
  const [busyAttachment, setBusyAttachment] = useState(null);
  const [queueing, setQueueing] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);

  /* Put it back in the unread pile — the inverse of the mark-read the list
     fires on open, and the recovery for a mail opened by mistake. Gmail is not
     told either way; the service account is read-only. */
  async function markUnread() {
    setMarkingUnread(true);
    try {
      const res = await fetch(`${API}/api/emails/${emailId}/read`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ read: false }),
      });
      if (!res.ok) throw new Error('Could not mark unread');
      onMarkedUnread?.(emailId);
      onClose();
    } catch (err) {
      setError(err.message);
      setMarkingUnread(false);
    }
  }

  const load = useCallback(async () => {
    const res = await fetch(`${API}/api/emails/${emailId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    return res.json();
  }, [emailId, token]);

  /* Queue (or re-queue) analysis, then poll briefly so the verdict appears
     without the operator having to reopen the email. */
  async function reanalyse() {
    setQueueing(true);
    try {
      const force = email?.analysis?.status === 'completed' || email?.analysis?.status === 'failed';
      await fetch(`${API}/api/emails/${emailId}/analyse${force ? '?force=true' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const fresh = await load().catch(() => null);
        if (fresh) setEmail(fresh);
        if (fresh?.analysis?.status === 'completed' || fresh?.analysis?.status === 'failed') break;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/emails/${emailId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setEmail(data);
          // Fall back to the HTML part when there is no usable plain-text body.
          if (!data.body_text?.trim() && data.body_html?.trim()) setView('html');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [emailId, token]);

  // Escape unwinds one layer at a time: the ticket modal is stacked on top of
  // this one, so closing the mail out from under it would be wrong.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (showTickets) setShowTickets(false);
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showTickets]);

  /* Attachments need the Authorization header, so a bare <a href> won't do —
     fetch the bytes and hand the browser a blob URL instead. */
  async function download(att) {
    setBusyAttachment(att.attachment_id);
    try {
      const res = await fetch(`${API}/api/emails/${emailId}/attachments/${att.attachment_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = att.filename || 'attachment';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyAttachment(null);
    }
  }

  const userLabels = (email?.label_ids ?? []).filter(l => !SYSTEM_LABELS.has(l));

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-200 dark:border-zinc-700 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
          <div className="min-w-0">
            {loading ? (
              <div className="h-4 w-40 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" />
            ) : (
              <>
                <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100 break-words">{email?.subject}</h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 break-all">
                  <span className="font-medium text-slate-700 dark:text-zinc-200">{email?.from_name || email?.from_email}</span>
                  {email?.from_name && <span> &lt;{email.from_email}&gt;</span>}
                </p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5 break-all">
                  to {email?.to || '—'}{email?.cc ? ` · cc ${email.cc}` : ''}
                </p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                  {fmtDate(email?.received_at)}
                  {/* Shared mailbox — knowing someone already picked this up is
                      the difference between one reply and three. */}
                  {email?.read_at && (
                    <span className="text-slate-400 dark:text-zinc-500">
                      {' · opened'}{email.read_by ? ` by ${email.read_by}` : ''}
                    </span>
                  )}
                </p>
                {userLabels.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {userLabels.map(l => (
                      <span key={l} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                        {l}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="shrink-0 ml-4 flex items-center gap-1.5">
            <button
              onClick={markUnread}
              disabled={markingUnread || loading}
              title="Put this back in the unread pile (does not change Gmail)"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              {markingUnread ? 'Marking…' : 'Unread'}
            </button>
            <button
              onClick={() => setShowTickets(true)}
              disabled={!email?.from_email}
              title="Tickets for this sender"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v2a1.5 1.5 0 010 3v2A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-2a1.5 1.5 0 010-3v-2z"/>
                <path d="M8 6v4M6 8h4"/>
              </svg>
              Ticket
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <>
              {email?.body_text?.trim() && email?.body_html?.trim() && (
                <div className="flex items-center gap-1 mb-3">
                  {['text', 'html'].map(v => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        view === v
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {v === 'text' ? 'Plain text' : 'HTML'}
                    </button>
                  ))}
                </div>
              )}

              {view === 'html' && email?.body_html ? (
                /* Email HTML is untrusted third-party markup. The sandbox
                   attribute with no allow-* tokens blocks scripts, forms,
                   popups, and top-level navigation, so the message can render
                   without being able to touch the app or the session token. */
                <iframe
                  title="Email body"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={email.body_html}
                  className="w-full h-[55vh] bg-white rounded-lg border border-slate-200 dark:border-zinc-700"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700 dark:text-zinc-300 leading-relaxed">
                  {email?.body_text?.trim() || email?.snippet || '(no body)'}
                </pre>
              )}

              <AnalysisPanel
                analysis={email?.analysis}
                onReanalyse={reanalyse}
                canReanalyse={isAdmin}
                busy={queueing}
              />

              {email?.attachments?.length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-200 dark:border-zinc-800">
                  <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                    {email.attachments.length} attachment{email.attachments.length > 1 ? 's' : ''}
                  </p>
                  <div className="space-y-1.5">
                    {email.attachments.map(att => (
                      <button
                        key={att.attachment_id}
                        onClick={() => download(att)}
                        disabled={busyAttachment === att.attachment_id}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 text-left hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-4 h-4 shrink-0 text-slate-400 dark:text-zinc-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5L9 1.5z"/><path d="M9 1.5v4h4"/>
                        </svg>
                        <span className="flex-1 min-w-0 truncate text-sm text-slate-700 dark:text-zinc-300">{att.filename}</span>
                        <span className="shrink-0 text-xs text-slate-400 dark:text-zinc-500">{fmtBytes(att.size)}</span>
                        {busyAttachment === att.attachment_id && (
                          <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {/* Stacked above this modal — later in the DOM, so it wins at the same z. */}
    {showTickets && email && (
      <EmailTicketModal email={email} onClose={() => setShowTickets(false)} />
    )}
    </>
  );
}
