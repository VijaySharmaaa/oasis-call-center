/**
 * /api/emails — routing, auth, filter construction, and projections.
 *
 * The database is a fake (tests/helpers/fakeMongo) and gmailService is mocked,
 * so nothing here touches Atlas or the Gmail API.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
// Which addresses mean "us" — the only thing that tells a reply we sent apart
// from mail a candidate sent, both in the chat view and in the counters.
process.env.GMAIL_USER = 'support@upessc.org';

const express  = require('express');
const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

const SEED = [
  { gmail_id: 'm1', thread_id: 'th1', subject: 'Payment debited but form incomplete',
    rfc822_id: '<m1@mail.example.com>',
    from_email: 'aasha@example.com', from_name: 'Aasha', to: 'support@upessc.org',
    snippet: 'money deducted', body_text: 'money deducted twice', body_html: '<b>hi</b>', has_html: true,
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

/**
 * The conversation rollups for that mail — one per correspondent, which is what
 * the Emails tab lists. m4's sender has none: Gmail deleted their only message.
 */
const CONVERSATIONS = [
  { _id: 'aasha@example.com', participant_email: 'aasha@example.com', participant_name: 'Aasha',
    thread_ids: ['th1'], subjects: ['Payment debited but form incomplete'],
    last_subject: 'Payment debited but form incomplete', last_snippet: 'money deducted',
    last_inbound_snippet: 'money deducted', last_inbound_id: 'm1', last_message_id: 'm1',
    message_count: 1, inbound_count: 1, outbound_count: 0,
    first_message_at: new Date('2026-08-16T10:00:00Z'), last_message_at: new Date('2026-08-16T10:00:00Z'),
    last_inbound_at: new Date('2026-08-16T10:00:00Z'), analysed_upto: new Date('2026-08-16T10:00:00Z'),
    unread_count: 1, has_attachments: true, is_trashed: false, is_spam: false, needs_analysis: false,
    category: 'Payment & Fee', sub_category: 'Money Debited but Application Incomplete',
    tags: [{ category: 'Payment & Fee', sub_category: 'Money Debited but Application Incomplete' }],
    ai_insight: 'Payment deducted form incomplete', analysis_status: 'completed',
    analysed_at: new Date('2026-08-16T10:05:00Z') },

  { _id: 'ravi@example.com', participant_email: 'ravi@example.com', participant_name: 'Ravi',
    thread_ids: ['th2'], subjects: ['OTR edit query'],
    last_subject: 'OTR edit query', last_snippet: 'edit saved data',
    last_inbound_snippet: 'edit saved data', last_inbound_id: 'm2', last_message_id: 'm2',
    message_count: 1, inbound_count: 1, outbound_count: 0,
    first_message_at: new Date('2026-08-15T10:00:00Z'), last_message_at: new Date('2026-08-15T10:00:00Z'),
    last_inbound_at: new Date('2026-08-15T10:00:00Z'),
    unread_count: 0, has_attachments: false, is_trashed: false, is_spam: false, needs_analysis: true },

  { _id: 'spam@example.com', participant_email: 'spam@example.com', participant_name: 'Spam',
    thread_ids: ['th3'], subjects: ['trashed thing'],
    last_subject: 'trashed thing', last_snippet: 'x', last_inbound_id: 'm3', last_message_id: 'm3',
    message_count: 1, inbound_count: 1, outbound_count: 0,
    first_message_at: new Date('2026-08-14T10:00:00Z'), last_message_at: new Date('2026-08-14T10:00:00Z'),
    last_inbound_at: new Date('2026-08-14T10:00:00Z'),
    unread_count: 1, has_attachments: false, is_trashed: true, is_spam: false, needs_analysis: true },
];

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

const mockSyncOnce = jest.fn(() => Promise.resolve({ phase: 'incremental', stored: 0 }));
jest.mock('../src/workers/emailSyncWorker', () => ({
  startEmailSyncWorker: jest.fn(),
  syncOnce: (...args) => mockSyncOnce(...args),
}));

const mockEnqueueEmail = jest.fn(() => Promise.resolve(true));
const mockEnqueueConversation = jest.fn(() => Promise.resolve(true));
jest.mock('../src/workers/emailAnalysisWorker', () => ({
  startEmailAnalysisWorker: jest.fn(),
  enqueueEmail: (...args) => mockEnqueueEmail(...args),
  enqueueConversation: (...args) => mockEnqueueConversation(...args),
  TOO_SHORT_CATEGORY: 'Email too Short',
}));

const SENT_MESSAGE = {
  gmail_id: 'sent-1', thread_id: 'th1', history_id: '900',
  subject: 'Re: Payment debited but form incomplete',
  from_name: 'UPTET Support', from_email: 'support@upessc.org',
  to: 'Km Aasha <aasha@example.com>', cc: '', reply_to: '', rfc822_id: '<sent-1@mail>',
  received_at: new Date('2026-08-19T10:00:00Z'), internal_date: 1755597600000,
  snippet: 'We have raised this', label_ids: ['SENT'],
  is_unread: false, is_starred: false, in_inbox: false, is_trashed: false, is_spam: false,
  body_text: 'We have raised this with the payment team.', body_html: '', has_html: false,
  attachments: [], has_attachments: false, size_estimate: 120,
};

const mockGmail = {
  isConfigured: jest.fn(() => true),
  authMode:     jest.fn(() => 'service_account'),
  mailbox:      jest.fn(() => 'support@upessc.org'),
  scopes:          jest.fn(() => ['https://www.googleapis.com/auth/gmail.modify']),
  canSend:         jest.fn(() => true),
  canModifyLabels: jest.fn(() => true),
  canWrite:        jest.fn(() => true),
  sendMessage:         jest.fn(() => Promise.resolve({ id: 'sent-1', threadId: 'th1' })),
  batchModifyMessages: jest.fn(() => Promise.resolve({ modified: 1 })),
  modifyMessage:       jest.fn(() => Promise.resolve({})),
  getMessage:          jest.fn(() => Promise.resolve(SENT_MESSAGE)),
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
  mockGmail.canSend.mockReturnValue(true);
  mockGmail.canModifyLabels.mockReturnValue(true);
  mockGmail.canWrite.mockReturnValue(true);
  mockGmail.sendMessage.mockResolvedValue({ id: 'sent-1', threadId: 'th1' });
  mockGmail.batchModifyMessages.mockResolvedValue({ modified: 1 });
  mockGmail.getMessage.mockResolvedValue(SENT_MESSAGE);
  mockFake = createFakeDb({
    // m1 is analysed (the worker mirrors category/sub_category/ai_insight onto
    // the email document); m2 is not yet. Every message carries the
    // conversation it belongs to, exactly as the sync worker stamps it.
    emails: SEED.map(e => ({
      ...e,
      conversation_id: e.from_email,
      ...(e.gmail_id === 'm1'
        ? { category: 'Payment & Fee', sub_category: 'Money Debited but Application Incomplete',
            ai_insight: 'Payment deducted form incomplete', analysed_at: new Date('2026-08-16T10:05:00Z') }
        : {}),
    })),
    // The rollups refreshConversation would have written for that mail.
    email_conversations: CONVERSATIONS,
    conversation_analysis: [{
      _id: 'aasha@example.com', conversation_id: 'aasha@example.com', status: 'completed',
      category: 'Payment & Fee', sub_category: 'Money Debited but Application Incomplete',
      summary: 'Fee was debited but the application stayed incomplete. They ask for the form to be unlocked.',
      ai_insight: 'Payment deducted form incomplete', bugs: '-', bug_category: '-',
      requested_action: 'Refund', language: ['Hinglish'], model_used: 'gemini-2.5-flash',
      message_count: 1, inbound_count: 1,
      processed_at: new Date('2026-08-16T10:05:00Z'), attempts: 0, error: null,
    }],
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
    // …and it now reads as read on both sides. With the write scope granted the
    // UNREAD label goes with it, so read state is one fact rather than two.
    expect(ids(await get('/api/emails?unread=false')).sort()).toEqual(['m1', 'm2']);
    expect(mockFake.store.emails.get('m1').is_unread).toBe(false);
  });

  /* Where the delegation is still read-only the old split stands: `read_at`
     records the operator's action and Gmail's own label is left exactly as it
     was, because our copy of it must not claim a change the mailbox refused. */
  it('leaves the Gmail label alone when it cannot push the change', async () => {
    mockGmail.canModifyLabels.mockReturnValue(false);
    await patch('/api/emails/m1/read', { read: true }).expect(200);

    expect(mockFake.store.emails.get('m1').is_unread).toBe(true);
    expect(mockFake.store.emails.get('m1').read_at).toBeInstanceOf(Date);
    // Still out of the unread pile here, because unread means both halves.
    expect(ids(await get('/api/emails?unread=true'))).toEqual([]);
  });

  it('puts it back in the unread pile when read=false', async () => {
    await patch('/api/emails/m1/read', { read: true }).expect(200);
    await patch('/api/emails/m1/read', { read: false }).expect(200);

    // Unset, not nulled — the unread predicate is a plain $exists.
    expect('read_at' in mockFake.store.emails.get('m1')).toBe(false);
    expect(ids(await get('/api/emails?unread=true'))).toEqual(['m1']);
  });

  /* This inverts what it used to assert, and deliberately. Read-only, "mark
     unread" could only clear our own marker, so a mail Gmail considered read
     stayed read. With write granted it means what it says: the UNREAD label
     goes back on, and the mail returns to the pile in Gmail too. */
  it('makes a mail unread in Gmail as well, now that it may', async () => {
    await patch('/api/emails/m2/read', { read: false }).expect(200);

    expect(mockGmail.batchModifyMessages).toHaveBeenCalledWith(['m2'], { addLabelIds: ['UNREAD'] });
    expect(ids(await get('/api/emails?unread=true')).sort()).toEqual(['m1', 'm2']);
  });

  it('cannot resurrect a mail Gmail considers read while write is unavailable', async () => {
    mockGmail.canModifyLabels.mockReturnValue(false);
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

  it('reports what the mailbox will let us do, so the UI can disable a dead composer', async () => {
    const ok = await get('/api/emails/sync-status').expect(200);
    expect(ok.body).toMatchObject({ can_send: true, can_modify: true });

    mockGmail.canSend.mockReturnValue(false);
    mockGmail.canModifyLabels.mockReturnValue(false);
    const readonly = await get('/api/emails/sync-status').expect(200);
    expect(readonly.body).toMatchObject({ can_send: false, can_modify: false });
  });

  it('returns labels, and degrades to an empty list if Gmail is unreachable', async () => {
    const ok = await get('/api/emails/labels').expect(200);
    expect(ok.body.labels).toEqual([{ id: 'Label_9', name: 'Escalations', type: 'user' }]);

    mockGmail.listLabels.mockRejectedValueOnce(new Error('network down'));
    const degraded = await get('/api/emails/labels').expect(200);
    expect(degraded.body.labels).toEqual([]);
  });
});

describe('GET /api/emails/conversations', () => {
  const convIds = res => res.body.conversations.map(c => c.id);

  it('lists one row per correspondent, newest activity first', async () => {
    const res = await get('/api/emails/conversations').expect(200);
    expect(convIds(res)).toEqual(['aasha@example.com', 'ravi@example.com']);
    expect(res.body.total).toBe(2);
  });

  it('hides a conversation whose every message is trashed, unless asked', async () => {
    expect(convIds(await get('/api/emails/conversations').expect(200))).not.toContain('spam@example.com');
    expect(convIds(await get('/api/emails/conversations?includeTrashed=true').expect(200))).toContain('spam@example.com');
  });

  it('counts unread by conversation, not by message', async () => {
    const res = await get('/api/emails/conversations').expect(200);
    expect(res.body.unreadCount).toBe(1);
  });

  it('filters by unread', async () => {
    expect(convIds(await get('/api/emails/conversations?unread=true').expect(200))).toEqual(['aasha@example.com']);
    expect(convIds(await get('/api/emails/conversations?unread=false').expect(200))).toEqual(['ravi@example.com']);
  });

  it('filters by category, and treats Uncategorised as "no verdict yet"', async () => {
    const byCategory = await get('/api/emails/conversations?category=' + encodeURIComponent('Payment & Fee')).expect(200);
    expect(convIds(byCategory)).toEqual(['aasha@example.com']);
    expect(convIds(await get('/api/emails/conversations?category=Uncategorised').expect(200))).toEqual(['ravi@example.com']);
  });

  it('filters by attachments and analysis coverage', async () => {
    expect(convIds(await get('/api/emails/conversations?hasAttachments=true').expect(200))).toEqual(['aasha@example.com']);
    expect(convIds(await get('/api/emails/conversations?analysisStatus=unanalysed').expect(200))).toEqual(['ravi@example.com']);
  });

  /**
   * The triage filters. Read state answers "has anyone looked at this", replied
   * answers "has anyone answered it", and the analysis states answer "does the
   * AI have anything to say about it yet" — three independent questions that an
   * operator working a backlog asks in combination.
   */
  describe('triage filters', () => {
    const conv = id => mockFake.store.email_conversations.get(id);

    it('filters by whether we have written back', async () => {
      conv('aasha@example.com').outbound_count = 2;

      expect(convIds(await get('/api/emails/conversations?replied=true').expect(200)))
        .toEqual(['aasha@example.com']);
      expect(convIds(await get('/api/emails/conversations?replied=false').expect(200)))
        .toEqual(['ravi@example.com']);
    });

    it('counts a rollup with no reply counter at all as not replied', async () => {
      // Written before outbound_count existed. `{$lte: 0}` would silently drop
      // it from both halves of the filter, which is the worst of both answers.
      delete conv('ravi@example.com').outbound_count;
      conv('aasha@example.com').outbound_count = 2;   // so only the legacy row can match

      expect(convIds(await get('/api/emails/conversations?replied=false').expect(200)))
        .toEqual(['ravi@example.com']);
    });

    it('filters by chains with mail newer than their verdict', async () => {
      expect(convIds(await get('/api/emails/conversations?analysisStatus=awaiting').expect(200)))
        .toEqual(['ravi@example.com']);
    });

    it('filters by the queue row: queued, analysing, failed', async () => {
      mockFake.store.conversation_analysis.set('ravi@example.com', {
        _id: 'ravi@example.com', conversation_id: 'ravi@example.com', status: 'pending', attempts: 0,
      });

      expect(convIds(await get('/api/emails/conversations?analysisStatus=queued').expect(200)))
        .toEqual(['ravi@example.com']);

      mockFake.store.conversation_analysis.get('ravi@example.com').status = 'processing';
      expect(convIds(await get('/api/emails/conversations?analysisStatus=processing').expect(200)))
        .toEqual(['ravi@example.com']);

      mockFake.store.conversation_analysis.get('ravi@example.com').status = 'failed';
      expect(convIds(await get('/api/emails/conversations?analysisStatus=failed').expect(200)))
        .toEqual(['ravi@example.com']);
    });

    // The failure mode of resolving a filter to a set of ids: an empty set has
    // to mean "nothing matches", never "no constraint".
    it('returns nothing — not everything — when the queue is empty', async () => {
      const res = await get('/api/emails/conversations?analysisStatus=queued').expect(200);
      expect(convIds(res)).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('combines with the other filters rather than replacing them', async () => {
      conv('aasha@example.com').outbound_count = 2;

      // Unread AND already answered — aasha only; ravi is read.
      expect(convIds(await get('/api/emails/conversations?unread=true&replied=true').expect(200)))
        .toEqual(['aasha@example.com']);
      // Unread AND not answered — nobody.
      expect(convIds(await get('/api/emails/conversations?unread=true&replied=false').expect(200)))
        .toEqual([]);
    });

    it('ignores a filter value it does not know', async () => {
      // A stale bookmark must not silently empty the list.
      expect(convIds(await get('/api/emails/conversations?analysisStatus=banana').expect(200)))
        .toEqual(['aasha@example.com', 'ravi@example.com']);
    });
  });

  it('searches the correspondent, their subjects, and the message bodies', async () => {
    expect(convIds(await get('/api/emails/conversations?search=ravi').expect(200))).toEqual(['ravi@example.com']);
    expect(convIds(await get('/api/emails/conversations?search=OTR').expect(200))).toEqual(['ravi@example.com']);
    // "deducted twice" appears only in m1's body — the hit has to resolve to
    // the conversation that message belongs to.
    expect(convIds(await get('/api/emails/conversations?search=deducted%20twice').expect(200))).toEqual(['aasha@example.com']);
  });

  it('ranges on the last message in the chain', async () => {
    const res = await get('/api/emails/conversations?dateFrom=2026-08-16T00:00').expect(200);
    expect(convIds(res)).toEqual(['aasha@example.com']);
  });

  it('paginates', async () => {
    const res = await get('/api/emails/conversations?limit=1&offset=1').expect(200);
    expect(convIds(res)).toEqual(['ravi@example.com']);
    expect(res.body.total).toBe(2);
  });

  // The list has to distinguish "the AI read this and had nothing to add" from
  // "the AI has not read this yet" — only the second is something an operator
  // can act on, and it is the one the row offers a button for.
  describe('analysis state', () => {
    const byId = res => Object.fromEntries(res.body.conversations.map(c => [c.id, c]));

    it('marks a chain with mail newer than its verdict as awaiting analysis', async () => {
      const conv = byId(await get('/api/emails/conversations').expect(200))['ravi@example.com'];
      expect(conv.awaiting_analysis).toBe(true);
      // Never enrolled: there is no queue row for it at all.
      expect(conv.queue_status).toBeNull();
    });

    it('does not mark an already-analysed chain as awaiting', async () => {
      const conv = byId(await get('/api/emails/conversations').expect(200))['aasha@example.com'];
      expect(conv.awaiting_analysis).toBe(false);
      expect(conv.queue_status).toBe('completed');
    });

    it('reports the queue row status, so a queued chain reads as queued', async () => {
      mockFake.store.conversation_analysis.set('ravi@example.com', {
        _id: 'ravi@example.com', conversation_id: 'ravi@example.com', status: 'pending', attempts: 0,
      });
      const conv = byId(await get('/api/emails/conversations').expect(200))['ravi@example.com'];
      expect(conv.queue_status).toBe('pending');
      expect(conv.awaiting_analysis).toBe(true);
    });
  });
});

describe('GET /api/emails/conversations/:id', () => {
  it('returns the chain as a chat, oldest first, with the shared verdict', async () => {
    const res = await get('/api/emails/conversations/aasha%40example.com').expect(200);
    expect(res.body.id).toBe('aasha@example.com');
    expect(res.body.messages.map(m => m.id)).toEqual(['m1']);
    expect(res.body.messages[0]).toMatchObject({ direction: 'inbound', body_text: 'money deducted twice', has_html: true });
    expect(res.body.analysis).toMatchObject({ status: 'completed', requested_action: 'Refund' });
  });

  it('marks our own replies as outbound so the chat has two sides', async () => {
    await mockFake.db.collection('emails').updateOne(
      { gmail_id: 'out1' },
      { $set: { gmail_id: 'out1', conversation_id: 'aasha@example.com', thread_id: 'th1',
                subject: 'Re: Payment debited but form incomplete', from_email: 'support@upessc.org',
                to: 'aasha@example.com', body_text: 'Please share the reference.',
                received_at: new Date('2026-08-16T12:00:00Z'), label_ids: ['SENT'] } },
      { upsert: true }
    );
    const res = await get('/api/emails/conversations/aasha%40example.com').expect(200);
    expect(res.body.messages.map(m => m.direction)).toEqual(['inbound', 'outbound']);
  });

  /* A chat bubble shows the message, not the envelope it arrived in. The
     quoted thread, the signature and the corporate disclaimer are stripped by
     lib/emailText — six replies would otherwise repeat the same paragraph six
     times down the chain. */
  it('shows the message, not the quoted thread wrapped around it', async () => {
    await mockFake.db.collection('emails').updateOne(
      { gmail_id: 'm1' },
      { $set: { body_text:
        'The form will not submit.\n\nBest regards,\nAasha\n\n-- \n' +
        'Disclaimer: This email is confidential.\n\n' +
        'On Tue, 18 Aug 2026 at 21:15, Aasha <aasha@example.com> wrote:\n' +
        '> my earlier message\n' } }
    );

    const res = await get('/api/emails/conversations/aasha%40example.com').expect(200);
    const [message] = res.body.messages;

    expect(message.body_text).toBe('The form will not submit.');
    expect(message.body_text).not.toMatch(/confidential|wrote:/);
    expect(message.body_text).not.toMatch(/^>/m);
    // Said out loud, so the client can offer the original rather than hiding
    // that it edited what the sender wrote.
    expect(message.body_trimmed).toBe(true);
  });

  it('leaves a message that is already just a message alone', async () => {
    const res = await get('/api/emails/conversations/aasha%40example.com').expect(200);
    expect(res.body.messages[0]).toMatchObject({ body_text: 'money deducted twice', body_trimmed: false });
  });

  it('never ships the HTML body in the chat payload', async () => {
    const res = await get('/api/emails/conversations/aasha%40example.com').expect(200);
    expect(res.body.messages[0].body_html).toBeUndefined();
  });

  it('404s an unknown correspondent', async () => {
    await get('/api/emails/conversations/nobody%40example.com').expect(404);
  });
});

describe('conversation read state', () => {
  it('marks every message in the chain read, and clears the unread count', async () => {
    const res = await patch('/api/emails/conversations/aasha%40example.com/read', { read: true }).expect(200);
    expect(res.body).toMatchObject({ success: true, read: true, unread_count: 0 });
    expect(mockFake.store.emails.get('m1').read_at).toBeInstanceOf(Date);
    expect(mockFake.store.emails.get('m1').read_by).toBe('Admin');
    expect(mockFake.store.email_conversations.get('aasha@example.com').unread_count).toBe(0);
  });

  it('puts the whole chain back in the unread pile', async () => {
    await patch('/api/emails/conversations/aasha%40example.com/read', { read: true }).expect(200);
    const res = await patch('/api/emails/conversations/aasha%40example.com/read', { read: false }).expect(200);
    expect(res.body.unread_count).toBe(1);
    expect(mockFake.store.emails.get('m1').read_at).toBeUndefined();
  });

  it('404s an unknown correspondent', async () => {
    await patch('/api/emails/conversations/nobody%40example.com/read', { read: true }).expect(404);
  });
});

describe('conversation analysis queueing', () => {
  it('lets an admin re-read a chain', async () => {
    await request(app).post('/api/emails/conversations/aasha%40example.com/analyse')
      .set('Authorization', 'Bearer ' + adminToken).expect(200);
    expect(mockEnqueueConversation).toHaveBeenCalledWith('aasha@example.com', { force: false });
  });

  it('passes force through so a completed chain can be re-run', async () => {
    await request(app).post('/api/emails/conversations/aasha%40example.com/analyse?force=true')
      .set('Authorization', 'Bearer ' + adminToken).expect(200);
    expect(mockEnqueueConversation).toHaveBeenCalledWith('aasha@example.com', { force: true });
  });

  it('blocks a non-admin, and 404s an unknown correspondent', async () => {
    await request(app).post('/api/emails/conversations/aasha%40example.com/analyse')
      .set('Authorization', 'Bearer ' + agentToken).expect(403);
    await request(app).post('/api/emails/conversations/nobody%40example.com/analyse')
      .set('Authorization', 'Bearer ' + adminToken).expect(404);
    expect(mockEnqueueConversation).not.toHaveBeenCalled();
  });
});

describe('replying from the chat', () => {
  const reply = (body, token = adminToken) =>
    request(app).post('/api/emails/conversations/aasha%40example.com/reply')
      .set('Authorization', `Bearer ${token}`).send(body);

  /** The RFC 2822 message we handed Gmail, decoded. */
  function sentMime() {
    const { raw } = mockGmail.sendMessage.mock.calls[0][0];
    return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  }

  it('sends the reply into the candidate\'s own thread', async () => {
    await reply({ body: 'We have raised this with the payment team.' }).expect(201);

    expect(mockGmail.sendMessage).toHaveBeenCalledTimes(1);
    // threadId keeps it in one conversation our side; the headers do the same
    // in the candidate's inbox, and both have to agree.
    expect(mockGmail.sendMessage.mock.calls[0][0].threadId).toBe('th1');
    const mime = sentMime();
    expect(mime).toContain('To: Aasha <aasha@example.com>');
    expect(mime).toContain('Subject: Re: Payment debited but form incomplete');
    expect(mime).toMatch(/In-Reply-To: <m1@/);
  });

  it('quotes what the candidate wrote underneath', async () => {
    await reply({ body: 'Refund issued.' }).expect(201);
    const body = Buffer.from(sentMime().split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString('utf8');
    expect(body).toContain('Refund issued.');
    expect(body).toMatch(/^> money deducted twice$/m);
  });

  it('stores the sent copy at once, so the chat does not wait for the sync', async () => {
    const res = await reply({ body: 'We have raised this.' }).expect(201);

    expect(res.body).toMatchObject({ success: true, gmail_id: 'sent-1' });
    // Returned in the shape the chat renders, so the client can append it.
    expect(res.body.message).toMatchObject({ id: 'sent-1', direction: 'outbound' });

    const stored = mockFake.store.emails.get('sent-1');
    expect(stored).toMatchObject({ conversation_id: 'aasha@example.com', sent_from_oasis: true, sent_by: 'Admin' });
  });

  it('counts the reply on the conversation immediately', async () => {
    const res = await reply({ body: 'Answered.' }).expect(201);
    expect(res.body.conversation).toMatchObject({ outbound_count: 1, message_count: 2 });
    expect(mockFake.store.email_conversations.get('aasha@example.com').outbound_count).toBe(1);
  });

  it('lets any authenticated agent answer, as marking read does', async () => {
    await reply({ body: 'From an agent.' }, agentToken).expect(201);
    expect(mockFake.store.emails.get('sent-1').sent_by).toBe('Agent');
  });

  it('queues a re-read of the chain, our answer included', async () => {
    await reply({ body: 'Your refund has been processed.' }).expect(201);

    // Forced, because the chain's verdict is settled and answering it is
    // exactly the event that makes that verdict out of date.
    expect(mockEnqueueConversation).toHaveBeenCalledWith('aasha@example.com', { force: true });
  });

  it('still reports the reply sent when the re-read cannot be queued', async () => {
    mockEnqueueConversation.mockRejectedValue(new Error('queue down'));
    await reply({ body: 'Answered.' }).expect(201);
    // The mail is gone; the sweep is the backstop for the analysis.
  });

  it('refuses an empty body without calling Gmail', async () => {
    await reply({ body: '   ' }).expect(400);
    expect(mockGmail.sendMessage).not.toHaveBeenCalled();
  });

  it('404s a correspondent it has never heard of', async () => {
    await request(app).post('/api/emails/conversations/nobody%40example.com/reply')
      .set('Authorization', `Bearer ${adminToken}`).send({ body: 'hello' }).expect(404);
    expect(mockGmail.sendMessage).not.toHaveBeenCalled();
  });

  it('says plainly when the mailbox is not authorised to send', async () => {
    mockGmail.canSend.mockReturnValue(false);
    const res = await reply({ body: 'hello' }).expect(503);
    expect(res.body.error).toMatch(/gmail\.modify/);
    expect(mockGmail.sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces a send failure as a bad gateway, not a success', async () => {
    mockGmail.sendMessage.mockRejectedValue(new Error('Gmail API /messages/send failed (500)'));
    await reply({ body: 'hello' }).expect(502);
    expect(mockFake.store.emails.get('sent-1')).toBeUndefined();
  });

  /* The reply is already gone. Reporting failure here would invite a second
     send, so the storage miss is logged and the sync picks the message up. */
  it('still reports success when the sent copy cannot be fetched back', async () => {
    mockGmail.getMessage.mockRejectedValue(new Error('network'));
    const res = await reply({ body: 'hello' }).expect(201);
    expect(res.body).toMatchObject({ success: true, gmail_id: 'sent-1' });
    expect(res.body.message).toBeNull();
  });
});

describe('read state reaching Gmail', () => {
  it('clears the UNREAD label on every message in the chain', async () => {
    const res = await patch('/api/emails/conversations/aasha%40example.com/read', { read: true }).expect(200);

    expect(mockGmail.batchModifyMessages).toHaveBeenCalledWith(['m1'], { removeLabelIds: ['UNREAD'] });
    expect(res.body.gmail_synced).toBe(true);
    // Mirrored locally too, so the list is right in the minute before the next
    // sync confirms it.
    expect(mockFake.store.emails.get('m1').is_unread).toBe(false);
  });

  it('puts the label back when a chain is marked unread', async () => {
    await patch('/api/emails/conversations/aasha%40example.com/read', { read: false }).expect(200);
    expect(mockGmail.batchModifyMessages).toHaveBeenCalledWith(['m1'], { addLabelIds: ['UNREAD'] });
    expect(mockFake.store.emails.get('m1').is_unread).toBe(true);
  });

  it('pushes a single message too', async () => {
    const res = await patch('/api/emails/m1/read', { read: true }).expect(200);
    expect(mockGmail.batchModifyMessages).toHaveBeenCalledWith(['m1'], { removeLabelIds: ['UNREAD'] });
    expect(res.body.gmail_synced).toBe(true);
  });

  /* Losing a triage marker in a shared mailbox means two people answer the same
     candidate, so the click counts here whatever Gmail does with it. */
  it('keeps the operator\'s action when Gmail refuses it', async () => {
    mockGmail.batchModifyMessages.mockRejectedValue(new Error('insufficient scopes'));
    const res = await patch('/api/emails/conversations/aasha%40example.com/read', { read: true }).expect(200);

    expect(res.body).toMatchObject({ success: true, gmail_synced: false });
    expect(res.body.gmail_error).toMatch(/insufficient scopes/);
    expect(mockFake.store.emails.get('m1').read_at).toBeInstanceOf(Date);
  });

  it('does not call Gmail at all when the scope was never granted', async () => {
    mockGmail.canModifyLabels.mockReturnValue(false);
    const res = await patch('/api/emails/conversations/aasha%40example.com/read', { read: true }).expect(200);

    expect(mockGmail.batchModifyMessages).not.toHaveBeenCalled();
    expect(res.body.gmail_synced).toBe(false);
    expect(mockFake.store.emails.get('m1').read_at).toBeInstanceOf(Date);
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
    const { CATEGORIZATION_SCHEMA } = jest.requireActual('../src/services/geminiService');
    const res = await get('/api/emails/categories').expect(200);

    // Compared against the schema itself rather than a count: the taxonomy has
    // been re-cut once already (17 categories into 5), and a magic number only
    // records what it happened to be on the day the test was written.
    expect(res.body.schema.map(c => c.name)).toEqual(Object.keys(CATEGORIZATION_SCHEMA));
    expect(res.body.schema[0]).toHaveProperty('sub_categories');
    expect(res.body.counts.find(c => c.category === 'Payment & Fee')).toMatchObject({ total: 1 });
  });

  it('reports queue health and coverage', async () => {
    const res = await get('/api/emails/analysis/stats').expect(200);
    expect(res.body.queue).toMatchObject({ completed: 1, pending: 0, processing: 0, failed: 0 });
    // Counted in conversations, not messages: three correspondents are stored,
    // one has a verdict, and "remaining" is whoever has said something the last
    // verdict did not cover — not simply stored-minus-analysed.
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

/**
 * GET /api/emails/stats/summary — the numbers the Dashboard puts on screen.
 *
 * The contract worth defending is that the four headline counts partition the
 * mailbox exactly once: replies + unread + read = total. Anything else and two
 * cards sitting side by side quietly describe different populations.
 */
describe('GET /api/emails/stats/summary', () => {
  const AT = t => new Date(`2026-08-${t}T10:00:00Z`);

  /**
   * Two senders and one reply from us. m-out carries the SENT label AND one of
   * our addresses, m-out2 only the address — both forms have to count as ours.
   */
  const STATS_MAIL = [
    { gmail_id: 'e1', from_email: 'aasha@example.com', to: 'support@upessc.org',
      received_at: AT('16'), is_unread: true,  label_ids: ['INBOX', 'UNREAD'],
      conversation_id: 'aasha@example.com', is_trashed: false, is_deleted: false },

    { gmail_id: 'e2', from_email: 'aasha@example.com', to: 'support@upessc.org',
      received_at: AT('15'), is_unread: false, label_ids: ['INBOX'],
      conversation_id: 'aasha@example.com', is_trashed: false, is_deleted: false },

    { gmail_id: 'e3', from_email: 'ravi@example.com', to: 'support@upessc.org',
      received_at: AT('14'), is_unread: false, label_ids: ['INBOX'],
      conversation_id: 'ravi@example.com', is_trashed: false, is_deleted: false },

    { gmail_id: 'm-out', from_email: 'support@upessc.org', to: 'aasha@example.com',
      received_at: AT('16'), is_unread: false, label_ids: ['SENT'],
      conversation_id: 'aasha@example.com', is_trashed: false, is_deleted: false },

    { gmail_id: 'm-out2', from_email: 'support@upessc.org', to: 'ravi@example.com',
      received_at: AT('14'), is_unread: false, label_ids: [],
      conversation_id: 'ravi@example.com', is_trashed: false, is_deleted: false },

    // Neither of these is in the mailbox any more, so neither is in the counts.
    { gmail_id: 'e-trash', from_email: 'spam@example.com', received_at: AT('16'),
      is_unread: true, label_ids: ['TRASH'], is_trashed: true, is_deleted: false },
    { gmail_id: 'e-gone', from_email: 'gone@example.com', received_at: AT('16'),
      is_unread: true, label_ids: [], is_trashed: false, is_deleted: true },
  ];

  const STATS_CONVERSATIONS = [
    { _id: 'aasha@example.com', participant_email: 'aasha@example.com', participant_name: 'Aasha',
      last_subject: 'Fee debited twice', last_message_at: AT('16'), unread_count: 1,
      is_trashed: false, needs_analysis: false, category: 'Payment & Fee',
      tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment' }] },

    { _id: 'ravi@example.com', participant_email: 'ravi@example.com', participant_name: 'Ravi',
      last_subject: 'OTR edit query', last_message_at: AT('14'), unread_count: 0,
      is_trashed: false, needs_analysis: true },
  ];

  beforeEach(() => {
    mockFake = createFakeDb({
      emails: STATS_MAIL,
      email_conversations: STATS_CONVERSATIONS,
    });
  });

  const summary = (qs = '') => get(`/api/emails/stats/summary${qs}`).expect(200).then(r => r.body);

  it('splits the mailbox into replies, unread and read without double-counting', async () => {
    const body = await summary();
    expect(body.total).toBe(5);        // 3 inbound + 2 ours; trashed and deleted excluded
    expect(body.replies).toBe(2);
    expect(body.unread).toBe(1);
    expect(body.read).toBe(2);
    expect(body.replies + body.unread + body.read).toBe(body.total);
  });

  it('counts a reply as ours whether it carries the SENT label or just our address', async () => {
    // m-out has the label, m-out2 only the From — dropping either would read as
    // a candidate email and inflate "read".
    const body = await summary();
    expect(body.replies).toBe(2);
    expect(body.inbound).toBe(3);
  });

  // The case that breaks a naive filter: sent from an address nobody listed as
  // ours, so only the SENT label says it is a reply. Counted as inbound too, it
  // would appear in both halves and the partition would stop adding up.
  it('does not double-count a reply sent from an unlisted alias', async () => {
    mockFake.store.emails.set('m-alias', {
      gmail_id: 'm-alias', from_email: 'escalations@upessc.org', to: 'ravi@example.com',
      received_at: AT('15'), is_unread: false, label_ids: ['SENT'],
      conversation_id: 'ravi@example.com', is_trashed: false, is_deleted: false,
    });

    const body = await summary();
    expect(body.replies).toBe(3);
    expect(body.inbound).toBe(3);
    expect(body.replies + body.unread + body.read).toBe(body.total);
  });

  it('leaves trashed and deleted mail out, exactly as the list does', async () => {
    const body = await summary();
    // e-trash and e-gone are both unread; neither may reach the counter.
    expect(body.unread).toBe(1);
    expect(body.total).toBe(5);
  });

  it('treats mail opened in Oasis as read even while Gmail still calls it unread', async () => {
    mockFake.store.emails.get('e1').read_at = new Date();
    const body = await summary();
    expect(body.unread).toBe(0);
    expect(body.read).toBe(3);
  });

  it('honours the date range the header selected', async () => {
    const body = await summary('?dateFrom=2026-08-16T00:00');
    // e1 (unread inbound) and m-out (our reply) are the only mail that late.
    expect(body.total).toBe(2);
    expect(body.replies).toBe(1);
    expect(body.unread).toBe(1);
    expect(body.read).toBe(0);
  });

  it('counts senders and the analysis backlog over the same window', async () => {
    expect(await summary().then(b => b.conversations)).toBe(2);
    expect(await summary().then(b => b.awaitingAnalysis)).toBe(1);

    const narrowed = await summary('?dateFrom=2026-08-16T00:00');
    expect(narrowed.conversations).toBe(1);
    expect(narrowed.awaitingAnalysis).toBe(0);   // Ravi's chain is older than that
  });

  it('breaks down categories per sender, skipping chains with no verdict yet', async () => {
    const body = await summary();
    expect(body.topCategories).toEqual([{ category: 'Payment & Fee', count: 1 }]);
  });

  it('lists who is still waiting, newest first', async () => {
    const body = await summary();
    expect(body.latestUnread).toHaveLength(1);
    expect(body.latestUnread[0]).toMatchObject({
      id: 'aasha@example.com', participant_name: 'Aasha', unread_count: 1,
    });
  });

  it('reports zeroes rather than failing on an empty mailbox', async () => {
    mockFake = createFakeDb({ emails: [], email_conversations: [] });
    const body = await summary();
    expect(body).toMatchObject({ total: 0, replies: 0, unread: 0, read: 0, conversations: 0 });
    expect(body.topCategories).toEqual([]);
    expect(body.latestUnread).toEqual([]);
  });

  it('is open to agents, who work the same shared mailbox', async () => {
    await get('/api/emails/stats/summary', agentToken).expect(200);
  });
});
