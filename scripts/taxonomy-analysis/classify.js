// Rule-based classifier: fit each email issue to a (category, sub_category)
// from CATEGORIZATION_SCHEMA. Patterns cover English / Hinglish / Devanagari.
// Ordered most-specific-first; first match wins.
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2];
const { CATEGORIZATION_SCHEMA } = require(path.resolve(DIR, '../backend/src/services/geminiService.js'));

const R = (cat, sub, ...pats) => ({ cat, sub, pats });

const RULES = [
  // ── v2 additions (2026-08-14) ───────────────────────────────────────────
  // Placed FIRST so these specific clusters win over the broader legacy
  // patterns they were previously being absorbed into.
  R('Identity Verification', 'Name Prefix Mismatch (KM / Kumari)', /\bkm\b|kumari|कुमारी/i),
  R('Identity Verification', 'Post-Marriage Surname Mismatch in eKYC', /(shadi|marriage|married|शादी|विवाह).{0,80}(aadhar|aadhaar|आधार|name|naam|surname|नाम|ekyc)|(surname|naam|name).{0,40}(shadi|marriage|शादी).{0,40}(change|badal|ho gya)/i),
  R('Identity Verification', 'Wrong ID Type Used at Registration', /(registered|select|apply).{0,40}(by |se )?(pan|dl|driving).{0,40}(mistake|galti|accident|by mistake)|(pan|dl).{0,20}select ho (gya|gaya)|mistakenly.{0,30}(pan|dl|aadhaar)/i),
  R('Educational Qualifications', 'Appearing Option Missing in Dropdown', /(appearing|pursuing|अपीयरिंग).{0,60}(option|vikalp|विकल्प).{0,30}(nahi|not|no |nhi|absent|unavail|उपलब्ध नहीं|अनुपलब्ध)|(option|विकल्प).{0,25}(appearing|pursuing).{0,30}(nahi|not|nhi)|no option for (pursuing|appearing)|appearing.{0,20}(ka )?(koi )?(option|विकल्प).{0,20}(nahi|nhi)/i),
  R('Educational Qualifications', 'Board Roll Number Digit Length Rejected', /roll ?(no|number|nu).{0,60}(digit|5|five|4|four)|(digit).{0,40}roll ?(no|number)/i),
  R('Educational Qualifications', 'Out-of-State / NIOS Qualification Not Listed', /(nios|dusre rajya|दूसरे राज्य|other state|another state|out of state).{0,70}(option|vikalp|विकल्प|nahi|not|eligib|form bhr)/i),
  R('Educational Qualifications', 'Graduation Field Mandatory but Not Applicable', /graduation.{0,50}(mandatory|compulsory|khali|खाली|blank|anivarya|अनिवार्य|nahi chhod|cannot be left)|(graduation).{0,30}(column|कालम|field).{0,40}(nahi|not|khali)/i),
  R('Portal Access & Registration', 'Apply / OTR Link Not Visible on Portal', /(apply now|otr).{0,40}(ka )?(option|link|button).{0,30}(nahi|not|nhi|koi nahi|dikh)|option of otr is not coming|no option for it|link.{0,25}(nahi dikh|not (visible|show))/i),
  R('Uploads & Documents', "Wrong Person's Document Uploaded", /(incorrect|wrong|another person|dusre|galat).{0,40}(aadhaar|aadhar|document|photo).{0,40}(upload|uploaded)|uploaded.{0,30}(incorrect|wrong|another)/i),
  R('Uploads & Documents', 'Handwritten Declaration Language Requirement', /(hand ?written|handrayton|हैंडरायटन|declaration|डिक्लेरेशन).{0,60}(hindi|english|हिंदी|इंग्लिश|language|bhasha)/i),
  R('Exam Application & Eligibility', 'In-Service Teacher Without Graduation Eligibility', /(in.?service|sevarat|सेवारत|working teacher|already.{0,15}teacher|appointed before|नियुक्ति).{0,90}(graduat|intermediate|12th|स्नातक|इंटरमीडिएट|eligib|qualif)|(non.?graduate|12th pass|intermediate).{0,50}teacher/i),
  R('Amendment & Post-Submission', 'Wrong Exam Level Selected (Primary vs Junior)', /(primary|prathmik|प्राथमिक).{0,60}(junior|upper primary|जूनियर)|(junior|जूनियर).{0,60}(primary|प्राथमिक)|wrong paper selection|galti se.{0,30}(junior|primary)|गलती से.{0,30}(junior|primary|जूनियर)/i),
  R('Amendment & Post-Submission', 'Form Cancellation / Withdrawal Request', /(cancel|reject|withdraw|nirast|निरस्त).{0,30}(form|application|आवेदन)/i),
  R('Address & Personal Details', 'Marital Status Field Query', /marital status|vaivahik|वैवाहिक/i),

  // ── Triage dispositions (not real issues) ───────────────────────────────
  R('~DISPOSITION', 'Issue Text Unclear', /issue\s*not\s*clear|isssue not claer|^n\/?a$|^test$/i),
  R('~DISPOSITION', 'Courtesy / Thank You', /thank\s*you|thanks|dhanyavad|धन्यवाद|आभार|issue\s*(is\s*)?(now\s*)?(fully\s*)?resolved|समस्या.*हल हो/i),

  // ── Payment & Fee ───────────────────────────────────────────────────────
  R('Payment & Fee', 'Duplicate Payment Refund Query', /(do|two|2|double|twice|dono|dubara|second time).{0,30}(payment|paid|bhugtan)|duplicate payment|paid twice|refund.{0,20}(first|pehla|extra|duplicate)/i),
  R('Payment & Fee', 'Money Debited but Application Incomplete', /(debit|deduct|cut (gy|ga|ho)|kat (gy|ga)|paise cut|katt|money.{0,15}(gone|deducted)).{0,80}(not|nahi|nhi|unpaid|incomplete|pending|fail|update|reflect|show)|payment.{0,30}(not|nahi|nhi).{0,20}(updat|reflect|credit|show|receiv)|fee.{0,20}not.{0,20}updat|पैसे (कट|कट गए)|भुगतान.{0,30}(नहीं|अपडेट)/i),
  R('Payment & Fee', 'Payment Pending / Processing Status', /payment.{0,20}(fail|pending|processing|status)|transaction.{0,20}(fail|pending)|payment successful but.{0,30}fail|failed.{0,15}(payment|transaction)|भुगतान.{0,20}(विफल|लंबित)/i),
  R('Payment & Fee', 'Payment Reconciliation Request', /reconcil|utr|transaction id|txn|bank statement/i),
  R('Payment & Fee', 'Fee Receipt / Challan Download Issue', /receipt|challan|रसीद/i),
  R('Payment & Fee', 'Fee Amount Query', /(fee|fees|shulk|शुल्क).{0,25}(amount|kitna|how much|kitni)|how much.{0,15}fee/i),
  R('Payment & Fee', 'Payment Gateway / Method Query', /payment (gateway|method|mode|option)|sbiepay|net ?banking|upi|debit card|credit card/i),

  // ── Identity Verification ───────────────────────────────────────────────
  R('Identity Verification', 'Live Photo / Face Match Failure', /live ?photo|selfie|face (match|captur|verif)|photo.{0,20}captur|लाइव फोटो/i),
  R('Identity Verification', 'Aadhaar OTP Not Received', /(aadhaar|aadhar|adhar|आधार).{0,40}(otp).{0,25}(not|nahi|nhi|unable|receiv|aa nahi)|unable to receive aadhar otp|aadhaar.{0,15}otp.{0,15}(fail|issue)/i),
  R('Identity Verification', 'Name / DOB Mismatch Across Documents', /(father|pita|पिता).{0,40}(husband|pati|पति)|(husband|pati|पति).{0,40}(father|pita|पिता)|name.{0,25}mismatch|dob.{0,20}mismatch|नाम.{0,20}(अलग|मेल नहीं)/i),
  R('Identity Verification', 'Aadhaar Number Not Accepted', /(aadhaar|aadhar|adhar|आधार).{0,40}(not (accept|verif|match|work)|fail|error|problem|issue|service.{0,20}(not )?avail|temporarily)/i),
  R('Identity Verification', 'Identity Proof Selection Query', /\b(pan|driving licen[cs]e|\bdl\b|voter|passport)\b.{0,40}(verif|fail|not|error)|failed to verify (pan|driving)/i),
  R('Identity Verification', 'Manual Aadhaar Verification Request', /manual.{0,20}verif|offline.{0,20}aadhaar/i),

  // ── OTP, Password & CAPTCHA ─────────────────────────────────────────────
  R('OTP, Password & CAPTCHA', 'Mobile OTP Not Received', /(mobile|phone|sms|mob).{0,25}otp.{0,25}(not|nahi|nhi|aa nahi|receiv|come|coming)|otp.{0,20}(not|nahi|nhi).{0,15}(com|receiv|aa|mil)|otp are not coming|failed to send otp|ओटीपी.{0,25}(नहीं|प्राप्त)/i),
  R('OTP, Password & CAPTCHA', 'Email OTP Not Received', /email.{0,20}otp/i),
  R('OTP, Password & CAPTCHA', 'OTP Expired Before Use', /otp.{0,20}expir|expired otp/i),
  R('OTP, Password & CAPTCHA', 'Password Forgotten / Reset', /(forgot|forget|bhul|भूल).{0,25}(password|pass)|reset.{0,15}password|password.{0,20}(reset|change|nahi|not)/i),
  R('Login & Account Access', 'OTR ID Forgotten / Recovery', /(forgot|forget|bhul|भूल|lost|kho).{0,25}otr|otr.{0,20}(id )?(forgot|bhul|nahi mil|not remember)/i),
  R('OTP, Password & CAPTCHA', 'CAPTCHA Not Loading / Unclear', /captcha|कैप्चा/i),
  R('OTP, Password & CAPTCHA', 'OTP Coming on Wrong Number', /otp.{0,30}(wrong|galat|another|dusre|old).{0,15}(number|mobile)/i),

  // ── Portal Access & Registration ────────────────────────────────────────
  R('Portal Access & Registration', 'Multiple OTR Accounts Issue', /(already|pehle se|पहले से).{0,30}(registered|panjikrit|पंजीकृत)|mobile.{0,30}already.{0,20}(regist|use)|uppsc.{0,60}otr|(same|usi|इसी).{0,25}(mobile|number).{0,40}otr/i),
  R('Portal Access & Registration', 'Registration Form Submission Error', /(otr|registration|registr|पंजीकरण).{0,35}(fail|asafal|असफल|error|not (complet|success)|nahi ho)|registration fail|otr.{0,15}(असफल|फेल)/i),
  R('Portal Access & Registration', 'OTR ID Not Received After Registration', /otr (id|number).{0,30}(not (receiv|generat|mil)|nahi mila|nhi mila)/i),
  R('Portal Access & Registration', 'Portal Not Loading / Technical Error', /(site|website|portal|server).{0,30}(not (work|load|open|proper)|down|slow|error|crash|harass)|technical (issue|error|glitch)|page.{0,20}not.{0,15}(load|open)/i),
  R('Portal Access & Registration', 'OTR vs Exam Application Confusion', /otr.{0,25}(vs|or|aur|and).{0,25}(application|form|exam)|difference.{0,25}otr/i),
  R('Portal Access & Registration', 'Fresh Registration Query', /how.{0,20}(to )?(register|regist|apply for otr)|new registration|naya registration/i),

  // ── OTR Completion & Preview ────────────────────────────────────────────
  R('OTR Completion & Preview', 'OTR Profile Locked After Submission', /otr.{0,30}lock|lock.{0,25}otr|profile.{0,20}lock|otr.{0,40}(edit|update).{0,25}(not|nahi|unable|nhi)/i),
  R('OTR Completion & Preview', 'Preview Section Data Missing or Wrong', /preview.{0,35}(wrong|galat|missing|not|data)/i),
  R('OTR Completion & Preview', 'How to Edit Saved OTR Data', /(edit|correct|sudhar|सुधार|change).{0,30}otr|otr.{0,25}(me|mein|में).{0,30}(correct|sudhar|change|edit)/i),
  R('OTR Completion & Preview', 'OTR Final Submit Button Issue', /submit.{0,20}button|final submit/i),
  R('OTR Completion & Preview', 'Print / Download OTR Form', /(print|download).{0,25}(otr|form)/i),

  // ── Educational Qualifications ──────────────────────────────────────────
  R('Educational Qualifications', 'Final Year Appearing Candidate Entry', /appearing|final year|antim varsh|अंतिम वर्ष|last year student|pursuing/i),
  R('Educational Qualifications', 'CGPA to Percentage Conversion Query', /cgpa|percentage.{0,20}convert|multiply/i),
  R('Educational Qualifications', 'Board / University Not in Dropdown', /(board|university|college|nios|vishwavidyalaya).{0,40}(not.{0,15}(in |show|avail|list)|dropdown|option.{0,15}(nahi|not))|nios.{0,30}(option|vikalp|विकल्प)/i),
  R('Educational Qualifications', 'B.Ed / D.El.Ed Qualification Entry', /\b(b\.?ed|d\.?el\.?ed|deled|btc|jbt|bstc)\b/i),
  R('Educational Qualifications', 'Marks / Percentage Entry Issue', /(marks|ank|अंक|percentage|obtain).{0,30}(galat|wrong|enter|fill|issue|error)|marksheet/i),
  R('Educational Qualifications', 'Graduation Subject / Stream Entry', /(subject|vishay|विषय).{0,30}(fill|select|add|nahi|not|option)|graduation.{0,25}(subject|stream)/i),
  R('Educational Qualifications', 'Year of Passing Entry Issue', /year of passing|passing year|expected date of completion/i),
  R('Educational Qualifications', 'Education Details Entry in OTR', /(education|qualification|yogyata|योग्यता).{0,35}(detail|entry|add|fill|enter)/i),

  // ── Exam Application & Eligibility ──────────────────────────────────────
  R('Exam Application & Eligibility', 'Practising Government Teacher Details Entry', /gov(ernment|t)?\.? ?teacher|sarkari.{0,15}(shikshak|teacher)|राजकीय शिक्षक/i),
  R('Exam Application & Eligibility', 'Application Form Section Not Saving', /(form|detail|data).{0,30}(not saved|nahi save|not sav|save nahi)|details not saved/i),
  R('Exam Application & Eligibility', 'Both Papers Application Query', /both paper|paper.{0,10}(1|i).{0,20}(to|se).{0,20}both|dono paper|दोनों पेपर/i),
  R('Exam Application & Eligibility', 'Paper I Eligibility Query', /paper.{0,5}(1|i)\b/i),
  R('Exam Application & Eligibility', 'Paper II Eligibility Query', /paper.{0,5}(2|ii)\b/i),
  R('Exam Application & Eligibility', 'Age Limit Eligibility Query', /age (limit|relax)|ayu|आयु सीमा|umar/i),
  R('Exam Application & Eligibility', 'Exam Centre Preference Entry', /(exam )?cent(re|er).{0,30}(not show|prefer|select|choice|nahi)/i),
  R('Exam Application & Eligibility', 'How to Apply for Exam After OTR', /how.{0,20}apply|kaise (bhare|apply|karu)|application process/i),

  // ── Category & Reservation ──────────────────────────────────────────────
  R('Category & Reservation', 'OBC Non-Creamy Layer Certificate Query', /(creamy|creame|creme).{0,15}layer|non.?creamy/i),
  R('Category & Reservation', 'EWS Certificate Format / Validity Query', /\bews\b/i),
  R('Category & Reservation', 'Age Relaxation Query', /age relaxation|ayu seema chhut|आयु.{0,20}छूट/i),
  R('Category & Reservation', 'Divyang / PwD / PH Category', /divyang|दिव्यांग|\bpwd\b|\bph\b.{0,15}categ|disabilit|handicap/i),
  R('Category & Reservation', 'SC / ST Category', /\bsc\b.{0,10}\bst\b|scheduled (caste|tribe)|अनुसूचित/i),
  R('Category & Reservation', 'Category Change After Form Submission', /categ(ory|ery).{0,30}(change|correct|galat|wrong|sudhar)|जाति.{0,25}(परिवर्तन|सुधार)/i),
  R('Category & Reservation', 'General Category Query', /\bobc\b|\bgeneral\b.{0,15}categ|category certificate/i),

  // ── Address & Personal Details ──────────────────────────────────────────
  R('Address & Personal Details', 'Gender / Nationality Entry Issue', /gender|लिंग|currection.{0,15}gender/i),
  R('Address & Personal Details', 'Father / Husband Name Entry Issue', /(father|pita|पिता|husband|pati|पति).{0,30}(name|naam|नाम)/i),
  R('Address & Personal Details', 'Date of Birth Entry Issue', /\bdob\b|date of birth|janm tithi|जन्म ?तिथि/i),
  R('Address & Personal Details', 'Personal Details Correction Request', /(personal|vyaktigat).{0,25}(detail|information)|spelling|naam.{0,20}(galat|wrong)|name.{0,20}(wrong|galat|correct)/i),
  R('Address & Personal Details', 'Mobile / Email Change in Profile', /(change|update|badal).{0,30}(mobile|email|number)/i),
  R('Address & Personal Details', 'District / State Dropdown Issue', /(district|jila|जिला|state|tehsil|block).{0,30}(not|dropdown|list|nahi|option)/i),
  R('Address & Personal Details', 'Permanent Address Entry Issue', /address|pata|पता/i),

  // ── Uploads & Documents ─────────────────────────────────────────────────
  R('Uploads & Documents', 'Photograph Upload Issue', /(photo|photograph|foto).{0,30}(upload|size|dimension|background|not)/i),
  R('Uploads & Documents', 'Signature Upload Issue', /signature|hastakshar|हस्ताक्षर/i),
  R('Uploads & Documents', 'File Size / Format Requirement', /file (size|format)|\bkb\b|\bmb\b.{0,15}(limit|size)/i),
  R('Uploads & Documents', 'Academic Certificate Upload', /(certificate|document|dastavej|प्रमाण ?पत्र).{0,30}(upload|attach|not)/i),
  R('Uploads & Documents', 'Upload Button Not Working', /upload.{0,25}(button|not work|nahi ho|fail)/i),

  // ── Login & Account Access ──────────────────────────────────────────────
  R('Login & Account Access', 'Account Locked / Blocked', /account.{0,20}(lock|block|suspend)/i),
  R('Login & Account Access', 'Session Timeout Issue', /session.{0,20}(timeout|expire)|logged out|log out ho/i),
  R('Login & Account Access', 'OTP Login Not Working', /login.{0,25}otp|otp.{0,20}login/i),
  R('Login & Account Access', 'Login Method Query', /(unable|not able|cannot|can'?t|nahi|nhi).{0,25}(log ?in|login|access)|login (issue|problem|fail|nahi)|access.{0,20}account/i),

  // ── Amendment & Post-Submission ─────────────────────────────────────────
  R('Amendment & Post-Submission', 'Amendment Window Opening Date Query', /correction window|amendment window|edit option.{0,20}(kab|when|open)|window.{0,20}(khol|open)/i),
  R('Amendment & Post-Submission', 'What Fields Can Be Corrected', /correction policy|what.{0,25}(can|fields).{0,20}correct/i),
  R('Amendment & Post-Submission', 'Subject / Paper Change After Submission', /(paper|subject).{0,30}(change|badal|convert).{0,25}(after|submit|baad)/i),
  R('Amendment & Post-Submission', 'Name / DOB Correction After Submission', /(name|dob|naam).{0,30}correct.{0,25}(after|submit|baad)/i),
  R('Amendment & Post-Submission', 'Amendment Process Step-by-Step Query', /(correction|sudhar|amend|edit|सुधार).{0,35}(request|process|chahiye|karna|hetu|kare|option|need|want)|request.{0,25}correction|edit(ing)? request/i),

  // ── Exam Information ────────────────────────────────────────────────────
  R('Exam Information', 'Important Dates & Schedule Query', /(exam|pariksha|परीक्षा).{0,30}(date|schedule|kab|when)|last date|अंतिम तिथि/i),
  R('Exam Information', 'Syllabus Query', /syllabus|पाठ्यक्रम/i),
  R('Exam Information', 'Exam Pattern & Structure Query', /exam pattern|question paper|negative marking/i),
  R('Exam Information', 'TET Validity Period Query', /validity|vaidhta|मान्यता/i),

  // ── Admit Card & Certificate ────────────────────────────────────────────
  R('Admit Card & Certificate', 'Admit Card Release Date Query', /admit card|pravesh patr|प्रवेश ?पत्र|hall ticket/i),
  R('Admit Card & Certificate', 'Exam Centre / Date / Time Query', /exam ?cent(re|er)/i),

  // ── Scribe / Result ─────────────────────────────────────────────────────
  R('Scribe & Compensatory Time', 'Scribe Eligibility Criteria Query', /scribe|lekhak|श्रुतलेखक/i),
  R('Result & Merit List', 'Result Declaration Date Query', /\bresult\b.{0,25}(date|kab|declar|when)/i),

  // ── General Enquiry ─────────────────────────────────────────────────────
  R('General Enquiry', 'Notification / Advertisement Query', /(notification|advertisement|vigyapan|विज्ञापन).{0,30}(number|no|regard|sankhya)/i),
  R('General Enquiry', 'Helpline Timing Query', /helpline|customer care|toll ?free/i),
  R('General Enquiry', 'Call Back Request', /call ?back|please call me|mujhe call/i),
];

const data = JSON.parse(fs.readFileSync(path.join(DIR, '_normalized.json'), 'utf8'));

// Validate every rule targets a real schema entry (except ~DISPOSITION)
for (const r of RULES) {
  if (r.cat === '~DISPOSITION') continue;
  if (!CATEGORIZATION_SCHEMA[r.cat]) throw new Error('BAD CATEGORY: ' + r.cat);
  if (!CATEGORIZATION_SCHEMA[r.cat].includes(r.sub)) throw new Error('BAD SUB: ' + r.cat + ' / ' + r.sub);
}

const hits = new Map();
const unmatched = [];
for (const row of data) {
  const text = row.issue + ' || ' + row.category + ' ' + row.subcategory;
  let m = null;
  for (const r of RULES) { if (r.pats.some(p => p.test(text))) { m = r; break; } }
  if (!m) { unmatched.push(row); continue; }
  const k = m.cat + ' ||| ' + m.sub;
  if (!hits.has(k)) hits.set(k, []);
  hits.get(k).push(row);
  row._cat = m.cat; row._sub = m.sub;
}

fs.writeFileSync(path.join(DIR, '_classified.json'), JSON.stringify({ data, unmatched }, null, 1));

const matched = data.length - unmatched.length;
console.log('rows:', data.length, '| matched:', matched, '(' + (matched / data.length * 100).toFixed(1) + '%)', '| unmatched:', unmatched.length);

// Roll up by category
const byCat = new Map();
for (const [k, rows] of hits) {
  const [cat] = k.split(' ||| ');
  byCat.set(cat, (byCat.get(cat) || 0) + rows.length);
}
console.log('\n=== BY CATEGORY ===');
[...byCat.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.log(String(n).padStart(5), (n / data.length * 100).toFixed(1).padStart(5) + '%', c));

console.log('\n=== BY SUB-CATEGORY (>=10) ===');
[...hits.entries()].sort((a, b) => b[1].length - a[1].length).filter(x => x[1].length >= 10)
  .forEach(([k, rows]) => console.log(String(rows.length).padStart(5), k.replace(' ||| ', ' → ')));

// Dormant parts of the schema
const usedCats = new Set([...byCat.keys()]);
const usedSubs = new Set([...hits.keys()].map(k => k.split(' ||| ')[1]));
console.log('\n=== SCHEMA CATEGORIES WITH ZERO HITS ===');
Object.keys(CATEGORIZATION_SCHEMA).filter(c => !usedCats.has(c)).forEach(c => console.log('   ', c));
let dormantSubs = 0, allSubs = 0;
for (const subs of Object.values(CATEGORIZATION_SCHEMA)) for (const s of subs) { allSubs++; if (!usedSubs.has(s)) dormantSubs++; }
console.log('sub-categories with zero hits:', dormantSubs, '/', allSubs);
