const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { buildReport } = require('../lib/reportData');
const logger = require('../logger');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNELS = new Set(['all', 'calls', 'emails']);

/**
 * The widest span one request may cover.
 *
 * A report reads its window into memory to slice it five ways, so the span is
 * what bounds the work. A year of a busy helpline is already tens of thousands
 * of documents; beyond that the request should be refused with a clear message
 * rather than left to time out or exhaust the heap.
 */
const MAX_DAYS = 366;

/** YYYY-MM-DD for a Date, in local time — the same day boundary reportData uses. */
function todayStr() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A real calendar date, not merely a well-shaped string. '2026-02-31' is not one. */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd)) / 86400000) + 1;
}

/**
 * GET /api/reports/summary
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   the window; `to` defaults to `from`
 *   ?date=YYYY-MM-DD                 shorthand for from=to=date
 *   ?channel=all|calls|emails        default all
 *
 * Admin-only: it spans every agent's calls, so the per-agent scoping the calls
 * routes apply would make the totals wrong rather than merely partial.
 */
router.get('/summary', requireAdmin, async (req, res) => {
  const { date, channel = 'all' } = req.query;
  const from = date || req.query.from || todayStr();
  const to   = date || req.query.to   || from;

  if (!isRealDate(from) || !isRealDate(to)) {
    return res.status(400).json({ error: 'from and to must be real YYYY-MM-DD dates' });
  }
  if (from > to) {
    return res.status(400).json({ error: 'from must not be after to' });
  }
  if (!CHANNELS.has(channel)) {
    return res.status(400).json({ error: `channel must be one of ${[...CHANNELS].join(', ')}` });
  }

  const days = daysBetween(from, to);
  if (days > MAX_DAYS) {
    return res.status(400).json({ error: `range is ${days} days; the maximum is ${MAX_DAYS}` });
  }

  try {
    const db = await getDb();
    res.json(await buildReport(db, { from, to, channel }));
  } catch (err) {
    logger.error('[Reports] Report failed', { from, to, channel, error: err.message });
    res.status(500).json({ error: 'Failed to build report' });
  }
});

/**
 * GET /api/reports/range — the earliest and latest day there is anything to
 * report on, so the UI can offer "everything so far" without guessing.
 */
router.get('/range', requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    // Cursor form, not the options object: it is what the rest of the routes
    // use, and it is the only form the test double implements.
    const [firstCall, firstEmail] = await Promise.all([
      db.collection('calls').find({}).sort({ created_at: 1 }).limit(1).toArray(),
      db.collection('emails').find({}).sort({ received_at: 1 }).limit(1).toArray(),
    ]);

    const earliest = [firstCall[0]?.created_at, firstEmail[0]?.received_at]
      .filter(Boolean)
      .map(d => new Date(d))
      .sort((a, b) => a - b)[0];

    const p = n => String(n).padStart(2, '0');
    res.json({
      minDate: earliest ? `${earliest.getFullYear()}-${p(earliest.getMonth() + 1)}-${p(earliest.getDate())}` : null,
      maxDate: todayStr(),
      maxDays: MAX_DAYS,
    });
  } catch (err) {
    logger.error('[Reports] Range lookup failed', { error: err.message });
    res.status(500).json({ error: 'Failed to read the reportable range' });
  }
});

module.exports = router;
