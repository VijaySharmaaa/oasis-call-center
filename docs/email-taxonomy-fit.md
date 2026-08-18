# Email Corpus vs. Categorization Schema — Fit & Gap Analysis

Fitting the UPTET-2026 email helpline corpus in `data/` against the 17-category `CATEGORIZATION_SCHEMA` (see [`taxonomy.md`](./taxonomy.md)), and identifying what the schema is missing.

> **Status: applied 2026-08-14.** All 14 proposed sub-categories and the duplicate fix are now live in `geminiService.js`. The schema went 184 → 196 sub-categories and coverage rose **79.5% → 82.4%**. Percentages in the *Result* section below are the **pre-change** baseline, kept as the record of why each change was made; the post-change figures are in [Outcome](#outcome-after-applying-the-changes).

## Source

| | |
|---|---|
| Files | 9 per-day sheets + 1 summary sheet, exported from `Email Issues Uptet updated.xlsx` |
| Period | 27 Mar 2026 – 4 Apr 2026 (detail sheets); summary covers 27 Mar – 30 Apr |
| Rows with issue text | **1,895** (of ~2,010 raw; the rest are blank spreadsheet padding) |
| Languages | English, Devanagari Hindi, Hinglish — frequently mixed within one email |
| Pre-existing labels | 189 distinct free-text human categories, 313 rows blank, `replied done` leaking in from the status column |

The summary sheet separately reports 13,041 emails received over the full window at a 91.32% reply rate, so **the 1,895 detail rows are roughly a 15% sample** — early-window, application-phase traffic.

### Method and its limits

Rule-based classifier (~90 regex patterns across all three scripts), first-match-wins, most-specific-first, validated so every rule targets a real schema entry. Script: `scratchpad/classify.js`.

This is a **coverage estimate, not a labelled gold set.** There is no hand-labelled ground truth to score against, patterns are recall-oriented, and broad buckets (`B.Ed / D.El.Ed Qualification Entry`, `Final Year Appearing Candidate Entry`) over-capture. Treat category-level percentages as reliable to a few points and individual sub-category counts as indicative. The gap counts in the proposals section were measured independently of the classifier and are the more trustworthy numbers.

## Result: 79.5% of the corpus fits the existing schema

**1,507 of 1,895 rows matched; 388 did not.**

| Category | Rows | Share |
|---|---:|---:|
| Educational Qualifications | 374 | 19.7% |
| Payment & Fee | 299 | 15.8% |
| Identity Verification | 201 | 10.6% |
| OTR Completion & Preview | 129 | 6.8% |
| Portal Access & Registration | 120 | 6.3% |
| Exam Application & Eligibility | 115 | 6.1% |
| *(triage disposition — not an issue)* | 62 | 3.3% |
| Address & Personal Details | 62 | 3.3% |
| Category & Reservation | 60 | 3.2% |
| Login & Account Access | 29 | 1.5% |
| Amendment & Post-Submission | 27 | 1.4% |
| Uploads & Documents | 16 | 0.8% |
| OTP, Password & CAPTCHA | 10 | 0.5% |
| Exam Information | 3 | 0.2% |
| **Unmatched** | **388** | **20.5%** |

Top sub-categories by volume:

| Rows | Sub-category |
|---:|---|
| 207 | Educational Qualifications → Final Year Appearing Candidate Entry |
| 110 | Payment & Fee → Money Debited but Application Incomplete |
| 98 | Payment & Fee → Duplicate Payment Refund Query |
| 96 | OTR Completion & Preview → How to Edit Saved OTR Data |
| 88 | Identity Verification → Live Photo / Face Match Failure |
| 85 | Educational Qualifications → B.Ed / D.El.Ed Qualification Entry |
| 77 | Payment & Fee → Payment Pending / Processing Status |
| 69 | Portal Access & Registration → Registration Form Submission Error |
| 63 | Identity Verification → Name / DOB Mismatch Across Documents |
| 49 | Exam Application & Eligibility → Practising Government Teacher Details Entry |

**The headline: three themes — appearing/final-year candidates, payment reconciliation, and identity verification — account for roughly half of all traffic.**

## What the 388 unmatched rows are

| Class | Rows | Action |
|---|---:|---|
| Genuinely missing sub-categories | ~52 | **Add** — see proposals below |
| Too vague to classify (≤4 words: `Payment`, `OTR ISSUE`, `Correction`, `Unable to proceed`) | 72 | Not a taxonomy problem — an intake problem |
| Agent's own reply text pasted into the Issue column | 4 | Data quality |
| Follow-up chasers on an existing ticket | 3 | Needs a `Follow-Up` disposition, not a category |
| Long tail of one-off queries | ~257 | Expected residue; no action |

## Dormant schema — do not delete

Four categories scored **zero hits**, and 126 of 184 sub-categories were never used:

- Admit Card & Certificate
- Scribe & Compensatory Time
- Result & Merit List
- General Enquiry

This is **not** evidence they're dead. The corpus is the application window (late March / early April 2026); admit-card traffic arrives near the exam, result traffic after it, and scribe requests cluster around the admit-card release. Re-run this analysis on a post-exam corpus before touching them.

`General Enquiry` scoring zero is different, and is a naming problem rather than a demand problem — its sub-categories (`Call Back Request`, `Unrelated / Wrong Call`, `Repeated Call / Follow-up`) are all phrased for voice calls and none can match an email. See *Structural recommendations*.

## Additions ✅ applied

The schema's own generator prompt requires every category to trace back to **at least 3 source items** (`geminiService.js:528-531`). Applying that bar to the corpus, these 14 clusters qualified — all are now in the schema. Counts below are the independent regex matches that justified each one; the *Outcome* section reports what each actually captured once wired into the classifier.

| Hits | Proposed sub-category | Parent category | Rationale |
|---:|---|---|---|
| 33 | **Name Prefix Mismatch (KM / Kumari)** | Identity Verification | Marksheet reads `KM AASHA`, Aadhaar reads `ASHA`. Distinct, highly repetitive failure mode; currently absorbed into the generic `Name / DOB Mismatch Across Documents` |
| 23 | **Appearing Option Missing in Qualification Dropdown** | Educational Qualifications | A *portal defect*, not an eligibility question. Currently collapses into `Final Year Appearing Candidate Entry`, hiding a fixable bug inside a query bucket |
| 20 | **Surname Changed After Marriage — eKYC Mismatch** | Identity Verification | Aadhaar updated to husband's surname, board records not. Same argument as above |
| 19 | **Wrong Exam Level Selected (Primary vs Junior)** | Amendment & Post-Submission | Candidate clicked Junior instead of Primary; several report no back/previous option. Distinct from `Subject / Paper Change After Submission` |
| 19 | **Apply / OTR Link Not Visible on Portal** | Portal Access & Registration | "Apply Now ka option nhi aa rha" — the option is absent, not the page broken. `Portal Not Loading / Technical Error` is the wrong home |
| 11 | **Wrong Person's Document Uploaded** | Uploads & Documents | Candidate uploaded another individual's Aadhaar; needs a distinct remediation path |
| 9 | **Board Roll Number Digit-Length Rejected** | Educational Qualifications | Form demands ≥5 digits; older board roll numbers are 4. A validation bug with a clean signature |
| 8 | **Out-of-State / NIOS Qualification Not Listed** | Educational Qualifications | NIOS D.El.Ed and other-state D.El.Ed have no selectable option. Broader than `Board / University Not in Dropdown` — it's an eligibility question too |
| 7 | **Handwritten Declaration Language Requirement** | Uploads & Documents | Hindi vs English. Existing `Handwritten Declaration Upload Issue` covers upload mechanics only |
| 5 | **In-Service Teacher Without Graduation — Eligibility** | Exam Application & Eligibility | Pre-1996/2004 appointees holding only Intermediate + training. `Practising Government Teacher Details Entry` covers data entry, not eligibility |
| 3 | **Graduation Field Mandatory but Not Applicable** | Educational Qualifications | B.El.Ed and similar integrated-course holders cannot leave the field blank |
| 3 | **Wrong ID Type Used at Registration** | Identity Verification | Registered with PAN/DL by mistake, wants to switch to Aadhaar. `Identity Proof Selection Query` covers choosing, not changing |
| 3 | **Marital Status Field Query** | Address & Personal Details | Not represented anywhere in the current schema |
| 3 | **Form Cancellation / Withdrawal Request** | Amendment & Post-Submission | "Please reject or cancel this form" — no destination today |

Below the evidence bar, recorded but **not** recommended yet: Second Language Selection Error (2), Email Domain Not Accepted (1), Refund Timeline Query (1).

### One split worth making ✅ applied

`Final Year Appearing Candidate Entry` was carrying 207 rows — 11% of the entire corpus — and doing two different jobs. Splitting the portal defect out into `Appearing Option Missing in Dropdown` leaves the eligibility query bucket clean and makes the defect countable for the engineering team. Post-change the eligibility bucket sits at 182 rows, with 26 rows now correctly filed as a defect.

## Outcome after applying the changes

Schema: **184 → 196** sub-categories (14 added, 2 duplicates removed). Coverage: **79.5% → 82.4%**; unmatched rows **388 → 334**.

| Rows captured | New sub-category |
|---:|---|
| 33 | Name Prefix Mismatch (KM / Kumari) |
| 26 | Appearing Option Missing in Dropdown |
| 21 | Post-Marriage Surname Mismatch in eKYC |
| 20 | Apply / OTR Link Not Visible on Portal |
| 19 | Wrong Exam Level Selected (Primary vs Junior) |
| 13 | Wrong Person's Document Uploaded |
| 12 | Out-of-State / NIOS Qualification Not Listed |
| 9 | Board Roll Number Digit Length Rejected |
| 7 | Handwritten Declaration Language Requirement |
| 4 | Graduation Field Mandatory but Not Applicable |
| 4 | In-Service Teacher Without Graduation Eligibility |
| 3 | Wrong ID Type Used at Registration |
| 3 | Form Cancellation / Withdrawal Request |
| 3 | Marital Status Field Query |
| **177** | **total — 9.3% of the corpus** |

Every one clears the ≥3 bar against live data, not just against the exploratory patterns. Note that 177 captured but only 54 fewer unmatched: the remaining ~123 were pulled *out of over-broad legacy buckets* where they had been miscounted — which is the more valuable half of the change.

Category shares after the revision:

| Category | Before | After |
|---|---:|---:|
| Educational Qualifications | 19.7% | 20.3% |
| Payment & Fee | 15.8% | 15.4% |
| Identity Verification | 10.6% | **12.2%** |
| Portal Access & Registration | 6.3% | **7.1%** |
| OTR Completion & Preview | 6.8% | 6.1% |
| Exam Application & Eligibility | 6.1% | 5.8% |
| Amendment & Post-Submission | 1.4% | **2.5%** |
| Uploads & Documents | 0.8% | **1.8%** |

### Still open

Two of the three structural recommendations below are **not** implemented — they are larger changes than a schema edit:

- The **disposition axis** needs a new field plus worker logic, not just schema entries.
- **Channel-neutral renaming** needs a retro-remap of historical records via `/generalise-categories`.

Both remain the right next steps.

## Structural recommendations

### 1. Dispositions belong on their own axis

62 rows (3.3%) are not issues at all — they're triage outcomes. The summary sheet independently accounts for **1,132 non-actionable emails (8.7% of 13,041)**, described as Duplicate, Blank, Bank Revert, and Thank You.

Filing `Blank Email` under a category would worsen the MECE problems the schema already has. Your codebase already handles this informally — `Call too Short` and `Audio Unclear` are dispositions that bypass `CATEGORIZATION_SCHEMA` entirely. Make it explicit:

```
disposition: Actionable | Duplicate | Blank | Courtesy/Thank You
           | Auto-Reply | Bank Notification | Follow-Up | Unclear
```

Evaluated first; only `Actionable` items get a `category` / `sub_category`. This also gives the 72 too-vague rows a home (`Unclear`) instead of forcing a bad guess.

### 2. The schema is call-shaped and email is now in scope

`Call Back Request`, `Unrelated / Wrong Call`, `Repeated Call / Follow-up`, `Helpline Timing Query` cannot match an email — which is exactly why `General Enquiry` scored zero. Either rename to channel-neutral wording (`Callback Request` → `Contact Request`, `Unrelated / Wrong Call` → `Out-of-Scope Contact`) and add a `channel: call | email` field, or accept that one schema cannot serve both. Renaming is the cheaper path and the retro-remap machinery in `/generalise-categories` already exists to migrate historical records.

### 3. Fix the two duplicate sub-categories first ✅ applied

`Password Forgotten / Reset` and `OTR ID Forgotten` appeared under both #3 and #11, so any classifier — Gemini or otherwise — split those calls arbitrarily between two parents. Resolved before the additions went in: #3 now owns credential challenges (password, OTP, CAPTCHA) and #11 owns account access (login, lockouts, identifier recovery, sessions). Details in the [change log](./taxonomy.md#change-log).

## Data quality notes for the intake process

These affect what any classifier can achieve, independent of taxonomy design:

- **72 rows (3.8%) are too vague to classify** — single words like `Payment`, `OTR`, `Correction`. If the Issue field were captured from the email subject *and* first body paragraph rather than a hand-typed gist, most would become classifiable.
- **The human category column is unusable as training data** — 189 distinct labels for 1,895 rows, with `otr issue`/`otr`/`registation issue`/`registration failed issue` as separate entries, `eligibity`/`eligibility`, and `ediiting`/`editing` typos. 313 rows blank; 36 contain the status value `replied done`.
- **Sub-category was captured on only 521 of 1,895 rows** (27%).
- **Response rate degrades under load** — days ≥400 emails average 89.78% reply rate vs 94.78% on lighter days; the 25 Apr spike (2,400 emails, 9× the 260 median) fell to 83.42%. A staffing signal, not a taxonomy one.

## Reproducing

```bash
node scripts/taxonomy-analysis/normalize.js data   # 9 sheets -> data/_normalized.json
node scripts/taxonomy-analysis/classify.js data    # -> data/_classified.json + coverage report
```

`normalize.js` merges the per-day sheets (headers differ on every sheet) into one array via an RFC4180 parser that handles the embedded newlines in the Issue column. `classify.js` imports `CATEGORIZATION_SCHEMA` directly from `backend/src/services/geminiService.js`, so it fails loudly if a rule ever targets a sub-category that no longer exists.
