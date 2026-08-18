# Gmail Integration — support@upessc.org

Mirrors the support mailbox into MongoDB and serves it at **/emails** in the app. Read-only: the requested scope is `gmail.readonly`, so the server can list and read mail but can never send, modify, or delete it.

## Status

**The code is complete and verified; the mailbox is not yet reachable.** Google rejects the token request with `unauthorized_client` because domain-wide delegation has not been granted to the service account. One Admin Console change (below) switches the feature on — no code change is needed.

## Required one-time setup

`upessc.org` is a Google Workspace domain (`MX = smtp.google.com`), so a **super-admin** can authorise the existing service account to impersonate the mailbox:

1. **Google Cloud console** → project `gmail-api-otr` → *APIs & Services* → enable the **Gmail API**.
2. **admin.google.com** → *Security* → *Access and data control* → **API controls** → *Manage domain-wide delegation* → **Add new**:
   - **Client ID**: `111776879778475843161`
   - **OAuth scopes**: `https://www.googleapis.com/auth/gmail.readonly`
3. Save, wait a few minutes for propagation, then check:

   ```bash
   curl -H "Authorization: Bearer $JWT" localhost:3001/api/emails/sync-status
   ```

   `configured: true` with `last_error: null` and a `phase` means it is working. The first backfill starts within a minute.

### If delegation cannot be granted

The service falls back to an OAuth2 refresh token — set `GMAIL_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` instead of the service-account key, obtained by consenting once as the mailbox owner. Publish the consent screen: refresh tokens from an app left in *Testing* status are revoked after 7 days. Everything downstream is identical.

## ⚠️ Rotate the leaked key

Commit `7ed5006` put the full `gmail-upessc@gmail-api-otr` private key into `backend/.env.example`, which is tracked by git. **That key must be treated as compromised**: create a new key in Cloud console, delete the old one, and put the new value in `backend/.env` only (base64, single line). The placeholder is now the only thing left in `.env.example`. Rewriting history is optional but the rotation is not — anyone with repo access has the old key.

## How it works

| Piece | File |
|---|---|
| Auth + REST calls + MIME parsing | `backend/src/services/gmailService.js` |
| Backfill / incremental sync loop | `backend/src/workers/emailSyncWorker.js` |
| API | `backend/src/routes/emails.js` |
| UI | `frontend/src/pages/Emails.jsx`, `components/EmailDetailModal.jsx` |

No new npm dependencies — the Gmail REST endpoints are called with global `fetch`, and the service-account JWT is signed with `node:crypto`.

### Tests

`cd backend && npm test` — 74 jest tests in `backend/tests/`, covering credential detection, MIME parsing, every `/api/emails` route, and the full sync state machine. `jest.config.js` pins `roots` to `tests/`, so a test file left beside its source will not run. The database is an in-memory fake (`tests/helpers/fakeMongo.js`) and the Gmail API is mocked — nothing reaches Atlas or Google.

### Sync model

Two phases, tracked per mailbox in `email_sync_state`:

- **backfill** — pages through `messages.list` (`GMAIL_BACKFILL_PAGES_PER_TICK` pages of 100 per tick), persisting the page token so a restart resumes rather than restarting. Bounded by `GMAIL_BACKFILL_DAYS` (default 30) or an explicit `GMAIL_SYNC_QUERY`.
- **incremental** — once drained, switches to `history.list` starting from the `historyId` captured **before** the backfill began. That ordering is what stops mail arriving mid-backfill from being missed; the worst case is a message fetched twice, which upserts harmlessly.

Label changes (read, starred, archived, trashed) are applied straight from the history record without re-fetching the message, so marking 200 emails read in Gmail costs no extra API quota. Deletions are soft (`is_deleted`), keeping the record for reporting while dropping it from listings. Gmail retains roughly a week of history — an aged-out `historyId` returns 404 and the worker automatically restarts a backfill.

### Storage

Messages land in `emails`, keyed by the Gmail message id (`gmail_id`, unique). Bodies are truncated at `GMAIL_MAX_BODY_CHARS` (200k default) to stay clear of MongoDB's 16 MB document cap. Attachment **bytes are never stored** — `/api/emails/:id/attachments/:attachmentId` streams them from Gmail on demand, and only serves attachment ids the message itself declares.

### API

| Endpoint | Notes |
|---|---|
| `GET /api/emails` | Filters: `search`, `unread`, `hasAttachments`, `label`, `from`, `threadId`, `includeTrashed`, `dateFrom`, `dateTo`, `limit`, `offset`. Bodies omitted. |
| `GET /api/emails/:id` | Full message including bodies and attachment metadata. |
| `GET /api/emails/:id/attachments/:attachmentId` | Proxied download. |
| `GET /api/emails/sync-status` | Credential + worker health; drives the UI banner. |
| `POST /api/emails/sync` | Force a pass. Admin only. |
| `GET /api/emails/labels` | Gmail label list. |

All routes require a valid JWT.

## AI analysis (v3.6.0)

Every synced email goes through the **same Gemini pipeline and the same `CATEGORIZATION_SCHEMA` as calls** — which is fitting, since that schema was extended against this very email corpus (see [`email-taxonomy-fit.md`](./email-taxonomy-fit.md)). `emailAnalysisWorker.js` deliberately mirrors `analysisWorker.js`: atomic claim, `processing_id` ownership, stale-lock recovery, heartbeat, and the same 30s → 2m → 8m → 30m backoff over five attempts. Change the retry policy in one and change it in the other.

Produced per email: `category`, `sub_category`, `summary`, `ai_insight`, `bugs`, `bug_category`, `requested_action`, `language`. The headline pair is mirrored onto the email document so list filtering needs no join.

**What has no email equivalent**, and is therefore absent rather than faked: `transcription`, `audio_quality`, `agent_score`, `call_resolved`. An inbound email has no audio and no agent turn to score.

**Two sentinels mirror the call side:**

| Email | Call analogue | When |
|---|---|---|
| `Email too Short` | `Call too Short` | Body under `EMAIL_ANALYSIS_MIN_CHARS` after quoted replies and signatures are stripped. Assigned *without* a Gemini call. |
| `Content Unclear` | `Audio Unclear` | Gemini can find no identifiable request — bounce, auto-reply, bare greeting, attachment with no text. |

Quoted history and signature blocks are trimmed before the prompt, and the body is capped at `EMAIL_ANALYSIS_MAX_CHARS`; a 40-message thread would otherwise cost tokens for text the candidate did not write.

### Verified against the real corpus

Run live against Gemini using real emails from `data/_normalized.json`:

| Email | Human label | AI verdict |
|---|---|---|
| Payment debited, not on OTR form | Payment deducted but not reflected / refund | Payment & Fee / Money Debited but Application Incomplete, bug → Payment Gateway |
| Devanagari Hindi, exam centre + shift | Exam center and shift, Paper 1 & 2 | Exam Application & Eligibility / Both Papers Application Query, lang Hindi |
| Aadhaar OTP + upload query (multi-issue) | *(blank)* | Identity Verification / Aadhaar OTP Not Received, bug → eKYC |
| "Photo from Vijay Tewa" | Personal Details Issue | Content Unclear |

Latency was 2–25s per email depending on body length. English, Devanagari, and Hinglish all classify without special handling.

### Still open

The **disposition axis** from `email-taxonomy-fit.md` is *not* implemented. Auto-replies, bank notifications, duplicates, and thank-you mail (8.7% of the corpus by that document's count) are still forced into a category or into `Content Unclear` rather than getting a disposition of their own. That remains the right next step, and it needs a schema change rather than a prompt tweak.

### Rendering safety

Email HTML is untrusted third-party markup, so it is never injected into the app's DOM. The detail modal defaults to the plain-text part and renders HTML only inside `<iframe sandbox="" referrerPolicy="no-referrer">` — no scripts, forms, popups, or top-level navigation, and no access to the session token.

## Configuration

Every variable is documented in `backend/.env.example` under *Gmail — support mailbox ingestion*. The feature is inert until `GMAIL_USER` is set, so an unconfigured deploy runs exactly as before.

## Next step this unlocks

The email taxonomy work in [`email-taxonomy-fit.md`](./email-taxonomy-fit.md) was done against a static CSV export. With live mail in `emails`, the same Gemini pipeline that categorises calls can run over it — the two structural recommendations still open there (the disposition axis, and channel-neutral category renaming) are the prerequisites.
