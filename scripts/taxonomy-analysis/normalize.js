// Normalize the 9 per-day sheets into one JSON array.
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];

// Minimal RFC4180 parser — handles quoted fields with embedded , and \n
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = s => String(s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

// Map varying header names -> canonical keys
const HEADER_MAP = {
  date: 'date',
  receivedfrom: 'email', email: 'email', emailid: 'email',
  issue: 'issue', query: 'issue',
  category: 'category',
  subcategory: 'subcategory',
  replystatus: 'status', status: 'status',
};

const out = [];
const sheetInfo = [];

for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.csv'))) {
  if (/Summary/i.test(file)) continue;
  const rows = parseCsv(fs.readFileSync(path.join(DIR, file), 'utf8'));
  if (!rows.length) continue;

  const hdr = rows[0].map(h => HEADER_MAP[norm(h)] || norm(h));
  const sheet = file.replace(/^.*xlsx - /, '').replace(/\.csv$/, '').trim();

  let kept = 0;
  for (const r of rows.slice(1)) {
    const rec = {};
    hdr.forEach((h, i) => { if (h) rec[h] = String(r[i] ?? '').trim(); });
    // Keep only rows with actual issue text
    if (!rec.issue || rec.issue.length < 3) continue;
    out.push({
      sheet,
      date: rec.date || '',
      issue: rec.issue.replace(/\s+/g, ' ').trim(),
      category: (rec.category || '').trim(),
      subcategory: (rec.subcategory || '').trim(),
      status: (rec.status || '').trim(),
    });
    kept++;
  }
  sheetInfo.push({ sheet, rawRows: rows.length - 1, kept, headers: rows[0].map(h => h.trim()) });
}

fs.writeFileSync(path.join(DIR, '_normalized.json'), JSON.stringify(out, null, 1));
console.log('=== per-sheet ===');
for (const s of sheetInfo) console.log(String(s.kept).padStart(4), '/', String(s.rawRows).padStart(4), ' ', s.sheet, ' | headers:', s.headers.join(' | '));
console.log('\nTOTAL usable rows:', out.length);
const withCat = out.filter(r => r.category).length;
const withSub = out.filter(r => r.subcategory).length;
console.log('with human category:', withCat, '| with human subcategory:', withSub);
