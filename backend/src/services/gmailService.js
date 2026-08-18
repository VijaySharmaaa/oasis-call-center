/**
 * Gmail Service — read access to the support mailbox via the Gmail REST API.
 *
 * Talks to the REST endpoints directly with global fetch + node:crypto, so no
 * googleapis SDK is needed (that package pulls ~50 MB of transitive deps for
 * three endpoints).
 *
 * TWO AUTH MODES, auto-detected from env:
 *
 *   1. Service account + domain-wide delegation (preferred for a shared inbox).
 *      Set GOOGLE_SERVICE_ACCOUNT_KEY (or _FILE) + GMAIL_USER. The service
 *      account impersonates GMAIL_USER, so no refresh token can expire and
 *      nobody has to sign in. REQUIRES a Workspace super-admin to authorise the
 *      key's client_id for the Gmail scope in Admin Console → Security →
 *      API controls → Domain-wide delegation. Without that step Google returns
 *      401 "unauthorized_client" on the token exchange.
 *
 *   2. OAuth2 refresh token (fallback when delegation cannot be granted).
 *      Set GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET +
 *      GMAIL_OAUTH_REFRESH_TOKEN, obtained once by consenting as the mailbox
 *      owner. Google expires refresh tokens for apps left in "Testing"
 *      publishing status after 7 days — publish the consent screen.
 *
 * Mode 1 wins if both are configured. Scope is read-only in both cases: this
 * service can list and read mail, never send, modify, or delete it.
 */
const fs     = require('fs');
const crypto = require('crypto');
const logger = require('../logger');

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Bodies are stored in Mongo, which caps a document at 16 MB. A single
// marketing email with inlined CSS can be megabytes of HTML, so truncate.
const MAX_BODY_CHARS = Math.max(1000, Number(process.env.GMAIL_MAX_BODY_CHARS || 200_000));

// ─── Credentials ──────────────────────────────────────────────────────────────

let cachedKey;  // undefined = not yet resolved, null = not configured

/**
 * Service-account JSON from GOOGLE_SERVICE_ACCOUNT_KEY (raw JSON *or* base64 —
 * base64 is far easier to put on one line in a .env file) or from the file at
 * GOOGLE_SERVICE_ACCOUNT_KEY_FILE.
 */
function serviceAccountKey() {
  if (cachedKey !== undefined) return cachedKey;

  const inline   = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').trim();
  const filePath = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '').trim();

  let raw = null;
  if (inline) {
    raw = inline;
  } else if (filePath) {
    try {
      raw = fs.readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      logger.error('[Gmail] Cannot read GOOGLE_SERVICE_ACCOUNT_KEY_FILE', { filePath, message: err.message });
      cachedKey = null;
      return cachedKey;
    }
  }

  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }

  try {
    // Anything not starting with "{" is assumed base64-encoded JSON.
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const key  = JSON.parse(json);
    if (!key.client_email || !key.private_key) throw new Error('missing client_email / private_key');
    cachedKey = key;
  } catch (err) {
    logger.error('[Gmail] Service account key is not valid JSON', { message: err.message });
    cachedKey = null;
  }
  return cachedKey;
}

/** The mailbox to read. Every API path uses this as the userId. */
function mailbox() {
  return (process.env.GMAIL_USER || '').trim();
}

/** Which auth mode is usable, or null when nothing is configured. */
function authMode() {
  if (serviceAccountKey() && mailbox()) return 'service_account';
  if (process.env.GMAIL_OAUTH_CLIENT_ID && process.env.GMAIL_OAUTH_CLIENT_SECRET && process.env.GMAIL_OAUTH_REFRESH_TOKEN) {
    return 'oauth';
  }
  return null;
}

/** True when the service has enough config to attempt a call. */
function isConfigured() {
  return authMode() !== null;
}

// ─── Access tokens ────────────────────────────────────────────────────────────

let tokenCache = null;      // { token, expiresAt }
let tokenInFlight = null;   // dedupes concurrent refreshes

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function postForm(url, params) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Token request failed (${res.status}): ${text.slice(0, 400)}`);
    err.status = res.status;
    // 400/401 here are config problems (bad key, delegation not granted) —
    // retrying cannot fix them, so the worker should not spin on it.
    err.retryable = res.status >= 500 || res.status === 429;
    throw err;
  }
  return JSON.parse(text);
}

/** Signed JWT assertion → access token, impersonating GMAIL_USER. */
async function serviceAccountToken() {
  const key = serviceAccountKey();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT', kid: key.private_key_id };
  const claims = {
    iss:   key.client_email,
    sub:   mailbox(),          // the impersonated user — this is the delegation
    scope: SCOPE,
    aud:   key.token_uri || OAUTH_TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature    = crypto.createSign('RSA-SHA256').update(signingInput).sign(key.private_key);

  try {
    const body = await postForm(key.token_uri || OAUTH_TOKEN_URL, {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  `${signingInput}.${b64url(signature)}`,
    });
    return body;
  } catch (err) {
    if (/unauthorized_client/.test(err.message)) {
      err.message = `Domain-wide delegation is not authorised for ${mailbox()}. ` +
        `A Workspace super-admin must add client_id ${key.client_id} with scope ${SCOPE} ` +
        `under Admin Console → Security → API controls → Domain-wide delegation. (${err.message})`;
    }
    throw err;
  }
}

async function oauthToken() {
  return postForm(OAUTH_TOKEN_URL, {
    grant_type:    'refresh_token',
    client_id:     process.env.GMAIL_OAUTH_CLIENT_ID,
    client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN,
  });
}

async function getAccessToken({ force = false } = {}) {
  const mode = authMode();
  if (!mode) throw new Error('Gmail is not configured — set GMAIL_USER + GOOGLE_SERVICE_ACCOUNT_KEY, or the GMAIL_OAUTH_* trio');

  // Refresh a minute early so a token never expires mid-request.
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = (async () => {
    const body = mode === 'service_account' ? await serviceAccountToken() : await oauthToken();
    tokenCache = {
      token:     body.access_token,
      expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    };
    logger.debug('[Gmail] Access token refreshed', { mode, expiresInSec: body.expires_in });
    return tokenCache.token;
  })().finally(() => { tokenInFlight = null; });

  return tokenInFlight;
}

// ─── API plumbing ─────────────────────────────────────────────────────────────

function userPath(suffix) {
  // OAuth mode authenticates *as* the mailbox owner, so "me" is correct there.
  const userId = authMode() === 'service_account' ? mailbox() : 'me';
  return `${GMAIL_API}/users/${encodeURIComponent(userId)}${suffix}`;
}

/**
 * One Gmail API GET. Refreshes the token once on 401, and surfaces
 * 429/5xx as retryable so the worker can back off instead of giving up.
 */
async function apiGet(path, params = {}, { retried = false } = {}) {
  const token = await getAccessToken();
  const url   = new URL(userPath(path));
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
    else url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401 && !retried) {
    tokenCache = null;
    return apiGet(path, params, { retried: true });
  }

  if (!res.ok) {
    const text = await res.text();
    const err  = new Error(`Gmail API ${path} failed (${res.status}): ${text.slice(0, 400)}`);
    err.status    = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }

  return res.json();
}

// ─── Message parsing ──────────────────────────────────────────────────────────

function decodeBody(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** "Name <a@b.com>" → { name, email }. Bare addresses come back with name: ''. */
function parseAddress(value) {
  if (!value) return { name: '', email: '' };
  const angled = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    return {
      name:  angled[1].replace(/^["']|["']$/g, '').trim(),
      email: angled[2].trim().toLowerCase(),
    };
  }
  return { name: '', email: value.trim().toLowerCase() };
}

/**
 * Depth-first walk of the MIME tree, collecting the first text/plain and
 * text/html parts plus every attachment. Gmail nests parts arbitrarily deep
 * (multipart/mixed → multipart/alternative → text/*), so recursion is required
 * rather than a single pass over payload.parts.
 */
function walkParts(part, out) {
  if (!part) return;
  const mime     = (part.mimeType || '').toLowerCase();
  const filename = part.filename || '';

  if (Array.isArray(part.parts) && part.parts.length) {
    for (const child of part.parts) walkParts(child, out);
  }

  if (filename && part.body?.attachmentId) {
    out.attachments.push({
      attachment_id: part.body.attachmentId,
      filename,
      mime_type:     part.mimeType || 'application/octet-stream',
      size:          part.body.size || 0,
    });
    return;
  }

  if (!part.body?.data) return;
  if (mime === 'text/plain' && !out.text) out.text = decodeBody(part.body.data);
  else if (mime === 'text/html' && !out.html) out.html = decodeBody(part.body.data);
}

function truncate(str) {
  if (!str) return '';
  return str.length > MAX_BODY_CHARS ? `${str.slice(0, MAX_BODY_CHARS)}\n\n[… truncated by Oasis at ${MAX_BODY_CHARS} characters]` : str;
}

/** Raw Gmail message resource → the document shape stored in `emails`. */
function parseMessage(msg) {
  const headers = {};
  for (const h of msg.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;

  const body = { text: '', html: '', attachments: [] };
  walkParts(msg.payload, body);

  const from      = parseAddress(headers.from);
  const labelIds  = msg.labelIds || [];
  // internalDate is Gmail's own receive timestamp (ms, string). The Date header
  // is sender-supplied and can be wrong or missing, so it is only a fallback.
  const receivedMs = Number(msg.internalDate) || (headers.date ? Date.parse(headers.date) : NaN);

  return {
    gmail_id:    msg.id,
    thread_id:   msg.threadId,
    history_id:  msg.historyId || null,

    subject:     headers.subject || '(no subject)',
    from_name:   from.name,
    from_email:  from.email,
    to:          headers.to  || '',
    cc:          headers.cc  || '',
    reply_to:    headers['reply-to'] || '',
    rfc822_id:   headers['message-id'] || '',

    received_at:    Number.isFinite(receivedMs) ? new Date(receivedMs) : new Date(),
    internal_date:  Number(msg.internalDate) || null,

    snippet:         msg.snippet || '',
    label_ids:       labelIds,
    is_unread:       labelIds.includes('UNREAD'),
    is_starred:      labelIds.includes('STARRED'),
    in_inbox:        labelIds.includes('INBOX'),
    is_trashed:      labelIds.includes('TRASH'),
    is_spam:         labelIds.includes('SPAM'),

    body_text:       truncate(body.text),
    body_html:       truncate(body.html),
    attachments:     body.attachments,
    has_attachments: body.attachments.length > 0,
    size_estimate:   msg.sizeEstimate || 0,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Mailbox profile — also the cheapest way to verify auth works end to end. */
function getProfile() {
  return apiGet('/profile');
}

/**
 * One page of message ids.
 * @param {object} opts
 * @param {string} [opts.q]         Gmail search syntax, e.g. "after:2026/07/01"
 * @param {string} [opts.pageToken]
 * @param {number} [opts.maxResults]
 * @param {string[]} [opts.labelIds]
 * @returns {Promise<{messages: Array<{id:string,threadId:string}>, nextPageToken?: string, resultSizeEstimate: number}>}
 */
async function listMessages({ q, pageToken, maxResults = 100, labelIds } = {}) {
  const data = await apiGet('/messages', {
    q,
    pageToken,
    maxResults,
    labelIds,
    includeSpamTrash: false,
  });
  return { messages: data.messages || [], nextPageToken: data.nextPageToken, resultSizeEstimate: data.resultSizeEstimate || 0 };
}

/** Full message, parsed into the storage shape. */
async function getMessage(id) {
  const msg = await apiGet(`/messages/${encodeURIComponent(id)}`, { format: 'full' });
  return parseMessage(msg);
}

/**
 * Incremental changes since `startHistoryId`.
 * Gmail keeps roughly a week of history: an id older than that yields 404,
 * which the caller must treat as "resync from scratch".
 */
async function listHistory({ startHistoryId, pageToken, maxResults = 500 }) {
  return apiGet('/history', {
    startHistoryId,
    pageToken,
    maxResults,
    historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
  });
}

/** Attachment bytes. Gmail returns base64url; callers get a Buffer. */
async function getAttachment(messageId, attachmentId) {
  const data = await apiGet(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return Buffer.from((data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** All labels, so the UI can show human names instead of raw label ids. */
async function listLabels() {
  const data = await apiGet('/labels');
  return data.labels || [];
}

module.exports = {
  isConfigured,
  authMode,
  mailbox,
  getAccessToken,
  getProfile,
  listMessages,
  getMessage,
  listHistory,
  getAttachment,
  listLabels,
  parseMessage,
  parseAddress,
};
