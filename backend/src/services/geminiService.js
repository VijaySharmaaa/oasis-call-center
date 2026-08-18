/**
 * Gemini AI Service — analyzes call recordings.
 *
 * Flow: stream audio URL → pipe directly into Gemini Files API upload
 *       (no temp file, no full download into memory first)
 *       → generateContent with returned file URI → cleanup.
 */

const logger = require('../logger');
const { dynamicCategoriesEnabled } = require('../config/features');

// ─── Categorization schema ────────────────────────────────────────────────────

const CATEGORIZATION_SCHEMA = {
  "Portal Access & Registration": [
    "Fresh Registration Query",
    "Duplicate Registration Concern",
    "OTR vs Exam Application Confusion",
    "Resume Incomplete Application",
    "Offline Application Query",
    "Portal Not Loading / Technical Error",
    "Registration Form Submission Error",
    "Multiple OTR Accounts Issue",
    "OTR ID Not Received After Registration",
    "Registration Confirmation Not Received",
    "Apply / OTR Link Not Visible on Portal"
  ],
  "Identity Verification": [
    "Aadhaar OTP Not Received",
    "Aadhaar Number Not Accepted",
    "Aadhaar Mismatch",
    "Name / DOB Mismatch Across Documents",
    "Identity Proof Selection Query",
    "Live Photo / Face Match Failure",
    "Manual Aadhaar Verification Request",
    "Photo Clicked During Verification Issue",
    "Aadhaar Linked Mobile Not Available",
    "Name Prefix Mismatch (KM / Kumari)",
    "Post-Marriage Surname Mismatch in eKYC",
    "Wrong ID Type Used at Registration"
  ],
  "OTP, Password & CAPTCHA": [
    "Mobile OTP Not Received",
    "Email OTP Not Received",
    "OTP Expired Before Use",
    "Wrong OTP Entered Multiple Times",
    "Password Forgotten / Reset",
    "CAPTCHA Not Loading / Unclear",
    "Account Recovery Query",
    "OTP Coming on Wrong Number"
  ],
  "Category & Reservation": [
    "General Category Query",
    "OBC Category & Creamy Layer",
    "OBC Non-Creamy Layer Certificate Query",
    "SC / ST Category",
    "SC / ST Sub-Category Clarification",
    "EWS Category",
    "EWS Certificate Format / Validity Query",
    "Divyang / PwD / PH Category",
    "Disability Type & Percentage Query",
    "Dependent Freedom Fighter Category",
    "Ex-Army / Ex-Serviceman Category",
    "Age Relaxation Query",
    "UP Residency & Reservation Eligibility",
    "Category Certificate Date Validity Query",
    "Category Change After Form Submission"
  ],
  "Address & Personal Details": [
    "Permanent Address Entry Issue",
    "Correspondence Address Entry Issue",
    "District / State Dropdown Issue",
    "Village / Ward / Tehsil Not Found",
    "Pincode Not Accepted",
    "Personal Details Correction Request",
    "Date of Birth Entry Issue",
    "Gender / Nationality Entry Issue",
    "Twin Information Query",
    "Father / Husband Name Entry Issue",
    "Mobile / Email Change in Profile",
    "Marital Status Field Query"
  ],
  "Educational Qualifications": [
    "Education Details Entry in OTR",
    "Wrong Education Row Added",
    "Board / University Not in Dropdown",
    "B.Ed / D.El.Ed Qualification Entry",
    "Graduation Subject / Stream Entry",
    "Training Qualification Entry",
    "Marks / Percentage Entry Issue",
    "CGPA to Percentage Conversion Query",
    "Year of Passing Entry Issue",
    "Appearing / Passed Status Query",
    "Final Year Appearing Candidate Entry",
    "Multiple Degree Entry Issue",
    "Appearing Option Missing in Dropdown",
    "Board Roll Number Digit Length Rejected",
    "Out-of-State / NIOS Qualification Not Listed",
    "Graduation Field Mandatory but Not Applicable"
  ],
  "Uploads & Documents": [
    "Photograph Upload Issue",
    "Signature Upload Issue",
    "Photo Identity Proof Upload",
    "Academic Certificate Upload",
    "Category / Caste Certificate Upload",
    "Domicile / Residency Certificate Upload",
    "Handwritten Declaration Upload Issue",
    "File Size / Format Requirement",
    "File Too Large Error",
    "Blurry / Unreadable Document Rejection",
    "Document Preview Not Showing",
    "Photo Background Color Requirement",
    "Photo Dimensions Not Accepted",
    "Upload Button Not Working",
    "Wrong Person's Document Uploaded",
    "Handwritten Declaration Language Requirement"
  ],
  "OTR Completion & Preview": [
    "Preview & Edit Before OTR Completion",
    "OTR Profile Locked After Submission",
    "Complete OTR Profile Step Query",
    "OTR Submission Confirmation Not Received",
    "Preview Section Data Missing or Wrong",
    "How to Edit Saved OTR Data",
    "OTR Final Submit Button Issue",
    "Print / Download OTR Form"
  ],
  "Exam Application & Eligibility": [
    "Paper I Eligibility Query",
    "Paper II Eligibility Query",
    "Both Papers Application Query",
    "Subject Group / Combination Selection",
    "Practising Government Teacher Details Entry",
    "Qualification Status (Passed / Appearing)",
    "B.Ed Appearing Candidate Eligibility",
    "D.El.Ed / BTC / JBT Eligibility Query",
    "Age Limit Eligibility Query",
    "Exam Centre Preference Entry",
    "Application Form Section Not Saving",
    "How to Apply for Exam After OTR",
    "In-Service Teacher Without Graduation Eligibility"
  ],
  "Payment & Fee": [
    "Fee Amount Query",
    "Category-wise Fee Query",
    "Both Papers Fee Query",
    "Payment Gateway / Method Query",
    "Net Banking / UPI / Debit Card Issue",
    "Challan Payment Query",
    "Payment Pending / Processing Status",
    "Money Debited but Application Incomplete",
    "Duplicate Payment Risk",
    "Duplicate Payment Refund Query",
    "Payment Reconciliation Request",
    "Application Status Showing PAID Confirmation",
    "Fee Receipt / Challan Download Issue",
    "Fee Waiver for Reserved Category Query"
  ],
  "Login & Account Access": [
    "Login Method Query",
    "OTR ID Forgotten / Recovery",
    "OTP Login Not Working",
    "Account Locked / Blocked",
    "Too Many Failed Login Attempts",
    "Registered Mobile Not Accessible",
    "Login with New Device Issue",
    "Session Timeout Issue"
  ],
  "Amendment & Post-Submission": [
    "Amendment Window Opening Date Query",
    "What Fields Can Be Corrected",
    "Amendment Process Step-by-Step Query",
    "Correction Window Already Closed",
    "Photo / Signature Amendment",
    "Name / DOB Correction After Submission",
    "Category Correction After Submission",
    "Subject / Paper Change After Submission",
    "Address Correction After Submission",
    "Re-payment Required After Amendment",
    "Amendment Confirmation Not Received",
    "Wrong Exam Level Selected (Primary vs Junior)",
    "Form Cancellation / Withdrawal Request"
  ],
  "Exam Information": [
    "Important Dates & Schedule Query",
    "Exam Pattern & Structure Query",
    "Number of Questions / Total Marks",
    "Qualifying Marks / Cut-off Query",
    "Negative Marking Query",
    "Exam Language / Medium Query",
    "Question Paper Language Options",
    "Exam Duration Query",
    "Normalisation / Multi-Shift Query",
    "TET Validity Period Query",
    "Syllabus Query",
    "Previous Year Paper Query"
  ],
  "Admit Card & Certificate": [
    "Admit Card Release Date Query",
    "Admit Card Download Process",
    "Admit Card Not Downloading / Available",
    "Wrong Details on Admit Card",
    "Exam Centre / Date / Time Query",
    "Exam Centre Change Request",
    "TET Pass Certificate Download",
    "TET Certificate Validity Query",
    "DigiLocker Certificate Query",
    "Photo Mismatch on Admit Card",
    "Category Error on Certificate",
    "Duplicate Certificate / Marksheet Query"
  ],
  "Scribe & Compensatory Time": [
    "Scribe Eligibility Criteria Query",
    "How to Request a Scribe",
    "Scribe Arrangement Process",
    "Scribe Documents & Declaration Required",
    "Scribe Qualification / Education Limit",
    "Compensatory Time (30 Minutes) Query",
    "Scribe Declaration Form Submission",
    "Medical Certificate for PwD Requirement",
    "Disability Certificate Format Query"
  ],
  "Result & Merit List": [
    "Result Declaration Date Query",
    "Result Check Process",
    "Merit List Query",
    "Cut-off Marks Query",
    "Rank / Score Discrepancy",
    "District Allocation Query",
    "Selection Process After TET",
    "Waiting List Query"
  ],
  "General Enquiry": [
    "Application Mode Query",
    "Notification / Advertisement Query",
    "Helpline Timing Query",
    "Appointment / Job Guarantee Query",
    "Transfer to Another Department",
    "Call Back Request",
    "Unrelated / Wrong Call",
    "Repeated Call / Follow-up",
    "Complaint Against Portal / Process"
  ]
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchWithTimeout(url, options = {}, timeoutMs = 300_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Strip markdown fences and any prose Gemini emits around JSON despite the
// response_mime_type hint. Returns the candidate JSON substring; if no
// braces/brackets are found, returns the trimmed input as-is so JSON.parse
// can still throw the original error for diagnosis.
function sanitizeJsonResponse(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  let s = raw.trim();
  // Strip ```json fences (any language tag)
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Find the first { or [ and the last matching } or ]
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = -1;
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) start = firstObj;
  else if (firstArr >= 0) start = firstArr;
  if (start < 0) return s.trim();
  const opener = s[start];
  const closer = opener === '{' ? '}' : ']';
  const end = s.lastIndexOf(closer);
  if (end <= start) return s.slice(start).trim();
  return s.slice(start, end + 1).trim();
}

// ─── Gemini rate-limit gate (module-level, shared across concurrent jobs) ────
// Two safeguards:
//   1. Minimum spacing between ALL outgoing Gemini calls. Caps peak RPM
//      regardless of worker concurrency. Single global slot.
//   2. Per-scope cooldown when Gemini returns 429. Scope is either a model
//      name (e.g. 'gemini-2.5-flash') for generateContent calls, or the
//      sentinel '__upload__' for Files API calls — Gemini limits these
//      separately, and our fallback-on-429 logic relies on the model
//      cooldown being independent so we can route to flash-lite while
//      flash itself is still cooling down.
const GEMINI_MIN_INTERVAL_MS = Math.max(0, Number(process.env.GEMINI_MIN_INTERVAL_MS) || 200);
const UPLOAD_SCOPE = '__upload__';
let _nextSlotAt = 0;                           // global min-interval gate
const _cooldowns = new Map();                  // scope -> until-timestamp (ms)

function getCooldown(scope) {
  return _cooldowns.get(scope) || 0;
}

async function awaitGeminiSlot(scope = null) {
  // Wait for whichever is later: the global min-interval or this scope's
  // 429 cooldown. Other scopes' cooldowns don't block us — that's the whole
  // point of per-scope tracking.
  const now = Date.now();
  const cooldown = scope ? getCooldown(scope) : 0;
  const slot = Math.max(now, _nextSlotAt, cooldown);
  _nextSlotAt = slot + GEMINI_MIN_INTERVAL_MS;
  const waitMs = slot - now;
  if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
}

// Parse the `Retry-After` header. Per RFC 7231 it's either a non-negative int
// (seconds) or an HTTP-date. Fall back to a sensible 30s if unparseable.
function parseRetryAfter(headerValue) {
  if (!headerValue) return 30;
  const asInt = Number(headerValue);
  if (Number.isFinite(asInt) && asInt >= 0) return Math.min(asInt, 600);
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) {
    const sec = Math.ceil((asDate - Date.now()) / 1000);
    return Math.max(1, Math.min(sec, 600));
  }
  return 30;
}

// Set a cooldown for a specific scope (model name or '__upload__'). All other
// scopes continue normally — this is what enables fallback to a sibling model
// when one is rate-limited.
function markGeminiRateLimited(retryAfterSec, source, scope) {
  if (!scope) return;
  const until = Date.now() + retryAfterSec * 1000;
  const prev = _cooldowns.get(scope) || 0;
  if (until > prev) {
    _cooldowns.set(scope, until);
    logger.warn('Gemini rate limit hit', { retryAfterSec, source, scope });
  }
}

function cleanCategory(text) {
  if (!text) return text;
  return text
    .replace(/^[IVX]+\.\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .replace(/^(Category|Type|Class|Group):\s*/i, '')
    .trim();
}

function toLanguageArray(lang) {
  if (!lang) return [];
  return Array.isArray(lang) ? lang : [lang];
}

/**
 * Stream the audio from audioUrl and pipe it directly into the Gemini Files API.
 * Returns { fileUri, fileName } on success or throws on failure.
 *
 * We use the resumable upload protocol:
 *   1. POST metadata to get an upload URL (session URI)
 *   2. PUT the raw audio bytes to that URL
 * This avoids buffering the entire file in Node memory.
 */
async function uploadAudioToGemini(audioUrl, apiKey) {
  // ── Fetch audio as a stream ───────────────────────────────────────────────
  const audioResp = await fetchWithTimeout(audioUrl, {}, 300_000);
  if (!audioResp.ok) {
    const err = new Error(`Audio fetch failed: HTTP ${audioResp.status}`);
    if (audioResp.status === 403 || audioResp.status === 404 || audioResp.status === 410) err.permanent = true;
    throw err;
  }

  // Content-Length header from S3 (needed for resumable upload)
  const contentLength = audioResp.headers.get('content-length');
  const mimeType      = audioResp.headers.get('content-type') || 'audio/x-wav';

  // Reject oversized files BEFORE starting the upload — saves our bandwidth,
  // Gemini upload quota, and the long timeout we'd otherwise burn waiting.
  // Marked permanent: retrying won't change the file size; admin can purge.
  // Only enforced when Content-Length is reported (not chunked transfers).
  const maxBytes = Math.max(1024 * 1024, Number(process.env.GEMINI_MAX_AUDIO_BYTES) || 100 * 1024 * 1024);
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxBytes) {
      // Drain & abort the body so the connection is released cleanly.
      try { audioResp.body?.cancel?.(); } catch { /* ignore */ }
      const err = new Error(`Audio too large: ${size} bytes (limit ${maxBytes})`);
      err.permanent = true;
      throw err;
    }
  }

  // Hold for the rate-limit gate before initiating the upload session.
  await awaitGeminiSlot(UPLOAD_SCOPE);

  // ── Step A: Initiate resumable upload session ─────────────────────────────
  const initResp = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}&uploadType=resumable`,
    {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command':  'start',
        ...(contentLength ? { 'X-Goog-Upload-Header-Content-Length': contentLength } : {}),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({ file: { display_name: 'recording' } }),
    },
    30_000
  );

  if (!initResp.ok) {
    if (initResp.status === 429) {
      markGeminiRateLimited(parseRetryAfter(initResp.headers.get('retry-after')), 'upload-init', UPLOAD_SCOPE);
    }
    throw new Error(`Gemini upload init failed: HTTP ${initResp.status} ${await initResp.text()}`);
  }

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned from Gemini');

  // ── Step B: Upload audio bytes (stream body directly) ────────────────────
  const uploadResp = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type':           mimeType,
        'X-Goog-Upload-Command':  'upload, finalize',
        ...(contentLength ? { 'X-Goog-Upload-Offset': '0', 'Content-Length': contentLength } : {}),
      },
      body: audioResp.body,   // pipe the stream directly — no buffering
      duplex: 'half',         // required for streaming request body in Node fetch
    },
    600_000  // 10 min for large files
  );

  if (!uploadResp.ok) {
    if (uploadResp.status === 429) {
      markGeminiRateLimited(parseRetryAfter(uploadResp.headers.get('retry-after')), 'upload', UPLOAD_SCOPE);
    }
    throw new Error(`Gemini upload failed: HTTP ${uploadResp.status} ${await uploadResp.text()}`);
  }

  const upData  = await uploadResp.json();
  const fileUri = upData?.file?.uri;
  const fileName= upData?.file?.name;

  if (!fileUri) throw new Error('No file URI returned from Gemini');
  return { fileUri, fileName };
}

// ─── Core analysis function ───────────────────────────────────────────────────

// Detect runaway/looping transcriptions. Gemini (especially -lite variants) can
// fall into repetition loops on ambiguous audio, producing the same dialog line
// hundreds of times. Such outputs bloat the DB and break Excel (per-cell limit
// is 32,767 chars). Any non-short line repeating past the threshold, or a total
// length beyond a sane hard cap, counts as a loop.
function detectTranscriptionLoop(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const minLineLen     = opts.minLineLen     ?? 80;
  const maxRepeats     = opts.maxRepeats     ?? 10;
  const hardLimitChars = opts.hardLimitChars ?? 50_000;

  if (text.length > hardLimitChars) return true;

  const counts = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < minLineLen) continue;
    const n = (counts.get(line) || 0) + 1;
    if (n > maxRepeats) return true;
    counts.set(line, n);
  }
  return false;
}

// ─── Taxonomy generation (meta-prompt) ──────────────────────────────────────
// Takes a corpus of past call summaries and asks Gemini to derive a
// hierarchical category/sub-category taxonomy that ALL future calls will be
// classified against. The prompt enforces a "well-defined" rubric so the
// output is mutually exclusive, collectively exhaustive, specific (no
// "Other"/"Misc"), consistently named, and grounded in the actual data.
async function generateCategoryTaxonomy(summaries, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const cleanSummaries = (Array.isArray(summaries) ? summaries : [])
    .map(s => (typeof s === 'string' ? s.trim() : ''))
    .filter(s => s.length > 0);

  if (cleanSummaries.length === 0) {
    return { success: false, error: 'No summaries provided' };
  }

  const targetCount     = Math.max(4, Math.min(30, Number(opts.targetCount) || 12));
  const minSubsPerCat   = Math.max(2, Number(opts.minSubsPerCat) || 4);
  const maxSubsPerCat   = Math.max(minSubsPerCat, Number(opts.maxSubsPerCat) || 10);
  // Same decoupling as generaliseCategoryTaxonomy — taxonomy output never hits
  // Excel, so the cap can be much higher than GEMINI_MAX_OUTPUT_TOKENS.
  const maxOutputTokens = Math.max(8192, Number(process.env.GEMINI_TAXONOMY_MAX_TOKENS) || 32768);

  // Number the summaries so model errors / debugging can refer back to them.
  const numbered = cleanSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const prompt = `
You are designing a categorization taxonomy for a customer support helpline.
The summaries below are real past calls. Use them — and ONLY them — to derive
a hierarchical taxonomy that will be applied to EVERY future call.

The taxonomy must be WELL-DEFINED. Hard requirements:

1) MUTUALLY EXCLUSIVE
   - No two top-level categories overlap in meaning.
   - Within a category, no two sub-categories overlap.
   - Every future call must fit exactly one (category, sub_category) pair.

2) COLLECTIVELY EXHAUSTIVE for the calls in scope
   - Every recurring issue type in the summaries must map to some
     sub-category. Do NOT silently drop a real cluster.
   - Do NOT lump unrelated issues together just to hit a count target.

3) SPECIFIC, NEVER VAGUE
   - Forbidden names: "Other", "Misc", "Miscellaneous", "General",
     "General Query", "General Issues", "Issues", "Problems", "Help",
     "Support", "Query", "Concern", "Doubt", anything ending in "etc".
   - A name must telegraph exactly which calls belong there. A new reader
     should be able to predict, from the name alone, what goes in the bucket.

4) CONSISTENT, READABLE NAMING
   - Title Case. No emoji, no abbreviations a new agent wouldn't recognize.
   - Same grammatical pattern across siblings (all noun phrases, or all
     "X Not Y" forms, etc.). Mix-and-match is not allowed.
   - Short — under 60 characters per name.

5) RIGHT GRANULARITY
   - Top-level categories: broad themes. Aim for ~${targetCount} (between
     ${Math.max(4, targetCount - 3)} and ${targetCount + 3}).
   - Each category has ${minSubsPerCat}–${maxSubsPerCat} sub-categories.
   - Sub-categories are concrete issues, not paraphrases of the parent.
   - A sub-category belongs to exactly ONE parent; never duplicated.

6) EVIDENCE-BASED
   - Every category and sub-category must trace back to at least 3
     summaries below. If a cluster has fewer, fold it into a sibling
     whose theme it shares — do NOT invent a category for one-off calls.

Return JSON ONLY, no markdown fence, no commentary:
{
  "categories": [
    { "name": "<Top-level Category>", "sub_categories": ["<Sub 1>", "<Sub 2>"] }
  ]
}

CALL SUMMARIES (n=${cleanSummaries.length}):
${numbered}
`;

  try {
    await awaitGeminiSlot(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetchWithTimeout(
      url,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json', maxOutputTokens },
        }),
      },
      300_000
    );

    if (!resp.ok) {
      if (resp.status === 429) {
        markGeminiRateLimited(parseRetryAfter(resp.headers.get('retry-after')), 'taxonomy', model);
      }
      return { success: false, error: `Gemini taxonomy gen failed: HTTP ${resp.status} ${await resp.text()}` };
    }

    const data = await resp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const finishReason = data?.candidates?.[0]?.finishReason;
    const cleaned = sanitizeJsonResponse(rawText);
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      const truncated = finishReason === 'MAX_TOKENS';
      logger.error('Taxonomy gen JSON parse failed', {
        error: e.message, finishReason, truncated, raw: rawText.slice(0, 1500),
      });
      return {
        success: false,
        error: truncated
          ? 'Gemini taxonomy response exceeded GEMINI_TAXONOMY_MAX_TOKENS — raise the cap or run on a smaller subset'
          : 'Invalid JSON returned from Gemini taxonomy gen',
        finishReason,
        raw: rawText.slice(0, 1500),
      };
    }

    const cats = Array.isArray(parsed?.categories) ? parsed.categories : [];
    // Normalize + validate. Drop empty/duplicate names; trim everything.
    const seenCat = new Set();
    const normalized = [];
    for (const c of cats) {
      const name = (typeof c?.name === 'string' ? c.name : '').trim();
      if (!name || seenCat.has(name.toLowerCase())) continue;
      const subsRaw = Array.isArray(c?.sub_categories) ? c.sub_categories : [];
      const seenSub = new Set();
      const subs = [];
      for (const s of subsRaw) {
        const sn = (typeof s === 'string' ? s : '').trim();
        if (!sn || seenSub.has(sn.toLowerCase())) continue;
        seenSub.add(sn.toLowerCase());
        subs.push(sn);
      }
      if (subs.length === 0) continue; // empty parents are useless
      seenCat.add(name.toLowerCase());
      normalized.push({ name, sub_categories: subs });
    }

    if (normalized.length === 0) {
      return { success: false, error: 'Gemini returned no usable categories', raw: text.slice(0, 1000) };
    }

    return {
      success:        true,
      categories:     normalized,
      summaries_used: cleanSummaries.length,
      gemini_model:   model,
    };
  } catch (err) {
    return { success: false, error: err.message || 'Unexpected taxonomy gen error' };
  }
}

// ─── Taxonomy generalisation (meta-prompt) ──────────────────────────────────
// Input: the CURRENT call_categories — an array of { name, sub_categories[] }
// objects (legacy flat docs with no sub_categories pass through with []).
// Output: a SMALLER, BROADER hierarchical taxonomy + a per-old-category
// mapping that says which (new parent, new sub_category) each old category
// becomes. The mapping powers the retro-remap that rewrites every existing
// call_analysis / calls record so historical data uses the new vocabulary.
//
// Hard rules enforced in the prompt:
//   - Cover EVERY old category (no orphans). If a category truly doesn't
//     fit anywhere, it gets mapped to its own ("Other", "<old_name>") pair
//     so we still have a deterministic destination.
//   - New top-level categories are mutually exclusive (no overlap).
//   - Sub-categories are short, concrete, and belong to exactly one parent.
async function generaliseCategoryTaxonomy(existingCategories, opts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const cats = (Array.isArray(existingCategories) ? existingCategories : [])
    .map(c => ({
      name: typeof c?.name === 'string' ? c.name.trim() : '',
      sub_categories: Array.isArray(c?.sub_categories)
        ? c.sub_categories.map(s => typeof s === 'string' ? s.trim() : '').filter(Boolean)
        : [],
    }))
    .filter(c => c.name);
  if (cats.length === 0) return { success: false, error: 'No existing categories to generalise' };

  // Decoupled from GEMINI_MAX_OUTPUT_TOKENS (which is tuned for Excel-cell
  // safety on transcription output). Taxonomy responses go straight to
  // JSON.parse and can include 100+ merged_from entries with pretty-printing
  // overhead, so we need a much higher cap. Override via GEMINI_TAXONOMY_MAX_TOKENS.
  const maxOutputTokens = Math.max(8192, Number(process.env.GEMINI_TAXONOMY_MAX_TOKENS) || 32768);

  const numbered = cats.map((c, i) =>
    `${i + 1}. ${c.name}${c.sub_categories.length ? '  [subs: ' + c.sub_categories.join(', ') + ']' : ''}`
  ).join('\n');

  const prompt = `
You are reorganising a customer-support call taxonomy. You will receive
${cats.length} existing categories (some with their own sub-categories) and
must consolidate them into a smaller, well-defined hierarchy. The output
becomes the canonical taxonomy used to classify EVERY future call AND will
be applied retroactively to every existing record — so the merge mapping
must be exhaustive and deterministic.

Hard requirements:

1) MUTUALLY EXCLUSIVE
   - No two new top-level categories overlap in meaning.
   - Within each category, no two sub-categories overlap.

2) EVERY OLD CATEGORY MAPS SOMEWHERE
   - Each input category MUST appear exactly once in some category's
     "merged_from" list. No orphans, no duplicates across categories.
   - If a single input category would split across multiple new buckets,
     pick the dominant fit and assign it once — never duplicate.

3) RIGHT GRANULARITY
   - Choose the number of top-level categories yourself based on the
     natural cluster boundaries in the input. A small, sharply-themed
     corpus might collapse to 5; a broad one might need 15. Don't pad
     to hit any count, don't merge unrelated themes just to keep totals
     low.
   - Same for sub-categories per parent — use as many as the data
     needs and no more. A parent covering two sharp issues should have
     two subs; one covering ten distinct issues should have ten.
   - Every category and every sub-category must be concrete enough
     that the next call clearly belongs to exactly one. No
     "Misc"/"General"/"Other" except as the residual sub when an
     input doesn't fit cleanly elsewhere.

4) NAMING
   - Title Case. No emoji. No abbreviations a new agent wouldn't recognise.
   - Same grammatical pattern across siblings.
   - Under 60 chars per name.

5) MERGE MAPPING
   - For each new category, list "merged_from" with one entry per old input
     it absorbs. Each entry is { "old_category": "<exact old name>",
     "new_sub_category": "<one of this category's sub_categories>" }.
   - The new_sub_category MUST come from the same category's
     sub_categories list — it cannot reference another category's subs.

Return JSON ONLY, no markdown fence, no commentary:
{
  "categories": [
    {
      "name": "<New Top-level>",
      "sub_categories": ["<sub 1>", "<sub 2>"],
      "merged_from": [
        { "old_category": "<old name>", "new_sub_category": "<sub 1>" }
      ]
    }
  ]
}

EXISTING CATEGORIES (n=${cats.length}):
${numbered}
`;

  try {
    await awaitGeminiSlot(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetchWithTimeout(
      url,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json', maxOutputTokens },
        }),
      },
      300_000
    );

    if (!resp.ok) {
      if (resp.status === 429) {
        markGeminiRateLimited(parseRetryAfter(resp.headers.get('retry-after')), 'generalise', model);
      }
      return { success: false, error: `Gemini generalise failed: HTTP ${resp.status} ${await resp.text()}` };
    }

    const data = await resp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const finishReason = data?.candidates?.[0]?.finishReason;
    const cleaned = sanitizeJsonResponse(rawText);
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) {
      const truncated = finishReason === 'MAX_TOKENS';
      logger.error('Generalise JSON parse failed', {
        error: e.message, finishReason, truncated, raw: rawText.slice(0, 1500),
      });
      return {
        success: false,
        error: truncated
          ? 'Gemini taxonomy response exceeded GEMINI_TAXONOMY_MAX_TOKENS — raise the cap or run on a smaller subset'
          : 'Invalid JSON returned from Gemini generalise',
        finishReason,
        raw: rawText.slice(0, 1500),
      };
    }

    // Normalise the response and build the per-old-category mapping.
    const oldNamesLower = new Set(cats.map(c => c.name.toLowerCase()));
    const seenOld       = new Set();   // old category names already mapped (case-insensitive)
    const seenNewName   = new Set();   // new top-level names (case-insensitive, dedupe)
    const normalized    = [];
    const mapping       = {};          // old_category_name → { new_category, new_sub_category }

    for (const c of (Array.isArray(parsed?.categories) ? parsed.categories : [])) {
      const newName = (typeof c?.name === 'string' ? c.name : '').trim();
      if (!newName || seenNewName.has(newName.toLowerCase())) continue;
      const subsRaw = Array.isArray(c?.sub_categories) ? c.sub_categories : [];
      const validSubs = [];
      const subsSeen = new Set();
      for (const s of subsRaw) {
        const sn = (typeof s === 'string' ? s : '').trim();
        if (!sn || subsSeen.has(sn.toLowerCase())) continue;
        subsSeen.add(sn.toLowerCase());
        validSubs.push(sn);
      }
      if (validSubs.length === 0) continue;

      const subSetLower = new Set(validSubs.map(s => s.toLowerCase()));
      const mergedRaw = Array.isArray(c?.merged_from) ? c.merged_from : [];
      const accepted  = [];
      for (const m of mergedRaw) {
        const oldName = (typeof m?.old_category === 'string' ? m.old_category : '').trim();
        const newSub  = (typeof m?.new_sub_category === 'string' ? m.new_sub_category : '').trim();
        if (!oldName) continue;
        const oldLower = oldName.toLowerCase();
        if (!oldNamesLower.has(oldLower) || seenOld.has(oldLower)) continue;       // unknown or already mapped
        const subToUse = subSetLower.has(newSub.toLowerCase()) ? newSub : validSubs[0];
        seenOld.add(oldLower);
        accepted.push({ old_category: oldName, new_sub_category: subToUse });
        mapping[oldName] = { new_category: newName, new_sub_category: subToUse };
      }

      seenNewName.add(newName.toLowerCase());
      normalized.push({ name: newName, sub_categories: validSubs, merged_from: accepted });
    }

    // Catch-all for any old category Gemini didn't map: send them to the
    // "Uncategorised" sentinel rather than synthesising a real parent in the
    // call_categories collection. Records that retro-remap into Uncategorised
    // get picked up by the hourly auto-worker, which tries to fit them into
    // the live generalised taxonomy on a recurring tick. The sentinel
    // (Uncategorised, -) is NOT a real category — it lives only on records,
    // never in the call_categories collection.
    const unmapped = cats.filter(c => !seenOld.has(c.name.toLowerCase()));
    if (unmapped.length > 0) {
      for (const u of unmapped) {
        mapping[u.name] = { new_category: 'Uncategorised', new_sub_category: '-' };
      }
      logger.warn('Generalise: unmapped categories sent to Uncategorised sentinel', { count: unmapped.length });
    }

    if (normalized.length === 0) {
      return { success: false, error: 'Gemini returned no usable categories', raw: text.slice(0, 1000) };
    }

    return {
      success:        true,
      categories:     normalized,
      mapping,                                 // old_name → { new_category, new_sub_category }
      input_count:    cats.length,
      output_count:   normalized.length,
      gemini_model:   model,
    };
  } catch (err) {
    return { success: false, error: err.message || 'Unexpected generalise error' };
  }
}

async function categorizeRecording(audioUrl, { callCategories = [], bugCategories = [] } = {}, maxRetries = 3) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model  = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const maxOutputTokens = Math.max(1024, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 8192);
  // Fallback model — used only when the primary returns 429 on this request.
  // Set to empty string in env to disable the fallback entirely.
  const fallbackEnv    = process.env.GEMINI_FALLBACK_MODEL;
  const fallbackModel  = (fallbackEnv === undefined ? 'gemini-2.5-flash-lite' : fallbackEnv).trim();
  const fallbackEnabled = !!fallbackModel && fallbackModel !== model;

  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  // When the dynamic taxonomy is off, Gemini is never shown the
  // `call_categories` collection and never asked for call_category /
  // call_sub_category — those are derived server-side from the hardcoded
  // schema after the response lands. No prompt input, no invented output.
  const useDynamicCategories = dynamicCategoriesEnabled();

  const startTime = Date.now();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let fileName = null;

    try {
      if (attempt > 0) {
        const waitMs = Math.min(2 ** attempt, 5) * 1000;
        logger.debug('Gemini retry', { attempt: attempt + 1, maxRetries, waitSec: waitMs / 1000 });
        await new Promise(r => setTimeout(r, waitMs));
      }

      // ── Upload (stream URL → Gemini, no local download) ──────────────────
      logger.debug('Gemini streaming audio');
      const upStart = Date.now();

      const { fileUri, fileName: fn } = await uploadAudioToGemini(audioUrl, apiKey);
      fileName = fn;
      logger.debug('Gemini upload done', { durationSec: ((Date.now() - upStart) / 1000).toFixed(1) });

      // ── Generate analysis ─────────────────────────────────────────────────
      const genStart   = Date.now();
      const schemaJson = JSON.stringify(CATEGORIZATION_SCHEMA, null, 2);

      // Task 10 and its two output keys exist only while the dynamic taxonomy
      // is enabled. With it off we drop both, so there is nothing for the model
      // to invent — the keys are filled from `category`/`sub_category` below.
      const taxonomyTask = !useDynamicCategories ? '' : `10) Call Category & Sub-Category:
   - Use the hierarchical taxonomy below. Each entry is { "name": "<top-level>", "sub_categories": [...] }.
   - Pick a call_category whose name best fits the ai_insight.
   - Then pick a call_sub_category from THAT category's sub_categories list — never from a different category's sub-list.
   - If no top-level fits: call_category = "Uncategorised", call_sub_category = "-".
   - If a top-level fits but no sub matches: call_sub_category = "Other".
   TAXONOMY: ${JSON.stringify(callCategories)}

`;
      const taxonomyOutputKeys = !useDynamicCategories ? '' : `
  "call_category": "",
  "call_sub_category": "",`;
      // Bug detection keeps its own numbering whether or not task 10 is present.
      const bugCategoryTaskNo = useDynamicCategories ? 11 : 10;

      const prompt = `
You are analyzing ONE audio call recording from the UPTET-2026 candidate support helpline.
The call is between a candidate (or their representative) and a support executive.
The audio is provided as file_data in this request.

RETURN ONLY ONE VALID JSON OBJECT.
Do not include markdown, explanations, or any extra text.

═══════════════════════════════════════════════════════
STRICT FIELD OWNERSHIP — violating these rules is wrong
═══════════════════════════════════════════════════════
Every observation belongs to EXACTLY ONE field. Before writing any field, check: "Does this belong somewhere else?"

  audio_quality → owns ALL observations about recording/connection quality: noise, drops, echo, distortion, silence, one-sided audio, unclear voices. If you want to write anything about audio anywhere else — DON'T. Put it only in audio_quality.

  bugs          → owns ONLY software/portal malfunctions reported by the candidate. Nothing else.

  agent_score   → owns ONLY agent behaviour: politeness, accuracy, resolution effort, communication.

  call_resolved → owns ONLY whether the candidate's problem was closed. One word: Yes / No / Partial.

  ai_insight    → owns a 4-5 word label for the CANDIDATE'S ISSUE ONLY. Must describe what the candidate called about — never audio, never agent, never outcome.

  summary       → owns a two-sentence factual recap: sentence 1 = candidate's issue, sentence 2 = what the agent did or said.

  category /
  sub_category  → own the query type per schema. Based purely on what the candidate asked — not audio, not agent.

═══════════════════════════════════════════════════════
AUDIO UNCLEAR SPECIAL CASE — if category = "Audio Unclear"
═══════════════════════════════════════════════════════
When audio is too noisy, silent, or unintelligible to determine the candidate's issue, apply these EXACT values — no exceptions, no creative text:
  category      = "Audio Unclear"
  sub_category  = ""
  summary       = "Audio quality insufficient for analysis."
  ai_insight    = "-"
  bugs          = "-"
  call_resolved = "No"
  agent_score   = null
  audio_quality = { "rating": "<Good|Moderate|Poor based on what you actually hear>", "issues": "<specific problems you detected, e.g. heavy background noise, call dropped, only silence, distorted voice>" }
  transcription = "<whatever partial transcript is possible, or empty string>"

  IMPORTANT: audio_quality is NOT optional for Audio Unclear calls — it is the primary reason this category exists. You MUST describe exactly what makes the audio unclear. Never leave rating empty.

TASKS:
1) Transcription:
   - Produce a full transcript with speaker differentiation.
   - Use these exact speaker labels on their own line before each turn:
       "CANDIDATE:" for the caller/candidate
       "AGENT:" for the support executive
       "SYSTEM:" for any IVR, automated voice, hold music, or pre-recorded messages
   - If parts are unclear, write [inaudible].
   - If the conversation is in Hindi, English, or a mix of both, transcribe in Hinglish (Hindi words written in Roman/Latin script mixed with English). Do NOT use Devanagari script.
   - Example: "CANDIDATE: Mera registration number nahi mil raha hai, kya aap help kar sakte hain?"

2) Categorization:
   - Determine if the audio is clear enough to identify the candidate's issue.
   - If NOT (too noisy, silent, unintelligible): apply the Audio Unclear special case above — stop here for all other fields.
   - If YES: choose exactly ONE category and ONE sub_category from the schema. category MUST be a top-level key; sub_category MUST be a listed value under it. Do not invent or paraphrase.

3) Summary (only if audio is clear):
   - Sentence 1: what issue did the candidate raise?
   - Sentence 2: what did the agent do or say in response?
   - Do NOT mention: audio quality, noise, agent tone, agent score, whether call was resolved. Those have their own fields.
   - WRONG: "The call had poor audio but the agent tried to help."
   - RIGHT:  "The candidate asked about OBC certificate validity. The agent confirmed the certificate must be issued within one year."

4) AI Insight (only if audio is clear):
   - A 4-5 word phrase describing the candidate's query or issue — nothing else.
   - WRONG: "Unclear audio, no issue identified" / "Candidate issue not articulated" / "Agent resolved payment query"
   - RIGHT:  "OBC certificate validity query" / "OTR portal not loading" / "Payment deducted form incomplete"
   - No full sentences. No punctuation at end.

5) Bug Detection (only if audio is clear):
   - Only flag portal/software malfunctions explicitly reported by the candidate.
   - WRONG: "Poor audio quality on call" / "Candidate could not articulate issue"
   - RIGHT:  "Submit button on OTR preview page does not respond to clicks."
   - If none: return exactly "-".

6) Agent Score (required for every call except Audio Unclear):
   - Score the agent 1–10 on: professionalism, issue comprehension, accuracy of guidance, resolution, clarity, call handling.
   - Do NOT factor in audio quality or the difficulty of the candidate's issue.
   - Use the full 1–10 range — do not default to 5 when uncertain; make a judgment.
   - Return null ONLY if category = "Audio Unclear" (i.e. no agent speech could be heard at all). For every other call, a score is mandatory.

7) Call Resolved (only if audio is clear):
   - "Yes" — candidate's issue fully resolved or candidate confirmed satisfaction.
   - "Partial" — some progress but issue not fully closed.
   - "No" — issue unresolved or call ended without a clear answer.
   - Do NOT return "No" just because audio was poor — that goes in audio_quality.

8) Audio Quality:
   - Rate ONLY the technical recording: noise, drops, echo, distortion, audibility.
   - Every audio observation MUST appear here and NOWHERE ELSE in the response.
   - "rating": "Good" | "Moderate" | "Poor"
   - "issues": comma-separated problems, or "-" if none.
   - Good = clear, minimal noise. Moderate = some noise/distortion but understandable. Poor = heavy noise, drops, or largely unintelligible.

9) Language detection:
   - List all languages spoken (e.g., ["Hindi", "English"]).

${taxonomyTask}${bugCategoryTaskNo}) Bug Category:
   - If bugs is not "-" (i.e., a real bug was found), assign a bug_category from this list: ${JSON.stringify(bugCategories)}
   - If the bug does NOT fit any of the above categories, set bug_category to "Uncategorised".
   - If bugs is "-", set bug_category to "-".

CATEGORIZATION SCHEMA:
${schemaJson}

OUTPUT FORMAT (must match exactly):
{
  "category": "",
  "sub_category": "",
  "summary": "",
  "ai_insight": "",
  "bugs": "",${taxonomyOutputKeys}
  "bug_category": "",
  "agent_score": null,
  "call_resolved": "",
  "audio_quality": { "rating": "", "issues": "" },
  "transcription": "",
  "language": [],
  "error": null
}
`;

      const buildGenUrl = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { file_data: { mime_type: 'audio/x-wav', file_uri: fileUri } },
          ],
        }],
        generationConfig: { response_mime_type: 'application/json', maxOutputTokens },
      };
      const payloadBody = JSON.stringify(payload);

      logger.debug('Gemini running analysis');
      // Try primary model first. The slot wait covers both the global
      // min-interval AND any active per-model cooldown — so if primary is
      // already cooling down from a sibling worker's 429, we'll wait here.
      // To skip waiting we fall back to a sibling model; that path lives in
      // the 429 branch below.
      await awaitGeminiSlot(model);
      let genResp = await fetchWithTimeout(
        buildGenUrl(model),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadBody },
        300_000
      );
      let modelUsed = model;
      let usedFallback = false;

      // 429 fallback. Only one redirect — if the fallback also 429s we let the
      // worker retry through normal backoff. Skip fallback if it's disabled,
      // identical to the primary, or itself currently rate-limited.
      if (genResp.status === 429 && fallbackEnabled) {
        markGeminiRateLimited(parseRetryAfter(genResp.headers.get('retry-after')), 'generate-primary', model);
        const fallbackCooling = getCooldown(fallbackModel) > Date.now();
        if (!fallbackCooling) {
          logger.warn('Gemini primary rate-limited, falling back', { primary: model, fallback: fallbackModel });
          // Drain the 429 response so the connection releases.
          try { await genResp.text(); } catch { /* ignore */ }
          await awaitGeminiSlot(fallbackModel);
          genResp = await fetchWithTimeout(
            buildGenUrl(fallbackModel),
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payloadBody },
            300_000
          );
          modelUsed = fallbackModel;
          usedFallback = true;
        } else {
          logger.warn('Gemini primary rate-limited but fallback also cooling — failing for retry', {
            primary: model, fallback: fallbackModel,
          });
        }
      }

      // Async cleanup — fire and forget
      if (fileName) {
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
          { method: 'DELETE' }, 30_000
        ).catch(() => {});
        fileName = null;
      }

      if (!genResp.ok) {
        if (genResp.status === 429) {
          markGeminiRateLimited(parseRetryAfter(genResp.headers.get('retry-after')), 'generate', modelUsed);
        }
        const errText = await genResp.text();
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: `Gemini generate failed (model=${modelUsed}): HTTP ${genResp.status} ${errText}` };
      }

      const resultData = await genResp.json();
      const candidates = resultData?.candidates;
      if (!candidates?.length) {
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: 'No candidates returned from Gemini' };
      }

      const textResponse = candidates[0]?.content?.parts?.[0]?.text || '{}';
      let analysis;
      try {
        analysis = JSON.parse(textResponse);
      } catch {
        if (attempt < maxRetries - 1) continue;
        return { success: false, error: 'Invalid JSON returned from Gemini' };
      }

      if (analysis.error) return { success: false, error: analysis.error };

      // Reject looping transcriptions as permanent failure. Retrying the same
      // audio with the same model will just reproduce the loop — burn no more
      // quota. Admin can re-queue via /api/analysis/reset-loops after tuning.
      if (detectTranscriptionLoop(analysis.transcription)) {
        logger.warn('Gemini transcription loop detected', {
          call_id_hint: audioUrl?.slice(-40),
          transcription_chars: (analysis.transcription || '').length,
        });
        return { success: false, permanent: true, error: 'transcription_loop_detected' };
      }

      // Validate (call_category, call_sub_category) against the taxonomy in
      // force. Gemini occasionally hallucinates a category not in the list, or
      // pairs a sub-category with the wrong parent. Snap to safe defaults so
      // the DB never holds inconsistent pairs.
      //
      // Dynamic taxonomy OFF: the model was never asked for these fields, so
      // seed them from the hardcoded category/sub_category it *was* asked for
      // and validate against CATEGORIZATION_SCHEMA. A pair that isn't in the
      // schema (the model paraphrasing, ~6% of historical rows) lands on
      // Uncategorised rather than smuggling an invented name through.
      const taxonomyMap = new Map();
      if (useDynamicCategories) {
        for (const c of (callCategories || [])) {
          if (c?.name) taxonomyMap.set(c.name, new Set(Array.isArray(c.sub_categories) ? c.sub_categories : []));
        }
      } else {
        for (const [name, subs] of Object.entries(CATEGORIZATION_SCHEMA)) {
          taxonomyMap.set(name, new Set(subs));
        }
        analysis.call_category     = cleanCategory(analysis.category)     || 'Uncategorised';
        analysis.call_sub_category = cleanCategory(analysis.sub_category) || '-';
      }
      let validCategory    = analysis.call_category    || 'Uncategorised';
      let validSubCategory = analysis.call_sub_category || '-';
      // Preserve "Uncategorised" as-is. For everything else, the parent must exist.
      if (validCategory !== 'Uncategorised' && taxonomyMap.size > 0 && !taxonomyMap.has(validCategory)) {
        logger.warn('Gemini returned unknown call_category — snapping', { returned: validCategory });
        validCategory    = 'Uncategorised';
        validSubCategory = '-';
      }
      // Sub-category must belong to the chosen parent (or be the wildcards "-"/"Other").
      if (validCategory !== 'Uncategorised' && validSubCategory !== '-' && validSubCategory !== 'Other') {
        const allowed = taxonomyMap.get(validCategory);
        if (allowed && allowed.size > 0 && !allowed.has(validSubCategory)) {
          logger.warn('Gemini returned sub-category outside parent — snapping to "Other"', {
            parent: validCategory, returned: validSubCategory,
          });
          validSubCategory = 'Other';
        }
      }
      analysis.call_category     = validCategory;
      analysis.call_sub_category = validSubCategory;

      logger.info('Gemini analysis complete', { totalSec: ((Date.now() - startTime) / 1000).toFixed(1), analysisSec: ((Date.now() - genStart) / 1000).toFixed(1), model: modelUsed, fallback: usedFallback });

      return {
        success:           true,
        category:          cleanCategory(analysis.category)      || 'Uncategorized',
        sub_category:      cleanCategory(analysis.sub_category)  || 'N/A',
        summary:           analysis.summary       || '',
        ai_insight:        analysis.ai_insight    || '',
        bugs:              analysis.bugs          || '-',
        call_category:     analysis.call_category || 'Uncategorised',
        call_sub_category: analysis.call_sub_category || '-',
        bug_category:      analysis.bug_category  || '-',
        agent_score:       typeof analysis.agent_score === 'number' ? analysis.agent_score : null,
        call_resolved:     analysis.call_resolved || 'No',
        audio_quality: {
          rating: analysis.audio_quality?.rating || 'Moderate',
          issues: analysis.audio_quality?.issues || '-',
        },
        transcription:     analysis.transcription || '',
        language:          toLanguageArray(analysis.language),
        model_used:        modelUsed,
        used_fallback:     usedFallback,
      };

    } catch (err) {
      // Cleanup uploaded Gemini file on error
      if (fileName) {
        fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
          { method: 'DELETE' }, 30_000
        ).catch(() => {});
      }

      const isRetryable =
        err.name === 'AbortError' ||
        err.code === 'ECONNRESET'  ||
        err.code === 'ECONNREFUSED'||
        err.message?.toLowerCase().includes('timeout') ||
        err.message?.toLowerCase().includes('connection');

      if (isRetryable && attempt < maxRetries - 1) {
        logger.warn('Gemini retryable error', { attempt: attempt + 1, error: err.message });
        continue;
      }

      logger.error('Gemini fatal error', { error: err.message });
      return { success: false, error: err.message, permanent: !!err.permanent };
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}

// ─── Email analysis ───────────────────────────────────────────────────────────
/**
 * Emails go through the SAME taxonomy as calls (CATEGORIZATION_SCHEMA), which
 * was itself extended against the email corpus in docs/email-taxonomy-fit.md.
 * What differs is only what a mail can carry: there is no audio to transcribe,
 * no agent turn to score, and no call outcome to judge, so audio_quality /
 * transcription / agent_score / call_resolved have no email equivalent and are
 * absent rather than faked.
 *
 * Parity that IS kept with categorizeRecording:
 *   • the same category/sub_category schema and snapping rules
 *   • the same bugs + bug_category detection
 *   • the same rate-limit gate, 429 fallback model, and retry classification
 *   • one sentinel category for "nothing to analyse" (Email too Short) and one
 *     for "cannot tell what they want" (Content Unclear), mirroring
 *     Call too Short / Audio Unclear.
 */

// Per-email prompt budget. A support mailbox routinely carries megabyte-long
// HTML newsletters and 40-message quoted threads; the issue is almost always in
// the first screenful, so trim rather than pay for the tail.
function emailBodyCharLimit() {
  return Math.max(500, Number(process.env.EMAIL_ANALYSIS_MAX_CHARS) || 12_000);
}

/**
 * Strip the quoted history and signature block so the model reads THIS message
 * rather than the whole thread. Conservative: only well-known reply markers.
 */
function stripQuotedText(body) {
  if (!body) return '';
  const markers = [
    /^\s*On .{0,120}wrote:\s*$/im,               // Gmail / Apple Mail
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im, // Outlook
    /^\s*_{10,}\s*$/m,                            // Outlook divider
    /^\s*From:\s.+\s*$/im,                        // forwarded header block
  ];
  let cut = body.length;
  for (const re of markers) {
    const m = body.match(re);
    if (!m || m.index === undefined) continue;
    // Ignore a marker that would leave nothing behind — candidates often reply
    // above a blank line, or forward a thread without writing anything at all.
    // In that case the quoted text IS the content and must be kept.
    if (!body.slice(0, m.index).trim()) continue;
    if (m.index < cut) cut = m.index;
  }
  return body.slice(0, cut).replace(/\n{3,}/g, '\n\n').trim();
}

/** Very rough HTML → text, for mail that carries no text/plain part. */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The readable text of an email, preferring the plain-text part.
 * Exported for the worker's "is there anything here at all" check.
 */
function emailToPlainText(email = {}) {
  const raw = (email.body_text && email.body_text.trim())
    ? email.body_text
    : htmlToText(email.body_html);
  return stripQuotedText(raw);
}

/**
 * Snap (category, sub_category) onto the taxonomy actually in force, so the DB
 * can never hold a parent/child pair that does not exist. Same rules the call
 * path applies inline; kept as a helper here so the email path cannot drift.
 */
function snapToTaxonomy(category, subCategory, { taxonomy, dynamic }) {
  const map = new Map();
  if (dynamic) {
    for (const c of (taxonomy || [])) {
      if (c?.name) map.set(c.name, new Set(Array.isArray(c.sub_categories) ? c.sub_categories : []));
    }
  } else {
    for (const [name, subs] of Object.entries(CATEGORIZATION_SCHEMA)) map.set(name, new Set(subs));
  }

  let cat = cleanCategory(category) || 'Uncategorised';
  let sub = cleanCategory(subCategory) || '-';

  if (cat !== 'Uncategorised' && map.size > 0 && !map.has(cat)) {
    logger.warn('[EmailAI] Unknown category — snapping to Uncategorised', { returned: cat });
    return { category: 'Uncategorised', sub_category: '-' };
  }
  if (cat !== 'Uncategorised' && sub !== '-' && sub !== 'Other') {
    const allowed = map.get(cat);
    if (allowed && allowed.size > 0 && !allowed.has(sub)) {
      logger.warn('[EmailAI] Sub-category outside parent — snapping to "Other"', { parent: cat, returned: sub });
      sub = 'Other';
    }
  }
  return { category: cat, sub_category: sub };
}

/**
 * POST a text-only prompt to Gemini and return parsed JSON, applying the same
 * global rate-limit gate and 429 → fallback-model behaviour the audio path uses.
 * @returns {Promise<{ok: true, json: object, model: string, usedFallback: boolean}
 *                  | {ok: false, status?: number, error: string, retryable: boolean}>}
 */
async function generateJson(prompt, { apiKey, model, fallbackModel, maxOutputTokens }) {
  const buildUrl = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json', maxOutputTokens },
  });
  const post = m => fetchWithTimeout(
    buildUrl(m),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    120_000
  );

  await awaitGeminiSlot(model);
  let resp = await post(model);
  let modelUsed = model;
  let usedFallback = false;

  const fallbackEnabled = !!fallbackModel && fallbackModel !== model;
  if (resp.status === 429 && fallbackEnabled) {
    markGeminiRateLimited(parseRetryAfter(resp.headers.get('retry-after')), 'email-primary', model);
    if (getCooldown(fallbackModel) <= Date.now()) {
      logger.warn('[EmailAI] Primary rate-limited, falling back', { primary: model, fallback: fallbackModel });
      try { await resp.text(); } catch { /* release the socket */ }
      await awaitGeminiSlot(fallbackModel);
      resp = await post(fallbackModel);
      modelUsed = fallbackModel;
      usedFallback = true;
    }
  }

  if (!resp.ok) {
    if (resp.status === 429) markGeminiRateLimited(parseRetryAfter(resp.headers.get('retry-after')), 'email', modelUsed);
    const text = await resp.text().catch(() => '');
    return {
      ok: false,
      status: resp.status,
      error: `Gemini email analysis failed (model=${modelUsed}): HTTP ${resp.status} ${text.slice(0, 300)}`,
      // 4xx other than 429 means the request itself is wrong — retrying burns quota.
      retryable: resp.status === 429 || resp.status >= 500,
    };
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, error: 'No candidates returned from Gemini', retryable: true };

  try {
    return { ok: true, json: JSON.parse(sanitizeJsonResponse(text)), model: modelUsed, usedFallback };
  } catch {
    return { ok: false, error: 'Invalid JSON returned from Gemini', retryable: true };
  }
}

/**
 * Categorize ONE support email against CATEGORIZATION_SCHEMA.
 *
 * @param {object} email  As stored in the `emails` collection: subject,
 *                        from_name, from_email, received_at, body_text,
 *                        body_html, attachments.
 * @param {object} opts   { callCategories, bugCategories } — the same live
 *                        taxonomy collections the call worker passes.
 * @returns {Promise<object>} { success, category, sub_category, summary,
 *                        ai_insight, bugs, bug_category, email_category,
 *                        email_sub_category, language, model_used,
 *                        used_fallback } or { success: false, error, permanent }
 */
async function categorizeEmail(email = {}, { callCategories = [], bugCategories = [] } = {}, maxRetries = 3) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not set' };

  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const fallbackEnv = process.env.GEMINI_FALLBACK_MODEL;
  const fallbackModel = (fallbackEnv === undefined ? 'gemini-2.5-flash-lite' : fallbackEnv).trim();
  // Emails need far less headroom than a transcript — no audio to transcribe.
  const maxOutputTokens = Math.max(512, Number(process.env.EMAIL_ANALYSIS_MAX_TOKENS) || 2048);
  const useDynamicCategories = dynamicCategoriesEnabled();

  const bodyText = emailToPlainText(email);
  const limit = emailBodyCharLimit();
  const trimmed = bodyText.length > limit
    ? `${bodyText.slice(0, limit)}\n[… ${bodyText.length - limit} more characters omitted]`
    : bodyText;

  const attachmentNames = (email.attachments || []).map(a => a.filename).filter(Boolean);

  const taxonomyTask = !useDynamicCategories ? '' : `8) Email Category & Sub-Category:
   - Use the hierarchical taxonomy below: { "name": "<top-level>", "sub_categories": [...] }.
   - Pick an email_category whose name best fits the ai_insight, then a
     email_sub_category from THAT category's list — never another category's.
   - If no top-level fits: email_category = "Uncategorised", email_sub_category = "-".
   - If a top-level fits but no sub matches: email_sub_category = "Other".
   TAXONOMY: ${JSON.stringify(callCategories)}

`;
  const taxonomyOutputKeys = !useDynamicCategories ? '' : `
  "email_category": "",
  "email_sub_category": "",`;
  const bugCategoryTaskNo = useDynamicCategories ? 9 : 8;

  const prompt = `
You are analyzing ONE email sent to the UPTET-2026 candidate support helpline
mailbox. The sender is a candidate (or their representative). You are reading
only what the candidate wrote — there is no support reply to judge.

RETURN ONLY ONE VALID JSON OBJECT.
Do not include markdown, explanations, or any extra text.

═══════════════════════════════════════════════════════
STRICT FIELD OWNERSHIP — violating these rules is wrong
═══════════════════════════════════════════════════════
Every observation belongs to EXACTLY ONE field.

  bugs          → owns ONLY software/portal malfunctions the candidate reports. Nothing else.

  ai_insight    → owns a 4-5 word label for the CANDIDATE'S ISSUE ONLY. Never about
                  formatting, language, attachments, or how the email was written.

  summary       → owns a two-sentence factual recap: sentence 1 = what the candidate's
                  problem is, sentence 2 = what they are asking support to do.

  category /
  sub_category  → own the query type per schema, based purely on what the candidate asks.

═══════════════════════════════════════════════════════
CONTENT UNCLEAR SPECIAL CASE — if category = "Content Unclear"
═══════════════════════════════════════════════════════
Use this ONLY when the email carries no identifiable request: an empty or
near-empty body, a bare greeting, an attachment with no explanatory text, an
automated bounce/out-of-office, or text too garbled to interpret. Then apply
these EXACT values:
  category      = "Content Unclear"
  sub_category  = ""
  summary       = "Email content insufficient for analysis."
  ai_insight    = "-"
  bugs          = "-"

Do NOT use Content Unclear merely because the email is short, informal,
misspelled, in Hindi, or written in Hinglish. A one-line request like
"payment ho gaya form nahi bhara" IS classifiable.

TASKS:
1) Categorization:
   - Choose exactly ONE category and ONE sub_category from the schema below.
   - category MUST be a top-level key; sub_category MUST be a listed value under it.
   - Do not invent or paraphrase schema names.
   - Many of these emails mix English, Devanagari Hindi and Hinglish, often in one
     sentence. Read all three; the language never changes the categorization.

2) Multiple issues in one email:
   - Candidates often raise two or three problems at once. Categorize the PRIMARY
     issue — the one they lead with or ask for most explicitly — and mention the
     secondary ones in the summary.

3) Summary:
   - Sentence 1: what is the candidate's problem?
   - Sentence 2: what are they asking support to do about it?
   - Include concrete identifiers they supply (registration number, exam level,
     board, payment reference) when present — those drive resolution.
   - Do NOT mention email formatting, attachments, or politeness.
   - RIGHT: "The candidate's fee was debited twice for the same application. They
            ask for one payment to be refunded and quote transaction ref 4471xx."

4) AI Insight:
   - A 4-5 word phrase describing the candidate's issue — nothing else.
   - RIGHT: "Duplicate payment refund request" / "Appearing option missing dropdown"
   - No full sentences. No trailing punctuation.

5) Bug Detection:
   - Only flag portal/software malfunctions explicitly described by the candidate:
     a field that will not accept valid input, a missing dropdown option, a page
     that will not load, a validation that rejects a correct value.
   - A candidate not knowing HOW to do something is NOT a bug.
   - RIGHT: "Qualification dropdown has no 'Appearing' option for D.El.Ed 2026."
   - If none: return exactly "-".

6) Language detection:
   - List the languages the candidate wrote in, e.g. ["Hindi", "English"].
   - Use "Hinglish" when Hindi is written in Roman script.

7) Requested action:
   - One of exactly: "Correction" | "Information" | "Refund" | "Technical Fix" |
     "Document Upload" | "Status Update" | "Other".
   - What the candidate wants done — independent of category.

${taxonomyTask}${bugCategoryTaskNo}) Bug Category:
   - If bugs is not "-", assign a bug_category from this list: ${JSON.stringify(bugCategories)}
   - If the bug fits none of them, set bug_category to "Uncategorised".
   - If bugs is "-", set bug_category to "-".

CATEGORIZATION SCHEMA:
${JSON.stringify(CATEGORIZATION_SCHEMA, null, 2)}

═══════════════════════════════════════════════════════
THE EMAIL
═══════════════════════════════════════════════════════
Subject: ${email.subject || '(no subject)'}
From:    ${email.from_name ? `${email.from_name} <${email.from_email || ''}>` : (email.from_email || '(unknown)')}
Date:    ${email.received_at ? new Date(email.received_at).toISOString() : '(unknown)'}
${attachmentNames.length ? `Attachments: ${attachmentNames.join(', ')}\n` : ''}
Body:
${trimmed || '(empty body)'}

OUTPUT FORMAT (must match exactly):
{
  "category": "",
  "sub_category": "",
  "summary": "",
  "ai_insight": "",
  "bugs": "",${taxonomyOutputKeys}
  "bug_category": "",
  "requested_action": "",
  "language": [],
  "error": null
}
`;

  const startTime = Date.now();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.min(2 ** attempt, 5) * 1000;
      logger.debug('[EmailAI] Retry', { attempt: attempt + 1, maxRetries, waitSec: waitMs / 1000 });
      await new Promise(r => setTimeout(r, waitMs));
    }

    let result;
    try {
      result = await generateJson(prompt, { apiKey, model, fallbackModel, maxOutputTokens });
    } catch (err) {
      const isRetryable =
        err.name === 'AbortError' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ECONNREFUSED' ||
        err.message?.toLowerCase().includes('timeout') ||
        err.message?.toLowerCase().includes('connection');
      if (isRetryable && attempt < maxRetries - 1) {
        logger.warn('[EmailAI] Retryable error', { attempt: attempt + 1, error: err.message });
        continue;
      }
      logger.error('[EmailAI] Fatal error', { error: err.message });
      return { success: false, error: err.message };
    }

    if (!result.ok) {
      if (result.retryable && attempt < maxRetries - 1) continue;
      // A non-retryable HTTP error will fail identically forever — mark it
      // permanent so the worker stops re-queueing it.
      return { success: false, error: result.error, permanent: !result.retryable };
    }

    const analysis = result.json;
    if (analysis.error) return { success: false, error: String(analysis.error) };

    const isUnclear = cleanCategory(analysis.category) === 'Content Unclear';

    // With the dynamic taxonomy off the model was never shown the live
    // taxonomy, so seed the pair from the schema answer it *was* asked for —
    // identical to how the call path fills call_category.
    const rawPair = useDynamicCategories
      ? { category: analysis.email_category, sub_category: analysis.email_sub_category }
      : { category: analysis.category, sub_category: analysis.sub_category };

    const snapped = isUnclear
      ? { category: 'Uncategorised', sub_category: '-' }
      : snapToTaxonomy(rawPair.category, rawPair.sub_category, { taxonomy: callCategories, dynamic: useDynamicCategories });

    // The schema pair itself is validated too, so an invented name from task 1
    // cannot reach the database.
    const primary = isUnclear
      ? { category: 'Content Unclear', sub_category: '' }
      : snapToTaxonomy(analysis.category, analysis.sub_category, { taxonomy: null, dynamic: false });

    logger.info('[EmailAI] Analysis complete', {
      gmail_id: email.gmail_id,
      category: primary.category,
      totalSec: ((Date.now() - startTime) / 1000).toFixed(1),
      model: result.model,
      fallback: result.usedFallback,
    });

    return {
      success:            true,
      category:           primary.category,
      sub_category:       primary.sub_category,
      summary:            analysis.summary || '',
      ai_insight:         isUnclear ? '-' : (analysis.ai_insight || ''),
      bugs:               analysis.bugs || '-',
      email_category:     snapped.category,
      email_sub_category: snapped.sub_category,
      bug_category:       (analysis.bugs && analysis.bugs !== '-') ? (analysis.bug_category || 'Uncategorised') : '-',
      requested_action:   analysis.requested_action || 'Other',
      language:           toLanguageArray(analysis.language),
      model_used:         result.model,
      used_fallback:      !!result.usedFallback,
      body_chars:         bodyText.length,
    };
  }

  return { success: false, error: 'Max retries exceeded' };
}

module.exports = {
  categorizeRecording,
  categorizeEmail,
  emailToPlainText,
  htmlToText,
  stripQuotedText,
  snapToTaxonomy,
  CATEGORIZATION_SCHEMA,
  detectTranscriptionLoop,
  generateCategoryTaxonomy,
  generaliseCategoryTaxonomy,
};
