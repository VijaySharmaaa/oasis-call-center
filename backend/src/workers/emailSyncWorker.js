/**
 * Email Sync Worker — mirrors the support mailbox into the `emails` collection.
 *
 * TWO PHASES, tracked per mailbox in `email_sync_state`:
 *
 *   backfill     Walks messages.list page by page (GMAIL_BACKFILL_PAGES_PER_TICK
 *                pages per tick so one big mailbox can't monopolise the loop),
 *                storing the pageToken between ticks so a restart resumes
 *                instead of starting over.
 *
 *   incremental  Once the backfill drains, switches to history.list from the
 *                historyId captured *before* the backfill began. Capturing it
 *                up front is what stops mail that arrives mid-backfill from
 *                being missed: worst case it is fetched twice, which upserts
 *                harmlessly. Gmail keeps ~1 week of history, so an id that has
 *                aged out returns 404 and we fall back to a fresh backfill.
 *
 * Read-only: nothing here sends, deletes, or marks mail. Label changes made in
 * Gmail (read, starred, archived, trashed) flow one way, into our copy.
 *
 * Tunable via env: GMAIL_SYNC_ENABLED, GMAIL_POLL_SEC, GMAIL_BACKFILL_DAYS,
 *                  GMAIL_SYNC_QUERY, GMAIL_FETCH_CONCURRENCY,
 *                  GMAIL_BACKFILL_PAGES_PER_TICK
 */
const { getDb } = require('../db');
const gmail     = require('../services/gmailService');
const { enqueueEmail } = require('./emailAnalysisWorker');
const logger    = require('../logger');

const POLL_MS            = Math.max(15_000, Number(process.env.GMAIL_POLL_SEC || 60) * 1000);
const BACKFILL_DAYS      = Math.max(0, Number(process.env.GMAIL_BACKFILL_DAYS ?? 30));
const PAGES_PER_TICK     = Math.max(1, Number(process.env.GMAIL_BACKFILL_PAGES_PER_TICK || 5));
const FETCH_CONCURRENCY  = Math.max(1, Number(process.env.GMAIL_FETCH_CONCURRENCY || 8));
const PAGE_SIZE          = 100;

// Labels whose presence we mirror onto boolean fields for cheap filtering.
const DERIVED_FLAGS = {
  UNREAD:  'is_unread',
  STARRED: 'is_starred',
  INBOX:   'in_inbox',
  TRASH:   'is_trashed',
  SPAM:    'is_spam',
};

let tickRunning = false;
let timer = null;

function syncEnabled() {
  const flag = (process.env.GMAIL_SYNC_ENABLED || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  return gmail.isConfigured();
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Gmail search string bounding the backfill. Empty = the entire mailbox. */
function backfillQuery() {
  const override = (process.env.GMAIL_SYNC_QUERY || '').trim();
  if (override) return override;
  if (!BACKFILL_DAYS) return '';
  const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const pad   = n => String(n).padStart(2, '0');
  return `after:${since.getFullYear()}/${pad(since.getMonth() + 1)}/${pad(since.getDate())}`;
}

async function loadState(db, mailbox) {
  const col   = db.collection('email_sync_state');
  const state = await col.findOne({ _id: mailbox });
  if (state) return state;

  const fresh = {
    _id:                 mailbox,
    phase:               'backfill',
    history_id:          null,
    pending_history_id:  null,
    backfill_query:      backfillQuery(),
    backfill_page_token: null,
    backfill_pages_done: 0,
    synced_total:        0,
    last_sync_at:        null,
    last_error:          null,
    last_error_at:       null,
    created_at:          new Date(),
  };
  await col.insertOne(fresh);
  logger.info('[EmailSync] Initialised sync state', { mailbox, query: fresh.backfill_query || '(entire mailbox)' });
  return fresh;
}

function saveState(db, mailbox, patch) {
  return db.collection('email_sync_state').updateOne({ _id: mailbox }, { $set: { ...patch, updated_at: new Date() } });
}

// ─── Storing messages ─────────────────────────────────────────────────────────

/** Fetch ids with a bounded pool, then upsert them in one bulk write. */
async function fetchAndStore(db, ids, mailbox) {
  if (!ids.length) return { stored: 0, failed: 0 };

  const docs = [];
  let failed = 0;
  let cursor = 0;

  async function drain() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        docs.push(await gmail.getMessage(id));
      } catch (err) {
        failed += 1;
        logger.warn('[EmailSync] Failed to fetch message', { gmail_id: id, status: err.status, message: err.message });
        // A retryable error means the whole tick is likely to keep failing —
        // stop early and let the next tick retry from the same page token.
        if (err.retryable) throw err;
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, drain));
  } finally {
    if (docs.length) {
      const now = new Date();
      await db.collection('emails').bulkWrite(
        docs.map(doc => ({
          updateOne: {
            filter: { gmail_id: doc.gmail_id },
            update: {
              $set:         { ...doc, mailbox, is_deleted: false, synced_at: now },
              $setOnInsert: { first_seen_at: now },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );

      // Hand each stored message to the analysis queue. enqueueEmail is
      // idempotent, so a message re-fetched by a later history page does not
      // re-run analysis that already completed. Failures here must not fail the
      // sync — the worker's sweep stage picks up anything missed.
      await Promise.all(docs.map(doc =>
        enqueueEmail(doc.gmail_id).catch(err =>
          logger.warn('[EmailSync] Could not queue analysis', { gmail_id: doc.gmail_id, message: err.message })
        )
      ));
    }
  }

  return { stored: docs.length, failed };
}

// ─── Backfill phase ───────────────────────────────────────────────────────────

async function runBackfill(db, state, mailbox) {
  const query = state.backfill_query ?? backfillQuery();

  // Snapshot the mailbox's current historyId before the first page, so the
  // incremental phase picks up anything that lands while we page through.
  let pendingHistoryId = state.pending_history_id;
  if (!pendingHistoryId) {
    const profile = await gmail.getProfile();
    pendingHistoryId = profile.historyId;
    await saveState(db, mailbox, { pending_history_id: pendingHistoryId });
    logger.info('[EmailSync] Backfill starting', {
      mailbox,
      query:            query || '(entire mailbox)',
      messagesTotal:    profile.messagesTotal,
      pendingHistoryId,
    });
  }

  let pageToken = state.backfill_page_token || undefined;
  let pages     = 0;
  let stored    = 0;

  while (pages < PAGES_PER_TICK) {
    const page = await gmail.listMessages({ q: query, pageToken, maxResults: PAGE_SIZE });
    const ids  = page.messages.map(m => m.id);

    const result = await fetchAndStore(db, ids, mailbox);
    stored += result.stored;
    pages  += 1;
    pageToken = page.nextPageToken;

    await saveState(db, mailbox, {
      backfill_page_token: pageToken || null,
      last_sync_at:        new Date(),
      last_error:          null,
    });
    await db.collection('email_sync_state').updateOne(
      { _id: mailbox },
      { $inc: { backfill_pages_done: 1, synced_total: result.stored } }
    );

    if (!pageToken) {
      // Drained — hand over to incremental sync.
      await saveState(db, mailbox, {
        phase:               'incremental',
        history_id:          pendingHistoryId,
        pending_history_id:  null,
        backfill_page_token: null,
        backfill_done_at:    new Date(),
      });
      const total = await db.collection('emails').countDocuments({ mailbox });
      logger.info('[EmailSync] Backfill complete — switching to incremental', { mailbox, storedThisTick: stored, totalInDb: total });
      return { phase: 'incremental', stored };
    }
  }

  logger.info('[EmailSync] Backfill progress', { mailbox, storedThisTick: stored, pagesThisTick: pages, morePages: true });
  return { phase: 'backfill', stored };
}

// ─── Incremental phase ────────────────────────────────────────────────────────

/**
 * Collapse a history page into: ids needing a full fetch, per-id label deltas,
 * and ids Gmail says are gone. Records arrive oldest-first, so later records
 * overwrite earlier ones for the same (id, label) pair.
 */
function collapseHistory(records) {
  const added       = new Set();
  const deleted     = new Set();
  const labelDeltas = new Map();   // gmail_id → Map(label → present:boolean)

  for (const rec of records) {
    for (const m of rec.messagesAdded  || []) added.add(m.message.id);
    for (const m of rec.messagesDeleted || []) deleted.add(m.message.id);

    for (const change of rec.labelsAdded || []) {
      const map = labelDeltas.get(change.message.id) || new Map();
      for (const label of change.labelIds || []) map.set(label, true);
      labelDeltas.set(change.message.id, map);
    }
    for (const change of rec.labelsRemoved || []) {
      const map = labelDeltas.get(change.message.id) || new Map();
      for (const label of change.labelIds || []) map.set(label, false);
      labelDeltas.set(change.message.id, map);
    }
  }

  // A message added and deleted within the same window is simply gone.
  for (const id of deleted) added.delete(id);
  // No point patching labels on a message we are about to fetch in full.
  for (const id of added) labelDeltas.delete(id);

  return { added: [...added], deleted: [...deleted], labelDeltas };
}

/**
 * Apply label changes without re-fetching the message — the history record
 * already carries the label ids, so this costs no API quota.
 */
async function applyLabelDeltas(db, labelDeltas) {
  const ops = [];

  for (const [gmail_id, labels] of labelDeltas) {
    const toAdd    = [...labels].filter(([, present]) =>  present).map(([label]) => label);
    const toRemove = [...labels].filter(([, present]) => !present).map(([label]) => label);

    const flags = {};
    for (const [label, field] of Object.entries(DERIVED_FLAGS)) {
      if (labels.has(label)) flags[field] = labels.get(label);
    }

    // $addToSet and $pull cannot touch the same field in one update, so a
    // message with both kinds of change gets two ops.
    if (toAdd.length) {
      ops.push({ updateOne: {
        filter: { gmail_id },
        update: { $addToSet: { label_ids: { $each: toAdd } }, $set: { ...flags, synced_at: new Date() } },
      }});
    }
    if (toRemove.length) {
      ops.push({ updateOne: {
        filter: { gmail_id },
        update: { $pull: { label_ids: { $in: toRemove } }, $set: { ...flags, synced_at: new Date() } },
      }});
    }
  }

  if (!ops.length) return 0;
  const result = await db.collection('emails').bulkWrite(ops, { ordered: false });
  return result.modifiedCount || 0;
}

async function runIncremental(db, state, mailbox) {
  let pageToken   = undefined;
  let historyId   = state.history_id;
  const records   = [];

  do {
    let page;
    try {
      page = await gmail.listHistory({ startHistoryId: state.history_id, pageToken });
    } catch (err) {
      if (err.status === 404) {
        // historyId aged out of Gmail's ~1 week window — full resync.
        logger.warn('[EmailSync] historyId expired — restarting backfill', { mailbox, historyId: state.history_id });
        await saveState(db, mailbox, {
          phase:               'backfill',
          history_id:          null,
          pending_history_id:  null,
          backfill_query:      backfillQuery(),
          backfill_page_token: null,
        });
        return { phase: 'backfill', stored: 0 };
      }
      throw err;
    }

    records.push(...(page.history || []));
    if (page.historyId) historyId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken);

  const { added, deleted, labelDeltas } = collapseHistory(records);

  const { stored, failed } = await fetchAndStore(db, added, mailbox);

  if (deleted.length) {
    // Soft delete — the record stays for reporting, but drops out of listings.
    await db.collection('emails').updateMany(
      { gmail_id: { $in: deleted } },
      { $set: { is_deleted: true, deleted_at: new Date() } }
    );
  }

  const relabelled = await applyLabelDeltas(db, labelDeltas);

  await saveState(db, mailbox, { history_id: historyId, last_sync_at: new Date(), last_error: null });
  if (stored) await db.collection('email_sync_state').updateOne({ _id: mailbox }, { $inc: { synced_total: stored } });

  if (stored || deleted.length || relabelled) {
    logger.info('[EmailSync] Incremental sync', { mailbox, new: stored, failed, deleted: deleted.length, relabelled, historyId });
  } else {
    logger.debug('[EmailSync] Nothing new', { mailbox, historyId });
  }

  return { phase: 'incremental', stored };
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Run one sync pass. Safe to call directly (the manual-sync endpoint does);
 * overlapping calls are collapsed rather than queued.
 * @returns {Promise<{skipped?: string, phase?: string, stored?: number, error?: string}>}
 */
async function syncOnce() {
  if (!syncEnabled()) return { skipped: 'disabled' };
  if (tickRunning)    return { skipped: 'already_running' };
  tickRunning = true;

  const mailbox = gmail.mailbox() || 'me';

  try {
    const db    = await getDb();
    const state = await loadState(db, mailbox);
    // history.list is useless without a start id — treat a missing one as a
    // signal to rebuild from scratch rather than crashing every tick.
    return state.phase === 'incremental' && state.history_id
      ? await runIncremental(db, state, mailbox)
      : await runBackfill(db, state, mailbox);
  } catch (err) {
    logger.error('[EmailSync] Sync failed', { mailbox, status: err.status, message: err.message });
    try {
      const db = await getDb();
      await saveState(db, mailbox, { last_error: err.message, last_error_at: new Date() });
    } catch { /* best-effort — the original error is what matters */ }
    return { error: err.message };
  } finally {
    tickRunning = false;
  }
}

function startEmailSyncWorker() {
  if (!gmail.isConfigured()) {
    logger.warn('[EmailSync] Not started — Gmail credentials are not configured (see GMAIL_USER / GOOGLE_SERVICE_ACCOUNT_KEY in .env.example)');
    return;
  }
  if (!syncEnabled()) {
    logger.info('[EmailSync] Not started — GMAIL_SYNC_ENABLED is false');
    return;
  }

  logger.info('[EmailSync] Started', {
    mailbox:         gmail.mailbox(),
    authMode:        gmail.authMode(),
    pollIntervalSec: POLL_MS / 1000,
    backfillDays:    BACKFILL_DAYS || 'all',
    concurrency:     FETCH_CONCURRENCY,
  });

  syncOnce().catch(err => logger.error('[EmailSync] Initial sync failed', { message: err.message }));
  timer = setInterval(
    () => syncOnce().catch(err => logger.error('[EmailSync] Tick failed', { message: err.message })),
    POLL_MS
  );
  timer.unref?.();
}

module.exports = { startEmailSyncWorker, syncOnce };
