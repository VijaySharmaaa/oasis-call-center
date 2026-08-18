const { getDb } = require('../db');
const logger = require('../logger');
const { dynamicCategoriesEnabled } = require('../config/features');

const INTERVAL = 60 * 60 * 1000; // 1 hour

async function geminiRequest(prompt, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    })
  });
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : [];
}

// Takes "Uncategorised" items → asks Gemini to create new categories → updates records and category list
async function resolveUncategorised({ label, sourceField, targetField, categoryCollection }) {
  const db = await getDb();
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!apiKey) return;

  const uncategorised = await db.collection('call_analysis').find(
    { status: 'completed', [targetField]: 'Uncategorised' },
    { projection: { call_id: 1, [sourceField]: 1, _id: 0 } }
  ).toArray();

  if (uncategorised.length === 0) { logger.debug(`[${label}] No uncategorised items`); return; }

  const catDocs = await db.collection(categoryCollection).find({}).toArray();
  const categories = catDocs.map(c => c.name);

  logger.info(`[${label}] Resolving uncategorised`, { count: uncategorised.length, existingCategories: categories.length });

  const BATCH = 50;
  let updated = 0;

  for (let i = 0; i < uncategorised.length; i += BATCH) {
    const batch = uncategorised.slice(i, i + BATCH);
    try {
      const prompt = `These items did not fit into any existing category. The existing categories are: ${JSON.stringify(categories)}

Your job: assign each item to a category.

PRIORITY ORDER:
1. RECONSIDER FIRST. For each item, look again at the existing list above.
   If the item plausibly belongs to one of those categories — even loosely —
   USE THE EXISTING CATEGORY NAME EXACTLY. Don't create something new.

2. ONLY IF an item genuinely doesn't fit any existing category, create a new
   short name (2-5 words). The new name MUST be semantically distinct from
   every entry in the existing list — no near-duplicates, no synonyms, no
   re-phrasings ("OTP Issues" vs "OTP Problems" → same thing, don't do
   this). If two items would each create near-duplicate new names, group
   them under one new name instead.

3. Group similar items under the same category (whether existing or new) so
   we don't fragment the taxonomy.

Items:
${batch.map(b => b.call_id + ': ' + b[sourceField]).join('\n')}

Return ONLY a JSON array: [{"call_id": "...", "${targetField}": "..."}, ...]`;

      const results = await geminiRequest(prompt, model, apiKey);
      for (const r of results) {
        const cat = r[targetField];
        if (!r.call_id || !cat || cat === 'Uncategorised') continue;
        await db.collection('call_analysis').updateOne(
          { call_id: r.call_id },
          { $set: { [targetField]: cat } }
        );
        updated++;
        if (!categories.includes(cat)) {
          categories.push(cat);
          await db.collection(categoryCollection).insertOne({ name: cat, created_at: new Date() });
          logger.info(`[${label}] New category created`, { category: cat });
        }
      }
    } catch (e) {
      logger.error(`[${label}] Batch error`, { error: e.message });
    }
    if (i + BATCH < uncategorised.length) await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`[${label}] Done`, { updated, totalCategories: categories.length });
}

async function runAll() {
  // Bugs have no hardcoded schema to fall back on — bug_category would sit on
  // "Uncategorised" forever if this pass were gated — so it always runs.
  await resolveUncategorised({
    label: 'BugCategory',
    sourceField: 'bugs',
    targetField: 'bug_category',
    categoryCollection: 'bug_categories',
  });

  // Call categories DO have a hardcoded schema. While the dynamic taxonomy is
  // off this pass is the last remaining path that can mint a new
  // call_categories entry, so it is skipped outright.
  if (!dynamicCategoriesEnabled()) {
    logger.debug('[CallCategory] Skipped — DYNAMIC_CATEGORIES_ENABLED is off');
    return;
  }
  await resolveUncategorised({
    label: 'CallCategory',
    sourceField: 'ai_insight',
    targetField: 'call_category',
    categoryCollection: 'call_categories',
  });
}

function startBugCategoryWorker() {
  logger.info('[CategoryWorker] Started', { intervalMin: INTERVAL / 60000 });
  setTimeout(() => runAll().catch(e => logger.error('[CategoryWorker] Error', { error: e.message })), 10000);
  setInterval(() => runAll().catch(e => logger.error('[CategoryWorker] Error', { error: e.message })), INTERVAL);
}

module.exports = { startBugCategoryWorker };
