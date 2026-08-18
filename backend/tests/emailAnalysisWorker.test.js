/**
 * emailAnalysisWorker — queueing, the no-body shortcut, writeback, and the
 * retry/permanent-failure policy it shares with analysisWorker.
 *
 * geminiService is mocked, so no prompt is ever built and no network call made.
 */
process.env.NODE_ENV                  = 'test';
process.env.LOG_LEVEL                 = 'error';
process.env.GEMINI_API_KEY            = 'test-key';
process.env.EMAIL_ANALYSIS_CONCURRENCY = '2';
process.env.EMAIL_ANALYSIS_MIN_CHARS   = '15';

const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

const mockCategorize = jest.fn();
jest.mock('../src/services/geminiService', () => ({
  categorizeEmail: (...args) => mockCategorize(...args),
  // The real implementation — the worker's short-circuit depends on it, and it
  // is pure, so there is nothing to gain from faking it.
  emailToPlainText: jest.requireActual('../src/services/geminiService').emailToPlainText,
  CATEGORIZATION_SCHEMA: jest.requireActual('../src/services/geminiService').CATEGORIZATION_SCHEMA,
}));

const { enqueueEmail, processTick, TOO_SHORT_CATEGORY } = require('../src/workers/emailAnalysisWorker');

const EMAIL = {
  gmail_id:   'm1',
  subject:    'Fee debited twice',
  from_email: 'aasha@example.com',
  body_text:  'Sir mera fee do baar cut gaya hai lekin form submit nahi hua, refund chahiye.',
  body_html:  '',
  received_at: new Date('2026-08-17T10:00:00Z'),
  is_deleted: false,
};

const GOOD_RESULT = {
  success: true,
  category: 'Payment & Fee',
  sub_category: 'Duplicate Payment Refund Query',
  summary: 'Fee debited twice. Refund requested.',
  ai_insight: 'Duplicate payment refund request',
  bugs: '-',
  bug_category: '-',
  email_category: 'Payment & Fee',
  email_sub_category: 'Duplicate Payment Refund Query',
  requested_action: 'Refund',
  language: ['Hinglish'],
  model_used: 'gemini-2.5-flash',
  used_fallback: false,
  body_chars: 76,
};

const analysis = id => mockFake.store.email_analysis?.get(id);
const email    = id => mockFake.store.emails?.get(id);

/**
 * processTick() claims work and spawns each job fire-and-forget, so it resolves
 * before the jobs do — that is the point of the design. Tests need the queue
 * settled before asserting, so flush the microtask/macrotask queues until no
 * job is left mid-flight.
 */
async function runTick() {
  await processTick();
  for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCategorize.mockResolvedValue(GOOD_RESULT);
  mockFake = createFakeDb({
    emails: [EMAIL],
    call_categories: [],
    bug_categories: [{ _id: 'b1', name: 'Payment Gateway' }],
  });
});

describe('enqueueEmail', () => {
  it('creates a pending row', async () => {
    await enqueueEmail('m1');
    expect(analysis('m1')).toMatchObject({ gmail_id: 'm1', status: 'pending', attempts: 0 });
    expect(analysis('m1').created_at).toBeInstanceOf(Date);
  });

  it('is idempotent for an email already completed', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, { $set: { status: 'completed' } });

    expect(await enqueueEmail('m1')).toBe(false);
    expect(analysis('m1').status).toBe('completed');
  });

  it('leaves a permanently failed email alone', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, { $set: { status: 'failed' } });

    expect(await enqueueEmail('m1')).toBe(false);
    expect(analysis('m1').status).toBe('failed');
  });

  it('re-queues a completed email when forced, resetting the attempt count', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne(
      { gmail_id: 'm1' }, { $set: { status: 'completed', attempts: 3, error: 'old' } }
    );

    expect(await enqueueEmail('m1', { force: true })).toBe(true);
    expect(analysis('m1')).toMatchObject({ status: 'pending', attempts: 0, error: null });
  });

  it('ignores a missing id', async () => {
    expect(await enqueueEmail(undefined)).toBe(false);
    expect(mockFake.store.email_analysis?.size ?? 0).toBe(0);
  });
});

describe('the sweep', () => {
  it('enrols a stored email that has no analysis row', async () => {
    await runTick();
    expect(analysis('m1')).toBeDefined();
  });

  it('skips soft-deleted email', async () => {
    mockFake = createFakeDb({
      emails: [{ ...EMAIL, gmail_id: 'gone', is_deleted: true }],
      call_categories: [], bug_categories: [],
    });
    await runTick();
    expect(analysis('gone')).toBeUndefined();
  });

  it('does not duplicate a row that already exists', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, { $set: { status: 'completed' } });
    await runTick();
    expect(mockFake.store.email_analysis.size).toBe(1);
    expect(analysis('m1').status).toBe('completed');   // not reset to pending
  });
});

describe('processing an email', () => {
  it('calls Gemini with the email and the live taxonomy', async () => {
    await enqueueEmail('m1');
    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    const [passedEmail, opts] = mockCategorize.mock.calls[0];
    expect(passedEmail.gmail_id).toBe('m1');
    expect(opts.bugCategories).toEqual(['Payment Gateway']);
  });

  it('stores the full verdict on email_analysis', async () => {
    await enqueueEmail('m1');
    await runTick();

    expect(analysis('m1')).toMatchObject({
      status: 'completed',
      category: 'Payment & Fee',
      sub_category: 'Duplicate Payment Refund Query',
      ai_insight: 'Duplicate payment refund request',
      requested_action: 'Refund',
      bug_category: '-',
      model_used: 'gemini-2.5-flash',
      error: null,
      processing_id: null,
    });
    expect(analysis('m1').processed_at).toBeInstanceOf(Date);
  });

  it('mirrors the headline pair onto the email document', async () => {
    // This is what makes category filtering on /api/emails a plain query.
    await enqueueEmail('m1');
    await runTick();

    expect(email('m1')).toMatchObject({
      category: 'Payment & Fee',
      sub_category: 'Duplicate Payment Refund Query',
      ai_insight: 'Duplicate payment refund request',
    });
    expect(email('m1').analysed_at).toBeInstanceOf(Date);
  });

  it('records a reported defect and its category', async () => {
    mockCategorize.mockResolvedValue({
      ...GOOD_RESULT,
      bugs: 'Appearing option missing from the qualification dropdown.',
      bug_category: 'Payment Gateway',
    });
    await enqueueEmail('m1');
    await runTick();

    expect(analysis('m1').bugs).toMatch(/Appearing option/);
    expect(analysis('m1').bug_category).toBe('Payment Gateway');
  });
});

describe('the no-body shortcut', () => {
  it('files an empty email as "Email too Short" without calling Gemini', async () => {
    mockFake = createFakeDb({
      emails: [{ ...EMAIL, gmail_id: 'blank', body_text: '', body_html: '' }],
      call_categories: [], bug_categories: [],
    });
    await enqueueEmail('blank');
    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(analysis('blank')).toMatchObject({ status: 'completed', category: TOO_SHORT_CATEGORY, ai_insight: '-' });
    expect(email('blank').category).toBe(TOO_SHORT_CATEGORY);
  });

  it('applies the same shortcut to a body under the character floor', async () => {
    mockFake = createFakeDb({
      emails: [{ ...EMAIL, gmail_id: 'tiny', body_text: 'hi' }],
      call_categories: [], bug_categories: [],
    });
    await enqueueEmail('tiny');
    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(analysis('tiny').category).toBe(TOO_SHORT_CATEGORY);
  });

  it('still analyses a short but meaningful request', async () => {
    mockFake = createFakeDb({
      emails: [{ ...EMAIL, gmail_id: 'short', body_text: 'payment ho gaya form nahi bhara' }],
      call_categories: [], bug_categories: [],
    });
    await enqueueEmail('short');
    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    expect(analysis('short').category).toBe('Payment & Fee');
  });
});

describe('failure handling', () => {
  it('schedules a backoff retry on a transient failure', async () => {
    mockCategorize.mockResolvedValue({ success: false, error: 'HTTP 503 upstream' });
    await enqueueEmail('m1');
    await runTick();

    const row = analysis('m1');
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.last_error).toMatch(/503/);
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    expect(row.processing_id).toBeNull();
  });

  it('does not retry a permanent failure', async () => {
    mockCategorize.mockResolvedValue({ success: false, permanent: true, error: 'HTTP 400 bad request' });
    await enqueueEmail('m1');
    await runTick();

    expect(analysis('m1')).toMatchObject({ status: 'failed', error: 'HTTP 400 bad request' });
    expect(analysis('m1').next_attempt_at).toBeFalsy();
  });

  it('gives up after the fifth attempt', async () => {
    mockCategorize.mockResolvedValue({ success: false, error: 'still failing' });
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, { $set: { attempts: 4 } });
    await runTick();

    expect(analysis('m1')).toMatchObject({ status: 'failed', attempts: 5, error: 'still failing' });
  });

  it('treats a thrown error as transient', async () => {
    mockCategorize.mockRejectedValue(new Error('socket hang up'));
    await enqueueEmail('m1');
    await runTick();

    expect(analysis('m1')).toMatchObject({ status: 'pending', attempts: 1 });
    expect(analysis('m1').last_error).toMatch(/socket hang up/);
  });

  it('fails the row if the email disappeared before analysis', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('emails').deleteOne({ gmail_id: 'm1' });
    await runTick();

    expect(analysis('m1')).toMatchObject({ status: 'failed' });
    expect(analysis('m1').error).toMatch(/no longer/i);
    expect(mockCategorize).not.toHaveBeenCalled();
  });

  it('does not pick up a row whose retry time is in the future', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne(
      { gmail_id: 'm1' }, { $set: { next_attempt_at: new Date(Date.now() + 600_000) } }
    );
    await runTick();
    expect(mockCategorize).not.toHaveBeenCalled();
  });

  it('recovers a stale processing lock', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, {
      $set: { status: 'processing', processing_id: 'dead-worker', updated_at: new Date(Date.now() - 30 * 60_000) },
    });

    await runTick();

    // Reclaimed and completed by this worker rather than stuck forever.
    expect(analysis('m1').status).toBe('completed');
  });

  it('leaves a fresh processing lock alone', async () => {
    await enqueueEmail('m1');
    await mockFake.db.collection('email_analysis').updateOne({ gmail_id: 'm1' }, {
      $set: { status: 'processing', processing_id: 'live-worker', updated_at: new Date() },
    });

    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(analysis('m1').processing_id).toBe('live-worker');
  });
});

describe('the enabled switch', () => {
  it('does nothing when EMAIL_ANALYSIS_ENABLED is false', async () => {
    process.env.EMAIL_ANALYSIS_ENABLED = 'false';
    await enqueueEmail('m1');
    await runTick();
    expect(mockCategorize).not.toHaveBeenCalled();
    delete process.env.EMAIL_ANALYSIS_ENABLED;
  });

  it('runs by default when a key is present', async () => {
    delete process.env.EMAIL_ANALYSIS_ENABLED;
    await enqueueEmail('m1');
    await runTick();
    expect(mockCategorize).toHaveBeenCalled();
  });
});
