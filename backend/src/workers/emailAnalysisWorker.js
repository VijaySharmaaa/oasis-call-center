/**
 * Conversation Analysis Worker — the email twin of analysisWorker.js.
 *
 * Same machinery, deliberately: atomic claim via findOneAndUpdate, a
 * processing_id so a reset lock can never be overwritten by the job that lost
 * it, stale-lock recovery, a heartbeat, exponential backoff, and a permanent
 * failure state. If you change the retry policy here, change it there too.
 *
 * THE UNIT OF WORK IS A CONVERSATION, NOT A MESSAGE. A candidate who writes
 * three times about one problem is one case, and analysing each message alone
 * produced three verdicts that disagreed with each other. Every job therefore
 * re-reads the whole exchange and OVERWRITES the previous verdict: the newest
 * message is not an addendum, it is the current state of the case.
 *
 * The verdict is written in four places, all of them derived from
 * `conversation_analysis`:
 *   • conversation_analysis  the record itself, with queue state and cost
 *   • email_conversations    mirrored headline pair, so the list filters cheaply
 *   • emails                 mirrored onto the INBOUND messages, so every
 *                            pre-existing per-message filter, export and report
 *                            keeps working untouched
 *   • email_analysis         one mirror row per inbound message, carrying the
 *                            same verdict; token usage rides only on the newest
 *                            one so the cost report cannot count it twice
 *
 * Differences from the call worker, all of them because email is not audio:
 *   • no upload step — the text goes straight into the prompt
 *   • the "nothing to analyse" shortcut is an empty exchange rather than a call
 *     under 10 seconds
 *   • a sweep stage enrols conversations that were synced before this worker
 *     existed, and stamps conversation ids onto mail that predates them
 *
 * Tunable via env: EMAIL_ANALYSIS_ENABLED, EMAIL_ANALYSIS_CONCURRENCY,
 *                  EMAIL_ANALYSIS_POLL_SEC, EMAIL_ANALYSIS_MIN_CHARS
 */
const { getDb }            = require('../db');
const { categorizeConversation, emailToPlainText } = require('../services/geminiService');
const {
  conversationIdOf, isOutbound, refreshConversation, refreshConversations, backfillConversationIds,
} = require('../lib/conversations');
const { envBool }          = require('../config/features');
const logger               = require('../logger');

const MAX_CONCURRENCY  = Math.max(1, Number(process.env.EMAIL_ANALYSIS_CONCURRENCY || 4));
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.EMAIL_ANALYSIS_POLL_SEC || 10) * 1000);
const MIN_BODY_CHARS   = Math.max(0, Number(process.env.EMAIL_ANALYSIS_MIN_CHARS ?? 15));
const SWEEP_BATCH      = 200;
const BACKFILL_BATCH   = 500;
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
 * Queue one conversation for (re-)analysis. Called by the sync worker as mail
 * arrives, by the sweep, and by the re-analyse endpoints.
 *
 * Idempotent for settled work: a conversation already completed or permanently
 * failed is left alone unless `force` is set. New mail is exactly what `force`
 * is for — the sync worker passes it, because a reply means the previous
 * verdict was formed without the sentence that matters most.
 */
async function enqueueConversation(conversation_id, { force = false } = {}) {
  if (!conversation_id) return false;
  const db  = await getDb();
  const col = db.collection('conversation_analysis');

  const existing = await col.findOne({ _id: conversation_id });
  if (existing && !force && (existing.status === 'completed' || existing.status === 'failed')) return false;

  const now = new Date();
  const set = {
    conversation_id,
    status: 'pending',
    processing_id: null,
    next_attempt_at: null,
    ...(force ? { attempts: 0, error: null, last_error: null } : {}),
    updated_at: now,
  };
  // `attempts` is seeded on insert ONLY when the forced branch is not already
  // setting it: Mongo rejects an update that names the same path in both
  // $setOnInsert and $set, and every sweep enqueue is forced — so the conflict
  // failed the sweep, which fails the tick, which stops the queue draining at
  // all. On a forced insert $set writes the 0 anyway.
  const setOnInsert = force ? { created_at: now } : { created_at: now, attempts: 0 };

  await col.updateOne(
    { _id: conversation_id },
    { $setOnInsert: setOnInsert, $set: set },
    { upsert: true }
  );

  if (inFlight < MAX_CONCURRENCY) {
    setImmediate(() => processTick().catch(err => logger.error('[EmailAI] Immediate tick failed', { message: err.message })));
  }
  return true;
}

/**
 * Queue the conversation ONE message belongs to.
 *
 * The per-message entry point every caller already had. It does not analyse the
 * message in isolation — there is no such thing any more — it finds the case
 * the message is part of and re-reads that.
 */
async function enqueueEmail(gmail_id, { force = false } = {}) {
  if (!gmail_id) return false;
  const db  = await getDb();
  const doc = await db.collection('emails').findOne(
    { gmail_id },
    { projection: { conversation_id: 1, from_email: 1, from_name: 1, to: 1, cc: 1, label_ids: 1 } }
  );
  if (!doc) return false;

  // Mail stored before conversations existed carries no id yet; deriving it
  // here means a re-analyse request never has to wait for the sweep.
  let conversationId = doc.conversation_id;
  if (!conversationId) {
    conversationId = conversationIdOf(doc);
    if (!conversationId) return false;
    await db.collection('emails').updateOne({ gmail_id }, { $set: { conversation_id: conversationId } });
    await refreshConversation(db, conversationId);
  }

  return enqueueConversation(conversationId, { force });
}

/**
 * Enrol conversations with something new to say. Bounded per tick so a mailbox
 * backfilled with tens of thousands of messages drains steadily instead of
 * queueing everything at once.
 *
 * `needs_analysis` is maintained by refreshConversation: it is true when
 * inbound mail landed after the point the last verdict covered, which is both
 * "never analysed" and "replied since" in one flag.
 */
async function sweepConversations(db) {
  // Mail that predates conversations has no id to group by — give it one first,
  // otherwise its rollup never exists and the sweep below never sees it.
  const backfilled = await backfillConversationIds(db, BACKFILL_BATCH);
  if (backfilled.length) await refreshConversations(db, backfilled);

  const pending = await db.collection('email_conversations')
    .find({ needs_analysis: true }, { projection: { _id: 1 } })
    .sort({ last_message_at: -1 })
    .limit(SWEEP_BATCH)
    .toArray();

  if (!pending.length) return 0;

  // Anything already queued or mid-flight is left strictly alone. Forcing a row
  // that is merely waiting out its retry backoff would clear next_attempt_at,
  // and since the sweep runs every tick the job would be retried at full speed
  // forever — a hot loop that spends Gemini quota as fast as the API answers.
  // Only settled rows (completed, permanently failed) and conversations with no
  // row at all are candidates.
  const ids    = pending.map(p => p._id);
  const active = await db.collection('conversation_analysis')
    .find({ _id: { $in: ids }, status: { $in: ['pending', 'processing'] } }, { projection: { _id: 1 } })
    .toArray();
  const busy = new Set(active.map(a => a._id));

  let queued = 0;
  for (const _id of ids) {
    if (busy.has(_id)) continue;
    // force: the flag itself means the stored verdict is out of date, so a
    // settled row is exactly what has to be reopened.
    if (await enqueueConversation(_id, { force: true })) queued += 1;
  }

  if (queued) logger.info('[EmailAI] Enrolled conversations needing analysis', { count: queued });
  return queued;
}

// ─── Claiming ─────────────────────────────────────────────────────────────────

/**
 * Recover locks whose owner is gone — no heartbeat since STALE_LOCK_MIN.
 *
 * A dead worker leaves its row saying `processing`, and there are two quite
 * different reasons for that. It may have died before producing anything, in
 * which case the work still has to happen. Or it may have died in the moment
 * between writing the verdict out and releasing the lock — and then the
 * conversation already carries a current answer, re-running would spend a
 * Gemini call to reproduce it, and until something settles the row the Emails
 * tab reports the chain as "Analysing…" next to the category it already has.
 *
 * The conversation itself says which happened: `needs_analysis` is false and
 * `analysed_at` is set only when a verdict covering the newest inbound message
 * landed. So a stale lock is reconciled against it rather than blindly retried.
 */
async function resetStaleLocks(db) {
  const threshold = new Date(Date.now() - STALE_LOCK_MIN * 60 * 1000);
  const stale = await db.collection('conversation_analysis')
    .find({ status: 'processing', updated_at: { $lt: threshold } })
    .toArray();
  if (!stale.length) return;

  const conversations = await db.collection('email_conversations')
    .find({ _id: { $in: stale.map(r => r._id) } }, { projection: { needs_analysis: 1, analysed_at: 1 } })
    .toArray();
  const byId = new Map(conversations.map(c => [c._id, c]));

  let requeued = 0;
  let reconciled = 0;
  const now = new Date();

  for (const row of stale) {
    const conversation = byId.get(row._id);
    const verdictLanded = !!conversation && conversation.needs_analysis === false && !!conversation.analysed_at;

    // Scoped to the lock we read: if another worker has claimed this row since,
    // it owns it and neither branch may touch it.
    const owned = { _id: row._id, status: 'processing', processing_id: row.processing_id };

    await db.collection('conversation_analysis').updateOne(
      owned,
      verdictLanded
        ? { $set: { status: 'completed', processing_id: null, error: null, updated_at: now, reconciled_at: now } }
        : { $set: { status: 'pending', processing_id: null, next_attempt_at: null, error: 'Stale lock reset', updated_at: now } }
    );

    if (verdictLanded) reconciled += 1; else requeued += 1;
  }

  logger.warn('[EmailAI] Recovered stale locks', { requeued, reconciled });
}

async function claimNext(db) {
  const now = new Date();
  const processingId = now.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
  return db.collection('conversation_analysis').findOneAndUpdate(
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

function startHeartbeat(db, conversation_id, processing_id) {
  return setInterval(async () => {
    try {
      await db.collection('conversation_analysis').updateOne(
        { _id: conversation_id, processing_id, status: 'processing' },
        { $set: { updated_at: new Date() } }
      );
    } catch { /* best-effort */ }
  }, 60_000);
}

// ─── Processing one conversation ──────────────────────────────────────────────

/**
 * Fan the verdict out from `conversation_analysis` to every view of it.
 *
 * The lock is checked first and once: if this job no longer owns the row it has
 * been superseded by a newer one that read newer mail, and writing anything
 * would replace a fresher verdict with a staler one.
 *
 * @param {Date|null} analysedUpto  the newest message this verdict covers, in
 *                        either direction. Stored so the next refresh can tell
 *                        whether anything has arrived since, which is the whole
 *                        basis of `needs_analysis`.
 */
async function writeBack(db, conversation_id, processing_id, {
  analysisSet, conversationSet, emailSet, inboundIds, analysedUpto, usage = null,
}) {
  const owned = await db.collection('conversation_analysis').updateOne(
    { _id: conversation_id, processing_id },
    { $set: analysisSet }
  );
  if (owned.matchedCount === 0) {
    logger.warn('[EmailAI] Lock lost, skipping writeback', { conversation_id });
    return false;
  }

  // Has anything landed while we were thinking? Recomputing the flag from the
  // current rollup rather than clearing it blindly is what stops a message that
  // arrived mid-analysis from being silently swallowed.
  const conv = await db.collection('email_conversations').findOne({ _id: conversation_id });
  const stillNew = !!(conv?.last_message_at && analysedUpto &&
    new Date(conv.last_message_at).getTime() > new Date(analysedUpto).getTime());

  await db.collection('email_conversations').updateOne(
    { _id: conversation_id },
    { $set: { ...conversationSet, analysed_upto: analysedUpto, needs_analysis: stillNew } }
  );

  if (inboundIds.length) {
    // Mirrored onto the messages themselves so every filter, export and report
    // written against `emails` keeps working with no change at all. Outbound
    // mail is left alone: our own replies are not the candidate's issue.
    await db.collection('emails').updateMany(
      { gmail_id: { $in: inboundIds } },
      { $set: emailSet }
    );

    // Per-message analysis rows, same verdict on each. Cost rides only on the
    // newest message: the call was made once, so the report must charge it once.
    const newest = inboundIds[inboundIds.length - 1];
    await db.collection('email_analysis').bulkWrite(
      inboundIds.map(gmail_id => ({
        updateOne: {
          filter: { gmail_id },
          update: {
            $set: {
              ...analysisSet,
              gmail_id,
              conversation_id,
              // Queue state belongs to the conversation row, not to these
              // mirrors — carrying it here would make two queues out of one.
              processing_id: null,
              usage: gmail_id === newest ? usage : null,
            },
            $setOnInsert: { created_at: new Date(), attempts: 0 },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }

  return true;
}

async function processRecord(db, record) {
  const conversation_id = record._id;
  const { processing_id } = record;
  const heartbeat = startHeartbeat(db, conversation_id, processing_id);

  logger.debug('[EmailAI] Processing', { conversation_id, inFlight });

  try {
    const conversation = await db.collection('email_conversations').findOne({ _id: conversation_id });
    const messages = await db.collection('emails')
      .find({ conversation_id, is_deleted: { $ne: true } })
      .toArray();

    if (!conversation || !messages.length) {
      await db.collection('conversation_analysis').updateOne(
        { _id: conversation_id, processing_id },
        { $set: { status: 'failed', error: 'Conversation no longer in the database', processing_id: null, updated_at: new Date() } }
      );
      logger.warn('[EmailAI] Conversation vanished before analysis', { conversation_id });
      return;
    }

    messages.sort((a, b) => new Date(a.received_at || 0).getTime() - new Date(b.received_at || 0).getTime());
    const inbound      = messages.filter(m => !isOutbound(m));
    const inboundIds   = inbound.map(m => m.gmail_id);
    // The newest message in either direction: this verdict was formed having
    // read our replies too, so it covers them.
    const analysedUpto = messages.length ? messages[messages.length - 1].received_at : null;

    // Nothing to analyse — the email equivalent of "Call too Short". Measured
    // over the whole exchange, so a candidate whose three messages each say
    // "?" is still one short conversation rather than three.
    const bodyChars = inbound.reduce((sum, m) => sum + emailToPlainText(m).length, 0);
    if (bodyChars < MIN_BODY_CHARS) {
      const now = new Date();
      await writeBack(db, conversation_id, processing_id, {
        analysisSet: {
          status: 'completed', category: TOO_SHORT_CATEGORY, sub_category: '',
          email_category: TOO_SHORT_CATEGORY, email_sub_category: '',
          // A sentinel is a state, not an issue, so it earns no tag.
          tags: [],
          summary: '', ai_insight: '-', bugs: '-', bug_category: '-',
          requested_action: 'Other', language: [], body_chars: bodyChars,
          message_count: messages.length, inbound_count: inbound.length,
          error: null, last_error: null, next_attempt_at: null, processing_id: null,
          processed_at: now, updated_at: now,
        },
        conversationSet: {
          category: TOO_SHORT_CATEGORY, sub_category: '', tags: [], ai_insight: '-',
          summary: '', analysis_status: 'completed', analysed_at: now,
        },
        emailSet: { category: TOO_SHORT_CATEGORY, sub_category: '', tags: [], ai_insight: '-', analysed_at: now },
        inboundIds, analysedUpto,
      });
      logger.info('[EmailAI] Skipped (no usable body)', { conversation_id, bodyChars, messages: messages.length });
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

    const result = await categorizeConversation(conversation, messages, { callCategories, bugCategories });

    if (result.success) {
      const now = new Date();
      const ok = await writeBack(db, conversation_id, processing_id, {
        analysisSet: {
          status:             'completed',
          category:           result.category,
          sub_category:       result.sub_category,
          tags:               result.tags || [],
          summary:            result.summary,
          ai_insight:         result.ai_insight,
          bugs:               result.bugs,
          bug_category:       result.bug_category,
          email_category:     result.email_category,
          email_sub_category: result.email_sub_category,
          requested_action:   result.requested_action,
          language:           result.language,
          body_chars:         result.body_chars,
          message_count:      messages.length,
          inbound_count:      inbound.length,
          analysed_messages:  result.analysed_messages,
          omitted_messages:   result.omitted_messages,
          model_used:         result.model_used || null,
          used_fallback:      !!result.used_fallback,
          usage:              result.usage || null,
          error:              null,
          last_error:         null,
          next_attempt_at:    null,
          processing_id:      null,
          processed_at:       now,
          updated_at:         now,
        },
        conversationSet: {
          category:         result.category,
          sub_category:     result.sub_category,
          tags:             result.tags || [],
          ai_insight:       result.ai_insight,
          summary:          result.summary,
          bugs:             result.bugs,
          bug_category:     result.bug_category,
          requested_action: result.requested_action,
          analysis_status:  'completed',
          analysed_at:      now,
        },
        emailSet: {
          category:     result.category,
          sub_category: result.sub_category,
          tags:         result.tags || [],
          ai_insight:   result.ai_insight,
          analysed_at:  now,
        },
        inboundIds,
        analysedUpto,
        usage: result.usage || null,
      });
      if (ok) {
        logger.info('[EmailAI] Done', {
          conversation_id, category: result.category,
          tags: (result.tags || []).length, messages: messages.length,
        });
      }
      return;
    }

    if (result.permanent) {
      await db.collection('conversation_analysis').updateOne(
        { _id: conversation_id, processing_id },
        {
          $set: { status: 'failed', error: result.error, processing_id: null, updated_at: new Date() },
          $inc: { attempts: 1 },
        }
      );
      // Stamped as covered even though it failed: the content was tried and
      // cannot succeed, so the sweep must not offer it again until new mail
      // arrives and changes what there is to read.
      await markCovered(db, conversation_id, analysedUpto, 'failed');
      logger.warn('[EmailAI] Permanent failure — not retrying', { conversation_id, error: result.error });
      return;
    }

    await scheduleRetryOrFail(db, record, analysedUpto, result.error);
  } catch (err) {
    logger.error('[EmailAI] Unexpected error', { conversation_id, message: err.message, stack: err.stack });
    await scheduleRetryOrFail(db, record, null, err.message || 'Unexpected error');
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Record that a verdict — or a final refusal to produce one — covers everything
 * up to `analysedUpto`, so `needs_analysis` reflects new mail only.
 */
async function markCovered(db, conversation_id, analysedUpto, analysisStatus) {
  if (!analysedUpto) return;
  const conv = await db.collection('email_conversations').findOne({ _id: conversation_id });
  const stillNew = !!(conv?.last_message_at &&
    new Date(conv.last_message_at).getTime() > new Date(analysedUpto).getTime());
  await db.collection('email_conversations').updateOne(
    { _id: conversation_id },
    { $set: { analysed_upto: analysedUpto, needs_analysis: stillNew, analysis_status: analysisStatus } }
  );
}

async function scheduleRetryOrFail(db, record, analysedUpto, errMessage) {
  const col = db.collection('conversation_analysis');
  const conversation_id = record._id;
  const ownedFilter = { _id: conversation_id, processing_id: record.processing_id };
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
    if (wb.matchedCount === 0) return logger.warn('[EmailAI] Lock lost during retry schedule', { conversation_id });
    logger.warn('[EmailAI] Scheduled retry', { conversation_id, attempt: newAttempts, maxAttempts: MAX_ATTEMPTS, backoffSec, error: errMessage });
  } else {
    const wb = await col.updateOne(ownedFilter, {
      $set: { status: 'failed', error: errMessage, processing_id: null, updated_at: new Date() },
      $inc: { attempts: 1 },
    });
    if (wb.matchedCount === 0) return logger.warn('[EmailAI] Lock lost during final fail', { conversation_id });
    await markCovered(db, conversation_id, analysedUpto, 'failed');
    logger.error('[EmailAI] Max retries exceeded — giving up', { conversation_id, attempts: newAttempts, error: errMessage });
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

    // Enrolment is best-effort. It runs before the claim loop, so letting it
    // throw would mean one bad conversation stops everything already queued
    // from ever being claimed — the queue freezes on a fault in the stage that
    // only feeds it. Log and carry on to the work that is already waiting.
    if (inFlight < MAX_CONCURRENCY) {
      try {
        await resetStaleLocks(db);
        await sweepConversations(db);
      } catch (err) {
        logger.error('[EmailAI] Enrolment failed — continuing with queued work', { message: err.message });
      }
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

module.exports = {
  startEmailAnalysisWorker,
  enqueueEmail,
  enqueueConversation,
  processTick,
  TOO_SHORT_CATEGORY,
};
