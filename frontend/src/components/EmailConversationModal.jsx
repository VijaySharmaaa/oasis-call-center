import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtDate } from './TicketDetailModal';
import EmailDetailModal from './EmailDetailModal';
import EmailTicketModal from './EmailTicketModal';
import { tagsOf, tagKey } from './TagChips';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * One correspondent's whole exchange with the mailbox, rendered as a chat.
 *
 * The candidate's messages sit left, our replies right, oldest at the top —
 * because that is how the case actually reads, and because the AI verdict
 * beside it was formed from exactly this sequence rather than from whichever
 * message happened to be opened.
 */

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-700 dark:text-zinc-300">{children}</p>
    </div>
  );
}

/** The verdict on the conversation — one per person, not one per message. */
function ConversationAnalysis({ analysis, conversation, onReanalyse, canReanalyse, busy }) {
  const status = analysis?.status;
  const stale  = !!conversation?.needs_analysis && status === 'completed';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">
          AI Analysis
          {analysis?.message_count > 0 && (
            <span className="ml-1.5 font-normal normal-case text-slate-400 dark:text-zinc-500">
              · {analysis.message_count} message{analysis.message_count > 1 ? 's' : ''} read
            </span>
          )}
        </p>
        {/* The same badge the list shows, so a chain reads the same whether it
            is being scanned in the table or opened. Withheld while `stale`,
            because then the verdict on screen does not cover the newest
            message and the banner below says so. */}
        {status === 'completed' && !stale && (
          <span
            title={conversation?.analysed_at ? `Analysed ${fmtDate(conversation.analysed_at)}` : undefined}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 8.5l3.5 3.5L13 4.5" />
            </svg>
            Analysed
          </span>
        )}
        {canReanalyse && (
          <button
            onClick={onReanalyse}
            disabled={busy}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50 shrink-0 ml-auto"
          >
            {busy ? 'Queueing…' : status === 'completed' ? 'Re-analyse' : 'Analyse now'}
          </button>
        )}
      </div>

      {/* A reply lands and the stored verdict is instantly one message behind.
          Saying so is better than showing it as though it were current. */}
      {stale && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          New mail has arrived since this verdict — a fresh reading is queued.
        </p>
      )}

      {!analysis && <p className="text-sm text-slate-400 dark:text-zinc-500">Not queued for analysis yet.</p>}

      {status === 'pending' && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Queued for analysis{analysis.attempts > 0 ? ` — retry ${analysis.attempts} of 5` : ''}.
        </p>
      )}
      {status === 'processing' && <p className="text-sm text-sky-600 dark:text-sky-400">Analysis in progress…</p>}
      {status === 'failed' && (
        <p className="text-sm text-red-600 dark:text-red-400">Analysis failed: {analysis.error || 'unknown error'}</p>
      )}

      {status === 'completed' && (
        <div className="space-y-3">
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
                  {tag.sub_category && tag.sub_category !== '-' && <span className="opacity-70"> · {tag.sub_category}</span>}
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

          {analysis.ai_insight && analysis.ai_insight !== '-' && <Field label="Insight">{analysis.ai_insight}</Field>}
          {analysis.summary && <Field label="Summary">{analysis.summary}</Field>}
          {analysis.bugs && analysis.bugs !== '-' && (
            <Field label={`Reported defect${analysis.bug_category && analysis.bug_category !== '-' ? ` · ${analysis.bug_category}` : ''}`}>
              <span className="text-amber-700 dark:text-amber-400">{analysis.bugs}</span>
            </Field>
          )}
          {analysis.omitted_messages > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-zinc-600">
              Oldest {analysis.omitted_messages} message{analysis.omitted_messages > 1 ? 's' : ''} were too long to include.
            </p>
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

/** One message in the chain. */
function Bubble({ message, showSubject, onOpen }) {
  const outbound = message.direction === 'outbound';

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] min-w-0 ${outbound ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        {/* The subject is repeated only when it changes: candidates start new
            threads for the same problem, and reprinting an unchanged line above
            every bubble buries the conversation in its own headers. */}
        {showSubject && (
          <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400 px-1 truncate max-w-full">
            {message.subject || '(no subject)'}
          </p>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2.5 border text-sm leading-relaxed ${
            outbound
              ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900/60 text-slate-700 dark:text-zinc-200 rounded-br-md'
              : 'bg-white dark:bg-zinc-800/60 border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 rounded-bl-md'
          }`}
        >
          <pre className="whitespace-pre-wrap break-words font-sans">
            {message.body_text?.trim() || message.snippet || '(no body)'}
          </pre>

          {(message.body_trimmed || message.body_truncated || message.has_html || message.attachments?.length > 0) && (
            <div className="mt-2 pt-2 border-t border-slate-200/70 dark:border-zinc-700/70 flex items-center gap-2 flex-wrap">
              {message.attachments?.map(att => (
                <span
                  key={att.attachment_id}
                  title={`${att.filename} · ${fmtBytes(att.size)}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 max-w-[160px]"
                >
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 7l-5.5 5.5a3 3 0 01-4.2-4.2L8.5 3a2 2 0 012.8 2.8l-5.3 5.3a1 1 0 01-1.4-1.4L9 5"/>
                  </svg>
                  <span className="truncate">{att.filename}</span>
                </span>
              ))}
              {/* Gmail's own affordance for the same edit, and for the same
                  reason: the quoted thread and the disclaimer are not the
                  message, but the reader is told they were taken off and can
                  have the original. */}
              <button
                onClick={onOpen}
                title={message.body_trimmed
                  ? 'Show the message as it arrived — quoted replies, signature and disclaimer included'
                  : undefined}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {message.body_truncated ? 'Read full message'
                  : message.body_trimmed ? 'Show original'
                  : 'Open message'}
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] text-slate-400 dark:text-zinc-500 px-1">
          {outbound ? 'Support' : (message.from_name || message.from_email)} · {fmtDate(message.received_at)}
          {message.is_unread && !message.read_at && (
            <span className="ml-1 text-indigo-500 dark:text-indigo-400">· unread</span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The reply box.
 *
 * Answering from here is the point of the chat — an operator who has to switch
 * to Gmail to reply loses the verdict, the ticket history and the rest of the
 * chain on the way. What they type is sent as a real reply, threaded into the
 * candidate's existing conversation.
 *
 * `canSend` comes from the server's own view of its Gmail scopes, so a mailbox
 * that cannot send says so up front instead of offering a button that fails.
 */
function Composer({ canSend, reason, sending, error, value, onChange, onSend }) {
  // Enter sends, Shift+Enter breaks the line — the convention every chat uses.
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (value.trim() && !sending) onSend();
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-zinc-800 px-4 sm:px-6 py-3 bg-white dark:bg-zinc-900">
      {!canSend && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          {reason || 'This mailbox is not authorised to send.'}
        </p>
      )}
      {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canSend || sending}
          rows={2}
          aria-label="Reply"
          placeholder={canSend ? 'Write a reply…  (Enter to send, Shift+Enter for a new line)' : 'Replying is unavailable'}
          className="flex-1 min-w-0 resize-y px-3 py-2 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
        />
        <button
          onClick={onSend}
          disabled={!canSend || sending || !value.trim()}
          className="shrink-0 h-9 px-4 flex items-center gap-1.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default function EmailConversationModal({ conversationId, onClose, onRead, onReplied }) {
  const { token, isAdmin } = useAuth();
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [queueing, setQueueing] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [openMessageId, setOpenMessageId] = useState(null);
  const [showTickets, setShowTickets] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [mailbox, setMailbox] = useState(null);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    const res = await fetch(`${API}/api/emails/conversations/${encodeURIComponent(conversationId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
    return res.json();
  }, [conversationId, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await load();
        if (!cancelled) setConversation(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  /* What this mailbox is allowed to do. Asked once per open: it changes with
     the delegation, not with the conversation. */
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/emails/sync-status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (!cancelled) setMailbox(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  /* Send the reply, then append what the server stored rather than what was
     typed — the bubble should be the message as Gmail actually holds it. */
  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setSendError('');
    try {
      const res = await fetch(`${API}/api/emails/conversations/${encodeURIComponent(conversationId)}/reply`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`);

      // Cleared only on success, so a failed send does not lose what was typed.
      setDraft('');
      setConversation(current => (current ? {
        ...current,
        ...(data.conversation || {}),
        // The server returns null when the send worked but the copy could not
        // be fetched back; the next poll picks it up rather than inventing one.
        messages: data.message ? [...(current.messages || []), data.message] : (current.messages || []),
        analysis: current.analysis,
      } : current));
      onReplied?.();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  // A chat opens at its newest message, the way every other chat does.
  useEffect(() => {
    if (!loading && conversation) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [loading, conversation]);

  // Escape unwinds one layer at a time — a stacked modal must not close the
  // conversation out from under itself.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (openMessageId) setOpenMessageId(null);
      else if (showTickets) setShowTickets(false);
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, openMessageId, showTickets]);

  /* Put the whole chain back in the unread pile — the inverse of the mark-read
     the list fires on open. Gmail is not told; the service account is read-only. */
  async function markUnread() {
    setMarkingUnread(true);
    try {
      const res = await fetch(`${API}/api/emails/conversations/${encodeURIComponent(conversationId)}/read`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ read: false }),
      });
      if (!res.ok) throw new Error('Could not mark unread');
      onRead?.(conversationId, false);
      onClose();
    } catch (err) {
      setError(err.message);
      setMarkingUnread(false);
    }
  }

  /* Re-read the chain, then poll briefly so the verdict appears without the
     operator having to reopen the conversation. */
  async function reanalyse() {
    setQueueing(true);
    try {
      const status = conversation?.analysis?.status;
      const force = status === 'completed' || status === 'failed';
      await fetch(`${API}/api/emails/conversations/${encodeURIComponent(conversationId)}/analyse${force ? '?force=true' : ''}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const fresh = await load().catch(() => null);
        if (fresh) setConversation(fresh);
        if (fresh?.analysis?.status === 'completed' || fresh?.analysis?.status === 'failed') break;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setQueueing(false);
    }
  }

  const messages = conversation?.messages ?? [];
  // Shaped like the email object the ticket modals expect: they key tickets by
  // address, which is exactly what a conversation is.
  const ticketSubject = conversation
    ? { id: conversation.last_inbound_id || conversation.last_message_id,
        from_email: conversation.participant_email,
        from_name:  conversation.participant_name,
        subject:    conversation.last_subject }
    : null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div
          className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-5xl border border-slate-200 dark:border-zinc-700 max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header — the person, not a subject line */}
          <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 shrink-0">
            <div className="min-w-0">
              {loading ? (
                <div className="h-4 w-40 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" />
              ) : (
                <>
                  <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100 break-words">
                    {conversation?.participant_name || conversation?.participant_email}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 break-all">{conversation?.participant_email}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">
                    {conversation?.message_count} message{conversation?.message_count === 1 ? '' : 's'}
                    {conversation?.outbound_count > 0 && <> · {conversation.outbound_count} replied</>}
                    {conversation?.unread_count > 0 && (
                      <span className="text-indigo-600 dark:text-indigo-400"> · {conversation.unread_count} unread</span>
                    )}
                    {conversation?.first_message_at && <> · since {fmtDate(conversation.first_message_at)}</>}
                  </p>
                </>
              )}
            </div>
            <div className="shrink-0 ml-4 flex items-center gap-1.5">
              <button
                onClick={markUnread}
                disabled={markingUnread || loading}
                title="Put this whole chain back in the unread pile (does not change Gmail)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                {markingUnread ? 'Marking…' : 'Unread'}
              </button>
              <button
                onClick={() => setShowTickets(true)}
                disabled={!conversation?.participant_email}
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

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="px-6 py-6 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* The chain, with the reply box under it */}
              <div className="flex-1 min-w-0 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 bg-slate-50/60 dark:bg-zinc-950/30">
                  {messages.map((m, i) => (
                    <Bubble
                      key={m.id}
                      message={m}
                      showSubject={i === 0 || m.subject !== messages[i - 1].subject}
                      onOpen={() => setOpenMessageId(m.id)}
                    />
                  ))}
                  <div ref={bottomRef} />
                </div>

                <Composer
                  canSend={mailbox ? !!mailbox.can_send : true}
                  reason={mailbox && !mailbox.configured
                    ? 'Mailbox ingestion is not configured on the server.'
                    : 'This mailbox is not authorised to send. A Workspace admin must grant the gmail.modify scope.'}
                  sending={sending}
                  error={sendError}
                  value={draft}
                  onChange={setDraft}
                  onSend={send}
                />
              </div>

              {/* The verdict on all of it */}
              <div className="lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-zinc-800 overflow-y-auto px-5 py-4">
                <ConversationAnalysis
                  analysis={conversation?.analysis}
                  conversation={conversation}
                  onReanalyse={reanalyse}
                  canReanalyse={isAdmin}
                  busy={queueing}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stacked above this modal — later in the DOM, so it wins at the same z. */}
      {openMessageId && (
        <EmailDetailModal emailId={openMessageId} onClose={() => setOpenMessageId(null)} />
      )}
      {showTickets && ticketSubject && (
        <EmailTicketModal email={ticketSubject} onClose={() => setShowTickets(false)} />
      )}
    </>
  );
}
