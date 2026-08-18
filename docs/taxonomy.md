# Category Taxonomy — Single Source of Truth

**This page is authoritative.** Every category and sub-category the system assigns is listed here. If a value is not on this page, the system is not meant to produce it — treat any sighting as a bug, not as a new category.

Nothing here is invented by the doc: the [issue taxonomy](#full-listing) is transcribed from `CATEGORIZATION_SCHEMA` and was verified identical to the code — 17 categories, 196 sub-categories, no duplicates within or across categories.

> **Renamed from `call-categories.md` (2026-08-18).** The schema stopped being call-only when the email pipeline shipped: emails are classified against the same 17/196 list.

## The axes at a glance

The system runs **five** independent controlled vocabularies. They are often all called "category" in code and UI, which is the single biggest source of confusion — keep them apart.

| # | Axis | Values | Fixed? | Applies to | Defined in |
|---|---|---|---|---|---|
| 1 | [**Issue taxonomy**](#axis-1--issue-taxonomy) | 17 cats / 196 subs | ✅ hardcoded | calls, emails | `geminiService.js:14-245` |
| 2 | [Reserved values](#axis-2--reserved-values) | 8 sentinels | ✅ hardcoded | calls, emails | various |
| 3 | [Ticket categories](#axis-3--ticket-categories) | 7 | ✅ hardcoded | tickets | `tickets.js:9` |
| 4 | [Bug categories](#axis-4--bug-categories) | unbounded | ❌ AI-generated | calls, emails | `bug_categories` collection |
| 5 | [Requested action](#axis-5--requested-action) | 7 | ✅ hardcoded | emails | `geminiService.js:1605-1607` |

Axis 1 is what people mean by "the taxonomy" and is the one this page exists to pin down. Axes 3 and 4 are genuinely separate vocabularies that happen to share the word "category" — a ticket's `General Inquiry` has nothing to do with the issue taxonomy's `General Enquiry`.

There is also a sixth, **dormant** vocabulary: the [dynamic taxonomy](#the-dynamic-taxonomy-off-by-default) in the `call_categories` collection, switched off since 2026-08-17.

---

## Axis 1 — Issue taxonomy

Source: [`backend/src/services/geminiService.js:14-245`](../backend/src/services/geminiService.js) — the `CATEGORIZATION_SCHEMA` constant, embedded verbatim in both the call prompt and the email prompt.

**This is the single source of truth for what an issue can be.** Both channels classify against it; a category means the same thing whether it arrived by phone or by email.

### What it populates

| Field | On | Notes |
|---|---|---|
| `tags[]` | calls, emails | **The real verdict.** One `{category, sub_category}` pair per distinct issue, most important first. Max 5 (`MAX_TAGS`, `geminiService.js:1372`) |
| `category` / `sub_category` | calls, emails | `tags[0]`, mirrored so pre-tagging filters, exports and dashboards keep working |
| `call_category` / `call_sub_category` | calls | Validated pair; derived from the schema answer while the dynamic taxonomy is off |
| `email_category` / `email_sub_category` | emails | Same, for the email path |

An item may carry **several** tags, so tag counts sum to more than the item count. Any UI showing them must say "mentions", not "calls"/"emails" — see `backend/src/lib/tags.js`.

### Validation

Model output is snapped onto the schema by `snapToTaxonomy()` (`geminiService.js:1341`) and `snapTags()` (`geminiService.js:1387`):

- Category not in the schema → the whole pair becomes `Uncategorised` / `-`.
- Sub-category not under its stated parent → sub becomes `Other` (parent kept).
- Duplicate tags collapse; `Uncategorised` survives only as the sole tag.

⚠️ One gap remains: on the **call** path the scalar `category` / `sub_category` bypass this and get only a cosmetic prefix strip. See [Known issues](#known-issues).

### Summary

| # | Category | Subs |
|---|---|---|
| 1 | [Portal Access & Registration](#1-portal-access--registration) | 11 |
| 2 | [Identity Verification](#2-identity-verification) | 12 |
| 3 | [OTP, Password & CAPTCHA](#3-otp-password--captcha) | 8 |
| 4 | [Category & Reservation](#4-category--reservation) | 15 |
| 5 | [Address & Personal Details](#5-address--personal-details) | 12 |
| 6 | [Educational Qualifications](#6-educational-qualifications) | 16 |
| 7 | [Uploads & Documents](#7-uploads--documents) | 16 |
| 8 | [OTR Completion & Preview](#8-otr-completion--preview) | 8 |
| 9 | [Exam Application & Eligibility](#9-exam-application--eligibility) | 13 |
| 10 | [Payment & Fee](#10-payment--fee) | 14 |
| 11 | [Login & Account Access](#11-login--account-access) | 8 |
| 12 | [Amendment & Post-Submission](#12-amendment--post-submission) | 13 |
| 13 | [Exam Information](#13-exam-information) | 12 |
| 14 | [Admit Card & Certificate](#14-admit-card--certificate) | 12 |
| 15 | [Scribe & Compensatory Time](#15-scribe--compensatory-time) | 9 |
| 16 | [Result & Merit List](#16-result--merit-list) | 8 |
| 17 | [General Enquiry](#17-general-enquiry) | 9 |
| | **Total** | **196** |

Entries marked 🆕 were added in the 2026-08-14 revision.

### Full listing

#### 1. Portal Access & Registration

1. Fresh Registration Query
2. Duplicate Registration Concern
3. OTR vs Exam Application Confusion
4. Resume Incomplete Application
5. Offline Application Query
6. Portal Not Loading / Technical Error
7. Registration Form Submission Error
8. Multiple OTR Accounts Issue
9. OTR ID Not Received After Registration
10. Registration Confirmation Not Received
11. Apply / OTR Link Not Visible on Portal 🆕

#### 2. Identity Verification

1. Aadhaar OTP Not Received
2. Aadhaar Number Not Accepted
3. Aadhaar Mismatch
4. Name / DOB Mismatch Across Documents
5. Identity Proof Selection Query
6. Live Photo / Face Match Failure
7. Manual Aadhaar Verification Request
8. Photo Clicked During Verification Issue
9. Aadhaar Linked Mobile Not Available
10. Name Prefix Mismatch (KM / Kumari) 🆕
11. Post-Marriage Surname Mismatch in eKYC 🆕
12. Wrong ID Type Used at Registration 🆕

#### 3. OTP, Password & CAPTCHA

1. Mobile OTP Not Received
2. Email OTP Not Received
3. OTP Expired Before Use
4. Wrong OTP Entered Multiple Times
5. Password Forgotten / Reset
6. CAPTCHA Not Loading / Unclear
7. Account Recovery Query
8. OTP Coming on Wrong Number

#### 4. Category & Reservation

1. General Category Query
2. OBC Category & Creamy Layer
3. OBC Non-Creamy Layer Certificate Query
4. SC / ST Category
5. SC / ST Sub-Category Clarification
6. EWS Category
7. EWS Certificate Format / Validity Query
8. Divyang / PwD / PH Category
9. Disability Type & Percentage Query
10. Dependent Freedom Fighter Category
11. Ex-Army / Ex-Serviceman Category
12. Age Relaxation Query
13. UP Residency & Reservation Eligibility
14. Category Certificate Date Validity Query
15. Category Change After Form Submission

#### 5. Address & Personal Details

1. Permanent Address Entry Issue
2. Correspondence Address Entry Issue
3. District / State Dropdown Issue
4. Village / Ward / Tehsil Not Found
5. Pincode Not Accepted
6. Personal Details Correction Request
7. Date of Birth Entry Issue
8. Gender / Nationality Entry Issue
9. Twin Information Query
10. Father / Husband Name Entry Issue
11. Mobile / Email Change in Profile
12. Marital Status Field Query 🆕

#### 6. Educational Qualifications

1. Education Details Entry in OTR
2. Wrong Education Row Added
3. Board / University Not in Dropdown
4. B.Ed / D.El.Ed Qualification Entry
5. Graduation Subject / Stream Entry
6. Training Qualification Entry
7. Marks / Percentage Entry Issue
8. CGPA to Percentage Conversion Query
9. Year of Passing Entry Issue
10. Appearing / Passed Status Query
11. Final Year Appearing Candidate Entry
12. Multiple Degree Entry Issue
13. Appearing Option Missing in Dropdown 🆕
14. Board Roll Number Digit Length Rejected 🆕
15. Out-of-State / NIOS Qualification Not Listed 🆕
16. Graduation Field Mandatory but Not Applicable 🆕

#### 7. Uploads & Documents

1. Photograph Upload Issue
2. Signature Upload Issue
3. Photo Identity Proof Upload
4. Academic Certificate Upload
5. Category / Caste Certificate Upload
6. Domicile / Residency Certificate Upload
7. Handwritten Declaration Upload Issue
8. File Size / Format Requirement
9. File Too Large Error
10. Blurry / Unreadable Document Rejection
11. Document Preview Not Showing
12. Photo Background Color Requirement
13. Photo Dimensions Not Accepted
14. Upload Button Not Working
15. Wrong Person's Document Uploaded 🆕
16. Handwritten Declaration Language Requirement 🆕

#### 8. OTR Completion & Preview

1. Preview & Edit Before OTR Completion
2. OTR Profile Locked After Submission
3. Complete OTR Profile Step Query
4. OTR Submission Confirmation Not Received
5. Preview Section Data Missing or Wrong
6. How to Edit Saved OTR Data
7. OTR Final Submit Button Issue
8. Print / Download OTR Form

#### 9. Exam Application & Eligibility

1. Paper I Eligibility Query
2. Paper II Eligibility Query
3. Both Papers Application Query
4. Subject Group / Combination Selection
5. Practising Government Teacher Details Entry
6. Qualification Status (Passed / Appearing)
7. B.Ed Appearing Candidate Eligibility
8. D.El.Ed / BTC / JBT Eligibility Query
9. Age Limit Eligibility Query
10. Exam Centre Preference Entry
11. Application Form Section Not Saving
12. How to Apply for Exam After OTR
13. In-Service Teacher Without Graduation Eligibility 🆕

#### 10. Payment & Fee

1. Fee Amount Query
2. Category-wise Fee Query
3. Both Papers Fee Query
4. Payment Gateway / Method Query
5. Net Banking / UPI / Debit Card Issue
6. Challan Payment Query
7. Payment Pending / Processing Status
8. Money Debited but Application Incomplete
9. Duplicate Payment Risk
10. Duplicate Payment Refund Query
11. Payment Reconciliation Request
12. Application Status Showing PAID Confirmation
13. Fee Receipt / Challan Download Issue
14. Fee Waiver for Reserved Category Query

#### 11. Login & Account Access

1. Login Method Query
2. OTR ID Forgotten / Recovery
3. OTP Login Not Working
4. Account Locked / Blocked
5. Too Many Failed Login Attempts
6. Registered Mobile Not Accessible
7. Login with New Device Issue
8. Session Timeout Issue

#### 12. Amendment & Post-Submission

1. Amendment Window Opening Date Query
2. What Fields Can Be Corrected
3. Amendment Process Step-by-Step Query
4. Correction Window Already Closed
5. Photo / Signature Amendment
6. Name / DOB Correction After Submission
7. Category Correction After Submission
8. Subject / Paper Change After Submission
9. Address Correction After Submission
10. Re-payment Required After Amendment
11. Amendment Confirmation Not Received
12. Wrong Exam Level Selected (Primary vs Junior) 🆕
13. Form Cancellation / Withdrawal Request 🆕

#### 13. Exam Information

1. Important Dates & Schedule Query
2. Exam Pattern & Structure Query
3. Number of Questions / Total Marks
4. Qualifying Marks / Cut-off Query
5. Negative Marking Query
6. Exam Language / Medium Query
7. Question Paper Language Options
8. Exam Duration Query
9. Normalisation / Multi-Shift Query
10. TET Validity Period Query
11. Syllabus Query
12. Previous Year Paper Query

#### 14. Admit Card & Certificate

1. Admit Card Release Date Query
2. Admit Card Download Process
3. Admit Card Not Downloading / Available
4. Wrong Details on Admit Card
5. Exam Centre / Date / Time Query
6. Exam Centre Change Request
7. TET Pass Certificate Download
8. TET Certificate Validity Query
9. DigiLocker Certificate Query
10. Photo Mismatch on Admit Card
11. Category Error on Certificate
12. Duplicate Certificate / Marksheet Query

#### 15. Scribe & Compensatory Time

1. Scribe Eligibility Criteria Query
2. How to Request a Scribe
3. Scribe Arrangement Process
4. Scribe Documents & Declaration Required
5. Scribe Qualification / Education Limit
6. Compensatory Time (30 Minutes) Query
7. Scribe Declaration Form Submission
8. Medical Certificate for PwD Requirement
9. Disability Certificate Format Query

#### 16. Result & Merit List

1. Result Declaration Date Query
2. Result Check Process
3. Merit List Query
4. Cut-off Marks Query
5. Rank / Score Discrepancy
6. District Allocation Query
7. Selection Process After TET
8. Waiting List Query

#### 17. General Enquiry

1. Application Mode Query
2. Notification / Advertisement Query
3. Helpline Timing Query
4. Appointment / Job Guarantee Query
5. Transfer to Another Department
6. Call Back Request
7. Unrelated / Wrong Call
8. Repeated Call / Follow-up
9. Complaint Against Portal / Process

---

## Axis 2 — Reserved values

These appear in the same fields as Axis 1 but are **not** in `CATEGORIZATION_SCHEMA`. They are states, not issues — "we could not classify this" rather than "this is what it was about". Never add them to the schema, and always exclude them before computing category distributions.

| Value | Channel | Written by | Meaning |
|---|---|---|---|
| `Uncategorised` | both | `snapToTaxonomy` | Nothing in the schema fit. Paired with sub `-` |
| `-` | both | `snapToTaxonomy` | Null sub-category |
| `Other` | both | `snapToTaxonomy` | Parent fits, no sub-category does |
| `Call too Short` | call | `analysisWorker.js:104-113` | Duration > 0 and < 10s — skipped before Gemini is called |
| `Audio Unclear` | call | Gemini special case (`geminiService.js:944`) | Too noisy, silent, or unintelligible |
| `Email too Short` | email | `emailAnalysisWorker.js:32` | Body below the analysable threshold |
| `Content Unclear` | email | Gemini special case (`geminiService.js:1543`) | No identifiable request. Deliberately left **untagged** |
| `Uncategorized` / `N/A` | call | `geminiService.js:1206-1207` | ⚠️ Inconsistent spelling — see [Known issues](#known-issues) |

`Audio Unclear` and `Call too Short` are excluded from the corpus fed to `/generate-categories` (`analysis.js:566-568`).

These are **dispositions, not categories** — a distinction the schema does not model. See the disposition-axis recommendation in [`email-taxonomy-fit.md`](./email-taxonomy-fit.md#1-dispositions-belong-on-their-own-axis).

---

## Axis 3 — Ticket categories

Source: [`backend/src/routes/tickets.js:9`](../backend/src/routes/tickets.js), mirrored in three frontend files (`CreateTicketModal.jsx:6`, `TicketDetailModal.jsx:7`, `Tickets.jsx:173`).

**Chosen by a human when raising a ticket — never by the AI.** Unrelated to Axis 1 despite the similar wording. Anything not on this list is coerced to `General Inquiry` server-side (`tickets.js:74`).

1. General Inquiry
2. Technical Issue
3. Billing
4. Complaint
5. Service Request
6. Follow Up
7. Others

Adjacent ticket enums, same file: **priority** `Low` / `Medium` / `High` / `Urgent`; **status** `Open` / `In Progress` / `Resolved` / `Closed`; **source** `call` / `email` (absent = `call`, for tickets predating the field).

> The list is duplicated in four places with no shared constant. Changing it means editing all four.

---

## Axis 4 — Bug categories

**No fixed list — this axis is AI-generated and unbounded.** Stored in the `bug_categories` Mongo collection, populated hourly by `bugCategoryWorker.js`, which sends `Uncategorised` bugs to Gemini and asks it to mint new category names.

`bug_category` is set only when `bugs` is not `-`; otherwise it is `-`. A bug fitting nothing existing gets `Uncategorised` and waits for the next worker pass.

Unlike the call taxonomy, this pass **is not gated** by `DYNAMIC_CATEGORIES_ENABLED` — bugs have no hardcoded schema to fall back on, so `bug_category` would sit on `Uncategorised` forever if it were switched off (`bugCategoryWorker.js:96-104`).

If this axis is ever to become a controlled vocabulary, it needs a hardcoded schema like Axis 1. Until then it cannot be enumerated here — query the collection.

---

## Axis 5 — Requested action

Source: `geminiService.js:1605-1607`. **Emails only.** What the candidate wants done, independent of the issue category. Defaults to `Other`.

1. Correction
2. Information
3. Refund
4. Technical Fix
5. Document Upload
6. Status Update
7. Other

---

## The dynamic taxonomy (off by default)

`call_category` / `call_sub_category` were once driven by a *generated* taxonomy in the `call_categories` collection, rewritten by `POST /api/analysis/generate-categories` and `POST /api/analysis/generalise-categories`.

**Switched off 2026-08-17** via `DYNAMIC_CATEGORIES_ENABLED=false` (`backend/src/config/features.js`). While off:

- `call_category` / `email_category` are derived from the hardcoded schema and validated against it.
- Both generator endpoints return **409**.
- The hourly worker no longer mints `call_categories` entries.

It was turned off because the generated taxonomy had drifted to **292 invented category names** against a 17-category schema. Axis 1 is never gated — it always drives `category` / `sub_category`.

Turning the flag back on re-enables an unbounded vocabulary and invalidates this page as a complete list. Treat that as a deliberate architectural decision, not a config tweak.

---

## Changing the taxonomy

Since this page is the source of truth, the schema and this doc must move together.

1. **Edit `CATEGORIZATION_SCHEMA`** in `geminiService.js` — it is the only definition. Do not add categories anywhere else.
2. **Clear the evidence bar.** The schema's own generator prompt requires **≥3 real items** before a sub-category is justified (`geminiService.js:540-543`). Applies to hand-added entries too.
3. **Keep it mutually exclusive.** No sub-category may appear under two parents — the 2026-08-14 revision existed largely to fix exactly that.
4. **Never add a [reserved value](#axis-2--reserved-values)** as a real category.
5. **Update this page** — summary table, listing, change log.
6. **Consider the backfill.** Existing records keep their old values; a rename orphans historical rows unless they are remapped.

Verify doc and code still agree:

```bash
node -e "const {CATEGORIZATION_SCHEMA:S}=require('./backend/src/services/geminiService');
console.log(Object.keys(S).length+' cats, '+Object.values(S).flat().length+' subs')"
# expect: 17 cats, 196 subs
```

---

## Change log

### 2026-08-18 — consolidated into a single source of truth

Renamed from `call-categories.md`. No schema change: the 17/196 list was verified byte-identical to `CATEGORIZATION_SCHEMA`. Added the four non-call axes (reserved values, tickets, bug categories, requested action), the tagging model, and the validation rules — all of which existed in code but were undocumented.

### 2026-08-14 — evidence-driven revision (184 → 196)

Derived from 1,895 UPTET helpline emails; every addition clears the ≥3-item evidence bar the schema's own generator prompt imposes. Full analysis: [`email-taxonomy-fit.md`](./email-taxonomy-fit.md).

**Duplicates resolved (−2).** The schema previously violated its own mutual-exclusivity rule:

| Sub-category | Was | Now |
|---|---|---|
| `Password Forgotten / Reset` | in both #3 and #11 | **#3 only** — the category name explicitly claims "Password" |
| `OTR ID Forgotten` (#3) / `OTR ID Forgotten / Recovery` (#11) | same bucket, two names | **#11 only**, as `OTR ID Forgotten / Recovery` — identifier recovery is account access |

The governing split is now: **#3 owns credential challenges** (OTP delivery, CAPTCHA, password), **#11 owns account access** (login methods, lockouts, identifier recovery, sessions).

> `Account Recovery Query` remains in #3 and sits close to #11's `OTR ID Forgotten / Recovery`. Not a duplicate — generic recovery vs. specific identifier lookup — but worth watching if the two start colliding in practice.

**Sub-categories added (+14).** Counts are matched rows in the 1,895-email corpus:

| Rows | Added | To |
|---:|---|---|
| 33 | Name Prefix Mismatch (KM / Kumari) | #2 |
| 26 | Appearing Option Missing in Dropdown | #6 |
| 21 | Post-Marriage Surname Mismatch in eKYC | #2 |
| 20 | Apply / OTR Link Not Visible on Portal | #1 |
| 19 | Wrong Exam Level Selected (Primary vs Junior) | #12 |
| 13 | Wrong Person's Document Uploaded | #7 |
| 12 | Out-of-State / NIOS Qualification Not Listed | #6 |
| 9 | Board Roll Number Digit Length Rejected | #6 |
| 7 | Handwritten Declaration Language Requirement | #7 |
| 4 | Graduation Field Mandatory but Not Applicable | #6 |
| 4 | In-Service Teacher Without Graduation Eligibility | #9 |
| 3 | Wrong ID Type Used at Registration | #2 |
| 3 | Form Cancellation / Withdrawal Request | #12 |
| 3 | Marital Status Field Query | #5 |

Together these capture **177 rows (9.3% of the corpus)** and lift schema coverage from **79.5% → 82.4%**.

The most consequential is `Appearing Option Missing in Dropdown`: it separates a *portal defect* from the eligibility-query bucket `Final Year Appearing Candidate Entry`, which alone was carrying 207 rows (11% of all traffic). The defect is now countable instead of hidden inside a query category.

---

## Known issues

### The call path's scalar pair is still unvalidated

Validation coverage is uneven:

| Field | Call path | Email path |
|---|---|---|
| `tags[]` | ✅ snapped | ✅ snapped |
| `call_category` / `email_category` | ✅ snapped | ✅ snapped |
| `category` / `sub_category` | ❌ **cosmetic prefix strip only** | ✅ snapped |

On the call path, `category` / `sub_category` are written as `cleanCategory(analysis.category) || 'Uncategorized'` (`geminiService.js:1206-1207`) — whatever Gemini emits is persisted as-is. The email path routes the same pair through `snapToTaxonomy` (`geminiService.js:1695-1697`), so an invented name cannot reach the database there.

Because the scalar pair is the one every pre-tagging filter, export and dashboard reads, this gap is still user-visible on calls.

Measured against the 45,162 completed analyses on the cluster (2026-08-17 audit, predating tagging): **65.0% exact schema match**, 27.4% the dispositions above, 1.5% valid category with off-schema sub, and **6.0% a category name not in the schema at all** — 292 distinct invented names. Off-schema output rose from 0.2% of calls in March to 15.9% in May, which is what prompted `DYNAMIC_CATEGORIES_ENABLED`.

### Two spellings of the same sentinel

The call path defaults to `Uncategorized` / `N/A` (`geminiService.js:1206-1207`) while every other path uses `Uncategorised` / `-`. A filter for one silently misses the other. Worth unifying on the `-ise` spelling used everywhere else.

### The schema is call-shaped

`Call Back Request`, `Unrelated / Wrong Call`, `Repeated Call / Follow-up`, and `Helpline Timing Query` are phrased for voice calls and cannot match an email — which is why #17 General Enquiry scored zero hits across the entire email corpus. Now that the same schema serves both channels, this is a live problem rather than a cosmetic one. Unresolved; see the channel-neutrality recommendation in the analysis doc.

### The ticket category list is duplicated four times

`tickets.js:9`, `CreateTicketModal.jsx:6`, `TicketDetailModal.jsx:7`, `Tickets.jsx:173` — four independent copies with no shared constant, so they can drift silently.
