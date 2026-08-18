/**
 * Daily report aggregation.
 *
 * Builds the whole five-page report in one pass:
 *   1. Overview — calls resolved/unresolved/missed, mail replied/resolved, issue share
 *   2. Call timeline    — hourly volume, today vs the previous day
 *   3. Email timeline   — same shape, for mail
 *   4. Call feedback    — time-to-resolve and rectified-on-call, per issue
 *   5. Email feedback   — time-to-resolve per issue
 *
 * WHY THIS READS A DAY INTO MEMORY RATHER THAN AGGREGATING IN MONGO
 * A day is a bounded working set (hundreds to low thousands of documents), and
 * the report needs the same documents sliced five different ways. One read plus
 * plain JS beats five pipelines that each re-scan, and it stays legible — the
 * bucketing rules below are business rules, not query tricks, and belong
 * somewhere a reader can follow them.
 *
 * Reserved values (Uncategorised, Call too Short, Audio Unclear, Email too
 * Short, Content Unclear) are dispositions, not issues — see docs/taxonomy.md.
 * They count toward bucket totals, because the call or mail really happened,
 * but they are excluded from the issue rankings and the pie so that "what are
 * people contacting us about" is not diluted by "we could not tell".
 */

const { tagsOf } = require('./tags');
const { costOf, totalCost, rateCard, displayCurrency } = require('../config/geminiPricing');

/**
 * Values that occupy a category field without naming an issue.
 * Kept in sync with docs/taxonomy.md § Axis 2.
 */
const RESERVED_CATEGORIES = new Set([
  'Uncategorised',
  'Uncategorized',   // the call path's variant spelling
  'Call too Short',
  'Audio Unclear',
  'Email too Short',
  'Content Unclear',
]);

const RESOLVED_TICKET_STATUSES = new Set(['Resolved', 'Closed']);

/** A call nobody picked up. Mirrors the missedFilter in routes/calls.js. */
function isMissed(call) {
  return !call.agent_answer_time;
}

function isReserved(category) {
  return !category || RESERVED_CATEGORIES.has(category);
}

/** YYYY-MM-DD for a Date, in local time. */
function toDateStr(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Local midnight for a YYYY-MM-DD string, optionally offset by whole days. */
function midnight(dateStr, offsetDays = 0) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d + offsetDays, 0, 0, 0, 0);
}

/**
 * Boundaries for a from..to range, plus the comparison window before it.
 *
 * Built from numeric parts rather than Date.parse, because `new Date('2026-08-18')`
 * is parsed as UTC while `new Date('2026-08-18T00:00')` is local — a difference
 * that silently shifts every bucket by the server's offset.
 *
 * The comparison window is the SAME NUMBER OF DAYS immediately before the
 * range. For one day that is simply yesterday; for a week it is the week
 * before. Comparing a week against a single day would make the red line
 * meaningless, so the two windows are always the same length.
 */
function rangeOf(from, to = from) {
  const start = midnight(from);
  const end   = new Date(midnight(to, 1).getTime() - 1);   // 23:59:59.999 on `to`
  const days  = Math.round((midnight(to) - start) / 86400000) + 1;

  return {
    start, end, days,
    prevStart: midnight(from, -days),
    prevEnd:   new Date(start.getTime() - 1),
    // One day reads hour by hour; anything longer reads day by day. A 30-day
    // range bucketed hourly would average away the very shape it is drawn for.
    granularity: days === 1 ? 'hour' : 'day',
  };
}

/**
 * Rank the issues raised by a set of documents, most frequent first.
 *
 * One document contributes one count per DISTINCT category it carries, so a
 * call tagged twice under the same parent is not double-counted, while a call
 * raising two genuinely different issues shows up under both. Sub-categories
 * are ranked within their parent so page 1 can drop to them when it has room.
 *
 * @param {object[]} docs documents carrying tags (or a legacy scalar pair)
 * @returns {{categories: object[], mentions: number, reserved: number}}
 */
function rankIssues(docs) {
  const byCategory = new Map();
  let mentions = 0;
  let reserved = 0;

  for (const doc of docs) {
    const tags = tagsOf(doc);
    const seenCategory = new Set();

    for (const tag of tags) {
      const category = tag?.category;
      if (isReserved(category)) { reserved += 1; continue; }
      if (seenCategory.has(category)) continue;
      seenCategory.add(category);

      if (!byCategory.has(category)) byCategory.set(category, { category, count: 0, subs: new Map() });
      const entry = byCategory.get(category);
      entry.count += 1;
      mentions += 1;

      const sub = tag.sub_category;
      if (sub && sub !== '-' && sub !== '') {
        entry.subs.set(sub, (entry.subs.get(sub) || 0) + 1);
      }
    }
  }

  const categories = [...byCategory.values()]
    .map(e => ({
      category: e.category,
      count:    e.count,
      subs: [...e.subs.entries()]
        .map(([sub_category, count]) => ({ sub_category, count }))
        .sort((a, b) => b.count - a.count || a.sub_category.localeCompare(b.sub_category)),
    }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return { categories, mentions, reserved };
}

/** rankIssues plus the bucket's own document count, which page 1 prints as a total. */
function bucket(docs) {
  const { categories, mentions, reserved } = rankIssues(docs);
  return { total: docs.length, categories, mentions, reserved };
}

/**
 * Volume over time, with the issue that dominated each bucket.
 *
 * Always returns a complete spine — every hour of the day, or every day of the
 * range — so an empty bucket is drawn as a zero rather than closing the gap and
 * implying traffic that never happened.
 *
 * The dominant issue drives the coloured marker on the timeline pages; a bucket
 * whose documents are all dispositions has a count but no issue, which is a
 * real state and is reported as null rather than a fabricated category.
 *
 * When `usageFor` is supplied each bucket also carries what its documents cost
 * to analyse, which is what makes "cost per day" fall out of the same pass.
 *
 * @param {object[]} docs
 * @param {string} dateField  created_at for calls, received_at for mail
 * @param {object} window     from rangeOf(): { start, days, granularity }
 * @param {Function} [usageFor] doc -> the Gemini usage record, or null
 * @returns {Array<{key, label, count, topCategory, costUsd, unpriced}>}
 */
function timelineBuckets(docs, dateField, { start, days, granularity }, usageFor) {
  const p = n => String(n).padStart(2, '0');
  const byHour = granularity === 'hour';

  // The spine, built first so empty buckets survive into the output.
  const slots = byHour
    ? Array.from({ length: 24 }, (_, i) => ({
        key: p(i), label: `${p(i)}:00`, count: 0, costUsd: 0, unpriced: 0, _tally: new Map(),
      }))
    : Array.from({ length: days }, (_, i) => {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return {
          key: toDateStr(day),
          label: `${p(day.getDate())}/${p(day.getMonth() + 1)}`,
          count: 0, costUsd: 0, unpriced: 0, _tally: new Map(),
        };
      });

  const index = new Map(slots.map((s, i) => [s.key, i]));

  for (const doc of docs) {
    const at = doc[dateField];
    if (!at) continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) continue;

    const slot = slots[index.get(byHour ? p(when.getHours()) : toDateStr(when))];
    if (!slot) continue;          // outside the window — the caller over-fetched
    slot.count += 1;

    if (usageFor) {
      const { usd, priced } = costOf(usageFor(doc));
      if (priced) slot.costUsd += usd; else slot.unpriced += 1;
    }

    for (const tag of tagsOf(doc)) {
      if (isReserved(tag?.category)) continue;
      slot._tally.set(tag.category, (slot._tally.get(tag.category) || 0) + 1);
    }
  }

  return slots.map(({ key, label, count, costUsd, unpriced, _tally }) => {
    let topCategory = null;
    let best = 0;
    for (const [category, n] of _tally) {
      // Ties break alphabetically, so the same data always names the same
      // winner rather than depending on Map insertion order.
      if (n > best || (n === best && topCategory && category.localeCompare(topCategory) < 0)) {
        best = n; topCategory = category;
      }
    }
    return { key, label, count, topCategory, costUsd: Math.round(costUsd * 1e6) / 1e6, unpriced };
  });
}

/**
 * When a ticket reached a resolved state, in minutes from creation.
 *
 * Prefers the timeline entry that recorded the transition, because updated_at
 * moves on every later edit. Falls back to updated_at only for a ticket that
 * is resolved but predates timeline recording.
 *
 * @returns {number|null} minutes, or null if the ticket is not resolved
 */
function ticketResolutionMinutes(ticket) {
  if (!ticket || !RESOLVED_TICKET_STATUSES.has(ticket.status)) return null;
  const created = ticket.created_at ? new Date(ticket.created_at) : null;
  if (!created || Number.isNaN(created.getTime())) return null;

  const transition = (ticket.timeline || [])
    .filter(e => e?.type === 'status_changed' && RESOLVED_TICKET_STATUSES.has(e.to) && e.at)
    .map(e => new Date(e.at))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)[0];

  const resolvedAt = transition || (ticket.updated_at ? new Date(ticket.updated_at) : null);
  if (!resolvedAt || Number.isNaN(resolvedAt.getTime())) return null;

  const minutes = (resolvedAt - created) / 60000;
  return minutes >= 0 ? Math.round(minutes) : null;
}

/**
 * Per-issue feedback rows for pages 4-5.
 *
 * Each row pairs an issue with how long it took to close and how often it was
 * closed without follow-up work. `avgResolutionMins` covers only the documents
 * that became a ticket, so `resolvedCount` is reported alongside it — an
 * average over three of ninety calls must not read like an average over ninety.
 *
 * @param {object[]} docs         documents carrying tags
 * @param {Function} ticketsFor   doc → linked ticket documents
 * @param {Function} [firstTouch] doc → true if it was settled at first contact
 */
function feedbackRows(docs, ticketsFor, firstTouch) {
  const byCategory = new Map();

  for (const doc of docs) {
    const seen = new Set();
    const minutes = ticketsFor(doc)
      .map(ticketResolutionMinutes)
      .filter(m => m !== null);
    const settledAtFirstTouch = firstTouch ? firstTouch(doc) : null;

    for (const tag of tagsOf(doc)) {
      const category = tag?.category;
      if (isReserved(category) || seen.has(category)) continue;
      seen.add(category);

      if (!byCategory.has(category)) {
        byCategory.set(category, {
          category, total: 0, firstTouch: 0, _minutes: [], subs: new Map(),
        });
      }
      const entry = byCategory.get(category);
      entry.total += 1;
      if (settledAtFirstTouch) entry.firstTouch += 1;
      entry._minutes.push(...minutes);

      const sub = tag.sub_category;
      if (sub && sub !== '-' && sub !== '') {
        entry.subs.set(sub, (entry.subs.get(sub) || 0) + 1);
      }
    }
  }

  return [...byCategory.values()]
    .map(e => ({
      category:          e.category,
      total:             e.total,
      firstTouch:        e.firstTouch,
      resolvedCount:     e._minutes.length,
      avgResolutionMins: e._minutes.length
        ? Math.round(e._minutes.reduce((a, b) => a + b, 0) / e._minutes.length)
        : null,
      subs: [...e.subs.entries()]
        .map(([sub_category, count]) => ({ sub_category, count }))
        .sort((a, b) => b.count - a.count || a.sub_category.localeCompare(b.sub_category)),
    }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

/**
 * Which inbound emails were answered.
 *
 * Gmail has no "replied" flag, so a reply is inferred from the thread: a SENT
 * message in the same thread, later than the inbound one. That requires the
 * mailbox sync to include sent mail — with GMAIL_SYNC_QUERY narrowed to the
 * inbox, no reply is ever visible and everything reads as unanswered. The
 * caller surfaces `sentMessagesSeen` so the report can say so out loud rather
 * than quietly reporting a zero.
 *
 * @returns {{repliedIds: Set<string>, sentMessagesSeen: number}}
 */
function detectReplies(inbound, sentMessages) {
  const sentByThread = new Map();
  for (const sent of sentMessages) {
    if (!sent.thread_id) continue;
    if (!sentByThread.has(sent.thread_id)) sentByThread.set(sent.thread_id, []);
    sentByThread.get(sent.thread_id).push(new Date(sent.received_at).getTime());
  }

  const repliedIds = new Set();
  for (const email of inbound) {
    const times = sentByThread.get(email.thread_id);
    if (!times) continue;
    const receivedAt = new Date(email.received_at).getTime();
    if (times.some(t => t > receivedAt)) repliedIds.add(String(email._id));
  }

  return { repliedIds, sentMessagesSeen: sentMessages.length };
}

/** Gather the call side of the report, or null when calls are filtered out. */
async function collectCalls(db, window) {
  const { start, end, prevStart, prevEnd } = window;
  const col = db.collection('calls');

  const [current, previous] = await Promise.all([
    col.find({ created_at: { $gte: start, $lte: end } }).toArray(),
    col.find({ created_at: { $gte: prevStart, $lte: prevEnd } }).toArray(),
  ]);

  const answered = current.filter(c => !isMissed(c));
  const missed   = current.filter(isMissed);

  const analyses = answered.length
    ? await db.collection('call_analysis')
        .find({ call_id: { $in: answered.map(c => c.call_id) }, status: 'completed' })
        .toArray()
    : [];
  const analysisByCall = new Map(analyses.map(a => [a.call_id, a]));

  // A call's tags live on the call document; its resolution lives on the
  // analysis. Merge them so every downstream slice reads one shape.
  const merged = answered.map(call => {
    const analysis = analysisByCall.get(call.call_id);
    return {
      ...call,
      // Prefer the analysis tags: the call mirror can lag a re-analysis.
      tags:          tagsOf(analysis || call),
      call_resolved: analysis?.call_resolved ?? null,
      _analysed:     !!analysis,
    };
  });

  const tickets = answered.length
    ? await db.collection('tickets').find({ call_id: { $in: answered.map(c => c.call_id) } }).toArray()
    : [];
  const ticketsByCall = new Map();
  for (const t of tickets) {
    if (!ticketsByCall.has(t.call_id)) ticketsByCall.set(t.call_id, []);
    ticketsByCall.get(t.call_id).push(t);
  }

  // Cost is attributed to WHEN THE CALL HAPPENED, not when the analysis ran, so
  // it lines up with every other figure on the page. A call re-analysed later
  // still counts against the day it came in.
  const usageOf = call => analysisByCall.get(call.call_id)?.usage ?? null;

  return {
    current, previous, merged, ticketsByCall, usageOf,
    cost: totalCost(answered.map(usageOf)),
    summary: {
      total:      current.length,
      answered:   answered.length,
      missed:     missed.length,
      pending:    merged.filter(c => !c._analysed).length,
      resolved:   bucket(merged.filter(c => c.call_resolved === 'Yes')),
      unresolved: bucket(merged.filter(c => c.call_resolved === 'No' || c.call_resolved === 'Partial')),
    },
    feedback: feedbackRows(
      merged.filter(c => c._analysed),
      call => ticketsByCall.get(call.call_id) || [],
      call => call.call_resolved === 'Yes',
    ),
  };
}

/** Gather the mail side of the report, or null when mail is filtered out. */
async function collectEmails(db, window) {
  const { start, end, prevStart, prevEnd } = window;
  const col = db.collection('emails');
  const notJunk = { is_trashed: { $ne: true }, is_spam: { $ne: true } };

  const [rawCurrent, rawPrevious] = await Promise.all([
    col.find({ ...notJunk, received_at: { $gte: start, $lte: end } }).toArray(),
    col.find({ ...notJunk, received_at: { $gte: prevStart, $lte: prevEnd } }).toArray(),
  ]);

  const isOutbound = e => (e.label_ids || []).includes('SENT');
  const inbound     = rawCurrent.filter(e => !isOutbound(e));
  const inboundPrev = rawPrevious.filter(e => !isOutbound(e));

  // Replies can land days later, so sent mail is fetched by thread across all
  // time rather than being restricted to the reporting window.
  const threadIds = [...new Set(inbound.map(e => e.thread_id).filter(Boolean))];
  const sentMessages = threadIds.length
    ? await col.find({ thread_id: { $in: threadIds }, label_ids: 'SENT' }).toArray()
    : [];
  const { repliedIds, sentMessagesSeen } = detectReplies(inbound, sentMessages);

  // Usage lives on email_analysis; the email document only mirrors the
  // category fields, so the cost figures need their own read.
  const gmailIds = inbound.map(e => e.gmail_id).filter(Boolean);
  const analyses = gmailIds.length
    ? await db.collection('email_analysis')
        .find({ gmail_id: { $in: gmailIds }, status: 'completed' })
        .toArray()
    : [];
  const analysisByGmailId = new Map(analyses.map(a => [a.gmail_id, a]));
  const usageOf = email => analysisByGmailId.get(email.gmail_id)?.usage ?? null;

  const emailIds = inbound.map(e => String(e._id));
  const tickets = emailIds.length
    ? await db.collection('tickets').find({ email_id: { $in: emailIds } }).toArray()
    : [];
  const ticketsByEmail = new Map();
  for (const t of tickets) {
    if (!ticketsByEmail.has(t.email_id)) ticketsByEmail.set(t.email_id, []);
    ticketsByEmail.get(t.email_id).push(t);
  }
  const isResolved = email =>
    (ticketsByEmail.get(String(email._id)) || []).some(t => RESOLVED_TICKET_STATUSES.has(t.status));

  const replied = inbound.filter(e => repliedIds.has(String(e._id)));

  return {
    current: inbound, previous: inboundPrev, ticketsByEmail, sentMessagesSeen, usageOf,
    cost: totalCost(inbound.map(usageOf)),
    summary: {
      total:             inbound.length,
      repliedResolved:   bucket(replied.filter(isResolved)),
      repliedUnresolved: bucket(replied.filter(e => !isResolved(e))),
      notReplied:        bucket(inbound.filter(e => !repliedIds.has(String(e._id)))),
    },
    feedback: feedbackRows(inbound, email => ticketsByEmail.get(String(email._id)) || []),
  };
}

/**
 * Build a report for a date range and channel.
 *
 * @param {object} db      a Mongo database handle
 * @param {object} opts
 * @param {string} opts.from     YYYY-MM-DD
 * @param {string} [opts.to]     YYYY-MM-DD, defaults to `from` (a single day)
 * @param {string} [opts.channel] 'all' | 'calls' | 'emails'
 *
 * A channel that is filtered out is not queried at all — the excluded side is
 * absent from the response rather than present and empty, so a page cannot
 * accidentally render a zero for something that was never asked about.
 */
async function buildReport(db, { from, to = from, channel = 'all' } = {}) {
  const window = rangeOf(from, to);
  const wantCalls  = channel === 'all' || channel === 'calls';
  const wantEmails = channel === 'all' || channel === 'emails';

  const [calls, emails] = await Promise.all([
    wantCalls  ? collectCalls(db, window)  : null,
    wantEmails ? collectEmails(db, window) : null,
  ]);

  // The pie covers only the channels in scope: a calls-only report must not
  // have its shares diluted by mail nobody asked to see.
  const share = rankIssues([...(calls?.merged || []), ...(emails?.current || [])]);
  const issueShare = share.categories.map(c => ({
    category: c.category,
    count:    c.count,
    pct:      share.mentions ? Math.round((c.count / share.mentions) * 1000) / 10 : 0,
  }));

  const prevWindow = { ...window, start: window.prevStart };
  const series = (docs, field, usageFor) => timelineBuckets(docs, field, window, usageFor);
  // The comparison window carries no cost: it exists to shape the red line, and
  // pricing a window nobody asked about would double the reported spend.
  const prevSeries = (docs, field) => timelineBuckets(docs, field, prevWindow);

  const currency = displayCurrency();
  const combined = {
    usd:      (calls?.cost.usd      ?? 0) + (emails?.cost.usd      ?? 0),
    priced:   (calls?.cost.priced   ?? 0) + (emails?.cost.priced   ?? 0),
    unpriced: (calls?.cost.unpriced ?? 0) + (emails?.cost.unpriced ?? 0),
  };

  return {
    from, to,
    days:        window.days,
    channel,
    granularity: window.granularity,
    previousFrom: toDateStr(window.prevStart),
    previousTo:   toDateStr(window.prevEnd),
    generatedAt:  new Date().toISOString(),

    calls:  calls?.summary  ?? null,
    emails: emails?.summary ?? null,

    issueShare,
    issueMentions: share.mentions,

    timeline: {
      calls: calls && {
        current:  series(calls.current, 'created_at', calls.usageOf),
        previous: prevSeries(calls.previous, 'created_at'),
      },
      emails: emails && {
        current:  series(emails.current, 'received_at', emails.usageOf),
        previous: prevSeries(emails.previous, 'received_at'),
      },
    },

    feedback: {
      calls:  calls?.feedback  ?? null,
      emails: emails?.feedback ?? null,
    },

    // What the AI analysis of this window cost. `unpriced` is the number of
    // analyses whose spend could not be established — no usage recorded, or a
    // model with no rate — so the total always reads as a floor, never as a
    // complete bill that happens to omit them.
    cost: {
      total:    { ...combined, usd: Math.round(combined.usd * 1e6) / 1e6 },
      calls:    calls?.cost  ?? null,
      emails:   emails?.cost ?? null,
      currency: currency.code,
      perUsd:   currency.perUsd,
      // Printed on the page so a stale rate is visible rather than implied.
      rates:    rateCard(),
    },

    // Everything the report cannot prove, stated rather than implied. The page
    // renders these as visible caveats so a zero is never mistaken for a fact.
    caveats: {
      // Reply detection is blind without sent mail in the mailbox sync.
      sentMailVisible: emails ? emails.sentMessagesSeen > 0 : null,
      // No field records that a follow-up mail went out — see docs/taxonomy.md.
      followUpMailTracked: false,
      // Resolution time exists only where an issue became a ticket.
      callsWithTickets:  calls?.ticketsByCall.size ?? null,
      emailsWithTickets: emails?.ticketsByEmail.size ?? null,
    },
  };
}

module.exports = {
  buildReport,
  // exported for tests
  rangeOf,
  rankIssues,
  timelineBuckets,
  ticketResolutionMinutes,
  detectReplies,
  feedbackRows,
  RESERVED_CATEGORIES,
};
