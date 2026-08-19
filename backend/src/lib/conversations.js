/**
 * Conversations — the mailbox seen as people rather than as messages.
 *
 * A support mailbox does not receive isolated emails; it receives candidates,
 * each of whom writes, replies, forwards, and writes again — often starting a
 * brand-new thread for a question they already asked. Treating every message as
 * its own item made the Emails tab a list of fragments: the same candidate
 * appeared five times, each row analysed as if the other four did not exist.
 *
 * A CONVERSATION is therefore keyed by the correspondent, not by Gmail's
 * threadId. One candidate = one row = one AI verdict, however many threads they
 * spread their problem across. Thread ids are still recorded on the
 * conversation, because they are what Gmail groups by and what the reply
 * detection in reportData.js reads.
 *
 * The rollup document in `email_conversations` is derived state: every field on
 * it can be recomputed from the `emails` collection by refreshConversation(),
 * which is exactly what happens whenever mail arrives, labels change, or an
 * operator marks something read. Nothing here is a source of truth, so a
 * conversation that drifts is fixed by recomputing rather than by migrating.
 */
const { tagMatch } = require('./tags');
const logger = require('../logger');

/** Subjects kept on the rollup — enough to search by, not a full archive. */
const MAX_SUBJECTS = 8;

/** How many conversations refreshMany() recomputes at once. */
const REFRESH_CONCURRENCY = 8;

function ts(value) {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Every address that means "us". Anything else on a message is the
 * correspondent. Aliases matter because a shared mailbox is routinely written
 * to at more than one address (support@, help@) and a reply sent from an alias
 * must not open a conversation with ourselves.
 */
function ourAddresses() {
  return new Set(
    [process.env.GMAIL_USER, ...String(process.env.GMAIL_ALIASES || '').split(',')]
      .map(a => String(a || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Split a header value into individual addresses.
 *
 * Written as a scanner rather than a split on commas because a display name may
 * legally contain one: `"Doe, John" <j@x.com>, b@y.com` is two recipients, and
 * every regex that gets this wrong gets it wrong silently.
 */
function splitAddressList(value) {
  if (!value) return [];
  const out = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const ch of String(value)) {
    if (ch === '"') { inQuotes = !inQuotes; current += ch; continue; }
    if (ch === '<') { inAngle = true;  current += ch; continue; }
    if (ch === '>') { inAngle = false; current += ch; continue; }
    if (ch === ',' && !inQuotes && !inAngle) {
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * `Name <a@b.com>` → { name, email }. A local copy of gmailService's parser
 * rather than an import: this module is pulled in by routes and workers whose
 * tests mock gmailService wholesale, and a lib that breaks because someone
 * else's mock is incomplete is a lib nobody can use.
 */
function parseOneAddress(value) {
  if (!value) return { name: '', email: '' };
  const angled = String(value).match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    return { name: angled[1].replace(/^["']|["']$/g, '').trim(), email: angled[2].trim().toLowerCase() };
  }
  return { name: '', email: String(value).trim().toLowerCase() };
}

/** Did we send this, or did the candidate? Drives which side of the chat it sits on. */
function isOutbound(email = {}) {
  if ((email.label_ids || []).includes('SENT')) return true;
  const from = String(email.from_email || '').trim().toLowerCase();
  return !!from && ourAddresses().has(from);
}

/**
 * isOutbound(), written as a query rather than as a predicate.
 *
 * Counting "how many replies did we send" happens in the database, over mail no
 * one has loaded into memory. Deriving both forms from the same two rules —
 * the SENT label, or a From address that is one of ours — is what stops a
 * dashboard total from disagreeing with the side of the chat a message sits on.
 *
 * With no mailbox configured `ourAddresses()` is empty, and both forms fall back
 * to the SENT label alone, which is still correct as far as it goes.
 */
function outboundFilter() {
  const ours = [...ourAddresses()];
  return ours.length
    ? { $or: [{ label_ids: 'SENT' }, { from_email: { $in: ours } }] }
    : { label_ids: 'SENT' };
}

/** Its complement, by De Morgan — mail we did not send is mail we received. */
function inboundFilter() {
  const ours = [...ourAddresses()];
  return {
    label_ids: { $ne: 'SENT' },
    ...(ours.length ? { from_email: { $nin: ours } } : {}),
  };
}

/**
 * The correspondent a message belongs to: the sender for mail we received, the
 * recipient for mail we sent. Returns null only when the message carries no
 * usable address at all, which is the one case that cannot be grouped.
 *
 * @returns {{email: string, name: string}|null}
 */
function participantOf(email = {}) {
  if (!isOutbound(email)) {
    const addr = String(email.from_email || '').trim().toLowerCase();
    return addr ? { email: addr, name: email.from_name || '' } : null;
  }

  const ours = ourAddresses();
  for (const field of ['to', 'cc']) {
    for (const raw of splitAddressList(email[field])) {
      const parsed = parseOneAddress(raw);
      if (parsed.email && !ours.has(parsed.email)) return parsed;
    }
  }

  // A reply with no external recipient (a note to the mailbox itself) still has
  // to live somewhere; filing it under the sender keeps it visible.
  const self = String(email.from_email || '').trim().toLowerCase();
  return self ? { email: self, name: email.from_name || '' } : null;
}

/** The conversation key for a message — the correspondent's address. */
function conversationIdOf(email = {}) {
  return participantOf(email)?.email || null;
}

// ─── Rollups ──────────────────────────────────────────────────────────────────

/**
 * Recompute one conversation from its messages and write it back.
 *
 * `needs_analysis` is stored rather than derived at query time because both the
 * worker's sweep and the coverage stat need to ask for it in a plain filter,
 * and comparing two fields of the same document is not something a plain filter
 * can do. It flips true whenever ANY message lands after the point the last
 * analysis covered — which is precisely "there is new context to re-read".
 *
 * Any message, in either direction. Our own reply changes the verdict as surely
 * as a candidate's follow-up does: the prompt reads SUPPORT messages as what
 * has already been answered, and an issue we have since resolved is no longer
 * the live one. A chain re-read after we answer says so; one re-read only on
 * inbound mail keeps reporting a problem that was fixed an hour ago.
 *
 * It still takes at least one inbound message to qualify. A chain we opened and
 * the candidate never answered has nothing from them to judge, and analysing it
 * would spend a call to be told so.
 *
 * @returns {Promise<object|null>} the rollup, or null when nothing is left
 */
async function refreshConversation(db, conversationId) {
  if (!conversationId) return null;
  const col = db.collection('email_conversations');

  const messages = await db.collection('emails')
    .find({ conversation_id: conversationId, is_deleted: { $ne: true } })
    .toArray();

  // Every message gone (deleted in Gmail) — the person is no longer in the
  // mailbox, so neither is their row, nor the queue entry that pointed at it.
  // Leaving the analysis record behind would keep counting towards the queue
  // health figures for a conversation nobody can open.
  if (!messages.length) {
    await col.deleteOne({ _id: conversationId });
    await db.collection('conversation_analysis').deleteOne({ _id: conversationId });
    return null;
  }

  messages.sort((a, b) => ts(a.received_at) - ts(b.received_at));

  const inbound  = messages.filter(m => !isOutbound(m));
  const outbound = messages.filter(m =>  isOutbound(m));
  const last        = messages[messages.length - 1];
  const lastInbound = inbound[inbound.length - 1] || null;

  // The most recent message that actually carried a display name — candidates
  // often write from a client that sends the name only sometimes.
  const named = [...messages].reverse().find(m => participantOf(m)?.name);
  const subjects = [];
  for (const m of [...messages].reverse()) {
    const subject = (m.subject || '').trim();
    if (subject && !subjects.includes(subject)) subjects.push(subject);
    if (subjects.length >= MAX_SUBJECTS) break;
  }

  const existing     = await col.findOne({ _id: conversationId });
  const lastInboundAt = lastInbound?.received_at || null;
  const analysedUpto  = existing?.analysed_upto || null;

  const rollup = {
    participant_email: conversationId,
    participant_name:  (named ? participantOf(named).name : '') || existing?.participant_name || '',
    mailbox:           last.mailbox || existing?.mailbox || null,

    thread_ids: [...new Set(messages.map(m => m.thread_id).filter(Boolean))],
    subjects,
    last_subject: last.subject || '',
    last_snippet: last.snippet || '',
    // The chat's own preview: what the candidate last said, which is what an
    // operator is deciding whether to open.
    last_inbound_snippet: lastInbound?.snippet || '',
    last_inbound_id:      lastInbound?.gmail_id || null,
    last_message_id:      last.gmail_id,

    message_count:  messages.length,
    inbound_count:  inbound.length,
    outbound_count: outbound.length,

    first_message_at: messages[0].received_at,
    last_message_at:  last.received_at,
    last_inbound_at:  lastInboundAt,

    unread_count:    messages.filter(m => m.is_unread && !m.read_at).length,
    has_attachments: messages.some(m => m.has_attachments),
    // A conversation drops out of the inbox only when ALL of it has — one
    // trashed message out of six is not a trashed candidate.
    is_trashed: messages.every(m => m.is_trashed),
    is_spam:    messages.every(m => m.is_spam),

    needs_analysis: !!lastInboundAt && (!analysedUpto || ts(last.received_at) > ts(analysedUpto)),
    updated_at: new Date(),
  };

  await col.updateOne(
    { _id: conversationId },
    { $set: rollup, $setOnInsert: { created_at: new Date() } },
    { upsert: true }
  );

  return { _id: conversationId, ...existing, ...rollup };
}

/** Recompute several conversations with a bounded pool. Ids may repeat. */
async function refreshConversations(db, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return 0;

  let cursor = 0;
  async function drain() {
    while (cursor < unique.length) {
      const id = unique[cursor++];
      try {
        await refreshConversation(db, id);
      } catch (err) {
        logger.warn('[Conversations] Refresh failed', { conversation_id: id, message: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, unique.length) }, drain));
  return unique.length;
}

/**
 * Stamp `conversation_id` onto stored mail that predates conversations, a
 * bounded batch at a time so a backfilled mailbox drains steadily.
 *
 * @returns {Promise<string[]>} the conversation ids touched, for the caller to refresh
 */
async function backfillConversationIds(db, limit = 500) {
  const pending = await db.collection('emails')
    .find(
      { conversation_id: { $exists: false }, is_deleted: { $ne: true } },
      { projection: { gmail_id: 1, from_email: 1, from_name: 1, to: 1, cc: 1, label_ids: 1 } }
    )
    .limit(limit)
    .toArray();

  if (!pending.length) return [];

  const ops = [];
  const touched = new Set();
  for (const doc of pending) {
    const id = conversationIdOf(doc);
    // A message with no address at all cannot be grouped. Marking it null
    // rather than leaving the field absent keeps it out of every later batch,
    // so the backfill terminates instead of re-reading it forever.
    ops.push({ updateOne: { filter: { gmail_id: doc.gmail_id }, update: { $set: { conversation_id: id } } } });
    if (id) touched.add(id);
  }

  await db.collection('emails').bulkWrite(ops, { ordered: false });
  logger.info('[Conversations] Backfilled conversation ids', { messages: pending.length, conversations: touched.size });
  return [...touched];
}

// ─── Querying ─────────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Conversations whose MESSAGES match a free-text search.
 *
 * Bodies live on `emails`, not on the rollup, so a body search resolves to the
 * set of correspondents those messages belong to. `distinct` rather than a
 * capped find: the scan is the same either way, and capping it would make the
 * CSV export quietly disagree with the screen it was exported from.
 *
 * @returns {Promise<string[]>} conversation ids, possibly empty
 */
async function conversationIdsMatchingText(db, search) {
  if (!search) return [];
  const re = { $regex: escapeRegex(search), $options: 'i' };
  const ids = await db.collection('emails').distinct('conversation_id', {
    $or: [{ body_text: re }, { subject: re }, { snippet: re }],
    is_deleted: { $ne: true },
  });
  return ids.filter(Boolean);
}

/**
 * analysisStatus values that name a row in the analysis queue rather than a
 * field on the conversation itself. Kept as a map so the route, the export and
 * the dropdown cannot drift into three different vocabularies.
 */
const QUEUE_FILTER_STATUS = {
  queued:     'pending',
  processing: 'processing',
  failed:     'failed',
};

/**
 * The filter behind every list of conversations — the Emails tab and the CSV
 * export both, which is the point of it living here. A CSV that disagrees with
 * the screen it was exported from is worse than no CSV.
 *
 * @param {object} db
 * @param {object} query  the request's query/body: search, unread, replied,
 *                        hasAttachments, category, subCategory, analysisStatus,
 *                        includeTrashed, dateFrom, dateTo
 * @returns {Promise<object>} a Mongo filter over `email_conversations`
 */
async function buildConversationFilter(db, query = {}) {
  const {
    search, unread, replied, hasAttachments, includeTrashed, dateFrom, dateTo,
    category, subCategory, analysisStatus,
  } = query;

  const conditions = [];

  // A conversation is trashed only when every message in it is, so this hides
  // the chains that have genuinely left the mailbox rather than the ones with
  // a single tidied-away message.
  if (String(includeTrashed) !== 'true') conditions.push({ is_trashed: { $ne: true } });
  if (unread === 'true')  conditions.push({ unread_count: { $gt: 0 } });
  if (unread === 'false') conditions.push({ unread_count: { $lte: 0 } });

  // "Replied" is measured over the whole chain, not over the last message: a
  // candidate who was answered last week and has written again since has been
  // replied to, and is still waiting. The two questions are separate filters
  // precisely so an operator can ask for both at once.
  //
  // outbound_count is absent on rollups written before it existed, so the
  // not-replied side is a $not on the positive test rather than `{$lte: 0}` —
  // which a missing field would fail.
  if (replied === 'true')  conditions.push({ outbound_count: { $gt: 0 } });
  if (replied === 'false') conditions.push({ outbound_count: { $not: { $gt: 0 } } });

  if (String(hasAttachments) === 'true') conditions.push({ has_attachments: true });

  // Same rules as the message list: a category matches on ANY tag, and
  // "Uncategorised" is the sentinel that must also catch what the worker has
  // not reached yet.
  if (category === 'Uncategorised') {
    conditions.push({ $or: [{ category: { $exists: false } }, { category: '' }, { category: 'Uncategorised' }] });
  } else if (category || subCategory) {
    conditions.push(tagMatch(category, subCategory));
  }
  // Two different questions wear the same dropdown. `analysed`/`unanalysed` ask
  // whether a verdict was ever produced; `awaiting` and the queue states ask
  // where the chain stands right now — a chain analysed last week that has had
  // a reply since is analysed AND awaiting, and both answers are useful.
  if (analysisStatus === 'analysed')   conditions.push({ analysed_at: { $exists: true } });
  if (analysisStatus === 'unanalysed') conditions.push({ analysed_at: { $exists: false } });
  if (analysisStatus === 'awaiting')   conditions.push({ needs_analysis: true });

  // Queue state lives on conversation_analysis, so it resolves to a set of ids.
  // Bounded in practice: these are the jobs outstanding, not the archive. An
  // empty result yields `{$in: []}`, which matches nothing — the correct answer
  // to "show me the queued ones" when none are queued.
  const queueStatus = QUEUE_FILTER_STATUS[analysisStatus];
  if (queueStatus) {
    const ids = await db.collection('conversation_analysis').distinct('_id', { status: queueStatus });
    conditions.push({ _id: { $in: ids } });
  }

  if (dateFrom || dateTo) {
    const range = {};
    if (dateFrom) range.$gte = new Date(dateFrom);
    if (dateTo)   range.$lte = new Date(dateTo);
    // Ranged on the last message: a chain is "active in this window" if
    // anything was said in it, which is what a date filter means to an operator
    // triaging today's work.
    conditions.push({ last_message_at: range });
  }

  if (search) {
    const re = { $regex: escapeRegex(search), $options: 'i' };
    const ids = await conversationIdsMatchingText(db, search);
    conditions.push({ $or: [
      { participant_email: re },
      { participant_name:  re },
      { last_subject:      re },
      { subjects:          re },
      { ai_insight:        re },
      { summary:           re },
      ...(ids.length ? [{ _id: { $in: ids } }] : []),
    ]});
  }

  return conditions.length ? { $and: conditions } : {};
}

// ─── Transcript ───────────────────────────────────────────────────────────────

/**
 * Render a conversation as a chat transcript for the model.
 *
 * Newest-last, so the model reads the exchange in the order it happened and
 * ends on the message that triggered this analysis. When the budget cannot fit
 * everything, the OLDEST messages are dropped: the current ask is always the
 * most recent one, and an opening mail from four months ago is context, not the
 * question.
 *
 * @param {Array<object>} messages       chronological, oldest first
 * @param {(email: object) => string} toText  body extractor (geminiService's)
 * @param {{totalCharLimit?: number, perMessageCharLimit?: number}} [opts]
 * @returns {{transcript: string, includedCount: number, omittedCount: number, totalChars: number}}
 */
function buildTranscript(messages, toText, { totalCharLimit = 24_000, perMessageCharLimit = 6_000 } = {}) {
  const rendered = [];
  let used = 0;
  let omitted = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const who = isOutbound(m)
      ? 'SUPPORT'
      : `CANDIDATE${m.from_name ? ` (${m.from_name})` : ''}`;

    let body = toText(m) || '(no text)';
    if (body.length > perMessageCharLimit) {
      body = `${body.slice(0, perMessageCharLimit)}\n[… ${body.length - perMessageCharLimit} more characters omitted]`;
    }
    const attachments = (m.attachments || []).map(a => a.filename).filter(Boolean);

    const block = [
      `--- Message ${i + 1} of ${messages.length} · ${who}`,
      `Date: ${m.received_at ? new Date(m.received_at).toISOString() : '(unknown)'}`,
      `Subject: ${m.subject || '(no subject)'}`,
      attachments.length ? `Attachments: ${attachments.join(', ')}` : null,
      '',
      body,
    ].filter(v => v !== null).join('\n');

    // Always keep the newest message, however long it is — a transcript that
    // omits the current ask answers the wrong question.
    if (rendered.length && used + block.length > totalCharLimit) {
      omitted = i + 1;
      break;
    }
    rendered.unshift(block);
    used += block.length;
  }

  return {
    transcript: rendered.join('\n\n'),
    includedCount: rendered.length,
    omittedCount: omitted,
    totalChars: used,
  };
}

module.exports = {
  ourAddresses,
  splitAddressList,
  parseOneAddress,
  isOutbound,
  outboundFilter,
  inboundFilter,
  participantOf,
  conversationIdOf,
  refreshConversation,
  refreshConversations,
  backfillConversationIds,
  conversationIdsMatchingText,
  buildConversationFilter,
  QUEUE_FILTER_STATUS,
  buildTranscript,
  MAX_SUBJECTS,
};
