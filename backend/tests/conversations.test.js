/**
 * lib/conversations — who a message belongs to, and the rollup that turns a
 * pile of messages into one row per correspondent.
 *
 * The database is a fake (tests/helpers/fakeMongo); nothing here touches Atlas.
 */
process.env.NODE_ENV  = 'test';
process.env.LOG_LEVEL = 'error';
process.env.GMAIL_USER = 'support@upessc.org';

const { createFakeDb } = require('./helpers/fakeMongo');
const {
  splitAddressList, isOutbound, participantOf, conversationIdOf,
  refreshConversation, refreshConversations, backfillConversationIds, buildTranscript,
} = require('../src/lib/conversations');

const AASHA = 'aasha@example.com';

const INBOUND = {
  gmail_id: 'm1', thread_id: 'th1', subject: 'Fee debited twice',
  from_email: AASHA, from_name: 'Km Aasha', to: 'support@upessc.org',
  snippet: 'fee cut gaya', body_text: 'Sir mera fee do baar cut gaya hai.',
  received_at: new Date('2026-08-17T10:00:00Z'), label_ids: ['INBOX'],
  is_unread: true, has_attachments: false, is_trashed: false, is_spam: false, is_deleted: false,
};

const OUTBOUND = {
  gmail_id: 'm2', thread_id: 'th1', subject: 'Re: Fee debited twice',
  from_email: 'support@upessc.org', from_name: 'UPTET Support',
  to: `Km Aasha <${AASHA}>`, snippet: 'share the reference',
  body_text: 'Please share the transaction reference.',
  received_at: new Date('2026-08-17T13:00:00Z'), label_ids: ['SENT'],
  is_unread: false, has_attachments: false, is_trashed: false, is_spam: false, is_deleted: false,
};

/** A second thread from the same person — the case that makes threads useless. */
const FOLLOW_UP = {
  ...INBOUND,
  gmail_id: 'm3', thread_id: 'th2', subject: 'Payment reference',
  snippet: 'ref 4471xx', body_text: 'Transaction ref 4471xx hai.',
  received_at: new Date('2026-08-18T09:00:00Z'),
  is_unread: true, has_attachments: true,
};

const withConversation = docs => docs.map(d => ({ ...d, conversation_id: conversationIdOf(d) }));

describe('splitAddressList', () => {
  it('splits a plain list', () => {
    expect(splitAddressList('a@x.com, b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('does not split on a comma inside a quoted display name', () => {
    // The regex-based version of this got it wrong silently, which put replies
    // in the wrong conversation.
    expect(splitAddressList('"Doe, John" <j@x.com>, b@y.com')).toEqual(['"Doe, John" <j@x.com>', 'b@y.com']);
  });

  it('returns nothing for an empty header', () => {
    expect(splitAddressList('')).toEqual([]);
    expect(splitAddressList(undefined)).toEqual([]);
  });
});

describe('participantOf', () => {
  it('files received mail under the sender', () => {
    expect(participantOf(INBOUND)).toEqual({ email: AASHA, name: 'Km Aasha' });
    expect(isOutbound(INBOUND)).toBe(false);
  });

  it('files sent mail under the recipient, so both sides land in one chain', () => {
    expect(isOutbound(OUTBOUND)).toBe(true);
    expect(participantOf(OUTBOUND)).toEqual({ email: AASHA, name: 'Km Aasha' });
    expect(conversationIdOf(OUTBOUND)).toBe(conversationIdOf(INBOUND));
  });

  it('treats mail from the mailbox itself as outbound even without the SENT label', () => {
    expect(isOutbound({ ...OUTBOUND, label_ids: [] })).toBe(true);
  });

  it('skips our own aliases when choosing the correspondent', () => {
    process.env.GMAIL_ALIASES = 'help@upessc.org';
    const cc = { ...OUTBOUND, to: 'help@upessc.org, support@upessc.org', cc: `${AASHA}` };
    expect(participantOf(cc).email).toBe(AASHA);
    delete process.env.GMAIL_ALIASES;
  });

  it('lowercases the key so one person is never two rows', () => {
    expect(conversationIdOf({ ...INBOUND, from_email: 'Aasha@Example.COM' })).toBe(AASHA);
  });

  it('returns null when there is no address to group by', () => {
    expect(participantOf({ from_email: '' })).toBeNull();
    expect(conversationIdOf({})).toBeNull();
  });
});

describe('refreshConversation', () => {
  let fake;
  beforeEach(() => {
    fake = createFakeDb({ emails: withConversation([INBOUND, OUTBOUND, FOLLOW_UP]) });
  });

  it('rolls every message up into one row, across threads and directions', async () => {
    const rollup = await refreshConversation(fake.db, AASHA);

    expect(rollup).toMatchObject({
      participant_email: AASHA,
      participant_name: 'Km Aasha',
      message_count: 3,
      inbound_count: 2,
      outbound_count: 1,
      last_subject: 'Payment reference',
      last_inbound_id: 'm3',
      unread_count: 2,
      has_attachments: true,
      is_trashed: false,
    });
    expect(rollup.thread_ids.sort()).toEqual(['th1', 'th2']);
    expect(rollup.first_message_at).toEqual(INBOUND.received_at);
    expect(rollup.last_message_at).toEqual(FOLLOW_UP.received_at);
    expect(rollup.last_inbound_at).toEqual(FOLLOW_UP.received_at);
  });

  it('marks a never-analysed conversation as needing analysis', async () => {
    expect((await refreshConversation(fake.db, AASHA)).needs_analysis).toBe(true);
  });

  it('clears the flag once a verdict covers the newest inbound message', async () => {
    await fake.db.collection('email_conversations').updateOne(
      { _id: AASHA }, { $set: { analysed_upto: FOLLOW_UP.received_at } }, { upsert: true }
    );
    expect((await refreshConversation(fake.db, AASHA)).needs_analysis).toBe(false);
  });

  it('raises it again the moment a reply lands after that verdict', async () => {
    await fake.db.collection('email_conversations').updateOne(
      { _id: AASHA }, { $set: { analysed_upto: FOLLOW_UP.received_at } }, { upsert: true }
    );
    await fake.db.collection('emails').updateOne(
      { gmail_id: 'm4' },
      { $set: { ...FOLLOW_UP, gmail_id: 'm4', conversation_id: AASHA, received_at: new Date('2026-08-19T09:00:00Z') } },
      { upsert: true }
    );
    expect((await refreshConversation(fake.db, AASHA)).needs_analysis).toBe(true);
  });

  /* Answering changes the verdict as surely as a follow-up does: the prompt
     reads our replies as what has already been answered, so a chain re-read
     after we reply stops reporting a problem we just fixed. */
  it('raises the flag when WE reply, not only when the candidate writes', async () => {
    await fake.db.collection('email_conversations').updateOne(
      { _id: AASHA }, { $set: { analysed_upto: FOLLOW_UP.received_at } }, { upsert: true }
    );
    expect((await refreshConversation(fake.db, AASHA)).needs_analysis).toBe(false);

    await fake.db.collection('emails').updateOne(
      { gmail_id: 'out2' },
      { $set: { ...OUTBOUND, gmail_id: 'out2', conversation_id: AASHA,
                received_at: new Date('2026-08-19T09:00:00Z') } },
      { upsert: true }
    );

    expect((await refreshConversation(fake.db, AASHA)).needs_analysis).toBe(true);
  });

  it('stays quiet for a chain the candidate has never written to', async () => {
    // We opened it and nobody answered: there is nothing of theirs to judge,
    // and analysing it would spend a call to be told so.
    const outboundOnly = createFakeDb({ emails: withConversation([OUTBOUND]) });
    const rollup = await refreshConversation(outboundOnly.db, AASHA);

    expect(rollup.inbound_count).toBe(0);
    expect(rollup.needs_analysis).toBe(false);
  });

  it('ignores soft-deleted mail, and drops the row when nothing is left', async () => {
    await fake.db.collection('emails').updateMany({ conversation_id: AASHA }, { $set: { is_deleted: true } });
    expect(await refreshConversation(fake.db, AASHA)).toBeNull();
    expect(fake.store.email_conversations.get(AASHA)).toBeUndefined();
  });

  it('counts a chain as trashed only when every message in it is', async () => {
    await fake.db.collection('emails').updateOne({ gmail_id: 'm1' }, { $set: { is_trashed: true } });
    expect((await refreshConversation(fake.db, AASHA)).is_trashed).toBe(false);

    await fake.db.collection('emails').updateMany({ conversation_id: AASHA }, { $set: { is_trashed: true } });
    expect((await refreshConversation(fake.db, AASHA)).is_trashed).toBe(true);
  });

  it('leaves the stored verdict alone — a rollup is not an analysis', async () => {
    await fake.db.collection('email_conversations').updateOne(
      { _id: AASHA }, { $set: { category: 'Payment & Fee', ai_insight: 'Duplicate payment refund request' } }, { upsert: true }
    );
    await refreshConversation(fake.db, AASHA);
    expect(fake.store.email_conversations.get(AASHA)).toMatchObject({
      category: 'Payment & Fee',
      ai_insight: 'Duplicate payment refund request',
    });
  });

  it('does nothing for an empty id', async () => {
    expect(await refreshConversation(fake.db, null)).toBeNull();
    expect(await refreshConversations(fake.db, [null, undefined])).toBe(0);
  });
});

describe('backfillConversationIds', () => {
  it('stamps mail stored before conversations existed', async () => {
    const fake = createFakeDb({ emails: [INBOUND, OUTBOUND] });   // no conversation_id
    const touched = await backfillConversationIds(fake.db, 100);

    expect(touched).toEqual([AASHA]);
    expect(fake.store.emails.get('m1').conversation_id).toBe(AASHA);
    expect(fake.store.emails.get('m2').conversation_id).toBe(AASHA);
  });

  it('marks ungroupable mail null so the backfill terminates', async () => {
    const fake = createFakeDb({ emails: [{ gmail_id: 'x', from_email: '', to: '', label_ids: [] }] });

    expect(await backfillConversationIds(fake.db, 100)).toEqual([]);
    expect(fake.store.emails.get('x').conversation_id).toBeNull();
    // Second pass sees nothing left to do — the field is present now.
    expect(await backfillConversationIds(fake.db, 100)).toEqual([]);
  });
});

describe('buildTranscript', () => {
  const toText = m => m.body_text || '';

  it('renders the chain oldest-first with each side labelled', () => {
    const { transcript, includedCount, omittedCount } = buildTranscript([INBOUND, OUTBOUND, FOLLOW_UP], toText);

    expect(includedCount).toBe(3);
    expect(omittedCount).toBe(0);
    expect(transcript.indexOf('do baar cut gaya')).toBeLessThan(transcript.indexOf('4471xx'));
    expect(transcript).toContain('CANDIDATE (Km Aasha)');
    expect(transcript).toContain('SUPPORT');
  });

  it('drops the OLDEST messages when the budget runs out', () => {
    // The current ask is always the newest message; an opening mail from months
    // ago is context, so it is what gets sacrificed.
    const { transcript, includedCount, omittedCount } = buildTranscript(
      [INBOUND, OUTBOUND, FOLLOW_UP], toText, { totalCharLimit: 260 }
    );

    expect(includedCount).toBeLessThan(3);
    expect(omittedCount).toBeGreaterThan(0);
    expect(transcript).toContain('4471xx');
  });

  it('keeps the newest message even when it alone blows the budget', () => {
    const { transcript, includedCount } = buildTranscript([FOLLOW_UP], toText, { totalCharLimit: 10 });
    expect(includedCount).toBe(1);
    expect(transcript).toContain('4471xx');
  });

  it('truncates a single oversized message rather than dropping it', () => {
    const huge = { ...FOLLOW_UP, body_text: 'x'.repeat(20_000) };
    const { transcript } = buildTranscript([huge], toText, { perMessageCharLimit: 500 });
    expect(transcript).toMatch(/more characters omitted/);
    expect(transcript.length).toBeLessThan(2_000);
  });
});
