/**
 * analysisWorker — enqueueing.
 *
 * The queue is the part of this worker the UI touches: the webhook enrols a
 * recording as it arrives, and the Call Report's "Analyse now" reopens one that
 * already settled. Gemini is mocked; nothing here runs a job.
 */
process.env.NODE_ENV  = 'test';
process.env.LOG_LEVEL = 'error';

const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));
jest.mock('../src/services/geminiService', () => ({ categorizeRecording: jest.fn() }));

const { enqueueRecording } = require('../src/workers/analysisWorker');

const RECORDING = 'https://recordings.buzzdial.io/BZ-1.wav';
const record    = id => mockFake.store.call_analysis?.get(id);

beforeEach(() => {
  mockFake = createFakeDb({ call_analysis: [] });
});

describe('enqueueRecording', () => {
  it('enrols a recording the worker has never seen', async () => {
    expect(await enqueueRecording('BZ-1', RECORDING)).toBe(true);
    expect(record('BZ-1')).toMatchObject({
      call_id: 'BZ-1', recording_url: RECORDING, status: 'pending', attempts: 0,
    });
  });

  it('leaves a completed record alone — a webhook replay must not re-spend quota', async () => {
    mockFake.store.call_analysis.set('BZ-1', {
      call_id: 'BZ-1', status: 'completed', category: 'Payment & Fee', attempts: 1,
    });

    expect(await enqueueRecording('BZ-1', RECORDING)).toBe(false);
    expect(record('BZ-1').status).toBe('completed');
  });

  /**
   * The forced path is the one an operator drives, and it is the path where an
   * `attempts` written by both $setOnInsert and $set would make Mongo reject
   * the whole write — silently leaving the button doing nothing at all.
   */
  it('reopens a settled record when forced, with a fresh attempt budget', async () => {
    mockFake.store.call_analysis.set('BZ-1', {
      call_id: 'BZ-1', status: 'failed', error: 'Gemini timed out', last_error: 'Gemini timed out',
      attempts: 5, next_attempt_at: new Date('2026-08-19T10:00:00Z'), created_at: new Date('2026-08-18T10:00:00Z'),
    });

    expect(await enqueueRecording('BZ-1', RECORDING, { force: true })).toBe(true);
    expect(record('BZ-1')).toMatchObject({
      status: 'pending', attempts: 0, error: null, last_error: null, next_attempt_at: null,
    });
  });

  it('forces an insert too, for a call that was never enrolled', async () => {
    expect(await enqueueRecording('BZ-9', RECORDING, { force: true })).toBe(true);
    expect(record('BZ-9')).toMatchObject({ status: 'pending', attempts: 0 });
    expect(record('BZ-9').created_at).toBeInstanceOf(Date);
  });

  it('keeps the original created_at, so queue order is still arrival order', async () => {
    const createdAt = new Date('2026-08-18T10:00:00Z');
    mockFake.store.call_analysis.set('BZ-1', { call_id: 'BZ-1', status: 'completed', attempts: 1, created_at: createdAt });

    await enqueueRecording('BZ-1', RECORDING, { force: true });
    expect(record('BZ-1').created_at).toEqual(createdAt);
  });
});
