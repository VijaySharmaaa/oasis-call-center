/**
 * The filters behind the AI Analysis tab — for both queues, in one place.
 *
 * Recordings and mail are analysed by different workers into different
 * collections, but the VERDICT has the same shape either way: a category, tags,
 * an insight, a bug. The tab therefore lists them together, and the same
 * question asked on screen has to reach both collections identically — a CSV
 * that disagrees with the screen it was exported from is worse than no CSV,
 * which is exactly why lib/conversations.js owns the mailbox filter too.
 *
 * The two differ in only two places, both named below: the field holding the
 * primary category, and which fields a free-text search looks at.
 */
const { tagMatch } = require('./tags');

/** Which queues a request wants read. */
const SOURCES = new Set(['all', 'calls', 'emails']);

/** Anything unrecognised — a stale bookmark, a typo — reads everything. */
function normaliseSource(value) {
  return SOURCES.has(value) ? value : 'all';
}

/**
 * Accepts every shape the two callers send. The list route passes the raw query
 * string value ('1'), the export passes the stored filter ('1' or 'true'), and
 * an unchecked toggle arrives as '' or absent.
 */
function isOn(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

const CALL_SEARCH_FIELDS = [
  'call_id', 'category', 'sub_category', 'tags.category', 'tags.sub_category', 'ai_insight',
];

// The correspondent's address is the conversation's id, and it is the thing an
// operator searches by — the email equivalent of typing a call id.
const EMAIL_SEARCH_FIELDS = [
  'conversation_id', 'category', 'sub_category', 'tags.category', 'tags.sub_category',
  'ai_insight', 'summary',
];

/** The conditions that mean the same thing for a call and for a correspondence. */
function commonAnalysisConditions(filters = {}, searchFields) {
  const { search, category, bugsOnly, bugCategory, dateFrom, dateTo } = filters;
  const conditions = [{ status: 'completed' }];

  if (isOn(bugsOnly)) conditions.push({ bugs: { $exists: true, $nin: ['', '-'] } });
  if (bugCategory)    conditions.push({ bug_category: bugCategory });
  // Matches the category on ANY tag, so a record whose second issue was Billing
  // is found by a Billing filter. Sentinels are never tagged, so they keep
  // matching through the scalar arm of tagMatch.
  if (category)       conditions.push(tagMatch(category));
  if (search) {
    conditions.push({ $or: searchFields.map(field => ({ [field]: { $regex: search, $options: 'i' } })) });
  }
  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }
  return conditions;
}

/** @returns {object} a Mongo filter over `call_analysis` */
function buildCallAnalysisFilter(filters = {}) {
  const conditions = commonAnalysisConditions(filters, CALL_SEARCH_FIELDS);
  if (filters.callCategory) conditions.push({ call_category: filters.callCategory });
  return { $and: conditions };
}

/**
 * @returns {object} a Mongo filter over `conversation_analysis`
 *
 * `callCategory` lands on `email_category` rather than getting a parameter of
 * its own: mail is categorised from the same taxonomy the calls use, so one
 * dropdown drives both and only the field name differs.
 */
function buildEmailAnalysisFilter(filters = {}) {
  const conditions = commonAnalysisConditions(filters, EMAIL_SEARCH_FIELDS);
  if (filters.callCategory) conditions.push({ email_category: filters.callCategory });
  return { $and: conditions };
}

module.exports = {
  SOURCES,
  normaliseSource,
  commonAnalysisConditions,
  buildCallAnalysisFilter,
  buildEmailAnalysisFilter,
  CALL_SEARCH_FIELDS,
  EMAIL_SEARCH_FIELDS,
};
