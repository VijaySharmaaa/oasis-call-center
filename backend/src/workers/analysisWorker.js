/**
 * Analysis Worker — background job that processes call recordings concurrently.
 *
 * Each tick (every POLL_INTERVAL_MS) claims up to MAX_CONCURRENCY pending calls
 * and processes them in parallel. Gemini I/O is mostly network-bound, so
 * concurrency dramatically improves throughput.
 *
 * Tunable via env: ANALYSIS_CONCURRENCY (default 4)
 *                  ANALYSIS_POLL_SEC   (default 5)
 */
const { getDb }               = require('../db');
const { categorizeRecording } = require('../services/geminiService');
const logger                  = require('../logger');

const MAX_CONCURRENCY  = Math.max(1, Number(process.env.ANALYSIS_CONCURRENCY || 5));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.ANALYSIS_POLL_SEC || 5) * 1000);
const STALE_LOCK_MIN   = 15;
const MAX_ATTEMPTS     = 5;  // total attempts including first

// Exponential backoff between retries for transient Gemini failures.
// Schedule: 30s → 2m → 8m → 30m → give up (all capped at 30m).
function backoffSeconds(attemptNumber) {
  const base = 30;
  const max = 30 * 60;
  return Math.min(base * Math.pow(4, attemptNumber - 1), max);
}

// Concurrency state — all reads/writes happen on the single Node event loop
// so we don't need atomic primitives, but we MUST serialize the tick function
// to prevent two ticks racing on `inFlight` across awaits.
let inFlight = 0;
let tickRunning = false;  // true while a tick is actively claiming/spawning
let tickQueued = false;   // another tick wants to run after the current one finishes

// ─── Stale lock reset ────────────────────────────────────────────────────────
async function resetStaleLocks(db) {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MIN * 60 * 1000);
  const result = await db.collection('call_analysis').updateMany(
    { status: 'processing', updated_at: { $lt: staleThreshold } },
    { $set: { status: 'pending', error: 'Stale lock reset', updated_at: new Date() } }
  );
  if (result.modifiedCount > 0) {
    logger.warn('[Worker] Reset stale locks', { count: result.modifiedCount });
  }
}

// ─── Atomically claim one pending record ─────────────────────────────────────
// MongoDB guarantees findOneAndUpdate is atomic per document, so even across
// multiple workers/containers the same record can never be claimed twice.
// We also record `processing_id` so we can detect stolen locks on writeback.
//
// Sort order is `created_at: -1` — newest first (LIFO). Recent calls reach
// agents/dashboards faster; older backlog drains in the gaps. If you need
// strict FIFO for a backfill, run a one-off script with explicit sort.
async function claimNext(db) {
  const now = new Date();
  const processingId = now.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
  // Only pick records that are due (no scheduled retry, or retry time has passed)
  const result = await db.collection('call_analysis').findOneAndUpdate(
    {
      status: 'pending',
      $or: [
        { next_attempt_at: { $exists: false } },
        { next_attempt_at: null },
        { next_attempt_at: { $lte: now } },
      ],
    },
    { $set: { status: 'processing', processing_id: processingId, updated_at: now } },
    { sort: { created_at: -1 }, returnDocument: 'after' }
  );
  return result;
}

// Periodic heartbeat so long-running Gemini calls aren't wrongly reset as stale
function startHeartbeat(db, call_id, processing_id) {
  return setInterval(async () => {
    try {
      await db.collection('call_analysis').updateOne(
        { call_id, processing_id, status: 'processing' },
        { $set: { updated_at: new Date() } }
      );
    } catch { /* best-effort */ }
  }, 60_000);  // every minute
}

// ─── Process a single record (runs inside its own promise) ───────────────────
async function processRecord(db, record) {
  const analysisCol = db.collection('call_analysis');
  const callsCol    = db.collection('calls');
  const { call_id, recording_url, processing_id } = record;

  // Writebacks only succeed if we still own this record (i.e. the lock wasn't
  // reset and reclaimed by another worker). Prevents two workers overwriting
  // each other if the stale-lock reset ever fires on a still-running job.
  const ownedFilter = { call_id, processing_id };

  logger.info('[Worker] Processing', { call_id, inFlight });

  const heartbeat = startHeartbeat(db, call_id, processing_id);

  try {
    // Skip very short calls
    const callDoc = await callsCol.findOne({ call_id });
    if (callDoc && callDoc.duration > 0 && callDoc.duration < 10) {
      const wb = await analysisCol.updateOne(
        ownedFilter,
        // A sentinel is a state, not an issue, so it earns no tag.
        { $set: { status: 'completed', category: 'Call too Short', sub_category: '', call_category: 'Call too Short', tags: [], summary: '', transcription: '', language: '', error: null, processed_at: new Date(), updated_at: new Date() } }
      );
      if (wb.matchedCount === 0) {
        logger.warn('[Worker] Lock lost, skipping writeback', { call_id });
        return;
      }
      await callsCol.updateOne({ call_id }, { $set: { category: 'Call too Short', sub_category: '', tags: [] } });
      logger.info('[Worker] Skipped (too short)', { call_id, duration: callDoc.duration });
      return;
    }

    // Fetch existing categories — each job fetches its own snapshot so concurrent
    // jobs see the latest dynamically-created categories.
    const [callCatDocs, bugCatDocs] = await Promise.all([
      db.collection('call_categories').find({}).toArray(),
      db.collection('bug_categories').find({}).toArray(),
    ]);
    // call_categories may be flat (legacy: { name }) or hierarchical
    // ({ name, sub_categories: [...] } from generate-categories endpoint).
    // Pass hierarchical shape always; legacy docs surface as { name, sub_categories: [] }.
    const callCategories = callCatDocs.map(c => ({
      name: c.name,
      sub_categories: Array.isArray(c.sub_categories) ? c.sub_categories : [],
    }));
    const bugCategories = bugCatDocs.map(c => c.name);

    const result = await categorizeRecording(recording_url, { callCategories, bugCategories });

    if (result.success && result.category === 'Audio Unclear') {
      const wb = await analysisCol.updateOne(
        ownedFilter,
        { $set: { status: 'completed', category: 'Audio Unclear', sub_category: '', call_category: 'Audio Unclear', tags: [], summary: result.summary || '', ai_insight: '-', bugs: '-', agent_score: null, call_resolved: 'No', audio_quality: result.audio_quality, transcription: result.transcription || '', language: result.language || [], error: null, processed_at: new Date(), updated_at: new Date() } }
      );
      if (wb.matchedCount === 0) {
        logger.warn('[Worker] Lock lost, skipping writeback', { call_id });
        return;
      }
      await callsCol.updateOne({ call_id }, { $set: { category: 'Audio Unclear', sub_category: '', tags: [] } });
      logger.info('[Worker] Audio Unclear', { call_id });
    } else if (result.permanent) {
      const wb = await analysisCol.updateOne(
        ownedFilter,
        { $set: { status: 'failed', error: result.error, updated_at: new Date() }, $inc: { attempts: 1 } }
      );
      if (wb.matchedCount === 0) { logger.warn('[Worker] Lock lost', { call_id }); return; }
      // Note: call_recording is intentionally PRESERVED on permanent failure.
      // Gemini's IP range may be blocked from S3 even when the URL is valid
      // for browsers/admins on a whitelisted network — keeping the URL lets
      // users still attempt playback. The status='failed' marker on
      // call_analysis is the source of truth for "analysis didn't work".
      logger.warn('[Worker] Permanent failure — not retrying', { call_id, error: result.error });
    } else if (result.success) {
      const wb = await analysisCol.updateOne(
        ownedFilter,
        {
          $set: {
            status:            'completed',
            category:          result.category,
            sub_category:      result.sub_category,
            tags:              result.tags || [],
            summary:           result.summary,
            ai_insight:        result.ai_insight,
            bugs:              result.bugs,
            call_category:     result.call_category,
            call_sub_category: result.call_sub_category || '-',
            bug_category:      result.bug_category,
            agent_score:       result.agent_score,
            call_resolved:     result.call_resolved,
            audio_quality:     result.audio_quality,
            transcription:     result.transcription,
            language:          result.language,
            model_used:        result.model_used || null,
            used_fallback:     !!result.used_fallback,
            // Token counts for the cost report. Absent on records analysed
            // before this was captured, which the report states rather than
            // treating as free.
            usage:             result.usage || null,
            error:             null,
            last_error:        null,
            next_attempt_at:   null,
            processing_id:     null,
            processed_at:      new Date(),
            updated_at:        new Date(),
          },
        }
      );
      if (wb.matchedCount === 0) {
        logger.warn('[Worker] Lock lost, skipping writeback', { call_id });
        return;
      }
      // Mirrored onto the call document so the Call Report can filter by tag
      // without joining call_analysis, exactly as the scalar pair is.
      await callsCol.updateOne(
        { call_id },
        { $set: { category: result.category, sub_category: result.sub_category, tags: result.tags || [] } }
      );
      logger.info('[Worker] Done', { call_id, tags: (result.tags || []).length });
    } else {
      // Transient failure — schedule a retry with exponential backoff
      await scheduleRetryOrFail(analysisCol, record, ownedFilter, result.error);
    }
  } catch (err) {
    logger.error('[Worker] Unexpected error', { call_id, message: err.message, stack: err.stack });
    // Treat unexpected errors as transient — will retry until MAX_ATTEMPTS
    await scheduleRetryOrFail(analysisCol, record, ownedFilter, err.message || 'Unexpected error');
  } finally {
    clearInterval(heartbeat);
  }
}

// ─── Retry scheduling ────────────────────────────────────────────────────────
async function scheduleRetryOrFail(analysisCol, record, ownedFilter, errMessage) {
  const { call_id } = record;
  const newAttempts = (record.attempts || 0) + 1;

  if (newAttempts < MAX_ATTEMPTS) {
    const backoffSec = backoffSeconds(newAttempts);
    const nextAt = new Date(Date.now() + backoffSec * 1000);
    const wb = await analysisCol.updateOne(
      ownedFilter,
      {
        $set: {
          status: 'pending',              // put back in queue (not 'failed')
          processing_id: null,
          next_attempt_at: nextAt,
          last_error: errMessage,
          updated_at: new Date(),
        },
        $inc: { attempts: 1 },
      }
    );
    if (wb.matchedCount === 0) {
      logger.warn('[Worker] Lock lost during retry schedule', { call_id });
      return;
    }
    logger.warn('[Worker] Scheduled retry', {
      call_id,
      attempt: newAttempts,
      maxAttempts: MAX_ATTEMPTS,
      backoffSec,
      error: errMessage,
    });
  } else {
    // Exhausted — mark permanently failed
    const wb = await analysisCol.updateOne(
      ownedFilter,
      {
        $set: {
          status: 'failed',
          error: errMessage,
          updated_at: new Date(),
        },
        $inc: { attempts: 1 },
      }
    );
    if (wb.matchedCount === 0) {
      logger.warn('[Worker] Lock lost during final fail', { call_id });
      return;
    }
    logger.error('[Worker] Max retries exceeded — giving up', {
      call_id,
      attempts: newAttempts,
      error: errMessage,
    });
  }
}

// ─── Tick: fill the worker pool up to MAX_CONCURRENCY ────────────────────────
// Serialized via tickRunning — two ticks can never execute the claim/spawn
// loop simultaneously, which prevents over-spawning past MAX_CONCURRENCY.
async function processTick() {
  if (tickRunning) {
    // Another tick is already spawning work; record that we want another pass
    // after it finishes so new pending records aren't left idle.
    tickQueued = true;
    return;
  }
  tickRunning = true;

  try {
    let db;
    try {
      db = await getDb();
    } catch (err) {
      logger.error('[Worker] DB connection error', { message: err.message });
      return;
    }

    // Reset stale locks only when we have headroom to start new work
    if (inFlight < MAX_CONCURRENCY) {
      await resetStaleLocks(db);
    }

    // Claim and spawn jobs until the pool is full (or no more pending records)
    while (inFlight < MAX_CONCURRENCY) {
      const record = await claimNext(db);
      if (!record) break;

      inFlight += 1;

      // Fire-and-forget — each record runs independently. On completion, the
      // .finally() triggers another tick so the pool refills immediately.
      processRecord(db, record)
        .catch(err => logger.error('[Worker] Unhandled job error', { message: err.message }))
        .finally(() => {
          inFlight -= 1;
          // Schedule another tick on the next macrotask so we don't recurse.
          // processTick's own guard collapses multiple pending requests.
          setImmediate(() => {
            processTick().catch(err => logger.error('[Worker] Tick error', { message: err.message }));
          });
        });
    }
  } finally {
    tickRunning = false;
    // If any ticks arrived while we were running, run exactly one more to catch up.
    if (tickQueued) {
      tickQueued = false;
      setImmediate(() => {
        processTick().catch(err => logger.error('[Worker] Queued tick error', { message: err.message }));
      });
    }
  }
}

// ─── Enqueue a new recording (called by webhook) ─────────────────────────────
async function enqueueRecording(call_id, recording_url) {
  const db  = await getDb();
  const col = db.collection('call_analysis');

  const existing = await col.findOne({ call_id });
  if (existing && (existing.status === 'completed' || existing.status === 'failed')) return;

  await col.updateOne(
    { call_id },
    {
      $setOnInsert: { created_at: new Date(), attempts: 0 },
      $set: { recording_url, status: 'pending', updated_at: new Date() },
    },
    { upsert: true }
  );
  logger.info('[Worker] Enqueued', { call_id });

  // Kick the worker immediately so new calls don't wait for the next tick
  if (inFlight < MAX_CONCURRENCY) {
    setImmediate(() => processTick().catch(err =>
      logger.error('[Worker] Immediate tick failed', { message: err.message })
    ));
  }
}

// ─── Start the background polling loop ───────────────────────────────────────
function startWorker() {
  logger.info('[Worker] Started', {
    concurrency: MAX_CONCURRENCY,
    pollIntervalSec: POLL_INTERVAL_MS / 1000,
  });
  processTick();
  setInterval(processTick, POLL_INTERVAL_MS);
}

module.exports = { startWorker, enqueueRecording };
