/**
 * Email Analysis Worker — the email twin of analysisWorker.js.
 *
 * Same machinery, deliberately: atomic claim via findOneAndUpdate, a
 * processing_id so a reset lock can never be overwritten by the job that lost
 * it, stale-lock recovery, a heartbeat, exponential backoff, and a permanent
 * failure state. If you change the retry policy here, change it there too.
 *
 * Differences from the call worker, all of them because email is not audio:
 *   • no upload step — the text goes straight into the prompt, so a job is one
 *     API call instead of an upload plus a call
 *   • the "nothing to analyse" shortcut is an empty body rather than a call
 *     under 10 seconds
 *   • a sweep stage enrols emails that were synced before this worker existed
 *
 * Tunable via env: EMAIL_ANALYSIS_ENABLED, EMAIL_ANALYSIS_CONCURRENCY,
 *                  EMAIL_ANALYSIS_POLL_SEC, EMAIL_ANALYSIS_MIN_CHARS
 */
const { getDb }            = require('../db');
const { categorizeEmail, emailToPlainText } = require('../services/geminiService');
const { envBool }          = require('../config/features');
const logger               = require('../logger');

const MAX_CONCURRENCY  = Math.max(1, Number(process.env.EMAIL_ANALYSIS_CONCURRENCY || 4));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.EMAIL_ANALYSIS_POLL_SEC || 10) * 1000);
const MIN_BODY_CHARS   = Math.max(0, Number(process.env.EMAIL_ANALYSIS_MIN_CHARS ?? 15));
const SWEEP_BATCH      = 200;
const STALE_LOCK_MIN   = 15;
const MAX_ATTEMPTS     = 5;

/** Sentinel used when there is no text worth spending a Gemini call on. */
const TOO_SHORT_CATEGORY = 'Email too Short';

let inFlight = 0;
let tickRunning = false;
let tickQueued = false;
let timer = null;

function analysisEnabled() {
  return envBool('EMAIL_ANALYSIS_ENABLED', true) && !!process.env.GEMINI_API_KEY;
}

// Same schedule as the call worker: 30s → 2m → 8m → 30m → give up.
function backoffSeconds(attemptNumber) {
  return Math.min(30 * Math.pow(4, attemptNumber - 1), 30 * 60);
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Queue one email for analysis. Called by the sync worker as mail arrives, and
 * by the re-analyse endpoint. Idempotent: an email already completed or
 * permanently failed is left alone unless `force` is set.
 */
async function enqueueEmail(gmail_id, { force = false } = {}) {
  if (!gmail_id) return false;
  const db  = await getDb();
  const col = db.collection('email_analysis');

  const existing = await col.findOne({ gmail_id });
  if (existing && !force && (existing.status === 'completed' || existing.status === 'failed')) return false;

  await col.updateOne(
    { gmail_id },
    {
      $setOnInsert: { created_at: new Date(), attempts: 0 },
      $set: {
        status: 'pending',
        processing_id: null,
        next_attempt_at: null,
        ...(force ? { attempts: 0, error: null, last_error: null } : {}),
        updated_at: new Date(),
      },
    },
    { upsert: true }
  );

  if (inFlight < MAX_CONCURRENCY) {
    setImmediate(() => processTick().catch(err => logger.error('[EmailAI] Immediate tick failed', { message: err.message })));
  }
  return true;
}

/**
 * Enrol any stored email that has no analysis row yet. Bounded per tick so a
 * mailbox backfilled with tens of thousands of messages drains steadily instead
 * of queueing everything at once.
 */
async function sweepUnanalysed(db) {
  const pending = await db.collection('emails').aggregate([
    { $match: { is_deleted: { $ne: true } } },
    { $sort: { received_at: -1 } },
    { $limit: SWEEP_BATCH },
    { $lookup: { from: 'email_analysis', localField: 'gmail_id', foreignField: 'gmail_id', as: 'analysis' } },
    { $match: { analysis: { $size: 0 } } },
    { $project: { gmail_id: 1 } },
  ]).toArray();

  if (!pending.length) return 0;

  const now = new Date();
  await db.collection('email_analysis').bulkWrite(
    pending.map(({ gmail_id }) => ({
      updateOne: {
        filter: { gmail_id },
        update: { $setOnInsert: { created_at: now, attempts: 0, status: 'pending' } },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  logger.info('[EmailAI] Enrolled unanalysed emails', { count: pending.length });
  return pending.length;
}

// ─── Claiming ─────────────────────────────────────────────────────────────────

async function resetStaleLocks(db) {
  const threshold = new Date(Date.now() - STALE_LOCK_MIN * 60 * 1000);
  const res = await db.collection('email_analysis').updateMany(
    { status: 'processing', updated_at: { $lt: threshold } },
    { $set: { status: 'pending', processing_id: null, error: 'Stale lock reset', updated_at: new Date() } }
  );
  if (res.modifiedCount > 0) logger.warn('[EmailAI] Reset stale locks', { count: res.modifiedCount });
}

async function claimNext(db) {
  const now = new Date();
  const processingId = now.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
  return db.collection('email_analysis').findOneAndUpdate(
    {
      status: 'pending',
      $or: [
        { next_attempt_at: { $exists: false } },
        { next_attempt_at: null },
        { next_attempt_at: { $lte: now } },
      ],
    },
    { $set: { status: 'processing', processing_id: processingId, updated_at: now } },
    { sort: { created_at: -1 }, returnDocument: 'after' }   // newest first, like calls
  );
}

function startHeartbeat(db, gmail_id, processing_id) {
  return setInterval(async () => {
    try {
      await db.collection('email_analysis').updateOne(
        { gmail_id, processing_id, status: 'processing' },
        { $set: { updated_at: new Date() } }
      );
    } catch { /* best-effort */ }
  }, 60_000);
}

// ─── Processing one email ─────────────────────────────────────────────────────

/**
 * Analysis results are written to `email_analysis`, and the headline pair is
 * mirrored onto the `emails` document so list queries can filter and sort on
 * category without a join — exactly how the call worker mirrors onto `calls`.
 */
async function writeBack(db, ownedFilter, gmail_id, analysisSet, emailSet) {
  const wb = await db.collection('email_analysis').updateOne(ownedFilter, { $set: analysisSet });
  if (wb.matchedCount === 0) {
    logger.warn('[EmailAI] Lock lost, skipping writeback', { gmail_id });
    return false;
  }
  await db.collection('emails').updateOne({ gmail_id }, { $set: emailSet });
  return true;
}

async function processRecord(db, record) {
  const { gmail_id, processing_id } = record;
  const ownedFilter = { gmail_id, processing_id };
  const heartbeat = startHeartbeat(db, gmail_id, processing_id);

  logger.debug('[EmailAI] Processing', { gmail_id, inFlight });

  try {
    const email = await db.collection('emails').findOne({ gmail_id });
    if (!email) {
      await db.collection('email_analysis').updateOne(ownedFilter, {
        $set: { status: 'failed', error: 'Email no longer in the database', processing_id: null, updated_at: new Date() },
      });
      logger.warn('[EmailAI] Email vanished before analysis', { gmail_id });
      return;
    }

    // Nothing to analyse — the email equivalent of "Call too Short". Spends no
    // Gemini quota, mirroring how sub-10-second calls are short-circuited.
    const bodyChars = emailToPlainText(email).length;
    if (bodyChars < MIN_BODY_CHARS) {
      const now = new Date();
      await writeBack(db, ownedFilter, gmail_id, {
        status: 'completed', category: TOO_SHORT_CATEGORY, sub_category: '',
        email_category: TOO_SHORT_CATEGORY, email_sub_category: '',
        summary: '', ai_insight: '-', bugs: '-', bug_category: '-',
        requested_action: 'Other', language: [], body_chars: bodyChars,
        error: null, last_error: null, next_attempt_at: null, processing_id: null,
        processed_at: now, updated_at: now,
      }, {
        category: TOO_SHORT_CATEGORY, sub_category: '', ai_insight: '-', analysed_at: now,
      });
      logger.info('[EmailAI] Skipped (no usable body)', { gmail_id, bodyChars });
      return;
    }

    // Fresh taxonomy snapshot per job, so categories created while a backlog
    // drains are visible to later jobs.
    const [callCatDocs, bugCatDocs] = await Promise.all([
      db.collection('call_categories').find({}).toArray(),
      db.collection('bug_categories').find({}).toArray(),
    ]);
    const callCategories = callCatDocs.map(c => ({
      name: c.name,
      sub_categories: Array.isArray(c.sub_categories) ? c.sub_categories : [],
    }));
    const bugCategories = bugCatDocs.map(c => c.name);

    const result = await categorizeEmail(email, { callCategories, bugCategories });

    if (result.success) {
      const now = new Date();
      const ok = await writeBack(db, ownedFilter, gmail_id, {
        status:             'completed',
        category:           result.category,
        sub_category:       result.sub_category,
        summary:            result.summary,
        ai_insight:         result.ai_insight,
        bugs:               result.bugs,
        bug_category:       result.bug_category,
        email_category:     result.email_category,
        email_sub_category: result.email_sub_category,
        requested_action:   result.requested_action,
        language:           result.language,
        body_chars:         result.body_chars,
        model_used:         result.model_used || null,
        used_fallback:      !!result.used_fallback,
        error:              null,
        last_error:         null,
        next_attempt_at:    null,
        processing_id:      null,
        processed_at:       now,
        updated_at:         now,
      }, {
        category:     result.category,
        sub_category: result.sub_category,
        ai_insight:   result.ai_insight,
        analysed_at:  now,
      });
      if (ok) logger.info('[EmailAI] Done', { gmail_id, category: result.category });
      return;
    }

    if (result.permanent) {
      await db.collection('email_analysis').updateOne(ownedFilter, {
        $set: { status: 'failed', error: result.error, processing_id: null, updated_at: new Date() },
        $inc: { attempts: 1 },
      });
      logger.warn('[EmailAI] Permanent failure — not retrying', { gmail_id, error: result.error });
      return;
    }

    await scheduleRetryOrFail(db, record, ownedFilter, result.error);
  } catch (err) {
    logger.error('[EmailAI] Unexpected error', { gmail_id, message: err.message, stack: err.stack });
    await scheduleRetryOrFail(db, record, ownedFilter, err.message || 'Unexpected error');
  } finally {
    clearInterval(heartbeat);
  }
}

async function scheduleRetryOrFail(db, record, ownedFilter, errMessage) {
  const col = db.collection('email_analysis');
  const { gmail_id } = record;
  const newAttempts = (record.attempts || 0) + 1;

  if (newAttempts < MAX_ATTEMPTS) {
    const backoffSec = backoffSeconds(newAttempts);
    const wb = await col.updateOne(ownedFilter, {
      $set: {
        status: 'pending',
        processing_id: null,
        next_attempt_at: new Date(Date.now() + backoffSec * 1000),
        last_error: errMessage,
        updated_at: new Date(),
      },
      $inc: { attempts: 1 },
    });
    if (wb.matchedCount === 0) return logger.warn('[EmailAI] Lock lost during retry schedule', { gmail_id });
    logger.warn('[EmailAI] Scheduled retry', { gmail_id, attempt: newAttempts, maxAttempts: MAX_ATTEMPTS, backoffSec, error: errMessage });
  } else {
    const wb = await col.updateOne(ownedFilter, {
      $set: { status: 'failed', error: errMessage, processing_id: null, updated_at: new Date() },
      $inc: { attempts: 1 },
    });
    if (wb.matchedCount === 0) return logger.warn('[EmailAI] Lock lost during final fail', { gmail_id });
    logger.error('[EmailAI] Max retries exceeded — giving up', { gmail_id, attempts: newAttempts, error: errMessage });
  }
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

async function processTick() {
  if (!analysisEnabled()) return;
  if (tickRunning) { tickQueued = true; return; }
  tickRunning = true;

  try {
    let db;
    try {
      db = await getDb();
    } catch (err) {
      logger.error('[EmailAI] DB connection error', { message: err.message });
      return;
    }

    if (inFlight < MAX_CONCURRENCY) {
      await resetStaleLocks(db);
      await sweepUnanalysed(db);
    }

    while (inFlight < MAX_CONCURRENCY) {
      const record = await claimNext(db);
      if (!record) break;
      inFlight += 1;
      processRecord(db, record)
        .catch(err => logger.error('[EmailAI] Unhandled job error', { message: err.message }))
        .finally(() => {
          inFlight -= 1;
          setImmediate(() => processTick().catch(err => logger.error('[EmailAI] Tick error', { message: err.message })));
        });
    }
  } finally {
    tickRunning = false;
    if (tickQueued) {
      tickQueued = false;
      setImmediate(() => processTick().catch(err => logger.error('[EmailAI] Queued tick error', { message: err.message })));
    }
  }
}

function startEmailAnalysisWorker() {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('[EmailAI] Not started — GEMINI_API_KEY is not set');
    return;
  }
  if (!analysisEnabled()) {
    logger.info('[EmailAI] Not started — EMAIL_ANALYSIS_ENABLED is false');
    return;
  }
  logger.info('[EmailAI] Started', {
    concurrency: MAX_CONCURRENCY,
    pollIntervalSec: POLL_INTERVAL_MS / 1000,
    minBodyChars: MIN_BODY_CHARS,
  });
  processTick().catch(err => logger.error('[EmailAI] Initial tick failed', { message: err.message }));
  timer = setInterval(
    () => processTick().catch(err => logger.error('[EmailAI] Tick failed', { message: err.message })),
    POLL_INTERVAL_MS
  );
  timer.unref?.();
}

module.exports = { startEmailAnalysisWorker, enqueueEmail, processTick, TOO_SHORT_CATEGORY };
