const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { once } = require('events');
const { ObjectId } = require('mongodb');
const { getDb } = require('../db');
const { buildConversationFilter } = require('../lib/conversations');
const {
  normaliseSource, buildCallAnalysisFilter, buildEmailAnalysisFilter,
} = require('../lib/analysisFilters');
const logger = require('../logger');

const JOBS_COLLECTION = 'call_export_jobs';
const POLL_INTERVAL_MS = 2000;
const STALE_MINUTES = 30;
const RETENTION_HOURS = 48;

let isRunning = false;

function getExportDir() {
  return path.join(process.env.LOG_DIR || path.join(__dirname, '../../logs'), 'exports');
}

function toDayToken(value) {
  if (!value) return '';
  // A filter boundary arrives as the operator wrote it — "2026-08-01T00:00",
  // with no zone. Date would read that as local time and toISOString would then
  // shift it into UTC, so anywhere east of UTC every export was named after the
  // day BEFORE the one that was picked. The date is already the answer; take it
  // literally rather than round-tripping it through a timezone.
  const literal = String(value).match(/^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/);
  if (literal) return literal[1];

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function slugPart(value, maxLen = 28) {
  if (!value) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return cleaned;
}

function buildReadableFileName(filters = {}) {
  const from = toDayToken(filters.dateFrom) || 'all';
  const to = toDayToken(filters.dateTo) || 'today';
  const parts = ['call-report', `${from}-to-${to}`];

  const status = slugPart(filters.status, 16);
  if (status) parts.push(status);

  const agent = slugPart(filters.agentNumber, 20);
  if (agent) parts.push(`agent-${agent}`);

  return `${parts.join('-')}.csv`;
}

function formatDate(v) {
  return v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

function normalizeFilters(raw = {}) {
  const pick = k => typeof raw[k] === 'string' ? raw[k].trim() : '';
  return {
    search: pick('search'),
    status: pick('status'),
    dateFrom: pick('dateFrom'),
    dateTo: pick('dateTo'),
    agentNumber: pick('agentNumber'),
    // Analysis-specific filters
    category: pick('category'),
    callCategory: pick('callCategory'),
    bugCategory: pick('bugCategory'),
    bugsOnly: pick('bugsOnly'),
    // Conversation-specific filters. Each export type reads only the keys it
    // knows; carrying them all through one normaliser is what stops a filter
    // the operator set on screen from being silently dropped on the way to the
    // job document.
    subCategory: pick('subCategory'),
    analysisStatus: pick('analysisStatus'),
    unread: pick('unread'),
    hasAttachments: pick('hasAttachments'),
    includeTrashed: pick('includeTrashed'),
    // Which queues the AI Analysis tab was showing when the export was asked for.
    source: pick('source'),
  };
}

function buildExportFilter(filters, user) {
  const { search, status, dateFrom, dateTo, agentNumber } = normalizeFilters(filters);
  const conditions = [];

  if (user.role === 'agent') {
    conditions.push({
      $or: [
        { agent_number: user.agent_number },
        { caller_number: user.agent_number },
        { called_number: user.agent_number },
        { agent_answer_time: { $exists: false } },
        { agent_answer_time: '' },
      ],
    });
  }

  if (search) {
    conditions.push({
      $or: [
        { caller_number: { $regex: search, $options: 'i' } },
        { called_number: { $regex: search, $options: 'i' } },
        { agent_name: { $regex: search, $options: 'i' } },
        { agent_number: { $regex: search, $options: 'i' } },
      ],
    });
  }

  if (status === 'received') {
    conditions.push({ agent_answer_time: { $exists: true, $ne: '' } });
  } else if (status === 'missed') {
    conditions.push({ $or: [{ agent_answer_time: { $exists: false } }, { agent_answer_time: '' }] });
  }

  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo) dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  if (agentNumber && user.role === 'admin') {
    conditions.push({ agent_number: agentNumber });
  }

  return conditions.length > 0 ? { $and: conditions } : {};
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

async function writeLine(writable, line) {
  if (writable.write(line)) return;
  await Promise.race([
    once(writable, 'drain'),
    once(writable, 'error').then(([err]) => { throw err; }),
  ]);
}

function buildCallsPipeline(filter) {
  return [
    { $match: filter },
    { $sort: { created_at: -1 } },
    {
      $lookup: {
        from: 'agents',
        localField: 'agent_number',
        foreignField: 'agent_number',
        as: 'agent_doc',
      },
    },
    {
      $lookup: {
        from: 'call_analysis',
        let: { cid: '$call_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$call_id', '$$cid'] },
                  { $eq: ['$status', 'completed'] },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              call_category: 1,
              call_sub_category: 1,
              tags: 1,
              ai_insight: 1,
              summary: 1,
              bug_category: 1,
              bugs: 1,
              call_resolved: 1,
              agent_score: 1,
              audio_quality: 1,
              language: 1,
              transcription: 1,
            },
          },
        ],
        as: 'analysis_doc',
      },
    },
    {
      $project: {
        _id: 0,
        call_id: 1,
        caller_number: 1,
        called_number: 1,
        agent_name: 1,
        agent_number: 1,
        agent_answer_time: 1,
        call_start_time: 1,
        call_end_time: 1,
        duration: 1,
        agent_duration: 1,
        call_recording: 1,
        keypress: 1,
        created_at: 1,
        analysis: { $first: '$analysis_doc' },
        enriched_agent_name: { $first: '$agent_doc.name' },
      },
    },
  ];
}

// Split transcription into speaker-labeled lines and normalize every line break
// to \r\n so Excel and strict CSV parsers don't misinterpret bare \n inside
// a CRLF-ended file.
function formatTranscription(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\r\n?/g, '\n')                                  // normalize mixed endings
    .replace(/(CANDIDATE:|AGENT:|SYSTEM:)/g, '\n$1')          // put each speaker on its own line
    .replace(/\n{2,}/g, '\n')                                 // collapse runs
    .trim()
    .replace(/\n/g, '\r\n');                                  // emit CRLF everywhere
}

// Same idea for summary — keep paragraph breaks but use CRLF.
function normalizeMultiline(raw) {
  if (!raw) return '';
  return String(raw).replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
}

/**
 * Flatten the tag array into one cell: "Category / Sub-Category; Category / Sub".
 * Empty for sentinel records, which carry no tags by design.
 */
function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return tags
    .map(t => (t.sub_category && t.sub_category !== '-' ? `${t.category} / ${t.sub_category}` : t.category))
    .join('; ');
}

function callsToCsvRecord(doc) {
  const a = doc.analysis || {};
  return {
    'Call ID': doc.call_id || '',
    'Caller Number': doc.caller_number || '',
    'Called Number': doc.called_number || '',
    'Agent Name': doc.enriched_agent_name || doc.agent_name || '',
    'Agent Number': doc.agent_number || '',
    'Status': doc.agent_answer_time ? 'Received' : 'Missed',
    'Keypress': doc.keypress || '',
    'Call Start Time': formatDate(doc.call_start_time),
    'Answer Time': formatDate(doc.agent_answer_time),
    'Call End Time': formatDate(doc.call_end_time),
    'Duration (s)': doc.duration || 0,
    'Agent Duration (s)': doc.agent_duration || 0,
    'Call Category': a.call_category || '',
    // Prefer the structured call_sub_category from the dynamic taxonomy.
    // Old records (analyzed before v3.4) only have ai_insight — fall back so
    // historical exports remain populated until those records are re-analyzed.
    'Sub-Category': a.call_sub_category && a.call_sub_category !== '-' ? a.call_sub_category : (a.ai_insight || ''),
    // Every issue the call raised, not just the primary one. Semicolon-separated
    // so a spreadsheet keeps it in one cell but a human can still read it.
    'Tags': formatTags(a.tags),
    'AI Insight': a.ai_insight || '',
    'Summary': normalizeMultiline(a.summary),
    'Bug Category': a.bug_category || '',
    'Bug Description': a.bugs || '',
    'Call Resolved': a.call_resolved || '',
    'Agent Score': a.agent_score ?? '',
    'Audio Rating': a.audio_quality?.rating || '',
    'Language': Array.isArray(a.language) ? a.language.join(', ') : (a.language || ''),
    'Recording URL': doc.call_recording || '',
    'Transcription': formatTranscription(a.transcription),
    'Created At': formatDate(doc.created_at),
  };
}

// ─── Analysis export type ────────────────────────────────────────────────────

function buildAnalysisFilter(filters, user) {
  const { search, dateFrom, dateTo, bugsOnly, bugCategory, callCategory, category } = normalizeFilters(filters);
  const conditions = [{ status: 'completed' }];

  if (bugsOnly === '1' || bugsOnly === 'true') conditions.push({ bugs: { $exists: true, $nin: ['', '-'] } });
  if (bugCategory) conditions.push({ bug_category: bugCategory });
  if (callCategory) conditions.push({ call_category: callCategory });
  if (category) conditions.push({ category });
  if (search) {
    conditions.push({ $or: [
      { call_id:      { $regex: search, $options: 'i' } },
      { category:     { $regex: search, $options: 'i' } },
      { sub_category: { $regex: search, $options: 'i' } },
      { ai_insight:   { $regex: search, $options: 'i' } },
    ]});
  }
  if (dateFrom || dateTo) {
    const dc = {};
    if (dateFrom) dc.$gte = new Date(dateFrom);
    if (dateTo)   dc.$lte = new Date(dateTo);
    conditions.push({ created_at: dc });
  }

  // Agents can only see their own analyses
  if (user.role === 'agent' && user.agent_number) {
    // Need to join with calls first to filter by agent — done in pipeline
  }

  return { $and: conditions };
}

function buildAnalysisPipeline(filter, user) {
  const stages = [
    { $match: filter },
    { $sort: { created_at: -1 } },
    {
      $lookup: {
        from: 'calls',
        localField: 'call_id',
        foreignField: 'call_id',
        as: 'call_doc',
      },
    },
    { $addFields: { call: { $first: '$call_doc' } } },
  ];

  if (user.role === 'agent' && user.agent_number) {
    stages.push({ $match: { 'call.agent_number': user.agent_number } });
  }

  stages.push({
    $project: {
      _id: 0,
      call_id: 1,
      category: 1,
      sub_category: 1,
      tags: 1,
      ai_insight: 1,
      call_category: 1,
      bug_category: 1,
      bugs: 1,
      summary: 1,
      agent_score: 1,
      call_resolved: 1,
      audio_quality: 1,
      transcription: 1,
      language: 1,
      created_at: 1,
      caller_number: '$call.caller_number',
      agent_number: '$call.agent_number',
      duration: '$call.duration',
      call_recording: '$call.call_recording',
      call_start_time: '$call.call_start_time',
    },
  });

  return stages;
}

function analysisToCsvRecord(doc) {
  return {
    'Call ID':         doc.call_id || '',
    'Call Category':   doc.call_category || '',
    'Sub-Category':    doc.call_sub_category && doc.call_sub_category !== '-' ? doc.call_sub_category : (doc.ai_insight || ''),
    'AI Insight':      doc.ai_insight || '',
    'Gemini Category': doc.category || '',
    'Gemini Sub-Cat':  doc.sub_category || '',
    'Tags':            formatTags(doc.tags),
    'Summary':         normalizeMultiline(doc.summary),
    'Bug Category':    doc.bug_category || '',
    'Bug Description': doc.bugs || '',
    'Call Resolved':   doc.call_resolved || '',
    'Agent Score':     doc.agent_score ?? '',
    'Audio Rating':    doc.audio_quality?.rating || '',
    'Audio Issues':    doc.audio_quality?.issues || '',
    'Language':        Array.isArray(doc.language) ? doc.language.join(', ') : (doc.language || ''),
    'Caller':          doc.caller_number || '',
    'Agent Number':    doc.agent_number || '',
    'Duration (s)':    doc.duration ?? '',
    'Recording':       doc.call_recording || '',
    'Date':            formatDate(doc.call_start_time || doc.created_at),
    'Transcription':   formatTranscription(doc.transcription),
  };
}

function buildAnalysisFileName(filters = {}) {
  const from = toDayToken(filters.dateFrom) || 'all';
  const to = toDayToken(filters.dateTo) || 'today';
  const parts = ['ai-analysis', `${from}-to-${to}`];
  const cat = slugPart(filters.callCategory || filters.category, 20);
  if (cat) parts.push(cat);
  return `${parts.join('-')}.csv`;
}

// ─── Conversations export type ───────────────────────────────────────────────
//
// One row per CORRESPONDENT, which is what the Emails tab lists: a candidate
// who wrote six times about one refund is one row carrying one verdict, not six
// rows repeating it. The filter comes from lib/conversations — the same
// function the screen uses — so the CSV can never select a different set than
// the list it was exported from.

function buildConversationsPipeline(filter) {
  return [
    { $match: filter },
    { $sort: { last_message_at: -1 } },
    {
      // The rollup mirrors the headline verdict, but language and the model
      // that produced it live only on the analysis record.
      $lookup: {
        from: 'conversation_analysis',
        localField: '_id',
        foreignField: '_id',
        as: 'analysis_doc',
      },
    },
    { $addFields: { analysis: { $first: '$analysis_doc' } } },
    { $project: { analysis_doc: 0 } },
  ];
}

function conversationsToCsvRecord(doc) {
  const a = doc.analysis || {};
  return {
    'Sender Name':      doc.participant_name || '',
    'Sender Email':     doc.participant_email || doc._id || '',
    'Messages':         doc.message_count ?? '',
    'From Candidate':   doc.inbound_count ?? '',
    'From Support':     doc.outbound_count ?? '',
    'Unread':           doc.unread_count ?? 0,
    'First Message':    formatDate(doc.first_message_at),
    'Last Message':     formatDate(doc.last_message_at),
    'Latest Subject':   doc.last_subject || '',
    // Candidates start fresh threads for the same problem, so the other
    // subjects they used are worth carrying — that is the whole reason these
    // rows are keyed by person rather than by thread.
    'Other Subjects':   (doc.subjects || []).filter(sub => sub !== doc.last_subject).join('; '),
    'Category':         doc.category || '',
    'Sub-Category':     doc.sub_category && doc.sub_category !== '-' ? doc.sub_category : '',
    'Tags':             formatTags(doc.tags),
    'AI Insight':       doc.ai_insight || '',
    'Summary':          normalizeMultiline(doc.summary || a.summary),
    'Requested Action': doc.requested_action || a.requested_action || '',
    'Bug Category':     doc.bug_category || a.bug_category || '',
    'Bug Description':  doc.bugs || a.bugs || '',
    'Language':         Array.isArray(a.language) ? a.language.join(', ') : (a.language || ''),
    'Attachments':      doc.has_attachments ? 'Yes' : 'No',
    'Threads':          (doc.thread_ids || []).length,
    // "Outstanding" is not the same as "never analysed": a chain analysed last
    // week that has had a reply since is outstanding again.
    'Analysis Status':  doc.needs_analysis ? 'Outstanding' : (doc.analysis_status || a.status || ''),
    'Analysed At':      formatDate(doc.analysed_at),
    'Model':            a.model_used || '',
  };
}

function buildConversationsFileName(filters = {}) {
  const from = toDayToken(filters.dateFrom) || 'all';
  const to = toDayToken(filters.dateTo) || 'today';
  const parts = ['email-report', `${from}-to-${to}`];
  const cat = slugPart(filters.category, 24);
  if (cat) parts.push(cat);
  if (filters.unread === 'true') parts.push('unread');
  return `${parts.join('-')}.csv`;
}

/**
 * The AI Analysis tab exports what is on screen, and that tab now lists two
 * queues. Calls alone keep their own long-standing CSV (the `analysis` type
 * above) so nobody's saved column layout changes underneath them; asking for
 * mail — alone or beside the calls — produces this one instead.
 *
 * Every row is a verdict, so the columns are the union of what a verdict can
 * carry, with a Source column saying which queue produced it. The fields that
 * only one side has (an agent score, a message count) are simply blank on the
 * other, which is the honest rendering: absent, not zero.
 */
const MIXED_ANALYSIS_HEADERS = [
  'Source', 'Reference', 'Category', 'Sub-Category', 'AI Insight', 'Tags', 'Summary',
  'Bug Category', 'Bug Description', 'Requested Action',
  'Call Resolved', 'Agent Score', 'Audio Rating', 'Language',
  'Caller / Sender', 'Agent Number', 'Messages', 'Duration (s)', 'Recording', 'Date',
];

/**
 * Both filters plus the source, carried together: streamCsv hands whatever
 * buildFilter returns straight to buildPipeline, so a type that reads two
 * collections can carry two filters.
 */
function buildMixedAnalysisFilter(filters) {
  return {
    source: normaliseSource(filters?.source),
    call:   buildCallAnalysisFilter(filters),
    email:  buildEmailAnalysisFilter(filters),
  };
}

/** Which collection the pipeline starts on — the union is written from there. */
function mixedAnalysisCollection(spec) {
  return spec.source === 'emails' ? 'conversation_analysis' : 'call_analysis';
}

/** The call queue, projected into the shared row shape. */
function mixedCallStages(filter, user) {
  const stages = [
    { $match: filter },
    { $lookup: { from: 'calls', localField: 'call_id', foreignField: 'call_id', as: 'call_doc' } },
    { $addFields: { call: { $first: '$call_doc' } } },
  ];
  // Same scoping the calls-only export applies: an agent exports their own work.
  // Mail carries no agent at all — a shared mailbox is not anybody's queue — so
  // the email branch below is deliberately not scoped this way.
  if (user?.role === 'agent' && user?.agent_number) {
    stages.push({ $match: { 'call.agent_number': user.agent_number } });
  }
  stages.push({
    $project: {
      _id: 0,
      _source:      'Call',
      reference:    '$call_id',
      category:     '$call_category',
      sub_category: { $cond: [{ $in: ['$call_sub_category', [null, '', '-']] }, '$sub_category', '$call_sub_category'] },
      ai_insight:   1,
      tags:         1,
      summary:      1,
      bug_category: 1,
      bugs:         1,
      requested_action: null,
      call_resolved: 1,
      agent_score:   1,
      audio_rating:  '$audio_quality.rating',
      language:      1,
      party:         '$call.caller_number',
      agent_number:  '$call.agent_number',
      message_count: null,
      duration:      '$call.duration',
      recording:     '$call.call_recording',
      date:          { $ifNull: ['$call.call_start_time', '$created_at'] },
      sort_at:       '$created_at',
    },
  });
  return stages;
}

/** The mail queue, projected into the same shape. */
function mixedEmailStages(filter) {
  return [
    { $match: filter },
    { $lookup: { from: 'email_conversations', localField: '_id', foreignField: '_id', as: 'conv_doc' } },
    { $addFields: { conv: { $first: '$conv_doc' } } },
    {
      $project: {
        _id: 0,
        _source:      'Email',
        reference:    { $ifNull: ['$conv.participant_email', '$_id'] },
        category:     { $ifNull: ['$email_category', '$category'] },
        sub_category: { $cond: [{ $in: ['$email_sub_category', [null, '', '-']] }, '$sub_category', '$email_sub_category'] },
        ai_insight:   1,
        tags:         1,
        summary:      1,
        bug_category: 1,
        bugs:         1,
        requested_action: 1,
        call_resolved: null,
        agent_score:   null,
        audio_rating:  null,
        language:      1,
        party:         { $ifNull: ['$conv.participant_name', '$conv.participant_email'] },
        agent_number:  null,
        message_count: '$message_count',
        duration:      null,
        recording:     null,
        date:          { $ifNull: ['$conv.last_message_at', '$created_at'] },
        sort_at:       '$created_at',
      },
    },
  ];
}

function buildMixedAnalysisPipeline(spec, user) {
  if (spec.source === 'emails') {
    return [...mixedEmailStages(spec.email), { $sort: { sort_at: -1 } }];
  }
  return [
    ...mixedCallStages(spec.call, user),
    { $unionWith: { coll: 'conversation_analysis', pipeline: mixedEmailStages(spec.email) } },
    { $sort: { sort_at: -1 } },
  ];
}

function mixedAnalysisToCsvRecord(doc) {
  return {
    'Source':           doc._source || '',
    'Reference':        doc.reference || '',
    'Category':         doc.category || '',
    'Sub-Category':     doc.sub_category && doc.sub_category !== '-' ? doc.sub_category : '',
    'AI Insight':       doc.ai_insight && doc.ai_insight !== '-' ? doc.ai_insight : '',
    'Tags':             formatTags(doc.tags),
    'Summary':          normalizeMultiline(doc.summary),
    'Bug Category':     doc.bug_category && doc.bug_category !== '-' ? doc.bug_category : '',
    'Bug Description':  doc.bugs && doc.bugs !== '-' ? doc.bugs : '',
    'Requested Action': doc.requested_action || '',
    'Call Resolved':    doc.call_resolved || '',
    'Agent Score':      doc.agent_score ?? '',
    'Audio Rating':     doc.audio_rating || '',
    'Language':         Array.isArray(doc.language) ? doc.language.join(', ') : (doc.language || ''),
    'Caller / Sender':  doc.party || '',
    'Agent Number':     doc.agent_number || '',
    'Messages':         doc.message_count ?? '',
    'Duration (s)':     doc.duration ?? '',
    'Recording':        doc.recording || '',
    'Date':             formatDate(doc.date),
  };
}

function buildMixedAnalysisFileName(filters = {}) {
  const from = toDayToken(filters.dateFrom) || 'all';
  const to = toDayToken(filters.dateTo) || 'today';
  const source = normaliseSource(filters.source);
  const parts = ['ai-analysis', source === 'emails' ? 'emails' : 'calls-and-emails', `${from}-to-${to}`];
  const cat = slugPart(filters.callCategory || filters.category, 20);
  if (cat) parts.push(cat);
  return `${parts.join('-')}.csv`;
}

// ─── Export type registry ────────────────────────────────────────────────────

const EXPORT_TYPES = {
  calls: {
    collection: 'calls',
    headers: [
      'Call ID', 'Caller Number', 'Called Number', 'Agent Name', 'Agent Number', 'Status',
      'Keypress',
      'Call Start Time', 'Answer Time', 'Call End Time', 'Duration (s)', 'Agent Duration (s)',
      'Call Category', 'Sub-Category', 'Tags', 'AI Insight', 'Summary', 'Bug Category', 'Bug Description',
      'Call Resolved', 'Agent Score', 'Audio Rating', 'Language', 'Recording URL',
      'Transcription', 'Created At',
    ],
    buildFilter: buildExportFilter,
    buildPipeline: buildCallsPipeline,
    toRecord: callsToCsvRecord,
    buildFileName: buildReadableFileName,
  },
  analysis: {
    collection: 'call_analysis',
    headers: [
      'Call ID', 'Call Category', 'Sub-Category', 'AI Insight', 'Gemini Category', 'Gemini Sub-Cat',
      'Tags',
      'Summary', 'Bug Category', 'Bug Description', 'Call Resolved', 'Agent Score',
      'Audio Rating', 'Audio Issues', 'Language', 'Caller', 'Agent Number',
      'Duration (s)', 'Recording', 'Date', 'Transcription',
    ],
    buildFilter: buildAnalysisFilter,
    buildPipeline: (filter, user) => buildAnalysisPipeline(filter, user),
    toRecord: analysisToCsvRecord,
    buildFileName: buildAnalysisFileName,
  },
  analysisMixed: {
    collection: mixedAnalysisCollection,
    headers: MIXED_ANALYSIS_HEADERS,
    buildFilter: buildMixedAnalysisFilter,
    buildPipeline: buildMixedAnalysisPipeline,
    toRecord: mixedAnalysisToCsvRecord,
    buildFileName: buildMixedAnalysisFileName,
  },
  conversations: {
    collection: 'email_conversations',
    headers: [
      'Sender Name', 'Sender Email', 'Messages', 'From Candidate', 'From Support', 'Unread',
      'First Message', 'Last Message', 'Latest Subject', 'Other Subjects',
      'Category', 'Sub-Category', 'Tags', 'AI Insight', 'Summary', 'Requested Action',
      'Bug Category', 'Bug Description', 'Language', 'Attachments', 'Threads',
      'Analysis Status', 'Analysed At', 'Model',
    ],
    // Async, unlike the call builders: a free-text search has to resolve
    // message bodies to the conversations they belong to before it can filter.
    buildFilter: (filters, user, db) => buildConversationFilter(db, filters),
    buildPipeline: buildConversationsPipeline,
    toRecord: conversationsToCsvRecord,
    buildFileName: buildConversationsFileName,
  },
};

async function streamCsv({ db, type = 'calls', filters, user, writable, onProgress }) {
  const def = EXPORT_TYPES[type];
  if (!def) throw new Error(`Unknown export type: ${type}`);

  await writeLine(writable, def.headers.map(csvEscape).join(',') + '\r\n');

  // Awaited so a type may build its filter asynchronously — the conversations
  // export does, because a body search is a query of its own. The call builders
  // return plain objects and are unaffected.
  const filter = await def.buildFilter(filters, user, db);
  const pipeline = def.buildPipeline(filter, user);
  // A type that reads two collections picks its starting one from the filter —
  // the mixed analysis export begins on whichever queue it is unioning from.
  const collection = typeof def.collection === 'function' ? def.collection(filter) : def.collection;
  const cursor = db.collection(collection).aggregate(pipeline, {
    allowDiskUse: true,
    batchSize: 300,
  });

  let count = 0;
  for await (const doc of cursor) {
    const row = def.toRecord(doc);
    const line = def.headers.map(h => csvEscape(row[h])).join(',') + '\r\n';
    await writeLine(writable, line);
    count += 1;
    if (onProgress && count % 1000 === 0) await onProgress(count);
  }

  return count;
}

function sanitizeUser(user) {
  return {
    role: user?.role || 'agent',
    name: user?.name || '',
    agent_number: user?.agent_number || '',
  };
}

async function createExportJob({ filters, user, type = 'calls' }) {
  if (!EXPORT_TYPES[type]) throw new Error(`Unknown export type: ${type}`);
  const db = await getDb();
  const now = new Date();
  const doc = {
    status: 'pending',
    export_type: type,
    filters: normalizeFilters(filters),
    requested_by: sanitizeUser(user),
    rows_processed: 0,
    file_name: null,
    file_path: null,
    file_size: null,
    error: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  };
  const result = await db.collection(JOBS_COLLECTION).insertOne(doc);
  logger.info('[ExportWorker] Job queued', { job_id: result.insertedId.toString(), type, user: doc.requested_by });
  return result.insertedId.toString();
}

async function getExportJob(jobId) {
  if (!ObjectId.isValid(jobId)) return null;
  const db = await getDb();
  return db.collection(JOBS_COLLECTION).findOne({ _id: new ObjectId(jobId) });
}

async function resetStaleJobs(db) {
  const threshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
  const result = await db.collection(JOBS_COLLECTION).updateMany(
    { status: 'processing', updated_at: { $lt: threshold } },
    { $set: { status: 'failed', error: 'Job timed out and was reset', finished_at: new Date(), updated_at: new Date() } }
  );
  if (result.modifiedCount > 0) {
    logger.warn('[ExportWorker] Reset stale jobs', { count: result.modifiedCount });
  }
}

async function cleanupOldJobs(db) {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  const oldJobs = await db.collection(JOBS_COLLECTION)
    .find({ status: { $in: ['completed', 'failed'] }, created_at: { $lt: cutoff } })
    .limit(100)
    .toArray();

  if (oldJobs.length === 0) return;

  for (const job of oldJobs) {
    if (job.file_path) {
      try { await fsp.unlink(job.file_path); } catch {}
    }
  }

  await db.collection(JOBS_COLLECTION).deleteMany({ _id: { $in: oldJobs.map(j => j._id) } });
  logger.info('[ExportWorker] Cleaned old jobs', { deleted: oldJobs.length });
}

async function processOneJob() {
  if (isRunning) return;
  let db;
  try {
    db = await getDb();
  } catch (err) {
    logger.error('[ExportWorker] DB connection error', { message: err.message });
    return;
  }

  await resetStaleJobs(db);
  await cleanupOldJobs(db);

  const job = await db.collection(JOBS_COLLECTION).findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'processing', started_at: new Date(), updated_at: new Date(), error: null } },
    { sort: { created_at: 1 }, returnDocument: 'after' }
  );

  if (!job) return;

  isRunning = true;
  const jobId = job._id.toString();
  const exportType = job.export_type || 'calls';
  const typeDef = EXPORT_TYPES[exportType];
  const exportDir = getExportDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const diskFileName = `${exportType}-${stamp}-${jobId}.csv`;
  const downloadFileName = typeDef
    ? typeDef.buildFileName(job.filters || {})
    : `${exportType}-${stamp}.csv`;
  const filePath = path.join(exportDir, diskFileName);
  let stream;

  logger.info('[ExportWorker] Processing job', { job_id: jobId, type: exportType });

  try {
    await fsp.mkdir(exportDir, { recursive: true });
    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    stream.on('error', (err) => logger.error('[ExportWorker] Stream error', { job_id: jobId, message: err.message }));

    const rowCount = await streamCsv({
      db,
      type: exportType,
      filters: job.filters || {},
      user: job.requested_by || {},
      writable: stream,
      onProgress: async (rows) => {
        await db.collection(JOBS_COLLECTION).updateOne(
          { _id: job._id },
          { $set: { rows_processed: rows, updated_at: new Date() } }
        );
      },
    });

    stream.end();
    await once(stream, 'finish');
    const stat = await fsp.stat(filePath);

    await db.collection(JOBS_COLLECTION).updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'completed',
          rows_processed: rowCount,
          file_name: downloadFileName,
          file_path: filePath,
          file_size: stat.size,
          finished_at: new Date(),
          updated_at: new Date(),
        },
      }
    );
    logger.info('[ExportWorker] Job completed', { job_id: jobId, rows: rowCount, size: stat.size });
  } catch (err) {
    if (stream) stream.destroy();
    try { await fsp.unlink(filePath); } catch {}
    await db.collection(JOBS_COLLECTION).updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          error: err.message,
          finished_at: new Date(),
          updated_at: new Date(),
        },
      }
    );
    logger.error('[ExportWorker] Job failed', { job_id: jobId, message: err.message, stack: err.stack });
  } finally {
    isRunning = false;
  }
}

function startExportWorker() {
  logger.info('[ExportWorker] Started', { pollIntervalSec: POLL_INTERVAL_MS / 1000 });
  processOneJob();
  setInterval(processOneJob, POLL_INTERVAL_MS);
}

module.exports = {
  startExportWorker,
  createExportJob,
  getExportJob,
  streamCsv,
  EXPORT_TYPES,
};
