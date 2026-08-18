/**
 * /webhook/recording — the BuzzDial → Oasis ingestion path.
 *
 * This is where call data enters the system. BuzzDial posts (or GETs) one hit
 * per call leg with field names that vary between IVR configurations, so most
 * of what is asserted here is tolerance: alias handling, type coercion, and
 * merge-on-repeat. Nothing downstream can be right if this is wrong.
 *
 * SCOPE: this proves we correctly ingest what BuzzDial sends. It cannot prove
 * BuzzDial is currently sending anything — that is a live-traffic question, not
 * something a unit test can answer. See the note at the bottom of the file.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';

const express = require('express');
const request = require('supertest');
const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
const mockGetDb = jest.fn();
jest.mock('../src/db', () => ({ getDb: () => mockGetDb() }));

const mockEnqueue = jest.fn(() => Promise.resolve());
jest.mock('../src/workers/analysisWorker', () => ({
  startWorker: jest.fn(),
  enqueueRecording: (...args) => mockEnqueue(...args),
}));

/** A realistic BuzzDial answered-call payload. */
const BUZZDIAL_PAYLOAD = {
  call_id:           'BZ-20260817-0001',
  caller_number:     '919876543210',
  called_number:     '918037126236',
  agent_number:      '1001',
  agent_name:        'Ravi Kumar',
  call_start_time:   '2026-08-17 14:30:00',
  agent_answer_time: '2026-08-17 14:30:08',
  call_end_time:     '2026-08-17 14:34:12',
  duration:          '252',
  agent_duration:    '244',
  keypress:          '2',
  call_recording:    'https://recordings.buzzdial.io/202608/1430/BZ-20260817-0001.wav',
};

let app;
beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeDb({});
  mockGetDb.mockImplementation(() => Promise.resolve(mockFake.db));
  app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/webhook/recording', require('../src/routes/webhook'));
});

// The route only creates the `calls` collection once it stores something, so
// these tolerate it being absent (that is itself the assertion in some tests).
const calls = () => [...(mockFake.store.calls?.values() ?? [])];
const call  = id => mockFake.store.calls?.get(id);
const post  = (body = BUZZDIAL_PAYLOAD) => request(app).post('/webhook/recording').send(body);

describe('accepting the hit', () => {
  it('stores a POSTed JSON payload and acknowledges it', async () => {
    const res = await post().expect(200);
    expect(res.body).toEqual({ status: 'ok', call_id: 'BZ-20260817-0001' });
    expect(calls()).toHaveLength(1);
  });

  it('accepts form-encoded bodies', async () => {
    await request(app)
      .post('/webhook/recording')
      .type('form')
      .send(BUZZDIAL_PAYLOAD)
      .expect(200);
    expect(call('BZ-20260817-0001')).toBeDefined();
  });

  it('accepts a GET with query parameters', async () => {
    // Some BuzzDial configurations fire the webhook as a GET.
    await request(app)
      .get('/webhook/recording')
      .query({ call_id: 'BZ-GET-1', caller_number: '919876543210', duration: '30' })
      .expect(200);
    expect(call('BZ-GET-1')).toMatchObject({ caller_number: '919876543210', duration: 30 });
  });

  it('requires no authentication', async () => {
    // BuzzDial cannot present a JWT; the endpoint is deliberately open and is
    // mounted outside the /api rate limiter.
    await request(app).post('/webhook/recording').send(BUZZDIAL_PAYLOAD).expect(200);
  });

  it('maps every field of a full payload onto the stored call', async () => {
    await post().expect(200);
    expect(call('BZ-20260817-0001')).toMatchObject({
      call_id:           'BZ-20260817-0001',
      caller_number:     '919876543210',
      called_number:     '918037126236',
      agent_number:      '1001',
      agent_name:        'Ravi Kumar',
      call_start_time:   '2026-08-17 14:30:00',
      agent_answer_time: '2026-08-17 14:30:08',
      call_end_time:     '2026-08-17 14:34:12',
      duration:          252,     // coerced from string
      agent_duration:    244,
      keypress:          '2',
      call_recording:    BUZZDIAL_PAYLOAD.call_recording,
    });
    expect(call('BZ-20260817-0001').created_at).toBeInstanceOf(Date);
  });
});

describe('field-name tolerance', () => {
  it.each([
    ['callid',       { callid: 'X1' },  'call_id',       'X1'],
    ['uid',          { uid: 'X2' },     'call_id',       'X2'],
    ['id',           { id: 'X3' },      'call_id',       'X3'],
    ['callernumber', { call_id: 'A', callernumber: '9998887776' }, 'caller_number', '9998887776'],
    ['caller',       { call_id: 'B', caller: '9998887776' },       'caller_number', '9998887776'],
    ['customer_number', { call_id: 'C', customer_number: '9998887776' }, 'called_number', '9998887776'],
    ['mobile',       { call_id: 'D', mobile: '9998887776' },       'called_number', '9998887776'],
    ['agentnumber',  { call_id: 'E', agentnumber: '1002' },        'agent_number',  '1002'],
    ['account',      { call_id: 'F', account: 'Sunita' },          'agent_name',    'Sunita'],
    ['start_time',   { call_id: 'G', start_time: '2026-08-17 10:00:00' }, 'call_start_time', '2026-08-17 10:00:00'],
    ['answer_time',  { call_id: 'H', answer_time: '2026-08-17 10:00:05' }, 'agent_answer_time', '2026-08-17 10:00:05'],
    ['call_duration',{ call_id: 'I', call_duration: '99' },        'duration',      99],
  ])('accepts %s as an alias', async (_alias, payload, field, expected) => {
    // Deliberately no canonical field in the payload — the canonical name wins
    // the || chain, which would make the alias untested.
    await post(payload).expect(200);
    const stored = calls().find(c => c[field] === expected);
    expect(stored).toBeDefined();
    expect(stored[field]).toBe(expected);
  });

  it('normalises header casing and spaces in keys', async () => {
    // Keys are lowercased and de-spaced before matching, so "Call ID" works.
    await post({ 'Call ID': 'SPACED-1', 'Caller Number': '919876543210', 'Agent Name': 'Ravi' }).expect(200);
    expect(call('SPACED-1')).toMatchObject({ caller_number: '919876543210', agent_name: 'Ravi' });
  });

  it.each(['recording_url', 'recording', 'recurl', 'file_url', 'audio_url', 'callrecording'])(
    'accepts %s as the recording field', async (field) => {
      const url = 'https://recordings.buzzdial.io/a.mp3';
      await post({ call_id: `REC-${field}`, caller_number: '919876543210', [field]: url }).expect(200);
      expect(call(`REC-${field}`).call_recording).toBe(url);
    }
  );
});

describe('type coercion', () => {
  it('defaults an unparseable duration to 0 rather than NaN', async () => {
    await post({ call_id: 'D1', caller_number: '9198', duration: 'not-a-number' }).expect(200);
    expect(call('D1').duration).toBe(0);
  });

  it('clamps an absurd agent_duration to 0', async () => {
    // BuzzDial occasionally reports a garbage agent_duration on missed legs;
    // anything over a day is treated as noise instead of skewing every report.
    await post({ call_id: 'D2', caller_number: '9198', agent_duration: '999999999' }).expect(200);
    expect(call('D2').agent_duration).toBe(0);
  });

  it('keeps a real agent_duration just under the clamp', async () => {
    await post({ call_id: 'D3', caller_number: '9198', agent_duration: '86400' }).expect(200);
    expect(call('D3').agent_duration).toBe(86400);
  });

  it('preserves keypress "0" instead of dropping it as falsy', async () => {
    // "0" is a real IVR selection; a truthiness check here would lose it.
    await post({ call_id: 'K1', caller_number: '9198', keypress: 0 }).expect(200);
    expect(call('K1').keypress).toBe('0');
  });

  it('stores an absent keypress as an empty string', async () => {
    await post({ call_id: 'K2', caller_number: '9198' }).expect(200);
    expect(call('K2').keypress).toBe('');
  });

  it('trims whitespace around a recording URL', async () => {
    await post({ call_id: 'W1', caller_number: '9198', call_recording: '  https://r.io/a.wav  ' }).expect(200);
    expect(call('W1').call_recording).toBe('https://r.io/a.wav');
  });
});

describe('rejecting noise', () => {
  it('acknowledges an empty payload without storing anything', async () => {
    const res = await post({}).expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(calls()).toHaveLength(0);
  });

  it('ignores a ping that carries neither a call id nor a number', async () => {
    await post({ status: 'test', foo: 'bar' }).expect(200);
    expect(calls()).toHaveLength(0);
  });

  it('still stores a call that has a number but no id', async () => {
    // A synthetic wb_<timestamp> id is generated so the record is not lost.
    await post({ caller_number: '919876543210' }).expect(200);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].call_id).toMatch(/^wb_\d+$/);
  });

  it('returns 500 when the database is unreachable', async () => {
    // BuzzDial should see a failure it can retry, not a false "ok".
    mockGetDb.mockRejectedValueOnce(new Error('no primary available'));
    const res = await post().expect(500);
    expect(res.body.status).toBe('error');
  });
});

describe('handing recordings to the analysis worker', () => {
  it('enqueues a real audio URL', async () => {
    await post().expect(200);
    expect(mockEnqueue).toHaveBeenCalledWith('BZ-20260817-0001', BUZZDIAL_PAYLOAD.call_recording);
  });

  it.each(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac', '.mp4'])('enqueues a %s recording', async (ext) => {
    await post({ call_id: `E${ext}`, caller_number: '9198', call_recording: `https://r.io/a${ext}` }).expect(200);
    expect(mockEnqueue).toHaveBeenCalledWith(`E${ext}`, `https://r.io/a${ext}`);
  });

  it('stores but does NOT enqueue a directory-only URL', async () => {
    // Missed calls arrive with just the folder prefix. Enqueuing those burns
    // Gemini quota on a guaranteed 403/404, but the URL is kept visible so an
    // admin can still try it by hand.
    const dirUrl = 'https://recordings.buzzdial.io/202608/1430/';
    await post({ call_id: 'N1', caller_number: '9198', call_recording: dirUrl }).expect(200);
    expect(call('N1').call_recording).toBe(dirUrl);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue a non-audio extension or a non-http scheme', async () => {
    await post({ call_id: 'N2', caller_number: '9198', call_recording: 'https://r.io/a.txt' }).expect(200);
    await post({ call_id: 'N3', caller_number: '9198', call_recording: 'ftp://r.io/a.wav' }).expect(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue a call with no recording at all', async () => {
    await post({ call_id: 'N4', caller_number: '9198' }).expect(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('still answers 200 if enqueueing blows up', async () => {
    // The webhook must never fail because of a downstream problem — BuzzDial
    // would retry or drop the call data.
    mockEnqueue.mockRejectedValueOnce(new Error('worker exploded'));
    await post().expect(200);
    expect(call('BZ-20260817-0001')).toBeDefined();
  });
});

describe('repeat hits for the same call', () => {
  it('merges a later leg instead of duplicating the call', async () => {
    await post({ call_id: 'M1', caller_number: '919876543210', duration: '0' }).expect(200);
    await post({ call_id: 'M1', caller_number: '919876543210', duration: '252',
                 agent_answer_time: '2026-08-17 14:30:08',
                 call_recording: 'https://r.io/M1.wav' }).expect(200);

    expect(calls()).toHaveLength(1);
    expect(call('M1')).toMatchObject({
      duration: 252,
      agent_answer_time: '2026-08-17 14:30:08',
      call_recording: 'https://r.io/M1.wav',
    });
  });

  it('does not let a later empty field clobber data already stored', async () => {
    await post({ call_id: 'M2', caller_number: '919876543210', agent_name: 'Ravi Kumar', duration: '252' }).expect(200);
    await post({ call_id: 'M2', caller_number: '919876543210', agent_name: '', duration: '0' }).expect(200);

    expect(call('M2')).toMatchObject({ agent_name: 'Ravi Kumar', duration: 252 });
  });

  it('keeps a stored recording when a later hit omits it', async () => {
    // upsertCall never writes an empty value over a populated one, recording
    // included — so a final BuzzDial hit that drops the URL cannot erase it.
    // (Clearing a bad URL is done through PATCH /api/calls/:id/recording.)
    await post({ call_id: 'M3', caller_number: '9198', call_recording: 'https://r.io/M3.wav' }).expect(200);
    await post({ call_id: 'M3', caller_number: '9198', call_recording: '' }).expect(200);
    expect(call('M3').call_recording).toBe('https://r.io/M3.wav');
  });

  it('enqueues again when a repeat hit finally brings the recording', async () => {
    await post({ call_id: 'M4', caller_number: '9198' }).expect(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
    await post({ call_id: 'M4', caller_number: '9198', call_recording: 'https://r.io/M4.wav' }).expect(200);
    expect(mockEnqueue).toHaveBeenCalledWith('M4', 'https://r.io/M4.wav');
  });
});

describe('click-to-call attribution', () => {
  function seedPending(overrides = {}) {
    mockFake = createFakeDb({
      click2call_pending: [{
        _id: 'p1',
        customer_number: '9876543210',
        initiated_by: '1001',
        original_call_id: 'MISSED-1',
        initiated_at: new Date(),
        ...overrides,
      }],
      calls: [{ _id: 'c-missed', call_id: 'MISSED-1', caller_number: '919876543210', agent_answer_time: '' }],
    });
  }

  it('tags a matching inbound call as click2call', async () => {
    seedPending();
    await post({ call_id: 'CB-1', caller_number: '919876543210', agent_number: '1001' }).expect(200);
    expect(call('CB-1').source).toBe('click2call');
  });

  it('matches on the last 10 digits, ignoring a country-code prefix', async () => {
    seedPending({ customer_number: '+919876543210' });
    await post({ call_id: 'CB-2', called_number: '09876543210' }).expect(200);
    expect(call('CB-2').source).toBe('click2call');
  });

  it('marks the original missed call as called back', async () => {
    seedPending();
    await post({ call_id: 'CB-3', caller_number: '9876543210' }).expect(200);
    expect(call('MISSED-1')).toMatchObject({ called_back_by: '1001' });
    expect(call('MISSED-1').called_back_at).toBeInstanceOf(Date);
  });

  it('consumes the pending record so a later call is not mis-tagged', async () => {
    seedPending();
    await post({ call_id: 'CB-4', caller_number: '9876543210' }).expect(200);
    expect(mockFake.store.click2call_pending.size).toBe(0);

    await post({ call_id: 'CB-5', caller_number: '9876543210' }).expect(200);
    expect(call('CB-5').source).toBeUndefined();
  });

  it('leaves an unrelated number untagged', async () => {
    seedPending();
    await post({ call_id: 'CB-6', caller_number: '911111111111' }).expect(200);
    expect(call('CB-6').source).toBeUndefined();
    expect(mockFake.store.click2call_pending.size).toBe(1);
  });

  it('ignores a pending record older than the 15-minute window', async () => {
    seedPending({ initiated_at: new Date(Date.now() - 20 * 60 * 1000) });
    await post({ call_id: 'CB-7', caller_number: '9876543210' }).expect(200);
    expect(call('CB-7').source).toBeUndefined();
  });
});

/*
 * NOTE ON LIVE TRAFFIC
 * These tests prove the endpoint handles BuzzDial's payloads correctly. To check
 * that BuzzDial is actually delivering right now, look at real data instead:
 *   • GET /api/calls/stats/summary → `total` and the newest `created_at`
 *   • grep the backend log for "Webhook saved call"
 * A silent BuzzDial produces a green test suite and an empty calls collection.
 */
