import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fmtDate } from './TicketDetailModal';

const API = import.meta.env.VITE_API_URL ?? '';

/**
 * Where one call or one conversation stands in the AI queue — and, for an
 * admin, the button that moves it.
 *
 * An empty Category cell used to mean two different things: the AI read this
 * and found nothing worth tagging, or the AI has never read it. Only the second
 * is something an operator can act on, so it says so and offers the action.
 *
 * Both tabs render this same component because both queues answer the same two
 * questions. The backend hands them the same pair of fields:
 *   awaiting_analysis  there is something to read and no current verdict on it
 *   queue_status       the queue row's status, or null when never enrolled
 *
 * `showAnalysed` opts a list into the positive terminal state as well. The Call
 * Report leaves it off: nearly every call is analysed, so a badge on each one
 * is a column of identical stickers. The Emails tab turns it on, because a
 * verdict there covers a whole chain and an operator wants to see at a glance
 * that the newest message is included in it.
 */

/**
 * `awaiting_analysis` is the question this component exists to answer: is there
 * anything to read that has no current verdict? Only when the answer is yes
 * does the queue row have anything useful to add, and then order matters — a
 * chain that is mid-flight is reported as such even though it is also, strictly,
 * awaiting a verdict, because "Analysing…" is the one that tells an operator
 * not to press the button again.
 *
 * A queue row can outlive the verdict it produced: a worker that dies between
 * writing the answer and releasing its lock leaves a row saying `processing`
 * for a conversation that is fully analysed. Reading the row first meant that
 * chain claimed to be "Analysing…" forever, next to the very category it had
 * already been given. The stored verdict is the truth; the queue row is only
 * ever a claim about work.
 */
export function analysisStateOf(item, { showAnalysed = false } = {}) {
  const status = item?.queue_status ?? null;
  // A permanent failure is reported whatever else is true: nothing is coming,
  // and it is the one state a person has to act on.
  if (status === 'failed')     return 'failed';
  if (!item?.awaiting_analysis) {
    return showAnalysed && item?.analysed_at ? 'analysed' : null;
  }
  if (status === 'processing') return 'processing';
  if (status === 'pending')    return 'queued';
  return 'awaiting';
}

const LABELS = {
  processing: 'Analysing…',
  queued:     'Queued',
  awaiting:   'Awaiting analysis',
  failed:     'Analysis failed',
  analysed:   'Analysed',
};

const STYLES = {
  processing: 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400',
  queued:     'bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400',
  awaiting:   'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
  failed:     'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400',
  // Settled and good — the same green the app uses everywhere else for done.
  analysed:   'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
};

/** Only these two states are waiting on a person rather than on the worker. */
const ACTIONABLE = { awaiting: 'Analyse now', failed: 'Retry' };
// 'analysed' is deliberately absent: re-reading a chain whose verdict is
// current is an explicit act, and it lives in the conversation itself.

function Tick() {
  return (
    <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      role="status"
      aria-label="Analysing"
      className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin"
    />
  );
}

export default function AnalysisStatus({ item, analyseUrl, onQueued, showAnalysed = false, className = '' }) {
  const { token, isAdmin } = useAuth();
  // Set the moment the server accepts the job, so the row answers the click
  // instead of looking inert until the next poll lands.
  const [queued, setQueued] = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');

  const state = queued ? 'queued' : analysisStateOf(item, { showAnalysed });
  if (!state) return null;

  const action = !queued && isAdmin && analyseUrl ? ACTIONABLE[state] : null;

  async function analyse(e) {
    // Both tabs put this inside a clickable row; analysing is not opening.
    e.stopPropagation();
    setBusy(true);
    setError('');
    try {
      // A settled record — completed, or failed for good — is only reopened on
      // an explicit force, and pressing this button IS that explicit ask.
      const force = state === 'failed' || item?.queue_status === 'completed';
      const res = await fetch(`${API}${analyseUrl}${force ? '?force=true' : ''}`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not queue this for analysis');
      setQueued(true);
      onQueued?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      <span
        title={
          error
          || (state === 'failed'   ? 'The worker gave up on this one' : undefined)
          // The date answers the question the badge provokes — analysed when?
          // A chain analysed before the latest reply would not say "Analysed"
          // at all, so this is always the reading that includes it.
          || (state === 'analysed' && item?.analysed_at ? `Analysed ${fmtDate(item.analysed_at)}` : undefined)
        }
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${STYLES[state]}`}
      >
        {state === 'processing' && <Spinner />}
        {state === 'analysed'   && <Tick />}
        {LABELS[state]}
      </span>

      {action && (
        <button
          onClick={analyse}
          disabled={busy}
          title="Send this to the AI now"
          className="px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap border border-indigo-200 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-50 disabled:cursor-wait transition-colors"
        >
          {busy ? 'Queueing…' : action}
        </button>
      )}

      {/* Kept next to the chip rather than raised as a toast: the row is where
          the operator is looking, and the failure belongs to that row. */}
      {error && <span className="text-[10px] text-red-500 dark:text-red-400">{error}</span>}
    </div>
  );
}
