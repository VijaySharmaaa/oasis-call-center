/**
 * emailAnalysisWorker — queueing, the sweep, the no-body shortcut, writeback,
 * and the retry/permanent-failure policy it shares with analysisWorker.
 *
 * The unit of work is a CONVERSATION: one row per correspondent, re-read whole
 * whenever they say something new, and the verdict it produces replaces the
 * previous one everywhere it was mirrored.
 *
 * geminiService is mocked, so no prompt is ever built and no network call made.
 */
process.env.NODE_ENV                   = 'test';
process.env.LOG_LEVEL                  = 'error';
process.env.GEMINI_API_KEY             = 'test-key';
process.env.EMAIL_ANALYSIS_CONCURRENCY = '2';
process.env.EMAIL_ANALYSIS_MIN_CHARS   = '15';
process.env.GMAIL_USER                 = 'support@upessc.org';

const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

const mockCategorize = jest.fn();
jest.mock('../src/services/geminiService', () => ({
  categorizeConversation: (...args) => mockCategorize(...args),
  // The real implementation — the worker's short-circuit depends on it, and it
  // is pure, so there is nothing to gain from faking it.
  emailToPlainText: jest.requireActual('../src/services/geminiService').emailToPlainText,
  CATEGORIZATION_SCHEMA: jest.requireActual('../src/services/geminiService').CATEGORIZATION_SCHEMA,
}));

const { enqueueEmail, enqueueConversation, processTick, TOO_SHORT_CATEGORY } = require('../src/workers/emailAnalysisWorker');
const { refreshConversation } = require('../src/lib/conversations');

const AASHA = 'aasha@example.com';

/** The candidate's opening mail, as stored by the sync worker. */
const FIRST = {
  gmail_id:    'm1',
  thread_id:   'th1',
  subject:     'Fee debited twice',
  from_email:  AASHA,
  from_name:   'Km Aasha',
  to:          'support@upessc.org',
  body_text:   'Sir mera fee do baar cut gaya hai lekin form submit nahi hua, refund chahiye.',
  body_html:   '',
  received_at: new Date('2026-08-17T10:00:00Z'),
  label_ids:   ['INBOX'],
  is_deleted:  false,
};

/** Our reply, three hours later. */
const REPLY_OUT = {
  gmail_id:    'm2',
  thread_id:   'th1',
  subject:     'Re: Fee debited twice',
  from_email:  'support@upessc.org',
  from_name:   'UPTET Support',
  to:          `Km Aasha <${AASHA}>`,
  body_text:   'Please share the transaction reference so we can trace the payment.',
  body_html:   '',
  received_at: new Date('2026-08-17T13:00:00Z'),
  label_ids:   ['SENT'],
  is_deleted:  false,
};

/** Her follow-up, in a brand-new thread — the case candidates actually create. */
const FOLLOW_UP = {
  gmail_id:    'm3',
  thread_id:   'th2',
  subject:     'Payment reference',
  from_email:  AASHA,
  from_name:   'Km Aasha',
  to:          'support@upessc.org',
  body_text:   'Transaction ref 4471xx hai. Ab tak refund nahi aaya, please dekh lijiye.',
  body_html:   '',
  received_at: new Date('2026-08-18T09:00:00Z'),
  label_ids:   ['INBOX'],
  is_deleted:  false,
};

const GOOD_RESULT = {
  success: true,
  category: 'Payment & Fee',
  sub_category: 'Duplicate Payment Refund Query',
  tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
  summary: 'Fee debited twice. Refund requested, reference supplied.',
  ai_insight: 'Duplicate payment refund request',
  bugs: '-',
  bug_category: '-',
  email_category: 'Payment & Fee',
  email_sub_category: 'Duplicate Payment Refund Query',
  requested_action: 'Refund',
  language: ['Hinglish'],
  model_used: 'gemini-2.5-flash',
  used_fallback: false,
  usage: { model: 'gemini-2.5-flash', prompt_tokens: 900, output_tokens: 120, total_tokens: 1020 },
  body_chars: 210,
  analysed_messages: 3,
  omitted_messages: 0,
};

const conversation = id => mockFake.store.email_conversations?.get(id);
const job          = id => mockFake.store.conversation_analysis?.get(id);
const analysis     = id => mockFake.store.email_analysis?.get(id);
const email        = id => mockFake.store.emails?.get(id);

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

/** Seed a database and build the rollups the sync worker would have built. */
async function seed(messages) {
  mockFake = createFakeDb({
    emails: messages.map(m => ({ ...m, conversation_id: m.conversation_id ?? (m.label_ids?.includes('SENT') ? AASHA : m.from_email) })),
    call_categories: [],
    bug_categories: [{ _id: 'b1', name: 'Payment Gateway' }],
  });
  const ids = [...new Set(messages.map(m => (m.label_ids?.includes('SENT') ? AASHA : m.from_email)))];
  for (const id of ids) await refreshConversation(mockFake.db, id);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockCategorize.mockResolvedValue(GOOD_RESULT);
  await seed([FIRST, REPLY_OUT, FOLLOW_UP]);
});

describe('enqueueConversation', () => {
  it('creates a pending row', async () => {
    await enqueueConversation(AASHA);
    expect(job(AASHA)).toMatchObject({ conversation_id: AASHA, status: 'pending', attempts: 0 });
    expect(job(AASHA).created_at).toBeInstanceOf(Date);
  });

  it('is idempotent for a conversation already completed', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne({ _id: AASHA }, { $set: { status: 'completed' } });

    expect(await enqueueConversation(AASHA)).toBe(false);
    expect(job(AASHA).status).toBe('completed');
  });

  it('leaves a permanently failed conversation alone', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne({ _id: AASHA }, { $set: { status: 'failed' } });

    expect(await enqueueConversation(AASHA)).toBe(false);
    expect(job(AASHA).status).toBe('failed');
  });

  it('re-queues a completed conversation when forced, resetting the attempt count', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne(
      { _id: AASHA }, { $set: { status: 'completed', attempts: 3, error: 'old' } }
    );

    expect(await enqueueConversation(AASHA, { force: true })).toBe(true);
    expect(job(AASHA)).toMatchObject({ status: 'pending', attempts: 0, error: null });
  });

  it('ignores a missing id', async () => {
    expect(await enqueueConversation(undefined)).toBe(false);
    expect(mockFake.store.conversation_analysis?.size ?? 0).toBe(0);
  });
});

describe('enqueueEmail', () => {
  it('queues the conversation the message belongs to, not the message', async () => {
    expect(await enqueueEmail('m3')).toBe(true);
    expect(job(AASHA)).toMatchObject({ status: 'pending' });
    expect(mockFake.store.conversation_analysis.size).toBe(1);
  });

  it('derives the conversation for mail stored before conversations existed', async () => {
    mockFake = createFakeDb({
      // No conversation_id, no rollup — exactly how the collection looked before.
      emails: [{ ...FIRST, conversation_id: undefined }],
      call_categories: [], bug_categories: [],
    });

    expect(await enqueueEmail('m1')).toBe(true);
    expect(email('m1').conversation_id).toBe(AASHA);
    expect(conversation(AASHA)).toMatchObject({ participant_email: AASHA, message_count: 1 });
    expect(job(AASHA)).toBeDefined();
  });

  it('ignores an unknown message', async () => {
    expect(await enqueueEmail('nope')).toBe(false);
  });
});

describe('the sweep', () => {
  it('enrols a conversation that has never been analysed', async () => {
    await runTick();
    expect(job(AASHA)).toBeDefined();
    expect(mockCategorize).toHaveBeenCalledTimes(1);
  });

  it('stamps conversation ids onto mail that predates conversations', async () => {
    mockFake = createFakeDb({
      emails: [{ ...FIRST, conversation_id: undefined }],
      call_categories: [], bug_categories: [],
    });
    await runTick();

    expect(email('m1').conversation_id).toBe(AASHA);
    expect(conversation(AASHA)).toBeDefined();
  });

  it('skips soft-deleted email', async () => {
    mockFake = createFakeDb({
      emails: [{ ...FIRST, gmail_id: 'gone', conversation_id: undefined, is_deleted: true }],
      call_categories: [], bug_categories: [],
    });
    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(mockFake.store.conversation_analysis?.size ?? 0).toBe(0);
  });

  it('leaves a settled conversation alone once nothing new has arrived', async () => {
    await runTick();
    expect(mockCategorize).toHaveBeenCalledTimes(1);

    await runTick();
    expect(mockCategorize).toHaveBeenCalledTimes(1);   // not re-analysed for free
    expect(conversation(AASHA).needs_analysis).toBe(false);
  });

  /* Regression: the sweep used to force every conversation carrying
     needs_analysis, which cleared next_attempt_at on a row that was merely
     waiting out its backoff. Running every tick, that retried a failing job at
     full speed forever and spent Gemini quota as fast as the API could answer. */
  it('does not clear the backoff of a job already waiting to retry', async () => {
    mockCategorize.mockResolvedValue({ success: false, error: 'HTTP 503 upstream' });
    await runTick();

    const scheduled = job(AASHA).next_attempt_at;
    expect(scheduled).toBeInstanceOf(Date);
    expect(scheduled.getTime()).toBeGreaterThan(Date.now());
    expect(conversation(AASHA).needs_analysis).toBe(true);   // still outstanding

    await runTick();
    expect(job(AASHA).next_attempt_at).toEqual(scheduled);
    expect(job(AASHA).attempts).toBe(1);                     // no second attempt burned
  });
});

describe('analysing a conversation', () => {
  it('hands Gemini the whole chain, both directions, oldest first', async () => {
    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    const [conv, messages, opts] = mockCategorize.mock.calls[0];
    expect(conv.participant_email).toBe(AASHA);
    expect(messages.map(m => m.gmail_id)).toEqual(['m1', 'm2', 'm3']);
    expect(opts.bugCategories).toEqual(['Payment Gateway']);
  });

  it('stores the full verdict against the conversation', async () => {
    await runTick();

    expect(job(AASHA)).toMatchObject({
      status: 'completed',
      category: 'Payment & Fee',
      sub_category: 'Duplicate Payment Refund Query',
      ai_insight: 'Duplicate payment refund request',
      requested_action: 'Refund',
      bug_category: '-',
      model_used: 'gemini-2.5-flash',
      message_count: 3,
      inbound_count: 2,
      error: null,
      processing_id: null,
    });
    expect(job(AASHA).processed_at).toBeInstanceOf(Date);
  });

  it('mirrors the headline pair onto the conversation row', async () => {
    // This is what makes the Emails tab a plain query over conversations.
    await runTick();

    expect(conversation(AASHA)).toMatchObject({
      category: 'Payment & Fee',
      sub_category: 'Duplicate Payment Refund Query',
      ai_insight: 'Duplicate payment refund request',
      analysis_status: 'completed',
      needs_analysis: false,
    });
    expect(conversation(AASHA).analysed_at).toBeInstanceOf(Date);
    expect(conversation(AASHA).analysed_upto).toEqual(FOLLOW_UP.received_at);
  });

  it('mirrors it onto the inbound messages, leaving our own replies untouched', async () => {
    await runTick();

    for (const id of ['m1', 'm3']) {
      expect(email(id)).toMatchObject({
        category: 'Payment & Fee',
        ai_insight: 'Duplicate payment refund request',
      });
      expect(email(id).analysed_at).toBeInstanceOf(Date);
    }
    expect(email('m2').category).toBeUndefined();
  });

  it('writes one email_analysis row per inbound message, charging the call once', async () => {
    await runTick();

    expect(analysis('m1')).toMatchObject({ status: 'completed', conversation_id: AASHA, category: 'Payment & Fee' });
    expect(analysis('m3')).toMatchObject({ status: 'completed', conversation_id: AASHA });
    expect(analysis('m2')).toBeUndefined();

    // Cost belongs to the newest message: one Gemini call, one charge.
    expect(analysis('m3').usage).toMatchObject({ total_tokens: 1020 });
    expect(analysis('m1').usage).toBeNull();
  });

  it('records a reported defect and its category', async () => {
    mockCategorize.mockResolvedValue({
      ...GOOD_RESULT,
      bugs: 'Appearing option missing from the qualification dropdown.',
      bug_category: 'Payment Gateway',
    });
    await runTick();

    expect(job(AASHA).bugs).toMatch(/Appearing option/);
    expect(job(AASHA).bug_category).toBe('Payment Gateway');
    expect(conversation(AASHA).bug_category).toBe('Payment Gateway');
  });
});

describe('answering re-reads the chain', () => {
  it('stamps the verdict as covering the newest message, whoever sent it', async () => {
    await runTick();
    // FOLLOW_UP (inbound) is not the newest — REPLY_OUT is older, so the newest
    // here is the follow-up; the point is that the stamp is taken from the
    // chain, not from the inbound subset.
    expect(conversation(AASHA).analysed_upto).toEqual(FOLLOW_UP.received_at);
    expect(conversation(AASHA).needs_analysis).toBe(false);
  });

  it('goes outstanding again once we answer, and re-reads with our answer in it', async () => {
    await runTick();
    expect(conversation(AASHA).needs_analysis).toBe(false);
    mockCategorize.mockClear();

    // Support replies — from the app, or from Gmail and picked up by the sync.
    await mockFake.db.collection('emails').updateOne(
      { gmail_id: 'out9' },
      { $set: { ...REPLY_OUT, gmail_id: 'out9', conversation_id: AASHA,
                body_text: 'Your refund has been processed.',
                received_at: new Date('2026-08-19T09:00:00Z') } },
      { upsert: true }
    );
    await refreshConversation(mockFake.db, AASHA);
    expect(conversation(AASHA).needs_analysis).toBe(true);

    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    // The whole chain went back to Gemini, our answer included — that is what
    // lets it stop reporting an issue we have since resolved.
    const [, messages] = mockCategorize.mock.calls[0];
    expect(messages.map(m => m.gmail_id)).toEqual(['m1', 'm2', 'm3', 'out9']);
    expect(conversation(AASHA)).toMatchObject({ needs_analysis: false });
    expect(conversation(AASHA).analysed_upto).toEqual(new Date('2026-08-19T09:00:00Z'));
  });
});

describe('a reply overrides the previous verdict', () => {
  it('re-reads the chain and replaces the stored answer everywhere', async () => {
    await runTick();
    expect(conversation(AASHA).category).toBe('Payment & Fee');

    // She writes again — a different problem this time.
    const later = {
      ...FOLLOW_UP,
      gmail_id: 'm4',
      subject: 'Photo upload failing',
      body_text: 'Refund mil gaya, thank you. Ab photo upload nahi ho raha hai portal par.',
      received_at: new Date('2026-08-19T09:00:00Z'),
    };
    await mockFake.db.collection('emails').updateOne(
      { gmail_id: 'm4' },
      { $set: { ...later, conversation_id: AASHA } },
      { upsert: true }
    );
    await refreshConversation(mockFake.db, AASHA);
    expect(conversation(AASHA).needs_analysis).toBe(true);

    mockCategorize.mockResolvedValue({
      ...GOOD_RESULT,
      category: 'Document & Photo Upload',
      sub_category: 'Photo Upload Failure',
      tags: [{ category: 'Document & Photo Upload', sub_category: 'Photo Upload Failure' }],
      ai_insight: 'Photo upload failing repeatedly',
      summary: 'Refund settled; photo upload now fails.',
    });
    await runTick();

    expect(mockCategorize.mock.calls.at(-1)[1].map(m => m.gmail_id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(job(AASHA).category).toBe('Document & Photo Upload');
    expect(conversation(AASHA)).toMatchObject({
      category: 'Document & Photo Upload',
      ai_insight: 'Photo upload failing repeatedly',
      needs_analysis: false,
    });
    // The older messages carry the current verdict too — there is one answer
    // for the case, not one per message.
    expect(email('m1').category).toBe('Document & Photo Upload');
    expect(analysis('m1').category).toBe('Document & Photo Upload');
    // And the cost moved to the message that triggered the re-read.
    expect(analysis('m4').usage).toMatchObject({ total_tokens: 1020 });
    expect(analysis('m3').usage).toBeNull();
  });
});

describe('the no-body shortcut', () => {
  it('files an empty exchange as "Email too Short" without calling Gemini', async () => {
    await seed([{ ...FIRST, body_text: '', body_html: '' }]);
    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(job(AASHA)).toMatchObject({ status: 'completed', category: TOO_SHORT_CATEGORY, ai_insight: '-' });
    expect(conversation(AASHA).category).toBe(TOO_SHORT_CATEGORY);
    expect(email('m1').category).toBe(TOO_SHORT_CATEGORY);
  });

  it('measures the floor across the whole chain, not one message at a time', async () => {
    // Two messages of "hi" and "??" would each fall under the floor alone; read
    // together they still do, and neither is worth a Gemini call.
    await seed([
      { ...FIRST, body_text: 'hi' },
      { ...FOLLOW_UP, body_text: '??' },
    ]);
    await runTick();

    expect(mockCategorize).not.toHaveBeenCalled();
    expect(job(AASHA).category).toBe(TOO_SHORT_CATEGORY);
  });

  it('still analyses a short but meaningful request', async () => {
    await seed([{ ...FIRST, body_text: 'payment ho gaya form nahi bhara' }]);
    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    expect(job(AASHA).category).toBe('Payment & Fee');
  });
});

describe('a lock whose owner died', () => {
  /** Claim the conversation, then abandon the lock 20 minutes in the past. */
  async function orphanLock() {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne(
      { _id: AASHA },
      { $set: {
        status: 'processing',
        processing_id: 'dead-worker',
        updated_at: new Date(Date.now() - 20 * 60 * 1000),
      } }
    );
  }

  /* The case that had a fully-analysed chain reporting "Analysing…" in the
     Emails tab indefinitely: the worker wrote its verdict out and was killed
     before it released the lock, so the queue row outlived the answer it had
     already produced. */
  it('settles the row when the verdict landed before the worker died', async () => {
    await runTick();                      // produce a real verdict first
    expect(conversation(AASHA).analysed_at).toBeInstanceOf(Date);
    mockCategorize.mockClear();

    await orphanLock();
    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'completed', processing_id: null, error: null });
    expect(job(AASHA).reconciled_at).toBeInstanceOf(Date);
    // And no Gemini call was spent reproducing an answer already stored.
    expect(mockCategorize).not.toHaveBeenCalled();
    expect(conversation(AASHA).category).toBe('Payment & Fee');
  });

  it('re-runs the work when the worker died before producing anything', async () => {
    await orphanLock();
    expect(conversation(AASHA).needs_analysis).toBe(true);

    await runTick();

    expect(mockCategorize).toHaveBeenCalledTimes(1);
    expect(job(AASHA)).toMatchObject({ status: 'completed' });
  });

  it('leaves a lock alone while its owner is still sending heartbeats', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne(
      { _id: AASHA },
      { $set: { status: 'processing', processing_id: 'live-worker', updated_at: new Date() } }
    );

    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'processing', processing_id: 'live-worker' });
    expect(mockCategorize).not.toHaveBeenCalled();
  });
});

describe('failure handling', () => {
  it('schedules a backoff retry on a transient failure', async () => {
    mockCategorize.mockResolvedValue({ success: false, error: 'HTTP 503 upstream' });
    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'pending', attempts: 1, last_error: 'HTTP 503 upstream' });
    expect(job(AASHA).next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up permanently on a non-retryable failure, without burning attempts', async () => {
    mockCategorize.mockResolvedValue({ success: false, error: 'HTTP 400 bad request', permanent: true });
    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'failed', error: 'HTTP 400 bad request' });
    // Stamped as covered: the content was tried and cannot succeed, so the
    // sweep must not offer it again until new mail changes what there is to read.
    expect(conversation(AASHA).needs_analysis).toBe(false);
    expect(conversation(AASHA).analysed_upto).toEqual(FOLLOW_UP.received_at);
  });

  it('fails for good once the attempt budget is spent', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('conversation_analysis').updateOne({ _id: AASHA }, { $set: { attempts: 4 } });
    mockCategorize.mockResolvedValue({ success: false, error: 'HTTP 503 upstream' });
    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'failed', attempts: 5, error: 'HTTP 503 upstream' });
  });

  it('fails a conversation whose messages have all gone', async () => {
    await enqueueConversation(AASHA);
    await mockFake.db.collection('emails').deleteMany({ conversation_id: AASHA });
    await mockFake.db.collection('email_conversations').deleteOne({ _id: AASHA });
    await runTick();

    expect(job(AASHA)).toMatchObject({ status: 'failed', error: 'Conversation no longer in the database' });
  });
});
