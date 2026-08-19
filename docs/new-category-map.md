# Unified 5-Category Schema — Call & Email (v2)

Same 196 sub-categories as before, re-cut into the 5 categories specified: **Account Access & Application Details / Eligibility**, **Documents & Identity Verification**, **Payment & Fee**, **Amendment & Changes in Form**, and **General**. Nothing dropped, nothing re-worded except the same 3 channel-neutral renames carried over from the previous cut.

**Deliberately excluded:** "disposition" items (Blank, Duplicate, Call too Short, Audio Unclear, Bank Notification, Thank You, etc.). Per the source analysis, these are triage outcomes, not issue categories, and belong on a separate `disposition` field evaluated before categorization.

## How the old 17 map to the new 5

| Old category                   | Subs    | → New category                                     |
| ------------------------------ | ------- | -------------------------------------------------- |
| Portal Access & Registration   | 11      | Account Access & Application Details / Eligibility |
| OTP, Password & CAPTCHA        | 8       | Account Access & Application Details / Eligibility |
| Login & Account Access         | 8       | Account Access & Application Details / Eligibility |
| Address & Personal Details     | 12      | Account Access & Application Details / Eligibility |
| Educational Qualifications     | 16      | Account Access & Application Details / Eligibility |
| Category & Reservation         | 15      | Account Access & Application Details / Eligibility |
| OTR Completion & Preview       | 8       | Account Access & Application Details / Eligibility |
| Exam Application & Eligibility | 13      | Account Access & Application Details / Eligibility |
| Identity Verification          | 12      | Documents & Identity Verification                  |
| Uploads & Documents            | 16      | Documents & Identity Verification                  |
| Payment & Fee                  | 14      | Payment & Fee                                      |
| Amendment & Post-Submission    | 13      | Amendment & Changes in Form                        |
| Exam Information               | 12      | General                                            |
| Admit Card & Certificate       | 12      | General                                            |
| Scribe & Compensatory Time     | 9       | General                                            |
| Result & Merit List            | 8       | General                                            |
| General Enquiry                | 9       | General                                            |
| **Total**                      | **196** |                                                    |

## Category summary

| #   | Category                                           | Sub-categories |
| --- | -------------------------------------------------- | -------------- |
| 1   | Account Access & Application Details / Eligibility | 91             |
| 2   | Documents & Identity Verification                  | 28             |
| 3   | Payment & Fee                                      | 14             |
| 4   | Amendment & Changes in Form                        | 13             |
| 5   | General                                            | 50             |
|     | **Total**                                          | **196**        |

---

## 1. Account Access & Application Details / Eligibility — 91

Two halves in one category: getting into the account, and everything entered into the OTR/application itself (personal data, qualifications, reservation category, eligibility).

### Account Access — 27

**From Portal Access & Registration — 11**

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
11. Apply / OTR Link Not Visible on Portal

**From OTP, Password & CAPTCHA — 8**

1. Mobile OTP Not Received
2. Email OTP Not Received
3. OTP Expired Before Use
4. Wrong OTP Entered Multiple Times
5. Password Forgotten / Reset
6. CAPTCHA Not Loading / Unclear
7. Account Recovery Query
8. OTP Coming on Wrong Number

**From Login & Account Access — 8**

1. Login Method Query
2. OTR ID Forgotten / Recovery
3. OTP Login Not Working
4. Account Locked / Blocked
5. Too Many Failed Login Attempts
6. Registered Mobile Not Accessible
7. Login with New Device Issue
8. Session Timeout Issue

### Application Details & Eligibility — 64

**From Address & Personal Details — 12**

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
12. Marital Status Field Query

**From Educational Qualifications — 16**

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
13. Appearing Option Missing in Dropdown
14. Board Roll Number Digit Length Rejected
15. Out-of-State / NIOS Qualification Not Listed
16. Graduation Field Mandatory but Not Applicable

**From Category & Reservation — 15**

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

**From OTR Completion & Preview — 8**

1. Preview & Edit Before OTR Completion
2. OTR Profile Locked After Submission
3. Complete OTR Profile Step Query
4. OTR Submission Confirmation Not Received
5. Preview Section Data Missing or Wrong
6. How to Edit Saved OTR Data
7. OTR Final Submit Button Issue
8. Print / Download OTR Form

**From Exam Application & Eligibility — 13**

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
13. In-Service Teacher Without Graduation Eligibility

---

## 2. Documents & Identity Verification — 28

Proving who you are (Aadhaar/eKYC matching) and uploading the documents that support it.

**From Identity Verification — 12**

1. Aadhaar OTP Not Received
2. Aadhaar Number Not Accepted
3. Aadhaar Mismatch
4. Name / DOB Mismatch Across Documents
5. Identity Proof Selection Query
6. Live Photo / Face Match Failure
7. Manual Aadhaar Verification Request
8. Photo Clicked During Verification Issue
9. Aadhaar Linked Mobile Not Available
10. Name Prefix Mismatch (KM / Kumari)
11. Post-Marriage Surname Mismatch in eKYC
12. Wrong ID Type Used at Registration

**From Uploads & Documents — 16**

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
15. Wrong Person's Document Uploaded
16. Handwritten Declaration Language Requirement

---

## 3. Payment & Fee — 14

Unchanged — already a single, clean topic.

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

---

## 4. Amendment & Changes in Form — 13

Same 13 sub-categories as "Amendment & Post-Submission" before — corrections requested after the form is already submitted.

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
12. Wrong Exam Level Selected (Primary vs Junior)
13. Form Cancellation / Withdrawal Request

---

## 5. General — 50

Everything downstream of form submission — exam details, admit card, accommodations, results — plus general/administrative contact reasons. Three items renamed for channel neutrality (see notes).

**From Exam Information — 12**

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

**From Admit Card & Certificate — 12**

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

**From Scribe & Compensatory Time — 9**

1. Scribe Eligibility Criteria Query
2. How to Request a Scribe
3. Scribe Arrangement Process
4. Scribe Documents & Declaration Required
5. Scribe Qualification / Education Limit
6. Compensatory Time (30 Minutes) Query
7. Scribe Declaration Form Submission
8. Medical Certificate for PwD Requirement
9. Disability Certificate Format Query

**From Result & Merit List — 8**

1. Result Declaration Date Query
2. Result Check Process
3. Merit List Query
4. Cut-off Marks Query
5. Rank / Score Discrepancy
6. District Allocation Query
7. Selection Process After TET
8. Waiting List Query

**From General Enquiry — 9**

1. Application Mode Query
2. Notification / Advertisement Query
3. Helpline Timing Query
4. Appointment / Job Guarantee Query
5. Transfer to Another Department
6. Contact Request _(was: Call Back Request)_
7. Out-of-Scope Contact _(was: Unrelated / Wrong Call)_
8. Repeated Contact / Follow-up _(was: Repeated Call / Follow-up)_
9. Complaint Against Portal / Process

---

## Notes

**Channel-neutral renames (3)** — carried over unchanged from the previous cut:

| Old (call-only)           | New (channel-neutral)        |
| ------------------------- | ---------------------------- |
| Call Back Request         | Contact Request              |
| Unrelated / Wrong Call    | Out-of-Scope Contact         |
| Repeated Call / Follow-up | Repeated Contact / Follow-up |

**What's not in here.** Dispositions — Duplicate, Blank, Courtesy/Thank You, Auto-Reply, Bank Notification, Call too Short, Audio Unclear, Unclear — stay off this list on purpose; they belong on a separate `disposition` field, not as category values.

**Before wiring this into code:**

- `classify.js` fails loudly if a rule targets a sub-category that doesn't exist — the 3 renamed values need their old names swapped out of any existing regex rules
- Category 1 now holds 91 of 196 sub-categories (46% of the schema) — worth knowing before this becomes a dropdown or a report dimension, since it's a much bigger bucket than the other 4
- Historical `call_analysis` / `calls` records, if you want old records reflected under the new 5 — via the `/generalise-categories` retro-remap already referenced in the analysis doc

Total: 196 sub-categories, 0 dropped, across 5 categories.
