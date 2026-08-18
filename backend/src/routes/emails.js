const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gmail  = require('../services/gmailService');
const { syncOnce } = require('../workers/emailSyncWorker');
const { enqueueEmail } = require('../workers/emailAnalysisWorker');
const { CATEGORIZATION_SCHEMA } = require('../services/geminiService');
const { tagMatch, unwindTagsStage } = require('../lib/tags');
const logger = require('../logger');

const router = express.Router();
router.use(requireAuth);

// Fields too large to ship in a list response — the detail endpoint has them.
const LIST_PROJECTION = { body_text: 0, body_html: 0 };

/**
 * "Unread" means unread in Gmail AND not yet opened by anyone in Oasis.
 *
 * `is_unread` mirrors Gmail's UNREAD label and is rewritten wholesale on every
 * re-fetch, so an operator's action cannot live there — a history replay or a
 * fresh backfill would silently resurrect it. `read_at` is ours alone: the sync
 * worker never writes it, so it survives re-fetches. It is unset rather than
 * nulled when cleared, which keeps this predicate a plain $exists.
 *
 * Marking read here does NOT mark it read in Gmail. The service account holds
 * gmail.readonly (gmailService.js SCOPE); pushing the label back would need a
 * Workspace super-admin to re-authorise the delegation for gmail.modify.
 */
const UNREAD  = { is_unread: true, read_at: { $exists: false } };
const IS_READ = { $or: [{ is_unread: { $ne: true } }, { read_at: { $exists: true } }] };

/** Mongo doc → API shape. `id` is the Gmail message id, which is stable forever. */
function toApi(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: doc.gmail_id, ...rest };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── GET /api/emails — paginated inbox ────────────────────────────────────────
router.get('/', async (req, res) => {
  const db = await getDb();
  const {
    search, label, from, unread, hasAttachments, threadId,
    includeTrashed, dateFrom, dateTo,
    category, subCategory, analysisStatus,
    limit = '25', offset = '0',
  } = req.query;

  // Soft-deleted mail is hidden unless explicitly asked for. `is_deleted` is
  // absent on documents written before the field existed, hence the $ne.
  const conditions = [{ is_deleted: { $ne: true } }];

  if (includeTrashed !== 'true') conditions.push({ is_trashed: { $ne: true } });
  if (label)     conditions.push({ label_ids: label });
  if (threadId)  conditions.push({ thread_id: threadId });
  if (from)      conditions.push({ from_email: from.toLowerCase() });
  if (unread === 'true')  conditions.push(UNREAD);
  if (unread === 'false') conditions.push(IS_READ);
  if (hasAttachments === 'true') conditions.push({ has_attachments: true });

  // Tags are mirrored onto the email document by the analysis worker, so
  // filtering needs no join. A filter matches mail carrying the category on ANY
  // tag, not just the primary one — that is the whole point of tagging.
  //
  // "Uncategorised" stays scalar-only: it is a sentinel meaning "nothing fit",
  // never a tag, and it must also match mail the worker has not reached yet,
  // which is what an operator means by "not categorised".
  if (category === 'Uncategorised') {
    conditions.push({ $or: [{ category: { $exists: false } }, { category: '' }, { category: 'Uncategorised' }] });
  } else if (category || subCategory) {
    conditions.push(tagMatch(category, subCategory));
  }
  if (analysisStatus === 'analysed')   conditions.push({ analysed_at: { $exists: true } });
  if (analysisStatus === 'unanalysed') conditions.push({ analysed_at: { $exists: false } });

  if (search) {
    const re = { $regex: escapeRegex(search), $options: 'i' };
    conditions.push({ $or: [
      { subject:    re },
      { from_email: re },
      { from_name:  re },
      { to:         re },
      { snippet:    re },
      { body_text:  re },
    ]});
  }

  if (dateFrom || dateTo) {
    const range = {};
    if (dateFrom) range.$gte = new Date(dateFrom);
    if (dateTo)   range.$lte = new Date(dateTo);
    conditions.push({ received_at: range });
  }

  const filter   = { $and: conditions };
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 25));
  const skip     = Math.max(0, Number(offset) || 0);

  const [docs, total, unreadCount] = await Promise.all([
    db.collection('emails').find(filter, { projection: LIST_PROJECTION })
      .sort({ received_at: -1 }).skip(skip).limit(pageSize).toArray(),
    db.collection('emails').countDocuments(filter),
    db.collection('emails').countDocuments({ ...UNREAD, is_deleted: { $ne: true }, is_trashed: { $ne: true } }),
  ]);

  res.json({ emails: docs.map(toApi), total, unreadCount });
});

// ─── GET /api/emails/sync-status — worker + credential health ─────────────────
// Declared before /:id so "sync-status" is never read as a message id.
router.get('/sync-status', async (req, res) => {
  const db      = await getDb();
  const mailbox = gmail.mailbox() || 'me';

  const [state, total, unread] = await Promise.all([
    db.collection('email_sync_state').findOne({ _id: mailbox }),
    db.collection('emails').countDocuments({}),
    db.collection('emails').countDocuments({ ...UNREAD, is_deleted: { $ne: true } }),
  ]);

  res.json({
    configured:   gmail.isConfigured(),
    auth_mode:    gmail.authMode(),
    mailbox:      gmail.mailbox() || null,
    phase:        state?.phase || null,
    last_sync_at: state?.last_sync_at || null,
    last_error:   state?.last_error || null,
    synced_total: state?.synced_total || 0,
    stored_total: total,
    unread,
  });
});

// ─── POST /api/emails/sync — run a sync pass now (admin) ──────────────────────
router.post('/sync', requireAdmin, async (req, res) => {
  if (!gmail.isConfigured()) return res.status(503).json({ error: 'Gmail is not configured on the server' });
  const result = await syncOnce();
  if (result.error) return res.status(502).json({ error: result.error });
  res.json({ success: true, ...result });
});

// ─── GET /api/emails/labels — Gmail label names for the filter dropdown ───────
router.get('/labels', async (req, res) => {
  if (!gmail.isConfigured()) return res.json({ labels: [] });
  try {
    const labels = await gmail.listLabels();
    res.json({ labels: labels.map(l => ({ id: l.id, name: l.name, type: l.type })) });
  } catch (err) {
    logger.warn('[Emails] Label fetch failed', { message: err.message });
    res.json({ labels: [], error: err.message });
  }
});

// ─── GET /api/emails/categories — schema + live counts for the filter ─────────
router.get('/categories', async (req, res) => {
  const db = await getDb();

  // One row per (email, tag): a two-issue email counts under both categories,
  // so these totals sum above the email count by design.
  const counts = await db.collection('emails').aggregate([
    { $match: { is_deleted: { $ne: true }, is_trashed: { $ne: true } } },
    ...unwindTagsStage(),
    { $group: { _id: { category: '$_tag_list.category', sub_category: '$_tag_list.sub_category' }, count: { $sum: 1 } } },
  ]).toArray();

  const byCategory = {};
  for (const row of counts) {
    const name = row._id.category || 'Uncategorised';
    byCategory[name] ??= { category: name, total: 0, subs: {} };
    byCategory[name].total += row.count;
    if (row._id.sub_category) {
      byCategory[name].subs[row._id.sub_category] = (byCategory[name].subs[row._id.sub_category] || 0) + row.count;
    }
  }

  res.json({
    // The full schema, so the dropdown offers categories that exist but have no
    // mail yet rather than only what has already been seen.
    schema: Object.entries(CATEGORIZATION_SCHEMA).map(([name, subs]) => ({ name, sub_categories: subs })),
    counts: Object.values(byCategory)
      .map(c => ({ ...c, subs: Object.entries(c.subs).map(([sub_category, count]) => ({ sub_category, count })).sort((a, b) => b.count - a.count) }))
      .sort((a, b) => b.total - a.total),
  });
});

// ─── GET /api/emails/analysis/stats — queue health + category breakdown ───────
router.get('/analysis/stats', async (req, res) => {
  const db = await getDb();
  const col = db.collection('email_analysis');

  const [pending, processing, completed, failed, storedTotal, analysed, topBugs] = await Promise.all([
    col.countDocuments({ status: 'pending' }),
    col.countDocuments({ status: 'processing' }),
    col.countDocuments({ status: 'completed' }),
    col.countDocuments({ status: 'failed' }),
    db.collection('emails').countDocuments({ is_deleted: { $ne: true } }),
    db.collection('emails').countDocuments({ analysed_at: { $exists: true }, is_deleted: { $ne: true } }),
    col.aggregate([
      { $match: { status: 'completed', bug_category: { $nin: [null, '', '-'] } } },
      { $group: { _id: '$bug_category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);

  res.json({
    queue: { pending, processing, completed, failed },
    coverage: { stored: storedTotal, analysed, remaining: Math.max(0, storedTotal - analysed) },
    topBugs: topBugs.map(b => ({ category: b._id, count: b.count })),
  });
});

// ─── GET /api/emails/:id — full message plus its analysis ─────────────────────
router.get('/:id', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('emails').findOne({ gmail_id: req.params.id });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const analysis = await db.collection('email_analysis').findOne(
    { gmail_id: req.params.id },
    { projection: { _id: 0, processing_id: 0 } }
  );

  res.json({ ...toApi(doc), analysis: analysis || null });
});

// ─── PATCH /api/emails/:id/read — Oasis-side read state ──────────────────────
// Body: { read: true | false }. Any authenticated user, because in a shared
// support mailbox whoever picks the mail up is the one who marks it handled.
router.patch('/:id/read', async (req, res) => {
  const db   = await getDb();
  const read = req.body?.read !== false;   // default true — the common direction

  const update = read
    ? { $set:   { read_at: new Date(), read_by: req.user.name || null } }
    // Unset rather than null so the UNREAD predicate stays a plain $exists.
    : { $unset: { read_at: '', read_by: '' } };

  const result = await db.collection('emails').updateOne({ gmail_id: req.params.id }, update);
  if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found' });

  res.json({ success: true, read });
});

// ─── POST /api/emails/:id/analyse — queue or re-queue one email (admin) ───────
router.post('/:id/analyse', requireAdmin, async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('emails').findOne({ gmail_id: req.params.id }, { projection: { gmail_id: 1 } });
  if (!doc) return res.status(404).json({ error: 'Not found' });

  // force=true re-runs mail that already completed or permanently failed.
  const queued = await enqueueEmail(req.params.id, { force: req.query.force === 'true' });
  res.json({
    success: true,
    queued,
    message: queued ? 'Queued for analysis' : 'Already analysed — pass ?force=true to re-run',
  });
});

// ─── GET /api/emails/:id/attachments/:attachmentId — proxied download ─────────
// Attachment bytes are never stored in Mongo; they are streamed from Gmail on
// demand so a mailbox with GBs of PDFs doesn't become a database problem.
router.get('/:id/attachments/:attachmentId', async (req, res) => {
  const db  = await getDb();
  const doc = await db.collection('emails').findOne(
    { gmail_id: req.params.id },
    { projection: { attachments: 1 } }
  );
  if (!doc) return res.status(404).json({ error: 'Email not found' });

  // Only serve attachment ids this message actually declares — otherwise the
  // endpoint would proxy arbitrary attachment ids out of the whole mailbox.
  const meta = (doc.attachments || []).find(a => a.attachment_id === req.params.attachmentId);
  if (!meta) return res.status(404).json({ error: 'Attachment not found on this email' });

  try {
    const buffer = await gmail.getAttachment(req.params.id, req.params.attachmentId);
    const safeName = (meta.filename || 'attachment').replace(/[^\w.\-() ]/g, '_');
    res.setHeader('Content-Type', meta.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', buffer.length);
    // Downloaded content is untrusted third-party data — never let a browser
    // sniff it into something executable in our origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (err) {
    logger.error('[Emails] Attachment download failed', { gmail_id: req.params.id, message: err.message });
    res.status(502).json({ error: 'Could not fetch attachment from Gmail' });
  }
});

module.exports = router;
