/**
 * GET /api/calls — the endpoint that carries BuzzDial data to the frontend.
 *
 * The Call Report table renders exactly what this returns, so the assertions
 * here are the API half of the ingest → UI contract; the frontend half is in
 * frontend/src/tests/useCalls.test.jsx.
 *
 * SCOPE: only the list endpoint. /stats/summary is deliberately not covered
 * here — it leans on $group/$toDate/$divide aggregation that the in-memory fake
 * would have to reimplement, which would test the fake more than the route. Its
 * response contract is asserted on the frontend side instead.
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

// The export worker touches the filesystem on require; the list endpoint never
// uses it, so it is stubbed out.
jest.mock('../src/workers/exportWorker', () => ({
  createExportJob: jest.fn(),
  getExportJob:    jest.fn(),
  streamCsv:       jest.fn(),
}));

/** Calls as the webhook stores them, newest first by created_at. */
const SEED_CALLS = [
  { _id: 'id-answered', call_id: 'BZ-1', caller_number: '919876543210', called_number: '918037126236',
    agent_number: '1001', agent_name: 'Ravi (from IVR)', call_start_time: '2026-08-17 14:30:00',
    agent_answer_time: '2026-08-17 14:30:08', call_end_time: '2026-08-17 14:34:12',
    duration: 252, agent_duration: 244, keypress: '2',
    call_recording: 'https://recordings.buzzdial.io/BZ-1.wav',
    category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query',
    created_at: new Date('2026-08-17T14:34:12Z') },

  { _id: 'id-missed', call_id: 'BZ-2', caller_number: '919812345678', called_number: '918037126236',
    agent_number: '', agent_name: '', call_start_time: '2026-08-17 12:00:00',
    agent_answer_time: '', call_end_time: '2026-08-17 12:00:20',
    duration: 20, agent_duration: 0, keypress: '1', call_recording: '',
    created_at: new Date('2026-08-17T12:00:20Z') },

  { _id: 'id-other-agent', call_id: 'BZ-3', caller_number: '919800000003', called_number: '918037126236',
    agent_number: '1002', agent_name: 'Sunita', call_start_time: '2026-08-16 09:00:00',
    agent_answer_time: '2026-08-16 09:00:04', call_end_time: '2026-08-16 09:02:00',
    duration: 116, agent_duration: 110, keypress: '3',
    call_recording: 'https://recordings.buzzdial.io/BZ-3.wav',
    created_at: new Date('2026-08-16T09:02:00Z') },

  { _id: 'id-called-back', call_id: 'BZ-4', caller_number: '919800000004', called_number: '918037126236',
    agent_number: '', agent_name: '', agent_answer_time: '', duration: 5, agent_duration: 0,
    keypress: '', call_recording: '', called_back_by: '1002',
    created_at: new Date('2026-08-15T08:00:00Z') },
];

const SEED_AGENTS = [
  { _id: 'a1', agent_number: '1001', name: 'Ravi Kumar' },
  { _id: 'a2', agent_number: '1002', name: 'Sunita Devi' },
];

const adminToken = jwt.sign({ name: 'Admin', role: 'admin' }, 'test-secret');
const agentToken = jwt.sign({ name: 'Ravi Kumar', role: 'agent', agent_number: '1001' }, 'test-secret');

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeDb({ calls: SEED_CALLS, agents: SEED_AGENTS });
  app = express();
  app.use(express.json());
  app.use('/api/calls', require('../src/routes/calls'));
});

const get  = (path, token = adminToken) => request(app).get(path).set('Authorization', `Bearer ${token}`);
const ids  = res => res.body.calls.map(c => c.call_id);

describe('auth', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/calls').expect(401);
  });
});

describe('the payload the frontend renders', () => {
  it('returns { calls, total }', async () => {
    const res = await get('/api/calls').expect(200);
    expect(Array.isArray(res.body.calls)).toBe(true);
    expect(res.body.total).toBe(4);
  });

  it('carries every BuzzDial field the calls table reads', async () => {
    // CallsTable.jsx reads exactly these; a rename upstream breaks the UI
    // silently, so they are pinned here.
    const res = await get('/api/calls').expect(200);
    const call = res.body.calls.find(c => c.call_id === 'BZ-1');

    for (const field of [
      'id', 'call_id', 'caller_number', 'called_number', 'agent_number', 'agent_name',
      'call_start_time', 'agent_answer_time', 'call_end_time', 'duration', 'agent_duration',
      'keypress', 'call_recording', 'category', 'sub_category', 'created_at',
    ]) {
      expect(call).toHaveProperty(field);
    }
  });

  it('exposes the Mongo _id as a string `id` and drops _id', async () => {
    // CallsTable keys rows and dial state off call.id.
    const res = await get('/api/calls').expect(200);
    expect(res.body.calls[0].id).toEqual(expect.any(String));
    expect(res.body.calls[0]._id).toBeUndefined();
  });

  it('preserves keypress and duration types', async () => {
    const res = await get('/api/calls').expect(200);
    const call = res.body.calls.find(c => c.call_id === 'BZ-1');
    expect(call.keypress).toBe('2');
    expect(call.duration).toBe(252);
    expect(call.agent_duration).toBe(244);
  });

  it('overrides the IVR-supplied agent name with the registered one', async () => {
    // BuzzDial sends whatever the softphone account is called; the agents
    // collection is the source of truth, and drives the verified tick.
    const res = await get('/api/calls').expect(200);
    expect(res.body.calls.find(c => c.call_id === 'BZ-1').agent_name).toBe('Ravi Kumar');
  });

  it('leaves the IVR name in place for an unregistered agent number', async () => {
    mockFake = createFakeDb({ calls: SEED_CALLS, agents: [] });
    const res = await get('/api/calls').expect(200);
    expect(res.body.calls.find(c => c.call_id === 'BZ-1').agent_name).toBe('Ravi (from IVR)');
  });
});

describe('ordering and pagination', () => {
  it('defaults to newest first', async () => {
    const res = await get('/api/calls').expect(200);
    expect(ids(res)).toEqual(['BZ-1', 'BZ-2', 'BZ-3', 'BZ-4']);
  });

  it('paginates without changing the total', async () => {
    const page1 = await get('/api/calls?limit=2&offset=0').expect(200);
    const page2 = await get('/api/calls?limit=2&offset=2').expect(200);
    expect(ids(page1)).toEqual(['BZ-1', 'BZ-2']);
    expect(ids(page2)).toEqual(['BZ-3', 'BZ-4']);
    expect(page1.body.total).toBe(4);
  });

  it('sorts by a whitelisted field in the requested direction', async () => {
    const asc = await get('/api/calls?sortBy=duration&sortDir=asc').expect(200);
    expect(asc.body.calls.map(c => c.duration)).toEqual([5, 20, 116, 252]);
  });

  it('falls back to created_at for an unknown sortBy instead of erroring', async () => {
    // The UI can send a stale column name after a release; it must not 500.
    const res = await get('/api/calls?sortBy=' + encodeURIComponent('{"$where":"1"}')).expect(200);
    expect(ids(res)).toEqual(['BZ-1', 'BZ-2', 'BZ-3', 'BZ-4']);
  });

  it('pins calls with no recording last when sorting by recording, even ascending', async () => {
    const res = await get('/api/calls?sortBy=recording&sortDir=asc').expect(200);
    const recorded = res.body.calls.filter(c => c.call_recording);
    expect(ids(res).slice(0, recorded.length)).toEqual(['BZ-3', 'BZ-1']);   // shortest first
    expect(ids(res).slice(recorded.length)).toEqual(expect.arrayContaining(['BZ-2', 'BZ-4']));
  });
});

describe('filters the UI sends', () => {
  it('status=received returns only answered calls', async () => {
    const res = await get('/api/calls?status=received').expect(200);
    expect(ids(res)).toEqual(['BZ-1', 'BZ-3']);
  });

  it('status=missed treats an empty agent_answer_time as missed', async () => {
    const res = await get('/api/calls?status=missed').expect(200);
    expect(ids(res)).toEqual(['BZ-2', 'BZ-4']);
  });

  it('searches caller, called, agent name and agent number', async () => {
    expect(ids(await get('/api/calls?search=9876543210').expect(200))).toEqual(['BZ-1']);
    expect(ids(await get('/api/calls?search=Sunita').expect(200))).toEqual(['BZ-3']);
    expect(ids(await get('/api/calls?search=1002').expect(200))).toEqual(['BZ-3']);
  });

  it('filters by date range on created_at', async () => {
    const res = await get('/api/calls?dateFrom=2026-08-17T00:00&dateTo=2026-08-17T23:59').expect(200);
    expect(ids(res)).toEqual(['BZ-1', 'BZ-2']);
    expect(res.body.total).toBe(2);
  });

  it('lets an admin filter by agent number', async () => {
    const res = await get('/api/calls?agentNumber=1002').expect(200);
    expect(ids(res)).toEqual(['BZ-3']);
  });
});

describe('role scoping', () => {
  it('shows an agent their own calls plus unanswered ones', async () => {
    const res = await get('/api/calls', agentToken).expect(200);
    // BZ-1 is theirs; BZ-2 is unanswered and not called back by anyone.
    expect(ids(res)).toContain('BZ-1');
    expect(ids(res)).toContain('BZ-2');
  });

  it("hides another agent's answered call", async () => {
    const res = await get('/api/calls', agentToken).expect(200);
    expect(ids(res)).not.toContain('BZ-3');
  });

  it('hides a missed call already called back by a different agent', async () => {
    // BZ-4 was called back by 1002, so it is off 1001's list.
    const res = await get('/api/calls', agentToken).expect(200);
    expect(ids(res)).not.toContain('BZ-4');
  });

  it('ignores the agentNumber filter for a non-admin', async () => {
    // Otherwise an agent could enumerate a colleague's calls.
    const res = await get('/api/calls?agentNumber=1002', agentToken).expect(200);
    expect(ids(res)).not.toContain('BZ-3');
  });

  it('scopes the total to what the agent can see', async () => {
    const res = await get('/api/calls', agentToken).expect(200);
    expect(res.body.total).toBe(res.body.calls.length);
    expect(res.body.total).toBeLessThan(4);
  });
});
