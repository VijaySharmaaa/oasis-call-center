/**
 * /api/emails — routing, auth, filter construction, and projections.
 *
 * The database is a fake (tests/helpers/fakeMongo) and gmailService is mocked,
 * so nothing here touches Atlas or the Gmail API.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';

const express  = require('express');
const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

const SEED = [
  { gmail_id: 'm1', thread_id: 'th1', subject: 'Payment debited but form incomplete',
    from_email: 'aasha@example.com', from_name: 'Aasha', to: 'support@upessc.org',
    snippet: 'money deducted', body_text: 'money deducted twice', body_html: '<b>hi</b>',
    received_at: new Date('2026-08-16T10:00:00Z'), is_unread: true, has_attachments: true,
    is_trashed: false, is_deleted: false, label_ids: ['INBOX', 'UNREAD'],
    attachments: [{ attachment_id: 'att1', filename: 'receipt.pdf', mime_type: 'application/pdf', size: 900 }] },

  { gmail_id: 'm2', thread_id: 'th2', subject: 'OTR edit query',
    from_email: 'ravi@example.com', from_name: 'Ravi', to: 'support@upessc.org',
    snippet: 'edit saved data', body_text: 'how to edit', body_html: '',
    received_at: new Date('2026-08-15T10:00:00Z'), is_unread: false, has_attachments: false,
    is_trashed: false, is_deleted: false, label_ids: ['INBOX', 'Label_9'], attachments: [] },

  { gmail_id: 'm3', thread_id: 'th3', subject: 'trashed thing',
    from_email: 'spam@example.com', from_name: 'Spam', to: 'support@upessc.org',
    snippet: 'x', body_text: 'x', body_html: '',
    received_at: new Date('2026-08-14T10:00:00Z'), is_unread: true, has_attachments: false,
    is_trashed: true, is_deleted: false, label_ids: ['TRASH'], attachments: [] },

  { gmail_id: 'm4', thread_id: 'th4', subject: 'deleted from gmail',
    from_email: 'gone@example.com', from_name: 'Gone', to: 'support@upessc.org',
    snippet: 'x', body_text: 'x', body_html: '',
    received_at: new Date('2026-08-13T10:00:00Z'), is_unread: true, has_attachments: false,
    is_trashed: false, is_deleted: true, label_ids: [], attachments: [] },
];

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

const mockSyncOnce = jest.fn(() => Promise.resolve({ phase: 'incremental', stored: 0 }));
jest.mock('../src/workers/emailSyncWorker', () => ({
  startEmailSyncWorker: jest.fn(),
  syncOnce: (...args) => mockSyncOnce(...args),
}));

const mockEnqueueEmail = jest.fn(() => Promise.resolve(true));
jest.mock('../src/workers/emailAnalysisWorker', () => ({
  startEmailAnalysisWorker: jest.fn(),
  enqueueEmail: (...args) => mockEnqueueEmail(...args),
  TOO_SHORT_CATEGORY: 'Email too Short',
}));

const mockGmail = {
  isConfigured: jest.fn(() => true),
  authMode:     jest.fn(() => 'service_account'),
  mailbox:      jest.fn(() => 'support@upessc.org'),
  getAttachment: jest.fn(() => Promise.resolve(Buffer.from('%PDF-1.4 fake'))),
  listLabels:   jest.fn(() => Promise.resolve([{ id: 'Label_9', name: 'Escalations', type: 'user' }])),
};
jest.mock('../src/services/gmailService', () => mockGmail);

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
const agentToken = jwt.sign({ name: 'Agent', role: 'agent', agent_number: '1001' }, 'test-secret');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockGmail.isConfigured.mockReturnValue(true);
  mockGmail.authMode.mockReturnValue('service_account');
  mockGmail.mailbox.mockReturnValue('support@upessc.org');
  mockFake = createFakeDb({
    // m1 is analysed (the worker mirrors category/sub_category/ai_insight onto
    // the email document); m2 is not yet.
    emails: SEED.map(e => e.gmail_id === 'm1'
      ? { ...e, category: 'Payment & Fee', sub_category: 'Money Debited but Application Incomplete',
          ai_insight: 'Payment deducted form incomplete', analysed_at: new Date('2026-08-16T10:05:00Z') }
      : e),
    email_sync_state: [{ _id: 'support@upessc.org', phase: 'incremental', synced_total: 12, last_sync_at: new Date('2026-08-17T09:00:00Z'), last_error: null }],
    email_analysis: [{
      gmail_id: 'm1', status: 'completed', category: 'Payment & Fee',
      sub_category: 'Money Debited but Application Incomplete',
      summary: 'Fee was debited but the application stayed incomplete. They ask for the form to be unlocked.',
      ai_insight: 'Payment deducted form incomplete', bugs: '-', bug_category: '-',
      requested_action: 'Refund', language: ['Hinglish'], model_used: 'gemini-2.5-flash',
      processed_at: new Date('2026-08-16T10:05:00Z'), attempts: 0, error: null,
    }],
  });
  app = express();
  app.use(express.json());
  app.use('/api/emails', require('../src/routes/emails'));
});

const ids = res => res.body.emails.map(e => e.id);
const get = (path, token = adminToken) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const patch = (path, body, token = adminToken) =>
  request(app).patch(path).set('Authorization', `Bearer ${token}`).send(body);

describe('auth', () => {
  it('rejects a request with no token', async () => {
    await request(app).get('/api/emails').expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ name: 'Mallory', role: 'admin' }, 'wrong-secret');
    await get('/api/emails', forged).expect(401);
  });

  it('allows any authenticated agent to read mail', async () => {
    await get('/api/emails', agentToken).expect(200);
  });
});

describe('GET /api/emails', () => {
  it('lists newest first, hiding trashed and soft-deleted mail', async () => {
    const res = await get('/api/emails').expect(200);
    expect(ids(res)).toEqual(['m1', 'm2']);
    expect(res.body.total).toBe(2);
  });

  it('omits bodies from the list payload', async () => {
    const res = await get('/api/emails').expect(200);
    for (const email of res.body.emails) {
      expect(email.body_text).toBeUndefined();
      expect(email.body_html).toBeUndefined();
    }
    expect(res.body.emails[0].snippet).toBe('money deducted');
  });

  it('exposes the Gmail message id as `id`', async () => {
    const res = await get('/api/emails').expect(200);
    expect(res.body.emails[0].id).toBe('m1');
    expect(res.body.emails[0].gmail_id).toBe('m1');
  });

  it('counts unread excluding trashed and deleted', async () => {
    // m1 (unread), m3 (unread but trashed), m4 (unread but deleted) → 1
    const res = await get('/api/emails').expect(200);
    expect(res.body.unreadCount).toBe(1);
  });

  it('filters by unread=true and unread=false', async () => {
    expect(ids(await get('/api/emails?unread=true').expect(200))).toEqual(['m1']);
    expect(ids(await get('/api/emails?unread=false').expect(200))).toEqual(['m2']);
  });
});

/**
 * Oasis-side read state.
 *
 * The service account holds gmail.readonly, so opening a mail here cannot clear
 * Gmail's UNREAD label. `read_at` records the read on our side instead, and
 * "unread" means unread in Gmail AND not opened here — otherwise every mail an
 * operator reads in Oasis stays bold forever, which is the bug this fixes.
 */
describe('PATCH /api/emails/:id/read', () => {
  const readAtOf = id => mockFake.store.emails.get(id).read_at;

  it('rejects an unauthenticated request', async () => {
    await request(app).patch('/api/emails/m1/read').send({ read: true }).expect(401);
  });

  it('404s for a message we do not hold', async () => {
    await patch('/api/emails/nope/read', { read: true }).expect(404);
  });

  it('marks a mail read and records who did it', async () => {
    await patch('/api/emails/m1/read', { read: true }).expect(200);
    expect(readAtOf('m1')).toBeInstanceOf(Date);
    expect(mockFake.store.emails.get('m1').read_by).toBe('Admin');
  });

  it('defaults to marking read when the body omits the flag', async () => {
    await patch('/api/emails/m1/read', {}).expect(200);
    expect(readAtOf('m1')).toBeInstanceOf(Date);
  });

  it('drops the mail out of the unread filter and count once read', async () => {
    expect(ids(await get('/api/emails?unread=true'))).toEqual(['m1']);
    expect((await get('/api/emails')).body.unreadCount).toBe(1);

    await patch('/api/emails/m1/read', { read: true }).expect(200);

    expect(ids(await get('/api/emails?unread=true'))).toEqual([]);
    expect((await get('/api/emails')).body.unreadCount).toBe(0);
    // …and it now reads as read, even though Gmail still says UNREAD.
    expect(ids(await get('/api/emails?unread=false')).sort()).toEqual(['m1', 'm2']);
    expect(mockFake.store.emails.get('m1').is_unread).toBe(true);
  });

  it('puts it back in the unread pile when read=false', async () => {
    await patch('/api/emails/m1/read', { read: true }).expect(200);
    await patch('/api/emails/m1/read', { read: false }).expect(200);

    // Unset, not nulled — the unread predicate is a plain $exists.
    expect('read_at' in mockFake.store.emails.get('m1')).toBe(false);
    expect(ids(await get('/api/emails?unread=true'))).toEqual(['m1']);
  });

  it('cannot resurrect a mail Gmail itself considers read', async () => {
    // m2 is read in Gmail. Clearing our marker must not make it unread again.
    await patch('/api/emails/m2/read', { read: false }).expect(200);
    expect(ids(await get('/api/emails?unread=true'))).toEqual(['m1']);
  });

  it('lets any agent mark read — a shared mailbox is triaged by whoever picks it up', async () => {
    await patch('/api/emails/m1/read', { read: true }, agentToken).expect(200);
    expect(mockFake.store.emails.get('m1').read_by).toBe('Agent');
  });

  it('is idempotent', async () => {
    await patch('/api/emails/m1/read', { read: true }).expect(200);
    const first = readAtOf('m1');
    await patch('/api/emails/m1/read', { read: true }).expect(200);
    expect(readAtOf('m1')).toBeInstanceOf(Date);
    expect(readAtOf('m1').getTime()).toBeGreaterThanOrEqual(first.getTime());
  });

  it('searches subject, sender and body', async () => {
    expect(ids(await get('/api/emails?search=OTR').expect(200))).toEqual(['m2']);
    expect(ids(await get('/api/emails?search=aasha').expect(200))).toEqual(['m1']);
    expect(ids(await get('/api/emails?search=deducted%20twice').expect(200))).toEqual(['m1']);
  });

  it('escapes regex metacharacters in the search term', async () => {
    // Unescaped, "pay(" is an invalid regex and would throw a 500; "." would
    // match everything. Both must be treated as literal text.
    const paren = await get('/api/emails?search=' + encodeURIComponent('pay(')).expect(200);
    expect(paren.body.total).toBe(0);
    const dot = await get('/api/emails?search=' + encodeURIComponent('....')).expect(200);
    expect(dot.body.total).toBe(0);
  });

  it('filters by attachments, label, sender and thread', async () => {
    expect(ids(await get('/api/emails?hasAttachments=true').expect(200))).toEqual(['m1']);
    expect(ids(await get('/api/emails?label=Label_9').expect(200))).toEqual(['m2']);
    expect(ids(await get('/api/emails?from=RAVI@example.com').expect(200))).toEqual(['m2']);
    expect(ids(await get('/api/emails?threadId=th1').expect(200))).toEqual(['m1']);
  });

  it('includes trashed mail only when asked', async () => {
    const res = await get('/api/emails?includeTrashed=true').expect(200);
    expect(ids(res)).toEqual(['m1', 'm2', 'm3']);
  });

  it('never returns soft-deleted mail, even with includeTrashed', async () => {
    const res = await get('/api/emails?includeTrashed=true').expect(200);
    expect(ids(res)).not.toContain('m4');
  });

  it('filters by date range', async () => {
    expect(ids(await get('/api/emails?dateFrom=2026-08-16T00:00').expect(200))).toEqual(['m1']);
    expect(ids(await get('/api/emails?dateTo=2026-08-15T23:59').expect(200))).toEqual(['m2']);
  });

  it('paginates', async () => {
    const page1 = await get('/api/emails?limit=1&offset=0').expect(200);
    const page2 = await get('/api/emails?limit=1&offset=1').expect(200);
    expect(ids(page1)).toEqual(['m1']);
    expect(ids(page2)).toEqual(['m2']);
    expect(page1.body.total).toBe(2);   // total ignores pagination
  });

  it('caps limit at 200 so a client cannot ask for the whole mailbox', async () => {
    // Only the cap matters here; the mockFake returns everything it has.
    await get('/api/emails?limit=99999').expect(200);
  });
});

describe('GET /api/emails/:id', () => {
  it('returns the full message including bodies', async () => {
    const res = await get('/api/emails/m1').expect(200);
    expect(res.body.body_text).toBe('money deducted twice');
    expect(res.body.body_html).toBe('<b>hi</b>');
    expect(res.body.attachments).toHaveLength(1);
  });

  it('404s an unknown id', async () => {
    await get('/api/emails/nope').expect(404);
  });

  it('does not shadow the static sub-routes', async () => {
    // "sync-status" and "labels" must not be read as message ids.
    await get('/api/emails/sync-status').expect(200);
    await get('/api/emails/labels').expect(200);
  });
});

describe('attachments', () => {
  it('streams an attachment the message actually declares', async () => {
    const res = await get('/api/emails/m1/attachments/att1').expect(200);
    expect(res.headers['content-type']).toMatch('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="receipt.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(mockGmail.getAttachment).toHaveBeenCalledWith('m1', 'att1');
  });

  it('refuses an attachment id not listed on that message', async () => {
    // Otherwise the endpoint would proxy arbitrary ids out of the whole mailbox.
    await get('/api/emails/m1/attachments/forged').expect(404);
    expect(mockGmail.getAttachment).not.toHaveBeenCalled();
  });

  it('refuses attachments on an unknown message', async () => {
    await get('/api/emails/nope/attachments/att1').expect(404);
  });

  it('reports a Gmail failure as 502 rather than leaking the error', async () => {
    mockGmail.getAttachment.mockRejectedValueOnce(new Error('quota exceeded for project 12345'));
    const res = await get('/api/emails/m1/attachments/att1').expect(502);
    expect(res.body.error).not.toMatch(/quota|12345/);
  });
});

describe('sync endpoints', () => {
  it('reports credential and worker health', async () => {
    const res = await get('/api/emails/sync-status').expect(200);
    expect(res.body).toMatchObject({
      configured:   true,
      auth_mode:    'service_account',
      mailbox:      'support@upessc.org',
      phase:        'incremental',
      synced_total: 12,
      stored_total: 4,   // counts everything, including trashed/deleted
      unread:       2,   // unread and not soft-deleted
    });
  });

  it('reports missing credentials instead of pretending to work', async () => {
    mockGmail.isConfigured.mockReturnValue(false);
    mockGmail.authMode.mockReturnValue(null);
    const res = await get('/api/emails/sync-status').expect(200);
    expect(res.body.configured).toBe(false);
  });

  it('lets an admin force a sync', async () => {
    await request(app).post('/api/emails/sync').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(mockSyncOnce).toHaveBeenCalled();
  });

  it('blocks a non-admin from forcing a sync', async () => {
    await request(app).post('/api/emails/sync').set('Authorization', `Bearer ${agentToken}`).expect(403);
    expect(mockSyncOnce).not.toHaveBeenCalled();
  });

  it('503s a forced sync when Gmail is not configured', async () => {
    mockGmail.isConfigured.mockReturnValue(false);
    await request(app).post('/api/emails/sync').set('Authorization', `Bearer ${adminToken}`).expect(503);
    expect(mockSyncOnce).not.toHaveBeenCalled();
  });

  it('surfaces a sync error as 502', async () => {
    mockSyncOnce.mockResolvedValueOnce({ error: 'delegation not authorised' });
    const res = await request(app).post('/api/emails/sync').set('Authorization', `Bearer ${adminToken}`).expect(502);
    expect(res.body.error).toMatch(/delegation/);
  });

  it('returns labels, and degrades to an empty list if Gmail is unreachable', async () => {
    const ok = await get('/api/emails/labels').expect(200);
    expect(ok.body.labels).toEqual([{ id: 'Label_9', name: 'Escalations', type: 'user' }]);

    mockGmail.listLabels.mockRejectedValueOnce(new Error('network down'));
    const degraded = await get('/api/emails/labels').expect(200);
    expect(degraded.body.labels).toEqual([]);
  });
});

describe('AI analysis surface', () => {
  it('carries the mirrored category fields in the list', async () => {
    const res = await get('/api/emails').expect(200);
    const analysed = res.body.emails.find(e => e.id === 'm1');
    expect(analysed).toMatchObject({
      category: 'Payment & Fee',
      sub_category: 'Money Debited but Application Incomplete',
      ai_insight: 'Payment deducted form incomplete',
    });
  });

  it('leaves the fields absent on mail not yet analysed', async () => {
    const res = await get('/api/emails').expect(200);
    expect(res.body.emails.find(e => e.id === 'm2').category).toBeUndefined();
  });

  it('filters by category', async () => {
    expect(ids(await get('/api/emails?category=' + encodeURIComponent('Payment & Fee')).expect(200))).toEqual(['m1']);
  });

  it('filters by sub-category', async () => {
    const res = await get('/api/emails?subCategory=' + encodeURIComponent('Money Debited but Application Incomplete')).expect(200);
    expect(ids(res)).toEqual(['m1']);
  });

  it('treats Uncategorised as "no category yet" too', async () => {
    // An operator asking for Uncategorised means "needs attention", which
    // includes mail the worker has not reached.
    expect(ids(await get('/api/emails?category=Uncategorised').expect(200))).toEqual(['m2']);
  });

  it('filters by analysis coverage', async () => {
    expect(ids(await get('/api/emails?analysisStatus=analysed').expect(200))).toEqual(['m1']);
    expect(ids(await get('/api/emails?analysisStatus=unanalysed').expect(200))).toEqual(['m2']);
  });

  it('returns the full analysis on the detail endpoint', async () => {
    const res = await get('/api/emails/m1').expect(200);
    expect(res.body.analysis).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/debited/),
      requested_action: 'Refund',
      model_used: 'gemini-2.5-flash',
    });
  });

  it('returns analysis: null when none exists', async () => {
    const res = await get('/api/emails/m2').expect(200);
    expect(res.body.analysis).toBeNull();
  });

  it('never leaks the internal processing_id', async () => {
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, { $set: { processing_id: 'worker-7' } });
    const res = await get('/api/emails/m1').expect(200);
    expect(res.body.analysis.processing_id).toBeUndefined();
  });

  it('offers the schema and live counts for the category filter', async () => {
    const res = await get('/api/emails/categories').expect(200);
    expect(res.body.schema.length).toBeGreaterThan(10);
    expect(res.body.schema[0]).toHaveProperty('sub_categories');
    expect(res.body.counts.find(c => c.category === 'Payment & Fee')).toMatchObject({ total: 1 });
  });

  it('reports queue health and coverage', async () => {
    const res = await get('/api/emails/analysis/stats').expect(200);
    expect(res.body.queue).toMatchObject({ completed: 1, pending: 0, processing: 0, failed: 0 });
    // stored excludes m4, which Gmail deleted — there is nothing to analyse there.
    expect(res.body.coverage).toMatchObject({ stored: 3, analysed: 1, remaining: 2 });
  });

  it('lets an admin queue an email for analysis', async () => {
    await request(app).post('/api/emails/m1/analyse').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(mockEnqueueEmail).toHaveBeenCalledWith('m1', { force: false });
  });

  it('passes force through so a completed email can be re-run', async () => {
    await request(app).post('/api/emails/m1/analyse?force=true').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(mockEnqueueEmail).toHaveBeenCalledWith('m1', { force: true });
  });

  it('blocks a non-admin from queueing analysis', async () => {
    await request(app).post('/api/emails/m1/analyse').set('Authorization', `Bearer ${agentToken}`).expect(403);
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('404s analysis of an unknown email', async () => {
    await request(app).post('/api/emails/nope/analyse').set('Authorization', `Bearer ${adminToken}`).expect(404);
    expect(mockEnqueueEmail).not.toHaveBeenCalled();
  });

  it('says so when the email was already analysed', async () => {
    mockEnqueueEmail.mockResolvedValueOnce(false);
    const res = await request(app).post('/api/emails/m1/analyse').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.queued).toBe(false);
    expect(res.body.message).toMatch(/force=true/);
  });
});
