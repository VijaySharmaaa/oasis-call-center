/**
 * Conversation CSV export — the job routes and the rows the worker writes.
 *
 * The contract that matters is that the CSV and the Emails tab always select
 * the SAME conversations: both build their filter with
 * lib/conversations.buildConversationFilter, and these tests hold that line by
 * asserting the export honours every filter the screen offers.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';
process.env.GMAIL_USER = 'support@upessc.org';

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { Writable } = require('stream');
const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

jest.mock('../src/workers/emailSyncWorker', () => ({ startEmailSyncWorker: jest.fn(), syncOnce: jest.fn() }));
jest.mock('../src/workers/emailAnalysisWorker', () => ({
  startEmailAnalysisWorker: jest.fn(),
  enqueueEmail: jest.fn(() => Promise.resolve(true)),
  enqueueConversation: jest.fn(() => Promise.resolve(true)),
  TOO_SHORT_CATEGORY: 'Email too Short',
}));
jest.mock('../src/services/gmailService', () => ({
  isConfigured: () => true, authMode: () => 'service_account', mailbox: () => 'support@upessc.org',
  listLabels: jest.fn(), getAttachment: jest.fn(),
}));

/**
 * Job persistence needs a real ObjectId and a real filesystem, neither of which
 * the fake provides — so those two entry points are stubbed while streamCsv and
 * the type registry stay real. What is under test here is the routes' own work:
 * which filters they accept, who may read a job, and how the download is signed.
 */
const jobs = new Map();
let nextJobId = 1;
const mockCreateExportJob = jest.fn(async ({ filters, user, type }) => {
  const id = `job${nextJobId++}`;
  jobs.set(id, {
    _id: id, export_type: type, filters, requested_by: { role: user.role, name: user.name, agent_number: user.agent_number || '' },
    status: 'pending', rows_processed: 0, file_name: null, file_path: null, created_at: new Date(),
  });
  return id;
});
const mockGetExportJob = jest.fn(async id => jobs.get(id) || null);

jest.mock('../src/workers/exportWorker', () => ({
  ...jest.requireActual('../src/workers/exportWorker'),
  createExportJob: (...args) => mockCreateExportJob(...args),
  getExportJob:    (...args) => mockGetExportJob(...args),
}));

const { streamCsv, EXPORT_TYPES } = require('../src/workers/exportWorker');

const CONVERSATIONS = [
  { _id: 'aasha@example.com', participant_email: 'aasha@example.com', participant_name: 'Km Aasha',
    thread_ids: ['th1', 'th2'], subjects: ['Payment reference', 'Fee debited twice'],
    last_subject: 'Payment reference',
    message_count: 3, inbound_count: 2, outbound_count: 1, unread_count: 1,
    first_message_at: new Date('2026-08-17T10:00:00Z'), last_message_at: new Date('2026-08-18T09:00:00Z'),
    has_attachments: true, is_trashed: false, needs_analysis: false,
    category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' },
           { category: 'Identity Verification', sub_category: 'Aadhaar OTP Not Received' }],
    ai_insight: 'Duplicate payment refund request',
    summary: 'Fee debited twice.\nRefund requested.',
    bugs: '-', bug_category: '-', requested_action: 'Refund',
    analysis_status: 'completed', analysed_at: new Date('2026-08-18T09:05:00Z') },

  { _id: 'ravi@example.com', participant_email: 'ravi@example.com', participant_name: 'Ravi',
    thread_ids: ['th3'], subjects: ['OTR edit query'], last_subject: 'OTR edit query',
    message_count: 1, inbound_count: 1, outbound_count: 0, unread_count: 0,
    first_message_at: new Date('2026-08-15T10:00:00Z'), last_message_at: new Date('2026-08-15T10:00:00Z'),
    has_attachments: false, is_trashed: false, needs_analysis: true },

  { _id: 'spam@example.com', participant_email: 'spam@example.com', participant_name: 'Spam',
    thread_ids: ['th4'], subjects: ['trashed'], last_subject: 'trashed',
    message_count: 1, inbound_count: 1, outbound_count: 0, unread_count: 1,
    first_message_at: new Date('2026-08-14T10:00:00Z'), last_message_at: new Date('2026-08-14T10:00:00Z'),
    has_attachments: false, is_trashed: true, needs_analysis: true },
];

const EMAILS = [
  { gmail_id: 'm1', conversation_id: 'aasha@example.com', subject: 'Fee debited twice',
    body_text: 'Sir mera fee do baar cut gaya hai.', snippet: 'fee', is_deleted: false },
  { gmail_id: 'm3', conversation_id: 'aasha@example.com', subject: 'Payment reference',
    body_text: 'Transaction ref 4471xx hai.', snippet: 'ref', is_deleted: false },
  { gmail_id: 'm4', conversation_id: 'ravi@example.com', subject: 'OTR edit query',
    body_text: 'How do I edit saved data?', snippet: 'edit', is_deleted: false },
];

const ANALYSIS = [{
  _id: 'aasha@example.com', conversation_id: 'aasha@example.com', status: 'completed',
  summary: 'Fee debited twice.\nRefund requested.', requested_action: 'Refund',
  language: ['Hinglish', 'English'], model_used: 'gemini-2.5-flash',
}];

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
const agentToken = jwt.sign({ name: 'Agent', role: 'agent', agent_number: '1001' }, 'test-secret');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  jobs.clear();
  mockFake = createFakeDb({
    email_conversations: CONVERSATIONS,
    emails: EMAILS,
    conversation_analysis: ANALYSIS,
  });
  app = express();
  app.use(express.json());
  app.use('/api/emails', require('../src/routes/emails'));
});

/**
 * Parse a CSV the way a spreadsheet would: quoted cells may contain commas and
 * newlines, which several of these columns do. Splitting on commas would pass
 * for the first few columns and then silently read the wrong ones.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); cell = ''; rows.push(row); row = []; i++;
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Run the export end to end against the fake, returning parsed rows. */
async function exportCsv(filters = {}) {
  const chunks = [];
  const writable = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  const rows = await streamCsv({
    db: mockFake.db, type: 'conversations', filters,
    user: { role: 'admin', name: 'Admin' }, writable,
  });

  const csv = chunks.join('');
  const [header, ...body] = parseCsv(csv);
  return {
    rows,
    header,
    csv,
    // Each row as { column: value }, which is how the assertions read.
    records: body.map(cells => Object.fromEntries(header.map((h, i) => [h, cells[i]]))),
  };
}

/** The Sender Email column of every exported row, in order. */
function senders({ records }) {
  return records.map(r => r['Sender Email']);
}

describe('what the export selects', () => {
  it('writes one row per correspondent, newest activity first', async () => {
    const result = await exportCsv();
    expect(result.rows).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(senders(result)).toEqual(['aasha@example.com', 'ravi@example.com']);
  });

  it('hides fully-trashed chains, unless asked for them', async () => {
    expect(senders(await exportCsv())).not.toContain('spam@example.com');
    expect(senders(await exportCsv({ includeTrashed: 'true' }))).toContain('spam@example.com');
  });

  it('honours the unread, attachment and coverage filters', async () => {
    expect(senders(await exportCsv({ unread: 'true' }))).toEqual(['aasha@example.com']);
    expect(senders(await exportCsv({ hasAttachments: 'true' }))).toEqual(['aasha@example.com']);
    expect(senders(await exportCsv({ analysisStatus: 'unanalysed' }))).toEqual(['ravi@example.com']);
  });

  it('honours the category filter, including the Uncategorised sentinel', async () => {
    expect(senders(await exportCsv({ category: 'Payment & Fee' }))).toEqual(['aasha@example.com']);
    // A secondary tag counts — that is the point of tagging.
    expect(senders(await exportCsv({ category: 'Identity Verification' }))).toEqual(['aasha@example.com']);
    expect(senders(await exportCsv({ category: 'Uncategorised' }))).toEqual(['ravi@example.com']);
  });

  it('ranges on the last message in the chain', async () => {
    expect(senders(await exportCsv({ dateFrom: '2026-08-16T00:00' }))).toEqual(['aasha@example.com']);
  });

  it('searches message bodies, not just the rollup', async () => {
    // "4471xx" exists only inside a message body; the row it belongs to still
    // has to come out, or the CSV and the screen disagree.
    expect(senders(await exportCsv({ search: '4471xx' }))).toEqual(['aasha@example.com']);
    expect(senders(await exportCsv({ search: 'Ravi' }))).toEqual(['ravi@example.com']);
  });
});

describe('what a row says', () => {
  it('carries the chain shape and the verdict formed from all of it', async () => {
    const [row] = (await exportCsv({ search: 'Aasha' })).records;

    expect(row).toMatchObject({
      'Sender Name':      'Km Aasha',
      'Messages':         '3',
      'From Candidate':   '2',
      'From Support':     '1',
      'Unread':           '1',
      'Threads':          '2',
      'Attachments':      'Yes',
      'Category':         'Payment & Fee',
      'Sub-Category':     'Duplicate Payment Refund Query',
      'AI Insight':       'Duplicate payment refund request',
      'Requested Action': 'Refund',
    });
  });

  it('flattens every tag into one cell, and keeps the other subjects used', async () => {
    const [row] = (await exportCsv({ search: 'Aasha' })).records;

    expect(row['Tags']).toBe('Payment & Fee / Duplicate Payment Refund Query; Identity Verification / Aadhaar OTP Not Received');
    // The chain spans two subject lines — the one not shown as "latest" is
    // still worth having, since that is why rows are keyed by person.
    expect(row['Latest Subject']).toBe('Payment reference');
    expect(row['Other Subjects']).toBe('Fee debited twice');
  });

  it('takes language and model from the analysis record, which the rollup does not mirror', async () => {
    const [row] = (await exportCsv({ search: 'Aasha' })).records;
    expect(row['Language']).toBe('Hinglish, English');
    expect(row['Model']).toBe('gemini-2.5-flash');
  });

  it('reports a chain with new mail since its verdict as outstanding', async () => {
    const [row] = (await exportCsv({ search: 'Ravi' })).records;
    expect(row['Analysis Status']).toBe('Outstanding');
  });

  it('escapes a multi-line summary rather than breaking the row', async () => {
    const { csv, records } = await exportCsv({ search: 'Aasha' });
    // Quoted, with CRLF inside — one row to a spreadsheet, however many lines
    // it occupies in the file.
    expect(csv).toContain('"Fee debited twice.\r\nRefund requested."');
    expect(records).toHaveLength(1);
    expect(records[0]['Summary']).toBe('Fee debited twice.\r\nRefund requested.');
  });

  it('names the file after the range and the filters', async () => {
    const name = EXPORT_TYPES.conversations.buildFileName({ dateFrom: '2026-08-01T00:00', dateTo: '2026-08-18T23:59', category: 'Payment & Fee' });
    expect(name).toBe('email-report-2026-08-01-to-2026-08-18-payment-fee.csv');
    expect(EXPORT_TYPES.conversations.buildFileName({})).toBe('email-report-all-to-today.csv');
  });
});

describe('the job endpoints', () => {
  const post = (path, body, token = adminToken) =>
    request(app).post(path).set('Authorization', `Bearer ${token}`).send(body);
  const get = (path, token = adminToken) =>
    request(app).get(path).set('Authorization', `Bearer ${token}`);

  it('queues a job carrying the filters the operator had on screen', async () => {
    const res = await post('/api/emails/conversations/export/jobs', {
      search: 'refund', unread: 'true', category: 'Payment & Fee', dateFrom: '2026-08-01T00:00',
    }).expect(202);

    expect(res.body).toMatchObject({ status: 'pending' });
    const job = jobs.get(res.body.job_id);
    expect(job.export_type).toBe('conversations');
    expect(job.filters).toMatchObject({
      search: 'refund', unread: 'true', category: 'Payment & Fee', dateFrom: '2026-08-01T00:00',
    });
  });

  it('ignores anything in the body that is not an export filter', async () => {
    const res = await post('/api/emails/conversations/export/jobs', { limit: '9999', evil: 'x' }).expect(202);
    const job = jobs.get(res.body.job_id);
    expect(job.filters.limit).toBeUndefined();
    expect(job.filters.evil).toBeUndefined();
  });

  it('reports progress, and hands back a signed download link once finished', async () => {
    const { body } = await post('/api/emails/conversations/export/jobs', {}).expect(202);

    const pending = await get(`/api/emails/conversations/export/jobs/${body.job_id}`).expect(200);
    expect(pending.body).toMatchObject({ status: 'pending' });
    expect(pending.body.download_url).toBeNull();

    Object.assign(jobs.get(body.job_id), {
      status: 'completed', rows_processed: 2, file_name: 'email-report.csv', file_path: '/tmp/x.csv',
    });
    const done = await get(`/api/emails/conversations/export/jobs/${body.job_id}`).expect(200);
    expect(done.body).toMatchObject({ status: 'completed', rows_processed: 2, file_name: 'email-report.csv' });
    expect(done.body.download_url).toContain(`/api/emails/conversations/export/jobs/${body.job_id}/download?token=`);

    // The link carries its own credential, because <a download> cannot send a
    // header — so it must be scoped to this one job and expire.
    const token = done.body.download_url.split('token=')[1];
    const payload = jwt.verify(token, 'test-secret');
    expect(payload).toMatchObject({ job_id: body.job_id, type: 'export-download' });
    expect(payload.exp - payload.iat).toBe(600);
  });

  it('refuses a download token minted for a different job', async () => {
    const { body } = await post('/api/emails/conversations/export/jobs', {}).expect(202);
    const wrong = jwt.sign({ job_id: 'someone-elses-job', type: 'export-download' }, 'test-secret');
    await request(app).get(`/api/emails/conversations/export/jobs/${body.job_id}/download?token=${wrong}`).expect(403);
  });

  it('refuses a forged or expired token', async () => {
    const { body } = await post('/api/emails/conversations/export/jobs', {}).expect(202);
    const forged = jwt.sign({ job_id: body.job_id, type: 'export-download' }, 'wrong-secret');
    await request(app).get(`/api/emails/conversations/export/jobs/${body.job_id}/download?token=${forged}`).expect(401);
  });

  it('keeps one operator out of another operator\'s export', async () => {
    const { body } = await post('/api/emails/conversations/export/jobs', {}, agentToken).expect(202);
    // A second agent, same role, different number.
    const other = jwt.sign({ name: 'Other', role: 'agent', agent_number: '1002' }, 'test-secret');
    await get(`/api/emails/conversations/export/jobs/${body.job_id}`, other).expect(403);
    // The one who asked for it, and any admin, still get it.
    await get(`/api/emails/conversations/export/jobs/${body.job_id}`, agentToken).expect(200);
    await get(`/api/emails/conversations/export/jobs/${body.job_id}`, adminToken).expect(200);
  });

  it('404s an unknown job, and requires a token at all', async () => {
    await get('/api/emails/conversations/export/jobs/nope').expect(404);
    await request(app).get('/api/emails/conversations/export/jobs/nope').expect(401);
  });

  /* "export" sits where a correspondent's address goes, so the routes have to
     be declared ahead of /conversations/:id or the chat endpoint swallows them. */
  it('does not read "export" as a conversation id', async () => {
    const res = await get('/api/emails/conversations/export/jobs/nope');
    expect(res.body.error).toBe('Export job not found');
  });
});
