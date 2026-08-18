/**
 * emailSyncWorker — the backfill → incremental state machine.
 *
 * Drives syncOnce() against a fake Gmail API and a fake Mongo. This is the
 * logic that cannot be exercised against the live mailbox until domain-wide
 * delegation is granted, so it is worth pinning down here.
 */
process.env.NODE_ENV                      = 'test';
process.env.GMAIL_USER                    = 'support@upessc.org';
process.env.GMAIL_BACKFILL_PAGES_PER_TICK = '1';   // force a multi-tick backfill
process.env.GMAIL_BACKFILL_DAYS           = '30';
process.env.LOG_LEVEL                     = 'error';

const { createFakeDb } = require('./helpers/fakeMongo');

let mockFake;
jest.mock('../src/db', () => ({ getDb: () => Promise.resolve(mockFake.db) }));

// ── Fake Gmail ────────────────────────────────────────────────────────────────
const PAGES = {
  first:  { messages: [{ id: 'a1' }, { id: 'a2' }], nextPageToken: 'page2' },
  page2:  { messages: [{ id: 'a3' }],               nextPageToken: undefined },
};

const mockGmail = {
  isConfigured: jest.fn(() => true),
  authMode:     jest.fn(() => 'service_account'),
  mailbox:      jest.fn(() => 'support@upessc.org'),
  getProfile:   jest.fn(() => Promise.resolve({ emailAddress: 'support@upessc.org', historyId: '1000', messagesTotal: 3 })),
  listMessages: jest.fn(({ pageToken }) => Promise.resolve(pageToken ? PAGES[pageToken] : PAGES.first)),
  getMessage:   jest.fn(id => Promise.resolve(fakeMessage(id))),
  listHistory:  jest.fn(),
};
jest.mock('../src/services/gmailService', () => mockGmail);

function fakeMessage(id, labels = ['INBOX', 'UNREAD']) {
  return {
    gmail_id: id, thread_id: `t_${id}`, history_id: '500',
    subject: `Subject ${id}`, from_name: 'Aasha', from_email: 'aasha@example.com',
    to: 'support@upessc.org', cc: '', reply_to: '', rfc822_id: `<${id}>`,
    received_at: new Date('2026-08-16T10:00:00Z'), internal_date: 1755338400000,
    snippet: 'snippet', label_ids: labels,
    is_unread: labels.includes('UNREAD'), is_starred: labels.includes('STARRED'),
    in_inbox: labels.includes('INBOX'), is_trashed: labels.includes('TRASH'), is_spam: false,
    body_text: 'body', body_html: '', attachments: [], has_attachments: false, size_estimate: 10,
  };
}

const HISTORY_PAGE = {
  historyId: '1200',
  history: [
    { messagesAdded:   [{ message: { id: 'n1' } }] },
    { labelsRemoved:   [{ message: { id: 'a1' }, labelIds: ['UNREAD'] }] },
    { labelsAdded:     [{ message: { id: 'a2' }, labelIds: ['STARRED', 'Label_9'] }] },
    { messagesAdded:   [{ message: { id: 'ghost' } }] },
    { messagesDeleted: [{ message: { id: 'ghost' } }] },
    { messagesDeleted: [{ message: { id: 'a3' } }] },
  ],
};

const { syncOnce } = require('../src/workers/emailSyncWorker');

const state  = () => mockFake.store.email_sync_state.get('support@upessc.org');
const email  = id => mockFake.store.emails.get(id);
const fetched = () => mockGmail.getMessage.mock.calls.map(([id]) => id);

beforeEach(() => {
  jest.clearAllMocks();
  mockGmail.isConfigured.mockReturnValue(true);
  mockGmail.mailbox.mockReturnValue('support@upessc.org');
  mockGmail.getProfile.mockResolvedValue({ emailAddress: 'support@upessc.org', historyId: '1000', messagesTotal: 3 });
  mockGmail.listMessages.mockImplementation(({ pageToken }) => Promise.resolve(pageToken ? PAGES[pageToken] : PAGES.first));
  mockGmail.getMessage.mockImplementation(id => Promise.resolve(fakeMessage(id)));
  mockGmail.listHistory.mockResolvedValue(HISTORY_PAGE);
  mockFake = createFakeDb({});
});

/** Run the two backfill ticks the fixture needs to reach incremental. */
async function completeBackfill() {
  await syncOnce();   // page 1
  await syncOnce();   // page 2 → handover
}

describe('backfill phase', () => {
  it('snapshots historyId BEFORE paging, so mid-backfill mail is not missed', async () => {
    await syncOnce();
    expect(mockGmail.getProfile).toHaveBeenCalledTimes(1);
    expect(state().pending_history_id).toBe('1000');
    // The profile call must precede the first list call.
    expect(mockGmail.getProfile.mock.invocationCallOrder[0])
      .toBeLessThan(mockGmail.listMessages.mock.invocationCallOrder[0]);
  });

  it('stores the first page and persists the page token for resume', async () => {
    const result = await syncOnce();
    expect(result.phase).toBe('backfill');
    expect(state().backfill_page_token).toBe('page2');
    expect([...mockFake.store.emails.keys()].sort()).toEqual(['a1', 'a2']);
  });

  it('stamps mailbox, is_deleted and first_seen_at on stored mail', async () => {
    await syncOnce();
    expect(email('a1')).toMatchObject({ mailbox: 'support@upessc.org', is_deleted: false });
    expect(email('a1').first_seen_at).toBeInstanceOf(Date);
    expect(email('a1').synced_at).toBeInstanceOf(Date);
  });

  it('resumes from the stored page token rather than restarting', async () => {
    await syncOnce();
    mockGmail.listMessages.mockClear();
    await syncOnce();
    expect(mockGmail.listMessages).toHaveBeenCalledWith(expect.objectContaining({ pageToken: 'page2' }));
    expect(mockGmail.getProfile).toHaveBeenCalledTimes(1);   // not re-snapshotted
  });

  it('hands over to incremental once the pages drain', async () => {
    await syncOnce();
    const result = await syncOnce();

    expect(result.phase).toBe('incremental');
    expect(state()).toMatchObject({
      phase: 'incremental',
      history_id: '1000',          // the pre-backfill snapshot, not a later one
      pending_history_id: null,
      backfill_page_token: null,
    });
    expect(mockFake.store.emails.size).toBe(3);
    expect(state().synced_total).toBe(3);
  });

  it('applies the configured date window to the list query', async () => {
    await syncOnce();
    expect(mockGmail.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringMatching(/^after:\d{4}\/\d{2}\/\d{2}$/) })
    );
  });

  it('leaves the page token untouched when a page fails, so the tick retries it', async () => {
    const boom = Object.assign(new Error('rate limited'), { status: 429, retryable: true });
    mockGmail.getMessage.mockRejectedValue(boom);

    const result = await syncOnce();

    expect(result.error).toMatch(/rate limited/);
    expect(state().backfill_page_token).toBeFalsy();   // never advanced past page 1
    expect(state().last_error).toMatch(/rate limited/);
    expect(state().phase).toBe('backfill');
  });
});

describe('incremental phase', () => {
  beforeEach(completeBackfill);

  it('fetches genuinely new messages', async () => {
    mockGmail.getMessage.mockClear();
    await syncOnce();
    expect(email('n1')).toBeDefined();
    expect(fetched()).toContain('n1');
  });

  it('skips a message added and deleted inside the same window', async () => {
    mockGmail.getMessage.mockClear();
    await syncOnce();
    expect(fetched()).not.toContain('ghost');
    expect(email('ghost')).toBeUndefined();
  });

  it('applies label changes without spending a fetch', async () => {
    mockGmail.getMessage.mockClear();
    await syncOnce();
    expect(fetched()).not.toContain('a1');
    expect(fetched()).not.toContain('a2');
  });

  it('mirrors labelsRemoved onto the stored labels and derived flags', async () => {
    await syncOnce();
    expect(email('a1').label_ids).not.toContain('UNREAD');
    expect(email('a1').is_unread).toBe(false);
  });

  it('mirrors labelsAdded, including user labels', async () => {
    await syncOnce();
    expect(email('a2').label_ids).toEqual(expect.arrayContaining(['STARRED', 'Label_9']));
    expect(email('a2').is_starred).toBe(true);
  });

  it('soft-deletes removed mail instead of dropping the record', async () => {
    await syncOnce();
    expect(email('a3')).toMatchObject({ is_deleted: true });
    expect(email('a3').deleted_at).toBeInstanceOf(Date);
    expect(email('a3').subject).toBe('Subject a3');   // still there for reporting
  });

  it('advances historyId and clears the previous error', async () => {
    await syncOnce();
    expect(state().history_id).toBe('1200');
    expect(state().last_error).toBeNull();
  });

  it('does nothing when there is no history', async () => {
    mockGmail.listHistory.mockResolvedValue({ historyId: '1300', history: [] });
    mockGmail.getMessage.mockClear();
    const result = await syncOnce();
    expect(result.stored).toBe(0);
    expect(mockGmail.getMessage).not.toHaveBeenCalled();
    expect(state().history_id).toBe('1300');
  });

  it('follows history pagination before acting', async () => {
    mockGmail.listHistory
      .mockResolvedValueOnce({ historyId: '1250', nextPageToken: 'h2', history: [{ messagesAdded: [{ message: { id: 'p1' } }] }] })
      .mockResolvedValueOnce({ historyId: '1300', history: [{ messagesAdded: [{ message: { id: 'p2' } }] }] });

    await syncOnce();

    expect(email('p1')).toBeDefined();
    expect(email('p2')).toBeDefined();
    expect(state().history_id).toBe('1300');
  });

  it('restarts a backfill when the historyId has aged out (404)', async () => {
    mockGmail.listHistory.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

    const result = await syncOnce();

    expect(result.phase).toBe('backfill');
    expect(state()).toMatchObject({ phase: 'backfill', history_id: null, backfill_page_token: null });
  });

  it('records a non-404 failure without losing its place', async () => {
    mockGmail.listHistory.mockRejectedValue(Object.assign(new Error('backend error'), { status: 503, retryable: true }));

    const result = await syncOnce();

    expect(result.error).toMatch(/backend error/);
    expect(state()).toMatchObject({ phase: 'incremental', history_id: '1000' });
    expect(state().last_error).toMatch(/backend error/);
  });
});

describe('guards', () => {
  it('does nothing when Gmail is not configured', async () => {
    mockGmail.isConfigured.mockReturnValue(false);
    expect(await syncOnce()).toEqual({ skipped: 'disabled' });
    expect(mockGmail.listMessages).not.toHaveBeenCalled();
  });

  it('collapses an overlapping call instead of double-syncing', async () => {
    let release;
    mockGmail.getProfile.mockReturnValue(new Promise(resolve => { release = () => resolve({ historyId: '1000' }); }));

    const first  = syncOnce();
    const second = await syncOnce();       // while the first is still in flight
    expect(second).toEqual({ skipped: 'already_running' });

    release();
    await first;
  });

  it('rebuilds from scratch if the state says incremental with no historyId', async () => {
    await completeBackfill();
    await mockFake.db.collection('email_sync_state').updateOne(
      { _id: 'support@upessc.org' }, { $set: { history_id: null } }
    );

    // history.list is useless without a start id, so the worker must fall back
    // to a full backfill — which takes the same two ticks as any other.
    const first = await syncOnce();
    expect(first.phase).toBe('backfill');
    expect(mockGmail.listHistory).not.toHaveBeenCalled();

    const second = await syncOnce();
    expect(second.phase).toBe('incremental');
    expect(state().history_id).toBe('1000');             // freshly snapshotted
  });
});
