/**
 * Backfill `tags` onto records analysed before tagging existed.
 *
 * Every such record already carries exactly one (category, sub_category) pair,
 * which is precisely a one-tag list — so this is a widening, not a reinterpretation.
 * Nothing is re-analysed and no Gemini quota is spent; issues that were dropped
 * at analysis time stay dropped until those records are re-analysed.
 *
 * Safe to re-run: only documents with no `tags` field are touched. Filters work
 * correctly before, during and after this runs (see src/lib/tags.js), so there
 * is no flag day and no need to stop the workers.
 *
 *   node scripts/backfillTags.js --dry-run
 *   node scripts/backfillTags.js
 */
require('dotenv').config();
const { getDb } = require('../src/db');

// Sentinels describe a state ("nothing to analyse"), not an issue the caller
// raised, so they must not become tags — that is what the live workers do too.
const SENTINELS = new Set([
  'Uncategorised', 'Uncategorized', 'Content Unclear', 'Audio Unclear',
  'Call too Short', 'Email too Short', '', 'N/A',
]);

const TARGETS = [
  { collection: 'emails',         label: 'emails' },
  { collection: 'calls',          label: 'calls' },
  { collection: 'call_analysis',  label: 'call analysis' },
  { collection: 'email_analysis', label: 'email analysis' },
];

async function backfill({ dryRun }) {
  const db = await getDb();
  let grandTotal = 0;

  for (const { collection, label } of TARGETS) {
    const col   = db.collection(collection);
    const cursor = col.find(
      { tags: { $exists: false } },
      { projection: { _id: 1, category: 1, sub_category: 1 } }
    );

    let scanned = 0;
    let tagged  = 0;
    let empty   = 0;
    let ops     = [];

    const flush = async () => {
      if (!ops.length || dryRun) { ops = []; return; }
      await col.bulkWrite(ops, { ordered: false });
      ops = [];
    };

    for await (const doc of cursor) {
      scanned++;
      const category = (doc.category || '').trim();
      const tags = SENTINELS.has(category)
        ? []
        : [{ category, sub_category: (doc.sub_category || '-').trim() || '-' }];

      if (tags.length) tagged++; else empty++;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { tags } } } });
      if (ops.length >= 500) await flush();
    }
    await flush();

    grandTotal += scanned;
    console.log(
      `${dryRun ? '[dry-run] ' : ''}${label.padEnd(15)} scanned ${String(scanned).padStart(7)}` +
      `  tagged ${String(tagged).padStart(7)}  left empty (sentinel/blank) ${String(empty).padStart(7)}`
    );
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${grandTotal} document(s).`);
  if (dryRun) console.log('Re-run without --dry-run to write.');
}

backfill({ dryRun: process.argv.includes('--dry-run') })
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Backfill failed:', err.message);
    process.exit(1);
  });
