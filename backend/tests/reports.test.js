/**
 * /api/reports/summary — the report, for a day or a range, per channel.
 *
 * Covers the bucketing rules that carry real business meaning: which calls
 * count as resolved, how a reply is inferred without a Gmail "replied" flag,
 * what a disposition does to an issue ranking, and how resolution time is read
 * off a ticket timeline. The database is a fake (tests/helpers/fakeMongo).
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

const {
  rangeOf, rankIssues, timelineBuckets,
  ticketResolutionMinutes, detectReplies, feedbackRows,
} = require('../src/lib/reportData');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
const agentToken = jwt.sign({ name: 'Agent', role: 'agent', agent_number: '1001' }, 'test-secret');

const D = '2026-08-18';
const at = (h, m = 0) => new Date(2026, 7, 18, h, m, 0, 0);   // month is 0-based
const yesterdayAt = (h) => new Date(2026, 7, 17, h, 0, 0, 0);

function seed() {
  return {
    calls: [
      // answered + resolved, two distinct issues
      { call_id: 'c1', created_at: at(9), agent_answer_time: '2026-08-18T09:00:05',
        tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' },
               { category: 'Uploads & Documents', sub_category: 'Photograph Upload Issue' }] },
      // answered + unresolved
      { call_id: 'c2', created_at: at(9, 30), agent_answer_time: '2026-08-18T09:30:05',
        tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
      // answered, partial counts as unresolved
      { call_id: 'c3', created_at: at(11), agent_answer_time: '2026-08-18T11:00:05',
        tags: [{ category: 'Login & Account Access', sub_category: 'Account Locked / Blocked' }] },
      // missed — no agent_answer_time
      { call_id: 'c4', created_at: at(12), agent_answer_time: '' },
      // answered but a disposition, not an issue
      { call_id: 'c5', created_at: at(13), agent_answer_time: '2026-08-18T13:00:05',
        tags: [], category: 'Audio Unclear' },
      // answered but not yet analysed
      { call_id: 'c6', created_at: at(14), agent_answer_time: '2026-08-18T14:00:05' },
      // yesterday, for the comparison line
      { call_id: 'p1', created_at: yesterdayAt(9), agent_answer_time: '2026-08-17T09:00:05',
        tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
    ],

    call_analysis: [
      { call_id: 'c1', status: 'completed', call_resolved: 'Yes',
        tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' },
               { category: 'Uploads & Documents', sub_category: 'Photograph Upload Issue' }] },
      { call_id: 'c2', status: 'completed', call_resolved: 'No',
        tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
      { call_id: 'c3', status: 'completed', call_resolved: 'Partial',
        tags: [{ category: 'Login & Account Access', sub_category: 'Account Locked / Blocked' }] },
      { call_id: 'c5', status: 'completed', call_resolved: 'No', tags: [], category: 'Audio Unclear' },
    ],

    emails: [
      // replied (SENT later in th1) + resolved (ticket Closed)
      { _id: 'e1', gmail_id: 'g1', thread_id: 'th1', received_at: at(10),
        label_ids: ['INBOX'], tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
      // replied but no resolved ticket
      { _id: 'e2', gmail_id: 'g2', thread_id: 'th2', received_at: at(11),
        label_ids: ['INBOX'], tags: [{ category: 'Exam Information', sub_category: 'Syllabus Query' }] },
      // never replied
      { _id: 'e3', gmail_id: 'g3', thread_id: 'th3', received_at: at(12),
        label_ids: ['INBOX'], tags: [{ category: 'Payment & Fee', sub_category: 'Challan Payment Query' }] },
      // our own outbound mail — must never be counted as an inbound email
      { _id: 's1', gmail_id: 'gs1', thread_id: 'th1', received_at: at(10, 30), label_ids: ['SENT'] },
      { _id: 's2', gmail_id: 'gs2', thread_id: 'th2', received_at: at(11, 30), label_ids: ['SENT'] },
      // trashed and spam are excluded
      { _id: 'e4', gmail_id: 'g4', thread_id: 'th4', received_at: at(13), label_ids: ['TRASH'], is_trashed: true },
      { _id: 'e5', gmail_id: 'g5', thread_id: 'th5', received_at: at(13), label_ids: ['SPAM'], is_spam: true },
      // yesterday
      { _id: 'ep1', gmail_id: 'gp1', thread_id: 'thp', received_at: yesterdayAt(10),
        label_ids: ['INBOX'], tags: [{ category: 'Exam Information', sub_category: 'Syllabus Query' }] },
    ],

    tickets: [
      { _id: 't1', email_id: 'e1', status: 'Closed', created_at: at(10, 5),
        timeline: [{ type: 'status_changed', to: 'Closed', at: at(10, 35) }] },
      { _id: 't2', email_id: 'e2', status: 'Open', created_at: at(11, 5), timeline: [] },
      { _id: 't3', call_id: 'c2', status: 'Resolved', created_at: at(9, 35),
        timeline: [{ type: 'status_changed', to: 'Resolved', at: at(10, 35) }] },
    ],
  };
}

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeDb(seed(), (name, doc) => doc._id ?? doc.call_id ?? doc.gmail_id);
  jest.isolateModules(() => {
    app = express();
    app.use(express.json());
    app.use('/api/reports', require('../src/routes/reports'));
  });
});

const getReport = (date = D, token = adminToken) =>
  request(app).get(`/api/reports/summary?date=${date}`).set('Authorization', `Bearer ${token}`);

/** The range/channel form of the same endpoint. */
const getRange = (query, token = adminToken) =>
  request(app).get(`/api/reports/summary?${query}`).set('Authorization', `Bearer ${token}`);

/* ── auth & validation ─────────────────────────────────────────────────── */

describe('auth and validation', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/reports/summary').expect(401);
  });

  it('rejects an agent — the report spans every agent, so partial scoping would mislead', async () => {
    await getReport(D, agentToken).expect(403);
  });

  it('rejects a malformed date', async () => {
    await getReport('18-08-2026').expect(400);
  });

  it('rejects a date that is not a real calendar day', async () => {
    const res = await getReport('2026-02-31').expect(400);
    expect(res.body.error).toMatch(/real YYYY-MM-DD/);
  });

  it('rejects a backwards range rather than silently returning nothing', async () => {
    const res = await getRange('from=2026-08-18&to=2026-08-12').expect(400);
    expect(res.body.error).toMatch(/must not be after/);
  });

  it('rejects an unknown channel', async () => {
    const res = await getRange(`date=${D}&channel=faxes`).expect(400);
    expect(res.body.error).toMatch(/channel must be one of/);
  });

  it('refuses a span wider than the cap instead of trying to load it', async () => {
    const res = await getRange('from=2020-01-01&to=2026-08-18').expect(400);
    expect(res.body.error).toMatch(/maximum is 366/);
  });

  it('reports the span it can cover', async () => {
    const { body } = await request(app).get('/api/reports/range')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(body.minDate).toBe('2026-08-17');   // the earliest seeded document
    expect(body.maxDays).toBe(366);
  });
});

/* ── date ranges ─────────────────────────────────────────────── */

describe('date ranges', () => {
  it('treats a single date as a one-day range bucketed by hour', async () => {
    const { body } = await getReport().expect(200);
    expect(body.days).toBe(1);
    expect(body.granularity).toBe('hour');
    expect(body.timeline.calls.current).toHaveLength(24);
  });

  it('aggregates a multi-day range and buckets it by day', async () => {
    const { body } = await getRange('from=2026-08-17&to=2026-08-18').expect(200);

    expect(body.days).toBe(2);
    expect(body.granularity).toBe('day');
    expect(body.timeline.calls.current).toHaveLength(2);
    // Both days' calls now count together: 6 on the 18th + 1 on the 17th.
    expect(body.calls.total).toBe(7);
    expect(body.emails.total).toBe(4);          // 3 on the 18th + 1 on the 17th
  });

  it('compares against the equally long window immediately before', async () => {
    const { body } = await getRange('from=2026-08-17&to=2026-08-18').expect(200);
    expect(body.previousFrom).toBe('2026-08-15');
    expect(body.previousTo).toBe('2026-08-16');
    expect(body.timeline.calls.previous).toHaveLength(2);
  });

  it('defaults `to` to `from`, so from alone is a single day', async () => {
    const { body } = await getRange(`from=${D}`).expect(200);
    expect(body.to).toBe(D);
    expect(body.days).toBe(1);
  });

  it('keys day buckets by date so the axis can label them', async () => {
    const { body } = await getRange('from=2026-08-17&to=2026-08-18').expect(200);
    expect(body.timeline.calls.current.map(b => b.key)).toEqual(['2026-08-17', '2026-08-18']);
    expect(body.timeline.calls.current[1].count).toBe(6);
  });
});

/* ── channel filter ──────────────────────────────────────────── */

describe('channel filter', () => {
  it('omits mail entirely when only calls are asked for', async () => {
    const { body } = await getRange(`date=${D}&channel=calls`).expect(200);

    expect(body.channel).toBe('calls');
    expect(body.calls).not.toBeNull();
    // Absent, not an empty object — a page cannot render a zero for something
    // that was never asked about.
    expect(body.emails).toBeNull();
    expect(body.timeline.emails).toBeNull();
    expect(body.feedback.emails).toBeNull();
  });

  it('omits calls entirely when only mail is asked for', async () => {
    const { body } = await getRange(`date=${D}&channel=emails`).expect(200);

    expect(body.channel).toBe('emails');
    expect(body.emails).not.toBeNull();
    expect(body.calls).toBeNull();
    expect(body.timeline.calls).toBeNull();
    expect(body.feedback.calls).toBeNull();
  });

  it('keeps the surviving channel identical to its half of the full report', async () => {
    const full  = (await getReport().expect(200)).body;
    const only  = (await getRange(`date=${D}&channel=calls`).expect(200)).body;
    expect(only.calls).toEqual(full.calls);
    expect(only.timeline.calls).toEqual(full.timeline.calls);
  });

  it('shares the pie across only the channels in scope', async () => {
    const full  = (await getReport().expect(200)).body;
    const calls = (await getRange(`date=${D}&channel=calls`).expect(200)).body;

    // Mail mentions are gone, so the totals differ and the shares are recomputed.
    expect(calls.issueMentions).toBeLessThan(full.issueMentions);
    const pct = calls.issueShare.reduce((sum, s) => sum + s.pct, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });

  it('drops the mail caveats when mail is out of scope', async () => {
    const { body } = await getRange(`date=${D}&channel=calls`).expect(200);
    expect(body.caveats.sentMailVisible).toBeNull();
    expect(body.caveats.emailsWithTickets).toBeNull();
    expect(body.caveats.callsWithTickets).toBe(1);
  });
});

/* ── page 1: calls ─────────────────────────────────────────────────────── */

describe('page 1 — calls', () => {
  it('splits answered calls into resolved and unresolved, and counts missed separately', async () => {
    const { body } = await getReport().expect(200);

    expect(body.calls.total).toBe(6);          // yesterday's p1 excluded
    expect(body.calls.missed).toBe(1);         // c4
    expect(body.calls.answered).toBe(5);
    expect(body.calls.resolved.total).toBe(1); // c1 only
    // c2 (No) + c3 (Partial) + c5 (Audio Unclear, resolved 'No')
    expect(body.calls.unresolved.total).toBe(3);
    expect(body.calls.pending).toBe(1);        // c6, not analysed
  });

  it('treats Partial as unresolved', async () => {
    const { body } = await getReport().expect(200);
    const cats = body.calls.unresolved.categories.map(c => c.category);
    expect(cats).toContain('Login & Account Access');
  });

  it('ranks issues by frequency and nests sub-categories', async () => {
    const { body } = await getReport().expect(200);
    const resolved = body.calls.resolved.categories;

    expect(resolved[0].category).toBe('Payment & Fee');
    expect(resolved[0].subs[0].sub_category).toBe('Duplicate Payment Refund Query');
  });

  it('keeps a disposition out of the issue list but inside the bucket total', async () => {
    const { body } = await getReport().expect(200);
    const names = body.calls.unresolved.categories.map(c => c.category);

    expect(names).not.toContain('Audio Unclear');   // not an issue
    expect(body.calls.unresolved.total).toBe(3);    // but the call still counts
    expect(body.calls.unresolved.reserved).toBeGreaterThan(0);
  });
});

/* ── page 1: emails ────────────────────────────────────────────────────── */

describe('page 1 — emails', () => {
  it('splits mail into replied+resolved, replied+unresolved and not-replied', async () => {
    const { body } = await getReport().expect(200);

    expect(body.emails.total).toBe(3);                   // e1..e3; SENT/trash/spam excluded
    expect(body.emails.repliedResolved.total).toBe(1);   // e1
    expect(body.emails.repliedUnresolved.total).toBe(1); // e2 — replied, ticket still Open
    expect(body.emails.notReplied.total).toBe(1);        // e3
  });

  it('never counts our own sent mail as an inbound email', async () => {
    const { body } = await getReport().expect(200);
    const buckets = body.emails.repliedResolved.total
      + body.emails.repliedUnresolved.total
      + body.emails.notReplied.total;
    expect(buckets).toBe(body.emails.total);
  });

  it('reports whether sent mail is visible at all, so an all-unreplied day is explainable', async () => {
    const { body } = await getReport().expect(200);
    expect(body.caveats.sentMailVisible).toBe(true);
  });
});

/* ── pages 2-3: timelines ──────────────────────────────────────────────── */

describe('pages 2-3 — timelines', () => {
  it('returns 24 hourly buckets for today and the previous day', async () => {
    const { body } = await getReport().expect(200);

    expect(body.timeline.calls.current).toHaveLength(24);
    expect(body.timeline.calls.previous).toHaveLength(24);
    expect(body.previousFrom).toBe('2026-08-17');
  });

  it('counts calls into the hour they arrived and names the dominant issue', async () => {
    const { body } = await getReport().expect(200);
    const nine = body.timeline.calls.current[9];

    expect(nine.count).toBe(2);                      // c1, c2
    expect(nine.topCategory).toBe('Payment & Fee');  // both raise it
  });

  it('reports no dominant issue for an hour holding only dispositions', async () => {
    const { body } = await getReport().expect(200);
    expect(body.timeline.calls.current[13].count).toBe(1);       // c5, Audio Unclear
    expect(body.timeline.calls.current[13].topCategory).toBeNull();
  });

  it('plots the previous day separately', async () => {
    const { body } = await getReport().expect(200);
    expect(body.timeline.calls.previous[9].count).toBe(1);     // p1
    expect(body.timeline.emails.previous[10].count).toBe(1);   // ep1
  });
});

/* ── page 1: pie ───────────────────────────────────────────────────────── */

describe('page 1 — issue share', () => {
  it('shares out issue mentions across calls and mail as percentages', async () => {
    const { body } = await getReport().expect(200);
    const total = body.issueShare.reduce((sum, s) => sum + s.count, 0);

    expect(total).toBe(body.issueMentions);
    expect(body.issueShare[0].category).toBe('Payment & Fee');
    const pct = body.issueShare.reduce((sum, s) => sum + s.pct, 0);
    expect(pct).toBeGreaterThan(99);
    expect(pct).toBeLessThan(101);
  });
});

/* ── pages 4-5: feedback ───────────────────────────────────────────────── */

describe('pages 4-5 — feedback loop', () => {
  it('reads resolution time off the ticket timeline, not updated_at', async () => {
    const { body } = await getReport().expect(200);
    const fee = body.feedback.calls.find(r => r.category === 'Payment & Fee');

    // c2 → ticket t3, created 09:35, resolved 10:35 = 60 minutes
    expect(fee.avgResolutionMins).toBe(60);
    expect(fee.resolvedCount).toBe(1);
  });

  it('counts calls settled on the call itself', async () => {
    const { body } = await getReport().expect(200);
    const fee = body.feedback.calls.find(r => r.category === 'Payment & Fee');
    expect(fee.firstTouch).toBe(1);   // c1 resolved 'Yes'
  });

  it('reports resolvedCount alongside the average so a thin sample is visible', async () => {
    const { body } = await getReport().expect(200);
    for (const row of body.feedback.calls) {
      if (row.avgResolutionMins === null) expect(row.resolvedCount).toBe(0);
      else expect(row.resolvedCount).toBeGreaterThan(0);
    }
  });

  it('states that follow-up mail is not tracked rather than reporting zero', async () => {
    const { body } = await getReport().expect(200);
    expect(body.caveats.followUpMailTracked).toBe(false);
  });
});

/* ── unit-level rules ──────────────────────────────────────────────────── */

describe('rangeOf', () => {
  it('spans local midnight to local end-of-day', () => {
    const { start, end } = rangeOf('2026-08-18');
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(18);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('steps back across a month boundary', () => {
    const { prevStart } = rangeOf('2026-08-01');
    expect(prevStart.getMonth()).toBe(6);   // July
    expect(prevStart.getDate()).toBe(31);
  });
});

describe('rankIssues', () => {
  it('counts a document once per distinct category, not once per tag', () => {
    const { categories, mentions } = rankIssues([
      { tags: [
        { category: 'Payment & Fee', sub_category: 'Fee Amount Query' },
        { category: 'Payment & Fee', sub_category: 'Challan Payment Query' },
      ]},
    ]);
    expect(categories[0].count).toBe(1);
    expect(mentions).toBe(1);
    expect(categories[0].subs).toHaveLength(1);   // only the first tag's sub counted
  });

  it('falls back to the scalar pair for records analysed before tagging', () => {
    const { categories } = rankIssues([
      { category: 'Exam Information', sub_category: 'Syllabus Query' },
    ]);
    expect(categories[0].category).toBe('Exam Information');
    expect(categories[0].subs[0].sub_category).toBe('Syllabus Query');
  });

  it('drops "-" sub-categories rather than listing them as an issue', () => {
    const { categories } = rankIssues([
      { tags: [{ category: 'Exam Information', sub_category: '-' }] },
    ]);
    expect(categories[0].subs).toHaveLength(0);
  });

  it('counts every reserved value it skipped', () => {
    const { categories, reserved } = rankIssues([
      { tags: [{ category: 'Uncategorised', sub_category: '-' }] },
      { category: 'Call too Short' },
    ]);
    expect(categories).toHaveLength(0);
    expect(reserved).toBe(2);
  });
});

describe('detectReplies', () => {
  const inbound = [{ _id: 'a', thread_id: 'th', received_at: new Date('2026-08-18T10:00:00Z') }];

  it('counts a later SENT message in the same thread as a reply', () => {
    const { repliedIds } = detectReplies(inbound, [
      { thread_id: 'th', received_at: new Date('2026-08-18T10:30:00Z') },
    ]);
    expect(repliedIds.has('a')).toBe(true);
  });

  it('ignores a SENT message that predates the inbound mail', () => {
    const { repliedIds } = detectReplies(inbound, [
      { thread_id: 'th', received_at: new Date('2026-08-18T09:00:00Z') },
    ]);
    expect(repliedIds.has('a')).toBe(false);
  });

  it('ignores sent mail in a different thread', () => {
    const { repliedIds } = detectReplies(inbound, [
      { thread_id: 'other', received_at: new Date('2026-08-18T23:00:00Z') },
    ]);
    expect(repliedIds.has('a')).toBe(false);
  });

  it('reports zero visible sent mail, which is what a narrowed sync query looks like', () => {
    const { repliedIds, sentMessagesSeen } = detectReplies(inbound, []);
    expect(repliedIds.size).toBe(0);
    expect(sentMessagesSeen).toBe(0);
  });
});

describe('ticketResolutionMinutes', () => {
  const created = new Date('2026-08-18T09:00:00Z');

  it('is null for a ticket that is still open', () => {
    expect(ticketResolutionMinutes({ status: 'Open', created_at: created })).toBeNull();
  });

  it('prefers the status_changed entry over updated_at', () => {
    const mins = ticketResolutionMinutes({
      status: 'Resolved', created_at: created,
      updated_at: new Date('2026-08-19T09:00:00Z'),          // a later edit
      timeline: [{ type: 'status_changed', to: 'Resolved', at: new Date('2026-08-18T09:30:00Z') }],
    });
    expect(mins).toBe(30);
  });

  it('uses the earliest resolving transition when a ticket was reopened', () => {
    const mins = ticketResolutionMinutes({
      status: 'Closed', created_at: created,
      timeline: [
        { type: 'status_changed', to: 'Resolved', at: new Date('2026-08-18T09:15:00Z') },
        { type: 'status_changed', to: 'Open',     at: new Date('2026-08-18T09:20:00Z') },
        { type: 'status_changed', to: 'Closed',   at: new Date('2026-08-18T10:00:00Z') },
      ],
    });
    expect(mins).toBe(15);
  });

  it('falls back to updated_at for a resolved ticket with no timeline', () => {
    const mins = ticketResolutionMinutes({
      status: 'Closed', created_at: created,
      updated_at: new Date('2026-08-18T10:00:00Z'), timeline: [],
    });
    expect(mins).toBe(60);
  });
});

describe('feedbackRows', () => {
  it('averages only over documents that actually reached a resolved ticket', () => {
    const docs = [
      { id: 1, tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
      { id: 2, tags: [{ category: 'Payment & Fee', sub_category: 'Fee Amount Query' }] },
    ];
    const tickets = { 1: [{ status: 'Resolved', created_at: new Date('2026-08-18T09:00:00Z'),
                            timeline: [{ type: 'status_changed', to: 'Resolved', at: new Date('2026-08-18T09:20:00Z') }] }],
                      2: [] };

    const [row] = feedbackRows(docs, d => tickets[d.id]);
    expect(row.total).toBe(2);
    expect(row.resolvedCount).toBe(1);
    expect(row.avgResolutionMins).toBe(20);
  });

  it('leaves the average null when nothing was ever resolved', () => {
    const [row] = feedbackRows(
      [{ tags: [{ category: 'Exam Information', sub_category: 'Syllabus Query' }] }],
      () => [],
    );
    expect(row.avgResolutionMins).toBeNull();
    expect(row.resolvedCount).toBe(0);
  });
});

describe('timelineBuckets', () => {
  const oneDay = rangeOf('2026-08-18');

  it('always returns a full 24-hour spine, including empty hours', () => {
    const hours = timelineBuckets([{ created_at: new Date(2026, 7, 18, 5) }], 'created_at', oneDay);
    expect(hours).toHaveLength(24);
    expect(hours[5].count).toBe(1);
    expect(hours[0].count).toBe(0);
  });

  it('skips documents with no timestamp instead of bucketing them at midnight', () => {
    const hours = timelineBuckets([{ created_at: null }], 'created_at', oneDay);
    expect(hours.reduce((a, h) => a + h.count, 0)).toBe(0);
  });

  it('buckets a multi-day range by day, one slot per day', () => {
    const week = rangeOf('2026-08-12', '2026-08-18');
    const days = timelineBuckets([
      { created_at: new Date(2026, 7, 12, 9) },
      { created_at: new Date(2026, 7, 12, 17) },
      { created_at: new Date(2026, 7, 18, 9) },
    ], 'created_at', week);

    expect(days).toHaveLength(7);
    expect(days[0].key).toBe('2026-08-12');
    expect(days[0].count).toBe(2);
    expect(days[6].count).toBe(1);
    expect(days[3].count).toBe(0);   // an untouched day is still drawn
  });

  it('labels day buckets DD/MM for the axis', () => {
    const week = rangeOf('2026-08-12', '2026-08-18');
    expect(timelineBuckets([], 'created_at', week)[0].label).toBe('12/08');
  });
});
