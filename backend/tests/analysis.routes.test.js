/**
 * GET /api/analysis — the AI Analysis tab's list, now fed by two queues.
 *
 * Recordings and mail are analysed into different collections. This endpoint is
 * where they meet, so the cases that matter are: both sources reach the screen,
 * a source can be asked for alone, one filter means the same thing on both
 * sides, and the merged page is ordered and counted as if it came from one
 * collection.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';

const express = require('express');
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

// The export worker touches the filesystem on require; the list never uses it.
jest.mock('../src/workers/exportWorker', () => ({
  createExportJob: jest.fn(() => Promise.resolve('job-1')),
  getExportJob:    jest.fn(),
  streamCsv:       jest.fn(),
}));

jest.mock('../src/services/geminiService', () => ({
  detectTranscriptionLoop:     jest.fn(),
  generateCategoryTaxonomy:    jest.fn(),
  generaliseCategoryTaxonomy:  jest.fn(),
}));

const at = day => new Date(`2026-08-${day}T10:00:00Z`);

/** Two call verdicts, newest first by created_at. */
const CALL_ANALYSES = [
  { call_id: 'BZ-1', status: 'completed', category: 'Payment & Fee', sub_category: 'Duplicate Payment',
    call_category: 'Payment & Fee', call_sub_category: 'Duplicate Payment',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment' }],
    ai_insight: 'Fee debited twice', bugs: 'Gateway double charge', bug_category: 'Payment Gateway',
    agent_score: 8, call_resolved: 'Yes', audio_quality: { rating: 'Good' },
    created_at: at('17') },

  { call_id: 'BZ-2', status: 'completed', category: 'Portal Access & Registration',
    call_category: 'Portal Access & Registration', tags: [], ai_insight: 'Cannot log in',
    bugs: '-', bug_category: '-', agent_score: 5, call_resolved: 'No',
    created_at: at('15') },

  // Still in flight — a verdict that does not exist yet is not a row.
  { call_id: 'BZ-3', status: 'pending', created_at: at('18') },
];

const CALLS = [
  { call_id: 'BZ-1', caller_number: '919876543210', agent_number: '1001', duration: 252,
    call_recording: 'https://rec/BZ-1.wav', agent_answer_time: '2026-08-17 10:00:08' },
  { call_id: 'BZ-2', caller_number: '919812345678', agent_number: '1002', duration: 60 },
];

/** Two mail verdicts, interleaving in time with the calls above. */
const CONVERSATION_ANALYSES = [
  { _id: 'aasha@example.com', conversation_id: 'aasha@example.com', status: 'completed',
    category: 'Payment & Fee', sub_category: 'Refund Query',
    email_category: 'Payment & Fee', email_sub_category: 'Refund Query',
    tags: [{ category: 'Payment & Fee', sub_category: 'Refund Query' }],
    ai_insight: 'Refund not received', bugs: '-', bug_category: '-',
    requested_action: 'Refund', message_count: 3, processing_id: 'lock-1',
    created_at: at('16') },

  { _id: 'ravi@example.com', conversation_id: 'ravi@example.com', status: 'completed',
    category: 'Uploads & Documents', email_category: 'Uploads & Documents', tags: [],
    ai_insight: 'Photo upload fails', bugs: 'Upload rejects valid JPEG',
    bug_category: 'Document Upload', requested_action: 'Fix', message_count: 1,
    created_at: at('14') },
];

const CONVERSATIONS = [
  { _id: 'aasha@example.com', participant_email: 'aasha@example.com', participant_name: 'Aasha',
    last_subject: 'Fee debited twice', message_count: 3, last_message_at: at('16') },
  { _id: 'ravi@example.com', participant_email: 'ravi@example.com', participant_name: 'Ravi',
    last_subject: 'Photo upload', message_count: 1, last_message_at: at('14') },
];

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeDb({
    call_analysis: CALL_ANALYSES,
    calls: CALLS,
    conversation_analysis: CONVERSATION_ANALYSES,
    email_conversations: CONVERSATIONS,
    bug_categories:  [{ name: 'Payment Gateway' }, { name: 'Document Upload' }],
    call_categories: [{ name: 'Payment & Fee' }, { name: 'Portal Access & Registration' }],
  });
  app = express();
  app.use(express.json());
  app.use('/api/analysis', require('../src/routes/analysis'));
});

const get  = (path, token = adminToken) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const ids  = body => body.analyses.map(a => a.id);
const list = qs => get(`/api/analysis${qs}`).expect(200).then(r => r.body);

describe('both queues on one list', () => {
  it('serves call and mail verdicts together by default', async () => {
    const body = await list('');
    expect(ids(body)).toEqual([
      'BZ-1',                 // 17th
      'aasha@example.com',    // 16th
      'BZ-2',                 // 15th
      'ravi@example.com',     // 14th
    ]);
    expect(body.total).toBe(4);
  });

  it('tags every row with the queue it came from', async () => {
    const body = await list('');
    expect(body.analyses.map(a => a.source)).toEqual(['call', 'email', 'call', 'email']);
  });

  it('counts the two queues separately, so neither hides behind the total', async () => {
    const body = await list('');
    expect(body.counts).toEqual({ calls: 2, emails: 2 });
  });

  it('leaves out work that has no verdict yet', async () => {
    // BZ-3 is still pending; an unfinished job is not an analysis.
    expect(ids(await list(''))).not.toContain('BZ-3');
  });

  it('normalises the category both queues render from', async () => {
    const byId = Object.fromEntries((await list('')).analyses.map(a => [a.id, a]));
    expect(byId['BZ-1'].primary_category).toBe('Payment & Fee');
    expect(byId['aasha@example.com'].primary_category).toBe('Payment & Fee');
  });

  it('joins the thing each verdict is about', async () => {
    const byId = Object.fromEntries((await list('')).analyses.map(a => [a.id, a]));
    expect(byId['BZ-1'].call).toMatchObject({ caller_number: '919876543210', duration: 252 });
    expect(byId['aasha@example.com'].email).toMatchObject({
      participant_name: 'Aasha', last_subject: 'Fee debited twice', message_count: 3,
    });
  });

  it('does not ship the queue lock, which is bookkeeping rather than a verdict', async () => {
    const row = (await list('')).analyses.find(a => a.id === 'aasha@example.com');
    expect(row.processing_id).toBeUndefined();
  });
});

describe('narrowing to one queue', () => {
  it('serves calls alone', async () => {
    const body = await list('?source=calls');
    expect(ids(body)).toEqual(['BZ-1', 'BZ-2']);
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ calls: 2, emails: 0 });
  });

  it('serves mail alone', async () => {
    const body = await list('?source=emails');
    expect(ids(body)).toEqual(['aasha@example.com', 'ravi@example.com']);
    expect(body.total).toBe(2);
  });

  it('reads everything when the source is unrecognised', async () => {
    // A stale bookmark must not silently empty the tab.
    expect((await list('?source=banana')).total).toBe(4);
  });
});

describe('one filter, both queues', () => {
  it('matches a category on either side', async () => {
    const body = await list('?callCategory=' + encodeURIComponent('Payment & Fee'));
    expect(ids(body)).toEqual(['BZ-1', 'aasha@example.com']);
  });

  it('finds bugs wherever they were reported', async () => {
    const body = await list('?bugsOnly=1');
    // BZ-2 and aasha both carry '-', which is the no-bug sentinel.
    expect(ids(body)).toEqual(['BZ-1', 'ravi@example.com']);
  });

  it('filters by bug category across both', async () => {
    expect(ids(await list('?bugCategory=Document+Upload'))).toEqual(['ravi@example.com']);
  });

  it('searches a call by its id and a correspondence by its address', async () => {
    expect(ids(await list('?search=BZ-1'))).toEqual(['BZ-1']);
    expect(ids(await list('?search=ravi'))).toEqual(['ravi@example.com']);
  });

  it('ranges on when the verdict was produced', async () => {
    const body = await list('?dateFrom=2026-08-16T00:00');
    expect(ids(body)).toEqual(['BZ-1', 'aasha@example.com']);
    expect(body.total).toBe(2);
  });
});

describe('paging and ordering the merged list', () => {
  it('pages across the two queues as if they were one', async () => {
    expect(ids(await list('?limit=2&offset=0'))).toEqual(['BZ-1', 'aasha@example.com']);
    expect(ids(await list('?limit=2&offset=2'))).toEqual(['BZ-2', 'ravi@example.com']);
    // The page is a window on the merge, so the total is the whole merge.
    expect((await list('?limit=2&offset=0')).total).toBe(4);
  });

  it('reverses on request', async () => {
    expect(ids(await list('?sortDir=asc'))).toEqual([
      'ravi@example.com', 'BZ-2', 'aasha@example.com', 'BZ-1',
    ]);
  });

  /**
   * A score is something only a call has. Rather than inventing an order for
   * the mail, the rows that can answer the question come first and the rest
   * follow — the same rule the calls-only query already applies to recordings.
   */
  it('pins rows that cannot answer a call-only sort to the bottom', async () => {
    const body = await list('?sortBy=agent_score');
    expect(ids(body).slice(0, 2)).toEqual(['BZ-1', 'BZ-2']);
    expect(ids(body).slice(2).sort()).toEqual(['aasha@example.com', 'ravi@example.com']);
  });
});
