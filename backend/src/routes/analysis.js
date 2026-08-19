const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { createExportJob, getExportJob } = require('../workers/exportWorker');
const { detectTranscriptionLoop, generateCategoryTaxonomy, generaliseCategoryTaxonomy, CATEGORIZATION_SCHEMA } = require('../services/geminiService');
const { dynamicCategoriesEnabled } = require('../config/features');
const { tagMatch } = require('../lib/tags');
const {
  normaliseSource, buildCallAnalysisFilter, buildEmailAnalysisFilter,
} = require('../lib/analysisFilters');

const router = express.Router();

// Both taxonomy generators REPLACE the call_categories collection, and
// /generalise-categories additionally retro-remaps every historical record.
// Neither may run while the dynamic taxonomy is switched off — otherwise a
// stray admin call would repopulate the very taxonomy the flag exists to
// freeze. 409, not 403: the caller has the rights, the feature is disabled.
function requireDynamicCategories(req, res, next) {
  if (dynamicCategoriesEnabled()) return next();
  return res.status(409).json({
    ok: false,
    error: 'Dynamic call categories are disabled. Analysis uses the hardcoded CATEGORIZATION_SCHEMA only. Set DYNAMIC_CATEGORIES_ENABLED=true and restart the backend to re-enable taxonomy generation.',
    flag: 'DYNAMIC_CATEGORIES_ENABLED',
  });
}

// Token-based download for analysis export (no Authorization header required).
// Must be declared before `requireAuth` mount — which happens in server.js.
// To expose a non-auth route on this router, we use a path prefix and check
// directly for the signed token.
router.get('/export/jobs/:id/download', async (req, res, next) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (!queryToken) return next(); // let Bearer-auth fallback handle it

  let payload;
  try {
    payload = jwt.verify(queryToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired download token' });
  }
  if (payload.job_id !== req.params.id || payload.type !== 'analysis-export-download') {
    return res.status(403).json({ error: 'Token does not match job' });
  }

  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (job.status !== 'completed') return res.status(409).json({ error: 'Export is not ready yet' });
  if (!job.file_path) return res.status(404).json({ error: 'Export file missing' });

  const baseDir = path.resolve(process.env.LOG_DIR || path.join(__dirname, '../../logs'), 'exports');
  const filePath = path.resolve(job.file_path);
  if (!filePath.startsWith(baseDir)) return res.status(400).json({ error: 'Invalid export path' });

  try { await fs.access(filePath); }
  catch { return res.status(404).json({ error: 'Export file not found on disk' }); }

  res.download(filePath, job.file_name || path.basename(filePath), (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Failed to download export' });
  });
});

// All routes below require authentication
router.use(requireAuth);

function pickAnalysisExportFilters(src = {}) {
  const pick = k => typeof src[k] === 'string' ? src[k].trim() : '';
  return {
    search: pick('search'),
    category: pick('category'),
    callCategory: pick('callCategory'),
    bugCategory: pick('bugCategory'),
    bugsOnly: pick('bugsOnly'),
    dateFrom: pick('dateFrom'),
    dateTo: pick('dateTo'),
    source: pick('source'),
  };
}

function canAccessJob(job, user) {
  if (!job) return false;
  if (user?.role === 'admin') return true;
  return job.requested_by?.agent_number && user?.agent_number && job.requested_by.agent_number === user.agent_number;
}

// GET /api/analysis/queue-stats — snapshot of the analysis pipeline.
// Returns counts by status plus useful breakdowns for the pending bucket.
// Admin-only because this reveals operational/internal state.
router.get('/queue-stats', requireAdmin, async (req, res) => {
  const db = await getDb();
  const col = db.collection('call_analysis');
  const now = new Date();
  const STALE_MS = 15 * 60 * 1000;

  // Single aggregation — one pass over the collection.
  const [row] = await col.aggregate([
    {
      $group: {
        _id: null,
        analyzed:   { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        processing: { $sum: { $cond: [{ $eq: ['$status', 'processing'] }, 1, 0] } },
        pending:    { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        failed:     { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        // Pending with a scheduled retry that hasn't elapsed yet
        retryScheduled: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$status', 'pending'] },
                { $ne: ['$next_attempt_at', null] },
                { $gt: ['$next_attempt_at', now] },
              ]},
              1,
              0,
            ],
          },
        },
        // Processing records that haven't updated in STALE_MS — likely dead worker
        stuck: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$status', 'processing'] },
                { $lt: ['$updated_at', new Date(now.getTime() - STALE_MS)] },
              ]},
              1,
              0,
            ],
          },
        },
        // Total attempts (sum across all records) — useful for Gemini usage estimation
        totalAttempts: { $sum: { $ifNull: ['$attempts', 0] } },
      },
    },
  ]).toArray();

  const stats = row || {};
  const pending = stats.pending || 0;
  const retryScheduled = stats.retryScheduled || 0;
  const readyNow = Math.max(pending - retryScheduled, 0);
  const analyzed = stats.analyzed || 0;
  const processing = stats.processing || 0;
  const failed = stats.failed || 0;
  const total = analyzed + processing + pending + failed;

  // Timestamps of next retry and oldest pending — helpful for ops visibility
  const [earliestRetry, oldestPending] = await Promise.all([
    col.findOne(
      { status: 'pending', next_attempt_at: { $gt: now } },
      { projection: { next_attempt_at: 1 }, sort: { next_attempt_at: 1 } }
    ),
    col.findOne(
      { status: 'pending' },
      { projection: { created_at: 1 }, sort: { created_at: 1 } }
    ),
  ]);

  res.json({
    analyzed,
    processing,
    pending,
    failed,
    total,
    queue: {
      ready_now:       readyNow,
      retry_scheduled: retryScheduled,
      stuck:           stats.stuck || 0,
    },
    earliest_retry_at: earliestRetry?.next_attempt_at || null,
    oldest_pending_at: oldestPending?.created_at || null,
    total_attempts:    stats.totalAttempts || 0,
    as_of:             now,
  });
});

// POST /api/analysis/export/jobs — queue async export
//
// The CSV follows the source the tab is showing, because an export that
// disagrees with the screen it was taken from is worse than no export. Calls
// alone keep the long-standing call-analysis CSV, column for column; asking for
// mail — alone or beside the calls — produces the mixed one.
router.post('/export/jobs', async (req, res) => {
  const filters = pickAnalysisExportFilters(req.body || {});
  const type = normaliseSource(filters.source) === 'calls' ? 'analysis' : 'analysisMixed';
  const jobId = await createExportJob({ filters, user: req.user, type });
  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/analysis/export/jobs/:id — job status
router.get('/export/jobs/:id', async (req, res) => {
  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (!canAccessJob(job, req.user)) return res.status(403).json({ error: 'Access denied' });

  let downloadUrl = null;
  if (job.status === 'completed') {
    const token = jwt.sign(
      { job_id: job._id.toString(), type: 'analysis-export-download' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    downloadUrl = `/api/analysis/export/jobs/${job._id.toString()}/download?token=${token}`;
  }

  res.json({
    job_id: job._id.toString(),
    status: job.status,
    rows_processed: job.rows_processed || 0,
    file_name: job.file_name || null,
    file_size: job.file_size || null,
    error: job.error || null,
    download_url: downloadUrl,
  });
});

// POST /api/analysis/retry-failed — admin-only: requeue records that exhausted retries.
// Body (all optional):
//   call_ids:   string[]   specific records to reset (takes priority over other filters)
//   since:      ISO date   only records created at or after this
//   until:      ISO date   only records created at or before this
//   all:        boolean    if true, reset every failed record (ignores limit safety cap)
//   limit:      number     max records to reset (default 1000, max 100000)
//   reason:     string     free-text note, stored on each record for audit
//
// By default the endpoint caps at 1000 to avoid accidentally kicking off a huge
// Gemini batch. Pass { "all": true } (or a large `limit`) to override.
router.post('/retry-failed', requireAdmin, async (req, res) => {
  const db = await getDb();
  const { call_ids, since, until, reason, all } = req.body || {};
  const rawLimit = Number(req.body?.limit);
  const limit = all
    ? 1_000_000
    : Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 1000, 1), 100_000);

  // Base filter: only records currently marked failed (terminal state)
  const filter = { status: 'failed' };

  if (Array.isArray(call_ids) && call_ids.length > 0) {
    filter.call_id = { $in: call_ids.filter(id => typeof id === 'string' && id.trim()) };
  } else {
    const dateRange = {};
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) dateRange.$gte = d;
    }
    if (until) {
      const d = new Date(until);
      if (!Number.isNaN(d.getTime())) dateRange.$lte = d;
    }
    if (Object.keys(dateRange).length > 0) filter.created_at = dateRange;
  }

  const matched = await db.collection('call_analysis').countDocuments(filter);
  if (matched === 0) {
    return res.json({ ok: true, matched: 0, reset: 0, message: 'No failed records match the filter' });
  }

  const retryMeta = {
    status: 'pending',
    attempts: 0,
    error: null,
    last_error: null,
    next_attempt_at: null,
    processing_id: null,
    retry_requested_at: new Date(),
    retry_requested_by: req.user?.name || req.user?.role || 'admin',
    retry_reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : null,
    updated_at: new Date(),
  };

  // Fast path: resetting all matching records — a single bulk updateMany is
  // much cheaper than fetching _ids then updating.
  if (matched <= limit) {
    const result = await db.collection('call_analysis').updateMany(filter, { $set: retryMeta });
    return res.json({
      ok: true,
      matched,
      reset: result.modifiedCount,
      limited: false,
      message: `Reset ${result.modifiedCount} failed record(s) to pending; the worker will pick them up on its next tick.`,
    });
  }

  // Bounded path: more matches than our limit — pick the newest `limit` records
  const ids = await db.collection('call_analysis')
    .find(filter, { projection: { _id: 1 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  const result = await db.collection('call_analysis').updateMany(
    { _id: { $in: ids.map(d => d._id) } },
    { $set: retryMeta }
  );

  res.json({
    ok: true,
    matched,
    reset: result.modifiedCount,
    limited: true,
    message: `Reset ${result.modifiedCount} of ${matched} failed record(s) (limited by 'limit'); pass {"all": true} to reset everything.`,
  });
});

// POST /api/analysis/reset-backoff — admin-only: clear scheduled retry timestamps
// so records waiting on exponential backoff become eligible for the next worker
// tick immediately. Useful after fixing an external issue (Gemini key, rate
// limit window, network) when you don't want to wait minutes for the backoff
// to elapse naturally.
//
// Body (all optional):
//   call_ids:        string[]  specific records (takes priority over filters)
//   since:           ISO date  only records updated at or after this
//   until:           ISO date  only records updated at or before this
//   reset_attempts:  boolean   also reset `attempts` to 0 (fresh 5-attempt budget)
//   all:             boolean   bypass the safety cap
//   limit:           number    max records (default 1000, max 100000)
//   reason:          string    audit note stored on each record
router.post('/reset-backoff', requireAdmin, async (req, res) => {
  const db = await getDb();
  const { call_ids, since, until, reason, all, reset_attempts } = req.body || {};
  const rawLimit = Number(req.body?.limit);
  const limit = all
    ? 1_000_000
    : Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 1000, 1), 100_000);

  // Only targets pending records with a future next_attempt_at — those are the
  // ones actually sitting in exponential-backoff limbo. status='processing' is
  // handled by the stale-lock reset; status='failed' is handled by /retry-failed.
  const now = new Date();
  const filter = {
    status: 'pending',
    next_attempt_at: { $gt: now },
  };

  if (Array.isArray(call_ids) && call_ids.length > 0) {
    filter.call_id = { $in: call_ids.filter(id => typeof id === 'string' && id.trim()) };
  } else {
    const dateRange = {};
    if (since) { const d = new Date(since); if (!Number.isNaN(d.getTime())) dateRange.$gte = d; }
    if (until) { const d = new Date(until); if (!Number.isNaN(d.getTime())) dateRange.$lte = d; }
    if (Object.keys(dateRange).length > 0) filter.updated_at = dateRange;
  }

  const matched = await db.collection('call_analysis').countDocuments(filter);
  if (matched === 0) {
    return res.json({
      ok: true,
      matched: 0,
      reset: 0,
      message: 'No pending records are currently waiting on a scheduled retry',
    });
  }

  const resetMeta = {
    next_attempt_at: null,
    updated_at: now,
    backoff_reset_at: now,
    backoff_reset_by: req.user?.name || req.user?.role || 'admin',
    backoff_reset_reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : null,
  };
  if (reset_attempts) resetMeta.attempts = 0;

  // Fast path: all matches fit under the cap
  if (matched <= limit) {
    const result = await db.collection('call_analysis').updateMany(filter, { $set: resetMeta });
    return res.json({
      ok: true,
      matched,
      reset: result.modifiedCount,
      reset_attempts: !!reset_attempts,
      limited: false,
      message: `Cleared backoff on ${result.modifiedCount} record(s); the worker will pick them up on its next tick.`,
    });
  }

  // Bounded path — pick the ones whose retry would happen soonest first, so the
  // user sees quickest movement (they were closest to being processed anyway).
  const ids = await db.collection('call_analysis')
    .find(filter, { projection: { _id: 1 } })
    .sort({ next_attempt_at: 1 })
    .limit(limit)
    .toArray();

  const result = await db.collection('call_analysis').updateMany(
    { _id: { $in: ids.map(d => d._id) } },
    { $set: resetMeta }
  );

  res.json({
    ok: true,
    matched,
    reset: result.modifiedCount,
    reset_attempts: !!reset_attempts,
    limited: true,
    message: `Cleared backoff on ${result.modifiedCount} of ${matched} record(s) (limited); pass {"all": true} to release all.`,
  });
});

// POST /api/analysis/reset-loops — admin-only: clear analysis on records whose
// stored transcription shows a Gemini repetition loop, and re-queue them for
// re-analysis. Targets status='completed' records whose transcription is
// suspiciously long AND passes the in-code loop detector, plus status='failed'
// records tagged with error='transcription_loop_detected'. Never touches
// status='processing' records — those belong to an active worker.
//
// Body (all optional):
//   call_ids:                 string[]  specific records (takes priority)
//   since:                    ISO date  only records created at or after this
//   until:                    ISO date  only records created at or before this
//   min_transcription_chars:  number    DB-side length prefilter (default 32000,
//                                       min 1000). Excel's per-cell cap is 32,767.
//   include_failed:           boolean   include failed records with the loop
//                                       marker (default true)
//   dry_run:                  boolean   scan and report without mutating
//   all:                      boolean   bypass the safety cap
//   limit:                    number    max candidates scanned (default 1000,
//                                       max 100000)
//   reason:                   string    audit note stored on each record
router.post('/reset-loops', requireAdmin, async (req, res) => {
  const db = await getDb();
  const { call_ids, since, until, reason, all, dry_run } = req.body || {};
  const includeFailed = req.body?.include_failed !== false; // default true
  const rawLimit = Number(req.body?.limit);
  const limit = all
    ? 1_000_000
    : Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 1000, 1), 100_000);
  const minChars = Math.max(1000, Number(req.body?.min_transcription_chars) || 32000);

  // Two OR-branches:
  //  (a) completed + suspiciously-long transcription → verify loop in Node
  //  (b) failed with the loop marker (already confirmed at write time)
  // Explicitly excludes status='processing' so we never race the worker.
  const orBranches = [
    {
      status: 'completed',
      transcription: { $type: 'string' },
      $expr: { $gte: [{ $strLenCP: { $ifNull: ['$transcription', ''] } }, minChars] },
    },
  ];
  if (includeFailed) {
    orBranches.push({ status: 'failed', error: 'transcription_loop_detected' });
  }
  const filter = { $or: orBranches };

  if (Array.isArray(call_ids) && call_ids.length > 0) {
    filter.call_id = { $in: call_ids.filter(id => typeof id === 'string' && id.trim()) };
  } else {
    const dateRange = {};
    if (since) { const d = new Date(since); if (!Number.isNaN(d.getTime())) dateRange.$gte = d; }
    if (until) { const d = new Date(until); if (!Number.isNaN(d.getTime())) dateRange.$lte = d; }
    if (Object.keys(dateRange).length > 0) filter.created_at = dateRange;
  }

  // Scan candidates. Pull transcription + status so we can verify the loop in
  // Node (cheap per-row) and confirm status at update time (prevents races).
  const candidates = await db.collection('call_analysis')
    .find(filter, { projection: { _id: 1, call_id: 1, status: 1, transcription: 1 } })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();

  // For completed records, re-verify with the full detector. For failed records
  // already tagged with the loop marker, accept them directly.
  const toReset = candidates.filter(c =>
    (c.status === 'failed') || detectTranscriptionLoop(c.transcription)
  );

  if (toReset.length === 0) {
    return res.json({
      ok: true,
      matched: candidates.length,
      reset: 0,
      message: 'No looping transcriptions matched the filter',
    });
  }

  if (dry_run) {
    return res.json({
      ok: true,
      dry_run: true,
      matched: candidates.length,
      would_reset: toReset.length,
      sample_call_ids: toReset.slice(0, 20).map(d => d.call_id),
      message: `Dry run: would reset ${toReset.length} record(s) to pending.`,
    });
  }

  const now = new Date();
  const resetMeta = {
    status: 'pending',
    attempts: 0,
    error: null,
    last_error: null,
    next_attempt_at: null,
    processing_id: null,
    transcription: '',
    summary: '',
    ai_insight: '',
    bugs: '',
    category: '',
    sub_category: '',
    call_category: '',
    bug_category: '',
    agent_score: null,
    call_resolved: '',
    audio_quality: null,
    language: [],
    loop_reset_at: now,
    loop_reset_by: req.user?.name || req.user?.role || 'admin',
    loop_reset_reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : null,
    updated_at: now,
  };

  // Re-check status in the update filter so we don't clobber a record that
  // transitioned (e.g. the webhook re-enqueued it, or another admin reset it)
  // between our scan and our write.
  const result = await db.collection('call_analysis').updateMany(
    {
      _id: { $in: toReset.map(d => d._id) },
      status: { $in: ['completed', 'failed'] },
    },
    { $set: resetMeta }
  );

  res.json({
    ok: true,
    matched: candidates.length,
    reset: result.modifiedCount,
    skipped: toReset.length - result.modifiedCount,
    sample_call_ids: toReset.slice(0, 20).map(d => d.call_id),
    message: `Reset ${result.modifiedCount} record(s) with looping transcriptions to pending; the worker will re-analyse them on its next tick.`,
  });
});

// POST /api/analysis/generate-categories — admin-only: feed past call summaries
// to Gemini and ask it to derive a hierarchical { category, sub_categories[] }
// taxonomy. By default returns the proposal without writing (dry_run). Pass
// dry_run=false (or commit=true) to snapshot the existing call_categories
// collection into call_categories_history, then replace it with the new
// taxonomy. The analysis worker reads call_categories on every job, so the
// next analysis tick after a successful write uses the new taxonomy.
//
// Body (all optional):
//   since:             ISO date  earliest created_at to include (default: any)
//   until:             ISO date  latest created_at to include (default: now)
//   max_summaries:     number    cap on summaries fed to Gemini (default 2000,
//                                 max 10000). More = better clustering, more cost.
//   target_count:      number    desired top-level category count (default 12)
//   min_subs_per_cat:  number    sub-category minimum per category (default 4)
//   max_subs_per_cat:  number    sub-category maximum per category (default 10)
//   dry_run:           boolean   if true, return proposal only (default true)
//   commit:            boolean   alias for dry_run=false (explicit intent)
//   reason:            string    audit note stored on the history record
router.post('/generate-categories', requireAdmin, requireDynamicCategories, async (req, res) => {
  const db = await getDb();
  const body = req.body || {};
  const dryRun = body.commit === true ? false : (body.dry_run !== false);

  const rawMax = Number(body.max_summaries);
  const maxSummaries = Math.min(
    Math.max(Number.isFinite(rawMax) ? rawMax : 2000, 50),
    10_000
  );
  const targetCount   = Math.max(4, Math.min(30, Number(body.target_count)    || 12));
  const minSubsPerCat = Math.max(2,                 Number(body.min_subs_per_cat) || 4);
  const maxSubsPerCat = Math.max(minSubsPerCat,     Number(body.max_subs_per_cat) || 10);

  // Build the summary-source filter. We only want completed, real analyses
  // — skip "Audio Unclear" / "Call too Short" since their summaries are
  // boilerplate, not useful for clustering.
  const summaryFilter = {
    status: 'completed',
    summary: { $exists: true, $type: 'string', $nin: ['', '-'] },
    category: { $nin: ['Audio Unclear', 'Call too Short'] },
  };
  const dateRange = {};
  if (body.since) { const d = new Date(body.since); if (!Number.isNaN(d.getTime())) dateRange.$gte = d; }
  if (body.until) { const d = new Date(body.until); if (!Number.isNaN(d.getTime())) dateRange.$lte = d; }
  if (Object.keys(dateRange).length > 0) summaryFilter.created_at = dateRange;

  // Pull most-recent first; truncate each to a sane length so one runaway
  // doesn't dominate the prompt token budget.
  const SUMMARY_TRUNC = 500;
  const docs = await db.collection('call_analysis')
    .find(summaryFilter, { projection: { _id: 0, summary: 1 } })
    .sort({ created_at: -1 })
    .limit(maxSummaries)
    .toArray();

  // Dedupe near-identical summaries by their first 80 chars — Gemini repeats
  // weaken the signal and waste input tokens.
  const seen = new Set();
  const summaries = [];
  for (const d of docs) {
    const s = String(d.summary || '').trim().slice(0, SUMMARY_TRUNC);
    if (!s) continue;
    const key = s.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    summaries.push(s);
  }

  if (summaries.length < 20) {
    return res.status(400).json({
      ok: false,
      error: `Not enough completed-analysis summaries to derive a meaningful taxonomy (found ${summaries.length}, need >=20). Widen the date range or wait for more analyses to complete.`,
    });
  }

  const result = await generateCategoryTaxonomy(summaries, {
    targetCount, minSubsPerCat, maxSubsPerCat,
  });
  if (!result.success) {
    return res.status(502).json({ ok: false, error: result.error || 'Gemini taxonomy generation failed' });
  }

  const audit = {
    generated_at: new Date(),
    generated_by: req.user?.name || req.user?.role || 'admin',
    reason:       typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : null,
    gemini_model: result.gemini_model,
    summaries_used: result.summaries_used,
  };

  if (dryRun) {
    return res.json({
      ok: true,
      dry_run: true,
      summaries_used: result.summaries_used,
      categories: result.categories,
      written: null,
      audit,
      message: `Dry run: would replace call_categories with ${result.categories.length} categories. Re-send with commit=true to apply.`,
    });
  }

  // Commit path: snapshot existing call_categories, then replace.
  // Brief gap between deleteMany + insertMany during which the worker would
  // see an empty taxonomy. With concurrency=5 and tick-rate 5s, the chance
  // of a tick landing in that ~10ms window is tiny — and even if it does,
  // the worker just returns "Uncategorised" / "-" for that one call, which
  // self-heals on the next /reset-loops or recategorization run.
  const existing = await db.collection('call_categories').find({}, { projection: { _id: 0 } }).toArray();
  await db.collection('call_categories_history').insertOne({
    ...audit,
    previous_categories: existing,
    new_categories:      result.categories,
  });

  await db.collection('call_categories').deleteMany({});
  const newDocs = result.categories.map(c => ({
    name:           c.name,
    sub_categories: c.sub_categories,
    source:         'gemini-generated',
    generated_at:   audit.generated_at,
    generated_by:   audit.generated_by,
    gemini_model:   audit.gemini_model,
  }));
  if (newDocs.length > 0) {
    await db.collection('call_categories').insertMany(newDocs);
  }

  res.json({
    ok: true,
    dry_run: false,
    summaries_used: result.summaries_used,
    categories: result.categories,
    written: { call_categories: newDocs.length, replaced: existing.length },
    audit,
    message: `Replaced call_categories: ${existing.length} → ${newDocs.length}. The next analysis tick uses the new taxonomy.`,
  });
});

// POST /api/analysis/generalise-categories — admin-only: take the CURRENT
// call_categories collection (granular, possibly many entries from the v3.4.0
// generator + the hourly auto-worker) and consolidate it into a smaller,
// well-defined hierarchy via Gemini. Then RETRO-REMAP every existing record
// — both call_analysis and calls — so historical data uses the new vocabulary
// without re-running Gemini per record.
//
// Body (all optional):
//   dry_run: boolean   if true, return proposal only (default true)
//   commit:  boolean   alias for dry_run=false
//   reason:  string    audit note for the history record
//
// Top-level count and sub-category counts per parent are intentionally NOT
// knobs — Gemini decides both based on the natural cluster boundaries in
// the input. No padding to hit a target, no forced merging.
router.post('/generalise-categories', requireAdmin, requireDynamicCategories, async (req, res) => {
  const db = await getDb();
  const body = req.body || {};
  const dryRun = body.commit === true ? false : (body.dry_run !== false);

  const existing = await db.collection('call_categories')
    .find({}, { projection: { _id: 0 } })
    .toArray();

  if (existing.length < 4) {
    return res.status(400).json({
      ok: false,
      error: `Not enough categories to generalise (found ${existing.length}, need >= 4). Run /generate-categories first or wait for the auto-worker to populate.`,
    });
  }

  // Hand them to Gemini in the shape the helper expects (always include
  // sub_categories, falling back to []).
  const input = existing.map(c => ({
    name: c.name,
    sub_categories: Array.isArray(c.sub_categories) ? c.sub_categories : [],
  }));
  const result = await generaliseCategoryTaxonomy(input, {});
  if (!result.success) {
    return res.status(502).json({ ok: false, error: result.error || 'Gemini generalisation failed', raw: result.raw });
  }

  const audit = {
    generalised_at: new Date(),
    generalised_by: req.user?.name || req.user?.role || 'admin',
    reason:         typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : null,
    gemini_model:   result.gemini_model,
    input_count:    result.input_count,
    output_count:   result.output_count,
  };

  if (dryRun) {
    return res.json({
      ok: true,
      dry_run: true,
      categories: result.categories,
      mapping: result.mapping,
      input_count: result.input_count,
      output_count: result.output_count,
      audit,
      message: `Dry run: would consolidate ${result.input_count} → ${result.output_count} categories and remap every call_analysis + calls record. Re-send with commit=true to apply.`,
    });
  }

  // ── Commit path ────────────────────────────────────────────────────────
  // 1. Snapshot the old + new + mapping into history (audit, rollback)
  // 2. Replace call_categories with the new generalised list
  // 3. Bulk remap call_analysis (call_category, call_sub_category)
  // 4. Bulk remap calls (category, sub_category — used by the calls table)
  //
  // Steps 3 and 4 use one updateMany per old category (typically 20-100 calls
  // per old category in production, so this is a small number of round trips
  // even for huge corpora). Each updateMany is idempotent.

  await db.collection('call_categories_history').insertOne({
    ...audit,
    kind:                'generalise',
    previous_categories: existing,
    new_categories:      result.categories,
    mapping:             result.mapping,
  });

  const now = new Date();
  await db.collection('call_categories').deleteMany({});
  const newDocs = result.categories.map(c => ({
    name:           c.name,
    sub_categories: c.sub_categories,
    merged_from:    c.merged_from || [],
    source:         'gemini-generalised',
    generalised_at: now,
    generalised_by: audit.generalised_by,
    gemini_model:   audit.gemini_model,
  }));
  if (newDocs.length > 0) await db.collection('call_categories').insertMany(newDocs);

  // Retro-remap. Each entry in mapping says: where old_category appears,
  // rewrite call_category -> new_category and call_sub_category ->
  // new_sub_category. We do call_analysis AND calls — the calls collection
  // also stores category/sub_category for the table view.
  let analysisRemapped = 0, callsRemapped = 0;
  for (const [oldCat, target] of Object.entries(result.mapping)) {
    const a = await db.collection('call_analysis').updateMany(
      { call_category: oldCat },
      { $set: {
          call_category:     target.new_category,
          call_sub_category: target.new_sub_category,
          remapped_at:       now,
          remapped_from_category: oldCat,
        }
      }
    );
    analysisRemapped += a.modifiedCount || 0;

    const c = await db.collection('calls').updateMany(
      { category: oldCat },
      { $set: { category: target.new_category, sub_category: target.new_sub_category } }
    );
    callsRemapped += c.modifiedCount || 0;
  }

  res.json({
    ok: true,
    dry_run: false,
    categories: result.categories,
    mapping: result.mapping,
    input_count: result.input_count,
    output_count: result.output_count,
    written: {
      call_categories: newDocs.length,
      replaced:        existing.length,
      call_analysis_remapped: analysisRemapped,
      calls_remapped:         callsRemapped,
    },
    audit,
    message: `Consolidated ${result.input_count} → ${result.output_count} categories. Remapped ${analysisRemapped} call_analysis records and ${callsRemapped} calls. The next analysis tick uses the new taxonomy.`,
  });
});

// GET /api/analysis/:call_id — fetch analysis for a specific call
router.get('/:call_id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('call_analysis').findOne(
    { call_id: req.params.call_id },
    { projection: { _id: 0 } }
  );

  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

// ─── The AI Analysis list ─────────────────────────────────────────────────────
//
// Two queues produce verdicts — recordings and mail — and this tab is where an
// operator reads them. They stay in separate collections because the work is
// different (audio versus text, one call versus a whole correspondence), but a
// VERDICT has the same shape either way: a category, tags, an insight, a bug.
// So the list serves both side by side, each row tagged with where it came from.
//
// `source` picks which queues to read: all (the default), calls, or emails.
// The filters themselves live in lib/analysisFilters, because the CSV export
// builds them from the same functions.

const CALL_SORT_FIELDS = {
  bugs: 'bugs', bug_category: 'bug_category', call_category: 'call_category',
  call_resolved: 'call_resolved', agent_score: 'agent_score',
  audio_quality: 'audio_quality.rating', created_at: 'created_at',
};

/** The mail queue can only be ordered by the keys it actually has. */
const EMAIL_SORT_FIELDS = {
  bugs: 'bugs', bug_category: 'bug_category', call_category: 'email_category',
  created_at: 'created_at',
};

/**
 * The value a merged list sorts on, read off a normalised row.
 *
 * Only the shared keys can order both sources. A call-only key — a score, an
 * audio rating, a recording's length — leaves every mail row undefined, and
 * undefined pins to the bottom, which is the same rule the single-source query
 * already applies to calls with no recording. Sorting by score therefore lists
 * the scored rows first and the mail after, which is the honest reading of that
 * request rather than an interleaving of values that do not exist.
 */
function sortValue(row, sortBy) {
  switch (sortBy) {
    case 'call_category': return row.primary_category;
    case 'bug_category':  return row.bug_category;
    case 'bugs':          return row.bugs;
    case 'call_resolved': return row.call_resolved;
    case 'agent_score':   return row.agent_score;
    case 'audio_quality': return row.audio_quality?.rating;
    case 'recording':     return row.call?.call_recording ? (row.call?.duration ?? 0) : undefined;
    default:              return row.created_at;
  }
}

function isEmptyValue(v) {
  return v === undefined || v === null || v === '';
}

/** Newest / highest first unless asked otherwise; missing values always last. */
function mergeComparator(sortBy, sortDir) {
  const order = sortDir === 'asc' ? 1 : -1;
  return (a, b) => {
    const av = sortValue(a, sortBy);
    const bv = sortValue(b, sortBy);
    if (isEmptyValue(av) !== isEmptyValue(bv)) return isEmptyValue(av) ? 1 : -1;
    if (isEmptyValue(av)) return 0;
    if (av < bv) return -order;
    if (av > bv) return  order;
    return 0;
  };
}

/** One page of call verdicts, with the call each belongs to joined on. */
async function fetchCallAnalyses(db, { filter, sortBy, sortDir, skip, limit }) {
  const sortOrder = sortDir === 'asc' ? 1 : -1;
  let docs, total;

  // Sorting by recording length reads `duration` off the joined `calls`
  // collection, so that one case needs an aggregation. The rest stay on
  // find().sort() to avoid paying for a lookup that changes nothing.
  if (sortBy === 'recording') {
    const pipeline = [
      { $match: filter },
      { $lookup: { from: 'calls', localField: 'call_id', foreignField: 'call_id', as: '_call' } },
      { $unwind: { path: '$_call', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          // "Has recording" pins to the bottom regardless of asc/desc.
          _hasVal: {
            $cond: [
              { $and: [{ $ne: ['$_call.call_recording', null] }, { $ne: ['$_call.call_recording', ''] }] },
              1, 0,
            ],
          },
          _dur: { $ifNull: ['$_call.duration', 0] },
        },
      },
      { $sort: { _hasVal: -1, _dur: sortOrder, _id: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 0, _hasVal: 0, _dur: 0, _call: 0 } },
    ];
    [docs, total] = await Promise.all([
      db.collection('call_analysis').aggregate(pipeline).toArray(),
      db.collection('call_analysis').countDocuments(filter),
    ]);
  } else {
    const sortField = CALL_SORT_FIELDS[sortBy] ?? 'created_at';
    [docs, total] = await Promise.all([
      db.collection('call_analysis').find(filter, { projection: { _id: 0 } })
        .sort({ [sortField]: sortOrder }).skip(skip).limit(limit).toArray(),
      db.collection('call_analysis').countDocuments(filter),
    ]);
  }

  const callIds  = docs.map(d => d.call_id);
  const callDocs = callIds.length
    ? await db.collection('calls').find({ call_id: { $in: callIds } },
        { projection: { call_id:1, caller_number:1, called_number:1, agent_name:1, agent_number:1, call_start_time:1, agent_answer_time:1, duration:1, call_recording:1 } }
      ).toArray()
    : [];
  const callMap = Object.fromEntries(callDocs.map(c => [c.call_id, c]));

  return {
    total,
    rows: docs.map(d => ({
      ...d,
      source: 'call',
      id: d.call_id,
      // What the Category column renders, whichever queue the row came from.
      primary_category: d.call_category,
      call: callMap[d.call_id] || null,
    })),
  };
}

/** One page of mail verdicts, with the correspondence each belongs to joined on. */
async function fetchEmailAnalyses(db, { filter, sortBy, sortDir, skip, limit }) {
  const sortOrder = sortDir === 'asc' ? 1 : -1;
  const sortField = EMAIL_SORT_FIELDS[sortBy] ?? 'created_at';

  const [docs, total] = await Promise.all([
    db.collection('conversation_analysis').find(filter)
      .sort({ [sortField]: sortOrder }).skip(skip).limit(limit).toArray(),
    db.collection('conversation_analysis').countDocuments(filter),
  ]);

  const ids = docs.map(d => d._id);
  const convDocs = ids.length
    ? await db.collection('email_conversations').find({ _id: { $in: ids } },
        { projection: { participant_email:1, participant_name:1, last_subject:1, message_count:1, inbound_count:1, unread_count:1, last_message_at:1 } }
      ).toArray()
    : [];
  const convMap = Object.fromEntries(convDocs.map(c => [c._id, c]));

  return {
    total,
    // processing_id is queue bookkeeping, not a verdict — the same reason the
    // conversation detail endpoint projects it away.
    rows: docs.map(({ _id, processing_id, ...d }) => {
      const conv = convMap[_id] || null;
      return {
        ...d,
        source: 'email',
        id: _id,
        conversation_id: d.conversation_id || _id,
        primary_category: d.email_category || d.category,
        // Named `email` to sit beside a call row's `call`: the thing the verdict
        // is about, joined on for the columns that describe it.
        email: { participant_email: _id, ...(conv || {}) },
      };
    }),
  };
}

// GET /api/analysis — paginated list of verdicts from both queues
router.get('/', async (req, res) => {
  const db = await getDb();
  const {
    category, search, limit = '25', offset = '0', dateFrom, dateTo,
    sortBy, sortDir, bugsOnly, bugCategory, callCategory, source: rawSource,
  } = req.query;

  const source   = normaliseSource(rawSource);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 25));
  const skip     = Math.max(0, Number(offset) || 0);

  const shared      = { search, category, bugsOnly, bugCategory, callCategory, dateFrom, dateTo };
  const callFilter  = buildCallAnalysisFilter(shared);
  const emailFilter = buildEmailAnalysisFilter(shared);

  let analyses, total, counts;

  if (source === 'calls' || source === 'emails') {
    // One queue: page it in the database, exactly as this endpoint always has.
    const fetchPage = source === 'calls' ? fetchCallAnalyses : fetchEmailAnalyses;
    const page = await fetchPage(db, {
      filter: source === 'calls' ? callFilter : emailFilter,
      sortBy, sortDir, skip, limit: pageSize,
    });
    analyses = page.rows;
    total    = page.total;
    counts   = { calls: source === 'calls' ? page.total : 0, emails: source === 'emails' ? page.total : 0 };
  } else {
    // Both: each queue is read to the same depth and the two are merged here.
    // Taking `skip + pageSize` from each is what makes the merge exact — the
    // page cannot contain a row that sorts below something left unfetched.
    const take = skip + pageSize;
    const [calls, emails] = await Promise.all([
      fetchCallAnalyses(db,  { filter: callFilter,  sortBy, sortDir, skip: 0, limit: take }),
      fetchEmailAnalyses(db, { filter: emailFilter, sortBy, sortDir, skip: 0, limit: take }),
    ]);
    analyses = [...calls.rows, ...emails.rows]
      .sort(mergeComparator(sortBy, sortDir))
      .slice(skip, skip + pageSize);
    total  = calls.total + emails.total;
    counts = { calls: calls.total, emails: emails.total };
  }

  // Distinct categories for filter dropdown
  const [categories, bugCategories, callCategories] = await Promise.all([
    db.collection('call_analysis')
      .distinct('category', { status: 'completed', category: { $exists: true, $ne: '' } }),
    db.collection('bug_categories').find({}).sort({ name: 1 }).toArray(),
    db.collection('call_categories').find({}).sort({ name: 1 }).toArray(),
  ]);

  // "Uncategorised" is a sentinel — records can hold it via the v3.5.0
  // retro-remap or when categorize returns it as the no-fit fallback — but
  // it never appears as a document in call_categories, so we append it to
  // the dropdown explicitly. Same idea for bug_categories, where the auto-
  // worker's no-fit case writes "-" but operators occasionally need to
  // filter on truly Uncategorised bugs too.
  // Which vocabulary the Category filter offers has to be the one new verdicts
  // are actually drawn from. With the dynamic taxonomy switched off that is
  // CATEGORIZATION_SCHEMA, and the `call_categories` collection is a fossil of
  // the era when Gemini invented its own names — 955 of them against a schema
  // of five. Offering those would be a dropdown of filters that match nothing
  // analysed from here on.
  const callCategoryNames = dynamicCategoriesEnabled()
    ? callCategories.map(c => c.name)
    : Object.keys(CATEGORIZATION_SCHEMA);
  if (!callCategoryNames.some(n => n.toLowerCase() === 'uncategorised')) {
    callCategoryNames.push('Uncategorised');
  }
  const bugCategoryNames = bugCategories.map(c => c.name);
  if (!bugCategoryNames.some(n => n.toLowerCase() === 'uncategorised')) {
    bugCategoryNames.push('Uncategorised');
  }

  res.json({
    analyses, total, counts, source,
    categories: categories.sort(),
    bugCategories: bugCategoryNames,
    callCategories: callCategoryNames,
  });
});

module.exports = router;
