# Gmail Integration — support@upessc.org

Mirrors the support mailbox into MongoDB and serves it at **/emails** in the app. The requested scope is `gmail.modify` (`GMAIL_SCOPES`), which covers reading, replying, and relabelling — and covers nothing else: it cannot permanently delete a thread, the one Gmail operation with no undo.

**The scope must match the delegation.** A service account may only request what a Workspace super-admin has authorised for its client_id under Admin Console → Security → API controls → Domain-wide delegation. Asking for more than was granted fails the *token exchange*, so the symptom is not "replies fail" — it is the entire mailbox sync stopping with `unauthorized_client`. Widen the delegation first, then `GMAIL_SCOPES`. A deployment that cannot widen it sets `GMAIL_SCOPES` back to `gmail.readonly` and keeps everything except replying and read-state sync; `/sync-status` reports `can_send` and `can_modify` so the UI disables the composer instead of offering a button that always fails.

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

### Conversations (v3.7.0)

The mailbox is presented as **people, not messages**. Every message carries a `conversation_id` — the correspondent's address, stamped at sync time by `lib/conversations.js` (the sender for mail we received, the recipient for mail we sent, so both sides of an exchange land in one chain). One rollup document per correspondent lives in `email_conversations`, keyed by that address.

**Why the address and not Gmail's `threadId`:** candidates routinely start a fresh thread for a problem they already raised, reply from a different client, or change the subject line halfway through. Grouping by thread scattered one case across several rows; grouping by person does not. Thread ids are still recorded on the rollup, because that is what the reply detection in `reportData.js` reads.

The rollup is **derived state** — every field on it can be recomputed from `emails` by `refreshConversation()`, which runs whenever mail arrives, labels change, or someone marks something read. A conversation that drifts is fixed by recomputing it, never by migrating it.

`needs_analysis` is stored rather than derived at query time: both the worker's sweep and the coverage stat ask for it in a plain filter, and comparing `last_inbound_at` against `analysed_upto` is not something a plain filter can do. It is true exactly when inbound mail landed after the point the last verdict covered — which is both "never analysed" and "replied since" in one flag.

### API

| Endpoint | Notes |
|---|---|
| `GET /api/emails/conversations` | **What the Emails tab lists.** One row per correspondent. Filters: `search`, `unread`, `hasAttachments`, `category`, `subCategory`, `analysisStatus`, `includeTrashed`, `dateFrom`, `dateTo`, `limit`, `offset`. |
| `GET /api/emails/conversations/:id` | The whole chain as a chat, oldest first, plus the conversation's analysis. `:id` is the correspondent's address. Bodies capped at `EMAIL_CHAT_BODY_CHARS` (8k); HTML omitted. |
| `PATCH /api/emails/conversations/:id/read` | `{ read }` — marks the whole chain, because the unit somebody picks up is the person. |
| `POST /api/emails/conversations/:id/analyse` | Re-read the chain. Admin only; `?force=true` re-runs a settled one. |
| `POST /api/emails/conversations/:id/reply` | Send a reply into the chain. Any authenticated user. Returns the stored bubble. |
| `POST /api/emails/conversations/export/jobs` | Queue a CSV export. Body = the same filters as the list. |
| `GET /api/emails/conversations/export/jobs/:id` | Progress; returns a signed `download_url` once complete. |
| `GET /api/emails/conversations/export/jobs/:id/download` | The file. Accepts the signed `?token=` or a Bearer header. |
| `GET /api/emails` | The message-level list, still available. Filters: `search`, `unread`, `hasAttachments`, `label`, `from`, `threadId`, `includeTrashed`, `dateFrom`, `dateTo`, `limit`, `offset`. Bodies omitted. |
| `GET /api/emails/:id` | Full message including bodies and attachment metadata. |
| `GET /api/emails/:id/attachments/:attachmentId` | Proxied download. |
| `GET /api/emails/sync-status` | Credential + worker health; drives the UI banner. |
| `POST /api/emails/sync` | Force a pass. Admin only. |
| `GET /api/emails/labels` | Gmail label list. |

All routes require a valid JWT — except the token-signed export download, which
carries its own short-lived credential because `<a download>` cannot send a
header. That token is scoped to one job and expires in ten minutes.

### CSV export

Same job-based flow as the call report (`useExportJob` on the front end, the
`exportWorker` type registry behind it): queue, poll, download. A background job
rather than a streamed response because the filters can select the whole
mailbox, and a request that streams for two minutes is a request every proxy in
the way is entitled to kill.

**One row per correspondent**, matching what the tab lists — a candidate who
wrote six times about one refund is one row carrying one verdict, not six rows
repeating it. Columns cover the shape of the chain (message counts by direction,
unread, first/last message, threads, the other subject lines they used) and the
verdict formed from all of it (category, sub-category, every tag, insight,
summary, requested action, bug, language, model).

The filter comes from `lib/conversations.buildConversationFilter` — **the same
function the list endpoint uses**. That is deliberate and worth keeping: an
export that selects a different set than the screen it was taken from is worse
than no export, because nothing about the file says so. A free-text search
resolves through message bodies to the conversations they belong to, so the CSV
finds what the search box finds.

## Replying (v3.8.0)

`POST /api/emails/conversations/:id/reply` answers the newest thing the *candidate* said — replying to our own last message would thread the conversation to ourselves. Any authenticated user may reply, on the same reasoning that lets anyone mark read: in a shared mailbox whoever picks the candidate up is the one who answers them. `sent_by` records which operator did, because Gmail has nowhere to put that.

Gmail composes nothing for us; it takes a finished RFC 2822 message, so `lib/mimeMessage` builds one:

- **Threading.** `In-Reply-To` and `References` are what a mail client threads on. Passing Gmail a `threadId` alone puts the reply in the right thread *our* side and leaves it orphaned in the candidate's inbox, which is the side that matters. Both are set, and they agree.
- **Encoding.** Candidates write in Hindi and are answered in it. The body goes out base64 with an explicit charset, and non-ASCII headers use RFC 2047 encoded-words, or a Devanagari subject arrives as mojibake.
- **Quoting.** The previous message is quoted underneath the way every mail client does it — the candidate has no Oasis to look the thread up in. It quotes the *cleaned* text, and our own chat strips it back off when rendering.
- **Header injection.** A newline in a header value ends that header and starts another, which is how a `Bcc` gets appended to someone else's message. Every header value has its newlines stripped.

**Answering re-reads the chain.** `needs_analysis` tracks the newest message in *either direction*, not just inbound, so a reply — sent from the app or from Gmail and picked up by the sync — makes the stored verdict stale and the worker re-reads the whole exchange with our answer in it. That is what the prompt asks for: it treats SUPPORT messages as what has already been answered, and an issue we resolved an hour ago should stop being reported as the live one. The reply route queues that re-read at once so the new verdict lands in seconds rather than on the next sweep. It costs one Gemini call per reply. A chain with no inbound message at all is still never analysed — there is nothing of the candidate's to judge.

The sent copy is fetched back and stored **immediately** rather than waiting for the sync worker's next pass — a chat where your own message takes a minute to appear is a chat nobody trusts. The sync re-fetches the same message later and upserts over it harmlessly. If that fetch-back fails the reply is still reported as sent: it is already gone, and reporting failure would invite a second send.

## Read state, both directions (v3.8.0)

Marking read in Oasis now clears the `UNREAD` label in Gmail too (`messages.batchModify` — one call for a whole chain), and marking unread puts it back. Read state is one fact rather than two views of it.

Two rules keep that honest:

1. **The operator's action survives a Gmail failure.** It is applied to our copy first and unconditionally, and the response carries `gmail_synced` (plus `gmail_error`). Losing a triage marker in a shared mailbox means two people answer the same candidate.
2. **Gmail wins when it changes there.** A `labelsAdded: UNREAD` history record clears our own `read_at`/`read_by`, because unread means "unread in Gmail AND not opened here" — without that, an operator's old read marker outvoted somebody deliberately putting the mail back in the pile, and the card stayed read however many times they tried.
3. **Our mirror of `is_unread` is written only when the push succeeds.** Where the delegation is still read-only, our copy must keep saying what Gmail says or the next sync would quietly contradict the screen — there, `read_at` alone carries the action, exactly as before write was granted.

## AI analysis (v3.6.0, conversation-scoped since v3.7.0)

Every synced email goes through the **same Gemini pipeline and the same `CATEGORIZATION_SCHEMA` as calls** — which is fitting, since that schema was extended against this very email corpus (see [`email-taxonomy-fit.md`](./email-taxonomy-fit.md)). `emailAnalysisWorker.js` deliberately mirrors `analysisWorker.js`: atomic claim, `processing_id` ownership, stale-lock recovery, heartbeat, and the same 30s → 2m → 8m → 30m backoff over five attempts. Change the retry policy in one and change it in the other.

**The unit of analysis is the conversation.** A reply is not a new problem; it is more information about the problem already on the table, and reading it alone produced verdicts that contradicted the one before it. So the queue in `conversation_analysis` holds one row per correspondent, each job re-reads the whole exchange (`categorizeConversation`, both directions, oldest first, newest message last), and **the verdict it produces replaces the previous one everywhere**.

The prompt tells the model to judge the chain's *current* state: an issue already answered and not raised since is not live, a follow-up that adds a registration number belongs to the issue it elaborates, and the newest candidate message decides the primary tag. The transcript is budgeted by `EMAIL_ANALYSIS_MAX_CONTEXT_CHARS` (24k) with `EMAIL_ANALYSIS_MAX_CHARS` per message; when it will not fit, the **oldest** messages are dropped, because the current ask is always the newest one.

Produced per conversation: `category`, `sub_category`, `tags`, `summary`, `ai_insight`, `bugs`, `bug_category`, `requested_action`, `language`. It is mirrored four ways so nothing downstream had to change:

| Written to | Why |
|---|---|
| `conversation_analysis` | the record itself — queue state, model, token usage |
| `email_conversations` | headline pair on the rollup, so the tab filters with no join |
| `emails` (inbound only) | every pre-existing per-message filter, export and report keeps working |
| `email_analysis` (inbound only) | one mirror row per message; **token usage rides only on the newest**, so the cost report charges one call once |

Our own replies are deliberately left unmirrored: what support wrote is not the candidate's issue.

**What has no email equivalent**, and is therefore absent rather than faked: `transcription`, `audio_quality`, `agent_score`, `call_resolved`. An inbound email has no audio and no agent turn to score.

**Two sentinels mirror the call side:**

| Email | Call analogue | When |
|---|---|---|
| `Email too Short` | `Call too Short` | Body under `EMAIL_ANALYSIS_MIN_CHARS` after quoted replies and signatures are stripped. Assigned *without* a Gemini call. |
| `Content Unclear` | `Audio Unclear` | Gemini can find no identifiable request — bounce, auto-reply, bare greeting, attachment with no text. |

### What a message actually says (`lib/emailText`)

A support email is mostly not the message. A three-line request arrives wrapped in a sign-off, a corporate disclaimer nobody has read, the whole previous exchange re-quoted with `> ` in front of it, and the header line naming who wrote what when. `cleanEmailBody()` takes all of that off, in order: quoted-reply markers (including the `On … wrote:` header **wrapped across two lines**, which is how Gmail sends it and what a single-line pattern misses), `> ` lines, the `-- ` signature delimiter, confidentiality boilerplate, and a trailing closing plus the name under it.

**One rule overrides every heuristic: never return nothing.** A bare forward with no covering note IS the content, and a candidate who writes only "Best regards" has still said something — so any step that would empty the body is skipped.

Both readers go through it, which is the point of it being one function:

- **the chat**, so a bubble shows the message. Six replies would otherwise repeat the same paragraph six times down one conversation. `body_trimmed` is returned alongside, and the bubble offers **Show original** — the per-message endpoint still serves the mail untouched, which is what makes trimming safe rather than lossy.
- **the prompt**, so the chain supplies the history once instead of paying for it re-quoted inside every reply. On the sample message that is 1358 characters down to 206.

**One trap worth keeping in mind.** The sweep enrols conversations carrying `needs_analysis`, forced — forcing clears `next_attempt_at`. It must therefore skip rows already `pending` or `processing`, or a job merely waiting out its retry backoff is retried at full speed on every tick, spending Gemini quota as fast as the API answers. `tests/emailAnalysisWorker.test.js` pins this.

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

## Read state

Gmail's `UNREAD` label is mirrored to `is_unread` on every fetch, and label changes made *in Gmail* arrive as history deltas. What was missing is the other direction: reading a mail **in Oasis** left it bold forever, because the sync is read-only and `SCOPE` is hardcoded to `gmail.readonly`.

Oasis therefore keeps its own marker:

| Field | Owner | Meaning |
|---|---|---|
| `is_unread` | Gmail | the `UNREAD` label, rewritten on every re-fetch |
| `read_at` / `read_by` | Oasis | who opened it here, and when |

**Unread = `is_unread && !read_at`.** Both halves matter, and the pair lives in `UNREAD` / `IS_READ` in `routes/emails.js` so the list filter, the `unreadCount` and the sync-status count cannot disagree.

`read_at` is deliberately a separate field rather than a flip of `is_unread`: `fetchAndStore` writes `$set: { ...doc }` on every re-fetch, so anything Gmail owns is overwritten wholesale. A history replay or a post-expiry backfill would silently resurrect the unread state. Clearing sets `$unset` rather than null, which keeps the predicate a plain `$exists`.

`PATCH /api/emails/:id/read` with `{ read: true | false }`, any authenticated user — in a shared mailbox whoever picks the mail up is the one who marks it handled. The list marks read on open; the detail modal offers **Unread** to put it back, and shows who already opened it, so two agents don't answer the same candidate.

**This does not touch Gmail.** The mailbox still shows the mail as unread. Pushing the label back needs `gmail.modify` in `SCOPE` *and* a Workspace super-admin re-authorising the delegation client_id for the new scope — domain-wide delegation grants are per-scope, so widening it is an Admin Console step, not a deploy.

## Tagging (replaces one-bucket categorisation)

An item is **tagged**, not bucketed. A tag is a `{ category, sub_category }` pair drawn from `CATEGORIZATION_SCHEMA` — the *same* 17 × 196 vocabulary a lone category always came from. Tagging changed how many an item may carry, not what they may say, so there is no new taxonomy to maintain and nothing for a model to invent.

This exists because one bucket per item provably loses data: the validation row above (*Aadhaar OTP + upload query*) raised two issues and only the first was recorded. The old email prompt said so explicitly — "categorize the PRIMARY issue … mention the secondary ones in the summary". A summary is not queryable.

**Shape.** Both the call and email documents (and their analysis records) now carry:

| Field | Meaning |
|---|---|
| `tags` | every issue, most important first, capped at `MAX_TAGS` (5) |
| `category` / `sub_category` | `tags[0]`, mirrored |

The scalar pair is kept deliberately: every filter, export and dashboard written before tagging keeps working untouched, and the `Uncategorised` / `Content Unclear` / `Call too Short` sentinels stay exactly where they were. Sentinels are **never** tagged — they describe a state, not an issue, so `tags` is `[]` for them.

**Validation.** `snapTags()` runs every proposed tag through the existing `snapToTaxonomy()`, so an invented name still cannot reach the database — the property that made `DYNAMIC_CATEGORIES_ENABLED` necessary. Duplicates collapse; the `Uncategorised` sentinel survives only as the sole tag.

**Querying.** `src/lib/tags.js` owns both helpers so the three route files cannot drift:
- `tagMatch(category, subCategory)` — matches the category on **any** tag. Passing both requires them on the *same* tag via `$elemMatch`; two independent dotted conditions would wrongly match a crossed pair.
- `unwindTagsStage()` — one row per (item, tag) for the breakdown aggregations. **These totals sum above the item count by design** — they count issues, not emails.

Every filter matches the tag array **or** the scalar pair, so a half-migrated collection answers correctly. There is no flag day.

**Backfill.** `node scripts/backfillTags.js --dry-run` then without the flag. It widens each existing pair into a one-tag list; it re-analyses nothing and spends no Gemini quota, so issues dropped at analysis time stay dropped until those records are re-analysed. Safe to re-run — only documents with no `tags` field are touched.

**Not covered:** ticket categories. Those 7 (`General Inquiry`, `Technical Issue`, …) are a human workflow taxonomy, unrelated to the content schema, and remain single-valued.

## Ticketing from email

Tickets are no longer a call-only artefact. The same `tickets` collection, the same `TKT-` counter, and the same detail modal now serve both channels; what differs is only how the customer is identified.

| | Call ticket | Email ticket |
|---|---|---|
| `source` | `'call'` | `'email'` |
| Customer key | `customer_number` | `customer_email` (stored lower-case) |
| Origin link | `call_id` | `email_id` (Gmail message id) + `email_subject` |

`POST /api/tickets` therefore requires **`customer_number` or `customer_email`**, not a phone number specifically. Tickets written before this change have no `source` field and are treated as calls — `?source=call` matches them via `$exists`, so the filter never silently drops history.

New list filters: `customerEmail`, `emailId`, `callId`, `source`. Search now also covers `customer_email` and `email_subject`, and the term is regex-escaped — an address is full of metacharacters that would otherwise match far too much.

In the UI, `EmailTicketModal` is the twin of `CallTicketModal`: it lists everything already raised **for that sender address** — so a follow-up mail shows the earlier tickets — and opens `CreateTicketModal` with the subject seeded as the title. It is reachable from the row action on the Emails table and from the *Ticket* button in the email detail modal. The Tickets page gains a source filter and shows a phone/envelope icon per row.

The click-to-call button in `TicketDetailModal` is already gated on `customer_number`, so it simply does not appear on an email ticket.

## Configuration

Every variable is documented in `backend/.env.example` under *Gmail — support mailbox ingestion*. The feature is inert until `GMAIL_USER` is set, so an unconfigured deploy runs exactly as before.

## Next step this unlocks

The email taxonomy work in [`email-taxonomy-fit.md`](./email-taxonomy-fit.md) was done against a static CSV export. With live mail in `emails`, the same Gemini pipeline that categorises calls can run over it — the two structural recommendations still open there (the disposition axis, and channel-neutral category renaming) are the prerequisites.
