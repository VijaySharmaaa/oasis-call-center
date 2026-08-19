const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gmail  = require('../services/gmailService');
const { syncOnce } = require('../workers/emailSyncWorker');
const { enqueueEmail, enqueueConversation } = require('../workers/emailAnalysisWorker');
const { refreshConversation, isOutbound, buildConversationFilter, outboundFilter, inboundFilter } = require('../lib/conversations');
const { cleanEmailBody } = require('../lib/emailText');
const { buildReply } = require('../lib/mimeMessage');
const { createExportJob, getExportJob } = require('../workers/exportWorker');
const { CATEGORIZATION_SCHEMA } = require('../services/geminiService');
const { tagMatch, unwindTagsStage } = require('../lib/tags');
const logger = require('../logger');

const router = express.Router();

/**
 * Where a finished export lives on disk. Every path served below is resolved
 * and checked against this, so a job document with a doctored file_path cannot
 * turn the download route into an arbitrary file read.
 */
function exportBaseDir() {
  return path.resolve(process.env.LOG_DIR || path.join(__dirname, '../../logs'), 'exports');
}

/** Admins see any job; everyone else only the ones they asked for. */
function canAccessJob(job, user) {
  if (!job) return false;
  if (user?.role === 'admin') return true;
  const requester = job.requested_by || {};
  if (requester.agent_number && user?.agent_number) return requester.agent_number === user.agent_number;
  return !!requester.name && requester.name === user?.name;
}

async function sendExportFile(res, job) {
  if (job.status !== 'completed') return res.status(409).json({ error: 'Export is not ready yet' });
  if (!job.file_path) return res.status(404).json({ error: 'Export file missing' });

  const filePath = path.resolve(job.file_path);
  if (!filePath.startsWith(exportBaseDir())) return res.status(400).json({ error: 'Invalid export path' });

  try {
    await fs.access(filePath);
  } catch {
    return res.status(404).json({ error: 'Export file not found on disk' });
  }

  res.download(filePath, job.file_name || path.basename(filePath), (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Failed to download export' });
  });
}

// Token-based download, mounted BEFORE requireAuth so it can validate its own
// short-lived token: <a download> sends no Authorization header, and the same
// trade-off is already made on the call report's export.
router.get('/conversations/export/jobs/:id/download', async (req, res, next) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  if (!queryToken) return next();   // fall through to the Bearer-auth route below

  let payload;
  try {
    payload = jwt.verify(queryToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired download token' });
  }
  if (payload.job_id !== req.params.id || payload.type !== 'export-download') {
    return res.status(403).json({ error: 'Token does not match job' });
  }

  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  return sendExportFile(res, job);
});

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
 * WITH THE WRITE SCOPE GRANTED, the two halves are no longer independent.
 * Marking read here clears the UNREAD label in Gmail as well, so read state is
 * one fact rather than two views of it, and an operator who tidies the mailbox
 * in either place sees it in both.
 *
 * The local mirror of `is_unread` is written only when that push SUCCEEDS. On a
 * deployment whose delegation is still read-only — or when Gmail is simply
 * down — our copy must keep saying what Gmail says, or the next sync would
 * quietly contradict the screen. There, `read_at` alone carries the operator's
 * action, exactly as it did before write was granted.
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
    // What the mailbox will actually let us do, so the UI can disable a
    // composer it knows will fail rather than offering a Send that always errors.
    can_send:     gmail.isConfigured() && gmail.canSend(),
    can_modify:   gmail.isConfigured() && gmail.canModifyLabels(),
    scopes:       gmail.scopes(),
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

  // Counted over CONVERSATIONS, because that is what the tab lists: a candidate
  // who wrote six times about one refund is one row under Payment & Fee, not
  // six. One row per (conversation, tag), so a two-issue chain counts under
  // both categories and the totals sum above the conversation count by design.
  const counts = await db.collection('email_conversations').aggregate([
    { $match: { is_trashed: { $ne: true } } },
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

// ─── GET /api/emails/stats/summary — the mailbox as the Dashboard reads it ────
//
// The email twin of /api/calls/stats/summary, and ranged the same way: every
// number answers the question for the window the header has selected, so a
// panel never mixes "this week" with "ever".
//
// The four headline counts partition the mailbox exactly once —
// replies + unread + read = total — which is the property that makes them
// legible side by side. Read is therefore inbound-minus-unread, not
// total-minus-unread: our own replies are not mail anybody had to read.
router.get('/stats/summary', async (req, res) => {
  const db = await getDb();
  const { dateFrom, dateTo } = req.query;

  const range = {};
  if (dateFrom) range.$gte = new Date(dateFrom);
  if (dateTo)   range.$lte = new Date(dateTo);
  const inRange = Object.keys(range).length > 0;

  // Same reach as the mailbox list: soft-deleted and trashed mail has left the
  // mailbox, and counting it would make the Dashboard disagree with the tab.
  const base = {
    is_deleted: { $ne: true },
    is_trashed: { $ne: true },
    ...(inRange ? { received_at: range } : {}),
  };

  const emails   = db.collection('emails');
  const outbound = { ...base, ...outboundFilter() };
  const inbound  = { ...base, ...inboundFilter() };

  const [total, replies, inboundTotal, unread, conversations, awaitingAnalysis, topCategoriesRaw, latestUnread] =
    await Promise.all([
      emails.countDocuments(base),
      emails.countDocuments(outbound),
      emails.countDocuments(inbound),
      emails.countDocuments({ ...inbound, ...UNREAD }),
      // Ranged on the last message, exactly as the conversations list is: a
      // sender counts as active in a window if anything was said in it.
      db.collection('email_conversations').countDocuments({
        is_trashed: { $ne: true },
        ...(inRange ? { last_message_at: range } : {}),
      }),
      db.collection('email_conversations').countDocuments({
        is_trashed: { $ne: true },
        needs_analysis: true,
        ...(inRange ? { last_message_at: range } : {}),
      }),
      // One row per (conversation, tag), like every other category breakdown
      // here: a sender who raised two issues counts under both, so these sum
      // above the conversation count by design.
      db.collection('email_conversations').aggregate([
        // Pre-matched on a real category so the scalar fallback inside
        // unwindTagsStage cannot emit a { category: null } row for a chain the
        // worker has not reached yet.
        { $match: {
          is_trashed: { $ne: true },
          category: { $exists: true, $ne: '' },
          ...(inRange ? { last_message_at: range } : {}),
        } },
        ...unwindTagsStage(),
        { $group: { _id: '$_tag_list.category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]).toArray(),
      // The mailbox's answer to "Latest Missed Calls": who is still waiting.
      db.collection('email_conversations')
        .find({ is_trashed: { $ne: true }, unread_count: { $gt: 0 }, ...(inRange ? { last_message_at: range } : {}) },
              { projection: { participant_email: 1, participant_name: 1, last_subject: 1, last_message_at: 1, unread_count: 1, category: 1 } })
        .sort({ last_message_at: -1 })
        .limit(8)
        .toArray(),
    ]);

  res.json({
    total,
    replies,
    inbound: inboundTotal,
    unread,
    read: Math.max(0, inboundTotal - unread),
    conversations,
    awaitingAnalysis,
    topCategories: topCategoriesRaw
      .filter(c => c._id)
      .map(c => ({ category: c._id, count: c.count })),
    latestUnread: latestUnread.map(({ _id, ...rest }) => ({ id: _id, ...rest })),
  });
});

// ─── GET /api/emails/analysis/stats — queue health + category breakdown ───────
router.get('/analysis/stats', async (req, res) => {
  const db = await getDb();
  // The queue holds conversations: one job re-reads a whole chain, so counting
  // messages here would report a backlog several times the work outstanding.
  const col   = db.collection('conversation_analysis');
  const convs = db.collection('email_conversations');

  const [pending, processing, completed, failed, storedTotal, analysed, remaining, topBugs] = await Promise.all([
    col.countDocuments({ status: 'pending' }),
    col.countDocuments({ status: 'processing' }),
    col.countDocuments({ status: 'completed' }),
    col.countDocuments({ status: 'failed' }),
    convs.countDocuments({}),
    convs.countDocuments({ analysed_at: { $exists: true } }),
    // "Remaining" is not stored-minus-analysed: a chain analysed last week that
    // has had a reply since is outstanding again, and needs_analysis is exactly
    // that question already answered.
    convs.countDocuments({ needs_analysis: true }),
    col.aggregate([
      { $match: { status: 'completed', bug_category: { $nin: [null, '', '-'] } } },
      { $group: { _id: '$bug_category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);

  res.json({
    queue: { pending, processing, completed, failed },
    coverage: { stored: storedTotal, analysed, remaining },
    topBugs: topBugs.map(b => ({ category: b._id, count: b.count })),
  });
});

// ─── Conversations ────────────────────────────────────────────────────────────
//
// The Emails tab is a list of PEOPLE, not of messages: one row per
// correspondent, carrying everything they have ever written and one AI verdict
// formed from the whole exchange. These routes are declared before /:id so a
// path segment of "conversations" is never read as a Gmail message id.

/** Per-message body budget in a chat payload. The full text is one click away. */
const CHAT_BODY_CHARS = Math.max(500, Number(process.env.EMAIL_CHAT_BODY_CHARS) || 8_000);

/** Conversation doc → API shape. `id` is the correspondent's address. */
function conversationToApi(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * Stamp each conversation on ONE page with where it stands in the analysis
 * queue, so the list can tell "the AI had nothing to say" apart from "the AI
 * has not read this yet".
 *
 *   queue_status       the conversation_analysis row's status, or null when the
 *                      chain was never enrolled
 *   awaiting_analysis  `needs_analysis` under a name that matches the Call
 *                      Report's field, so one component renders both tabs. It
 *                      already means exactly this: inbound mail has landed
 *                      since the point the stored verdict covers.
 *
 * One indexed fetch per page, never per mailbox.
 */
async function withAnalysisState(db, conversations) {
  const ids = conversations.map(c => c.id).filter(Boolean);
  const rows = ids.length
    ? await db.collection('conversation_analysis')
        .find({ _id: { $in: ids } }, { projection: { status: 1 } })
        .toArray()
    : [];
  const statusOf = new Map(rows.map(r => [r._id, r.status]));

  return conversations.map(c => ({
    ...c,
    queue_status: statusOf.get(c.id) ?? null,
    awaiting_analysis: c.needs_analysis === true,
  }));
}

/**
 * One message as it appears inside a chat.
 *
 * Bodies are capped rather than omitted: a chain of forty messages must not
 * ship forty full HTML documents, but a bubble with nothing in it is not a
 * chat. `body_truncated` tells the client to offer the full message, which the
 * per-message detail endpoint still serves in full.
 */
function chatMessageToApi(doc, isOutboundMessage) {
  const { _id, body_text, body_html, ...rest } = doc;
  // Reduced to what the person actually wrote — the quoted thread, the
  // signature and the corporate disclaimer come off (lib/emailText). Sent
  // verbatim, a chain of six replies repeats the same paragraph six times and
  // the one new sentence is lost in it; that is a mail archive, not a chat.
  //
  // Nothing is hidden without saying so: `body_trimmed` tells the client to
  // offer the original, which the per-message endpoint still serves untouched.
  const { text: cleaned, trimmed } = cleanEmailBody(body_text || '');

  return {
    ...rest,
    id: doc.gmail_id,
    direction: isOutboundMessage ? 'outbound' : 'inbound',
    body_text: cleaned.length > CHAT_BODY_CHARS ? cleaned.slice(0, CHAT_BODY_CHARS) : cleaned,
    body_truncated: cleaned.length > CHAT_BODY_CHARS,
    body_trimmed: trimmed,
    // `has_html` is stamped at sync time precisely so this query can project
    // the HTML away; mail synced before that field existed reports false, and
    // the message is still one click away through the detail endpoint.
    has_html: !!(doc.has_html ?? (body_html || '').trim()),
  };
}

// ─── GET /api/emails/conversations — paginated list of correspondents ─────────
router.get('/conversations', async (req, res) => {
  const db = await getDb();
  const { limit = '25', offset = '0' } = req.query;

  // The filter is built in lib/conversations because the CSV export builds it
  // from the same function — an export that disagrees with the screen it was
  // taken from is worse than no export.
  const filter   = await buildConversationFilter(db, req.query);
  const pageSize = Math.min(200, Math.max(1, Number(limit) || 25));
  const skip     = Math.max(0, Number(offset) || 0);

  const [docs, total, unreadCount] = await Promise.all([
    db.collection('email_conversations').find(filter)
      .sort({ last_message_at: -1 }).skip(skip).limit(pageSize).toArray(),
    db.collection('email_conversations').countDocuments(filter),
    db.collection('email_conversations').countDocuments({ unread_count: { $gt: 0 }, is_trashed: { $ne: true } }),
  ]);

  const conversations = await withAnalysisState(db, docs.map(conversationToApi));
  res.json({ conversations, total, unreadCount });
});

// ─── Conversation CSV export ─────────────────────────────────────────────────
//
// Same job-based flow as the call report: queue, poll, download. It is a
// background job rather than a streamed response because the filters can select
// the whole mailbox, and a request that streams for two minutes is a request
// every proxy in the way is entitled to kill.
//
// Declared before /conversations/:id, or "export" would be read as an address.

/** Only the filters the export understands — never the whole request body. */
function pickExportFilters(src = {}) {
  const pick = k => (typeof src[k] === 'string' ? src[k].trim() : '');
  return {
    search:         pick('search'),
    unread:         pick('unread'),
    replied:        pick('replied'),
    hasAttachments: pick('hasAttachments'),
    includeTrashed: pick('includeTrashed'),
    category:       pick('category'),
    subCategory:    pick('subCategory'),
    analysisStatus: pick('analysisStatus'),
    dateFrom:       pick('dateFrom'),
    dateTo:         pick('dateTo'),
  };
}

// POST /api/emails/conversations/export/jobs — queue one
router.post('/conversations/export/jobs', async (req, res) => {
  const filters = pickExportFilters(req.body || {});
  const jobId = await createExportJob({ filters, user: req.user, type: 'conversations' });
  res.status(202).json({ job_id: jobId, status: 'pending' });
});

// GET /api/emails/conversations/export/jobs/:id — progress
router.get('/conversations/export/jobs/:id', async (req, res) => {
  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (!canAccessJob(job, req.user)) return res.status(403).json({ error: 'Access denied' });

  let downloadUrl = null;
  if (job.status === 'completed') {
    // Short-lived, and scoped to this one job: the browser downloads through an
    // <a download>, which cannot carry the Bearer token.
    const token = jwt.sign(
      { job_id: job._id.toString(), type: 'export-download' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    downloadUrl = `/api/emails/conversations/export/jobs/${job._id.toString()}/download?token=${token}`;
  }

  res.json({
    job_id:         job._id.toString(),
    status:         job.status,
    rows_processed: job.rows_processed || 0,
    file_name:      job.file_name || null,
    file_size:      job.file_size || null,
    error:          job.error || null,
    created_at:     job.created_at,
    started_at:     job.started_at || null,
    finished_at:    job.finished_at || null,
    download_url:   downloadUrl,
  });
});

// GET /api/emails/conversations/export/jobs/:id/download — Bearer-auth download
router.get('/conversations/export/jobs/:id/download', async (req, res) => {
  const job = await getExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Export job not found' });
  if (!canAccessJob(job, req.user)) return res.status(403).json({ error: 'Access denied' });
  return sendExportFile(res, job);
});

// ─── GET /api/emails/conversations/:id — the whole chain, as a chat ───────────
router.get('/conversations/:id', async (req, res) => {
  const db = await getDb();
  const id = String(req.params.id || '').toLowerCase();

  const conversation = await db.collection('email_conversations').findOne({ _id: id });
  if (!conversation) return res.status(404).json({ error: 'Not found' });

  const [messages, analysis] = await Promise.all([
    db.collection('emails')
      .find({ conversation_id: id, is_deleted: { $ne: true } }, { projection: { body_html: 0 } })
      .toArray(),
    db.collection('conversation_analysis').findOne({ _id: id }, { projection: { processing_id: 0 } }),
  ]);

  // Oldest first — a chat is read downwards, and the analysis is a verdict on
  // where that reading ends up.
  messages.sort((a, b) => new Date(a.received_at || 0).getTime() - new Date(b.received_at || 0).getTime());

  res.json({
    ...conversationToApi(conversation),
    messages: messages.map(m => chatMessageToApi(m, isOutbound(m))),
    analysis: analysis ? { ...analysis, id: analysis._id, _id: undefined } : null,
  });
});

/**
 * Push read state to Gmail, and say whether it got there.
 *
 * The operator's action is applied to our copy first and unconditionally. If
 * Gmail refuses — the delegation lost its scope, the API is down — the click
 * still counts here rather than being thrown away, because losing a triage
 * marker in a shared mailbox means two people answer the same candidate. The
 * caller reports the outcome instead of failing the request.
 *
 * @returns {Promise<{synced: boolean, error?: string}>}
 */
async function pushReadState(gmailIds, read) {
  if (!gmailIds.length) return { synced: false };
  if (!gmail.isConfigured() || !gmail.canModifyLabels()) {
    return { synced: false, error: 'Gmail is not authorised to change labels' };
  }

  try {
    await gmail.batchModifyMessages(gmailIds, read
      ? { removeLabelIds: ['UNREAD'] }
      : { addLabelIds:    ['UNREAD'] });
    return { synced: true };
  } catch (err) {
    logger.warn('[Emails] Could not push read state to Gmail', {
      count: gmailIds.length, read, message: err.message,
    });
    return { synced: false, error: err.message };
  }
}

// ─── PATCH /api/emails/conversations/:id/read — read state for a whole chain ──
// Body: { read: true | false }. Opening a chat marks the chain handled, because
// in a shared mailbox the unit somebody picks up is the person, not a message.
router.patch('/conversations/:id/read', async (req, res) => {
  const db   = await getDb();
  const id   = String(req.params.id || '').toLowerCase();
  const read = req.body?.read !== false;   // default true — the common direction

  const update = read
    ? { $set:   { read_at: new Date(), read_by: req.user.name || null } }
    // Unset rather than null so the UNREAD predicate stays a plain $exists.
    : { $unset: { read_at: '', read_by: '' } };

  const scope = { conversation_id: id, is_deleted: { $ne: true } };

  // Read before writing: the ids are needed for Gmail, and after the update the
  // set is no longer identifiable by read state.
  const messages = await db.collection('emails').find(scope, { projection: { gmail_id: 1 } }).toArray();
  if (!messages.length) return res.status(404).json({ error: 'Not found' });

  const result = await db.collection('emails').updateMany(scope, update);
  const push = await pushReadState(messages.map(m => m.gmail_id), read);

  // Only once Gmail has agreed: our copy of its label must not claim a change
  // the mailbox never made.
  if (push.synced) {
    await db.collection('emails').updateMany(scope, { $set: { is_unread: !read } });
  }

  const conversation = await refreshConversation(db, id);

  res.json({
    success: true,
    read,
    messages: result.matchedCount,
    unread_count: conversation?.unread_count ?? 0,
    // The client shows a quiet note when the mailbox itself did not follow.
    gmail_synced: push.synced,
    ...(push.error ? { gmail_error: push.error } : {}),
  });
});

// ─── POST /api/emails/conversations/:id/reply — answer from the chat ──────────
//
// Any authenticated user, like marking read: in a shared support mailbox
// whoever picks the candidate up is the one who answers them.
//
// The reply is sent, then stored immediately rather than waiting for the sync
// worker's next pass — a chat where your own message takes a minute to appear
// is a chat nobody trusts. The sync will re-fetch the same message later and
// upsert over it harmlessly.
router.post('/conversations/:id/reply', async (req, res) => {
  const db = await getDb();
  const id = String(req.params.id || '').toLowerCase();
  const body = String(req.body?.body || '').trim();

  if (!body) return res.status(400).json({ error: 'A reply needs a body' });
  if (!gmail.isConfigured()) return res.status(503).json({ error: 'Gmail is not configured on the server' });
  if (!gmail.canSend()) {
    return res.status(503).json({
      error: 'Gmail is not authorised to send. A Workspace super-admin must grant the gmail.modify scope to this service account, and GMAIL_SCOPES must request it.',
    });
  }

  const conversation = await db.collection('email_conversations').findOne({ _id: id });
  if (!conversation) return res.status(404).json({ error: 'Not found' });

  // Answer the newest thing the candidate actually said. Replying to our own
  // last message would thread the conversation to ourselves.
  const messages = await db.collection('emails')
    .find({ conversation_id: id, is_deleted: { $ne: true } })
    .toArray();
  messages.sort((a, b) => new Date(a.received_at || 0).getTime() - new Date(b.received_at || 0).getTime());
  const inbound = messages.filter(m => !isOutbound(m));
  const answering = inbound[inbound.length - 1] || messages[messages.length - 1] || null;

  const mailbox = gmail.mailbox() || '';
  const recipient = {
    // Reply-To is the sender's own instruction about where answers go.
    email: (answering?.reply_to || conversation.participant_email || '').replace(/^.*<|>.*$/g, '').trim().toLowerCase()
           || conversation.participant_email,
    name:  conversation.participant_name || answering?.from_name || '',
  };

  let sent;
  let reply;
  try {
    reply = buildReply({
      from:    { email: mailbox, name: process.env.GMAIL_FROM_NAME || 'UPTET Support' },
      to:      recipient,
      subject: req.body?.subject || conversation.last_subject || answering?.subject || '',
      body,
      inReplyTo:  answering?.rfc822_id || null,
      // Oldest first, so a client rebuilding the thread sees it in order.
      references: messages.map(m => m.rfc822_id).filter(Boolean),
      quote: answering && {
        from_name:   answering.from_name,
        from_email:  answering.from_email,
        received_at: answering.received_at,
        // Quote what they wrote, not the boilerplate around it — the same
        // reduction the chat renders.
        body: cleanEmailBody(answering.body_text || '').text,
      },
    });

    sent = await gmail.sendMessage({ raw: reply.raw, threadId: answering?.thread_id || null });
  } catch (err) {
    logger.error('[Emails] Reply failed', { conversation_id: id, message: err.message });
    return res.status(err.scopeProblem ? 503 : 502).json({ error: err.message });
  }

  // Fetch back what Gmail actually stored, so the bubble is the real message
  // rather than our guess at it — headers, threadId and internalDate included.
  let stored = null;
  try {
    const parsed = await gmail.getMessage(sent.id);
    stored = {
      ...parsed,
      conversation_id: id,
      mailbox: gmail.mailbox() || null,
      is_deleted: false,
      synced_at: new Date(),
      // Ours alone: a shared mailbox needs to know which operator answered, and
      // Gmail has nowhere to record it.
      sent_by: req.user.name || null,
      sent_from_oasis: true,
    };
    await db.collection('emails').updateOne(
      { gmail_id: parsed.gmail_id },
      { $set: stored, $setOnInsert: { first_seen_at: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    // The reply is sent; failing the request now would invite a second send.
    logger.warn('[Emails] Reply sent but could not be stored — the sync will pick it up', {
      conversation_id: id, gmail_id: sent.id, message: err.message,
    });
  }

  const refreshed = await refreshConversation(db, id);

  // Answering changes the verdict: the issue we just addressed may no longer be
  // the live one. The refresh above has already flagged the chain, so the
  // worker's sweep would find it within a tick — queueing here just means the
  // operator sees the new reading in seconds rather than after the next poll.
  // Never fatal: the reply is sent, and the sweep is the backstop.
  await enqueueConversation(id, { force: true })
    .catch(err => logger.warn('[Emails] Could not queue re-analysis after reply', {
      conversation_id: id, message: err.message,
    }));

  logger.info('[Emails] Replied', { conversation_id: id, gmail_id: sent.id, by: req.user.name });

  res.status(201).json({
    success: true,
    gmail_id: sent.id,
    thread_id: sent.threadId,
    // The bubble to append, in the shape the chat already renders.
    message: stored ? chatMessageToApi(stored, true) : null,
    conversation: refreshed ? conversationToApi(refreshed) : null,
  });
});

// ─── POST /api/emails/conversations/:id/analyse — re-read the chain (admin) ───
router.post('/conversations/:id/analyse', requireAdmin, async (req, res) => {
  const db = await getDb();
  const id = String(req.params.id || '').toLowerCase();

  const conversation = await db.collection('email_conversations').findOne({ _id: id }, { projection: { _id: 1 } });
  if (!conversation) return res.status(404).json({ error: 'Not found' });

  // force=true re-runs a chain that already completed or permanently failed.
  const queued = await enqueueConversation(id, { force: req.query.force === 'true' });
  res.json({
    success: true,
    queued,
    message: queued ? 'Queued for analysis' : 'Already analysed — pass ?force=true to re-run',
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

  const push = await pushReadState([req.params.id], read);
  // Same rule as the chain endpoint: mirror Gmail's label only once Gmail has
  // actually been told.
  if (push.synced) {
    await db.collection('emails').updateOne({ gmail_id: req.params.id }, { $set: { is_unread: !read } });
  }

  // The chain's unread count is derived from its messages, so it has to be
  // recomputed here or the list would keep showing a pill nobody can clear.
  const doc = await db.collection('emails').findOne({ gmail_id: req.params.id }, { projection: { conversation_id: 1 } });
  if (doc?.conversation_id) await refreshConversation(db, doc.conversation_id);

  res.json({ success: true, read, gmail_synced: push.synced, ...(push.error ? { gmail_error: push.error } : {}) });
});

// ─── POST /api/emails/:id/analyse — re-read this message's chain (admin) ─────
// Kept per-message because that is the id a caller holding one mail has. The
// work it queues is the CONVERSATION the message belongs to: analysing a reply
// on its own is what this whole change exists to stop.
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
