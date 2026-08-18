/**
 * Tagging — the multi-label axis over CATEGORIZATION_SCHEMA.
 *
 * A tag is a (category, sub_category) pair from the SAME schema a lone category
 * always came from; tagging changed the cardinality, not the vocabulary. These
 * tests hold two lines:
 *
 *   1. snapTags cannot let an invented name reach the database — the property
 *      that made DYNAMIC_CATEGORIES_ENABLED necessary in the first place.
 *   2. tagMatch finds an item by a SECONDARY tag, which is the entire point,
 *      while still finding records that predate tagging and have no tags array.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV   = 'test';
process.env.LOG_LEVEL  = 'error';

const { snapTags, MAX_TAGS, CATEGORIZATION_SCHEMA } = require('../src/services/geminiService');
const { tagMatch, unwindTagsStage } = require('../src/lib/tags');
const { matches, createFakeDb } = require('./helpers/fakeMongo');

const CAT_A = Object.keys(CATEGORIZATION_SCHEMA)[0];
const SUB_A = CATEGORIZATION_SCHEMA[CAT_A][0];
const CAT_B = Object.keys(CATEGORIZATION_SCHEMA)[1];
const SUB_B = CATEGORIZATION_SCHEMA[CAT_B][0];

const opts = { taxonomy: null, dynamic: false };

// ─── snapTags ─────────────────────────────────────────────────────────────────

describe('snapTags — the vocabulary gate', () => {
  it('keeps several valid tags, in the order given', () => {
    expect(snapTags([
      { category: CAT_A, sub_category: SUB_A },
      { category: CAT_B, sub_category: SUB_B },
    ], opts)).toEqual([
      { category: CAT_A, sub_category: SUB_A },
      { category: CAT_B, sub_category: SUB_B },
    ]);
  });

  it('snaps an invented category to the Uncategorised sentinel', () => {
    expect(snapTags([{ category: 'Refund Department', sub_category: 'Angry' }], opts))
      .toEqual([{ category: 'Uncategorised', sub_category: '-' }]);
  });

  it('drops the sentinel once a real tag exists', () => {
    const out = snapTags([
      { category: 'Totally Invented', sub_category: 'x' },
      { category: CAT_A, sub_category: SUB_A },
    ], opts);
    expect(out).toEqual([{ category: CAT_A, sub_category: SUB_A }]);
  });

  it('keeps the sentinel when it is all there is', () => {
    expect(snapTags([{ category: 'Nope', sub_category: 'x' }], opts))
      .toEqual([{ category: 'Uncategorised', sub_category: '-' }]);
  });

  it('snaps a sub-category borrowed from another parent to "Other"', () => {
    expect(snapTags([{ category: CAT_A, sub_category: SUB_B }], opts))
      .toEqual([{ category: CAT_A, sub_category: 'Other' }]);
  });

  it('collapses duplicate tags', () => {
    const out = snapTags([
      { category: CAT_A, sub_category: SUB_A },
      { category: CAT_A, sub_category: SUB_A },
    ], opts);
    expect(out).toHaveLength(1);
  });

  it('accepts bare category strings from a model that ignored the shape', () => {
    expect(snapTags([CAT_A], opts)).toEqual([{ category: CAT_A, sub_category: '-' }]);
  });

  it(`caps the list at ${MAX_TAGS}`, () => {
    const many = Object.keys(CATEGORIZATION_SCHEMA)
      .slice(0, MAX_TAGS + 3)
      .map(c => ({ category: c, sub_category: CATEGORIZATION_SCHEMA[c][0] }));
    expect(snapTags(many, opts)).toHaveLength(MAX_TAGS);
  });

  it('returns an empty list for junk input rather than throwing', () => {
    expect(snapTags(undefined, opts)).toEqual([]);
    expect(snapTags(null, opts)).toEqual([]);
    expect(snapTags('not an array', opts)).toEqual([]);
    expect(snapTags([null, undefined], opts)).toEqual([]);
  });

  it('validates against the live taxonomy when dynamic categories are on', () => {
    const taxonomy = [{ name: 'Live Cat', sub_categories: ['Live Sub'] }];
    expect(snapTags([{ category: 'Live Cat', sub_category: 'Live Sub' }], { taxonomy, dynamic: true }))
      .toEqual([{ category: 'Live Cat', sub_category: 'Live Sub' }]);
    // A hardcoded-schema name is not valid while the dynamic taxonomy is in force.
    expect(snapTags([{ category: CAT_A, sub_category: SUB_A }], { taxonomy, dynamic: true }))
      .toEqual([{ category: 'Uncategorised', sub_category: '-' }]);
  });
});

// ─── tagMatch ─────────────────────────────────────────────────────────────────

/* Three documents spanning the states a real collection holds mid-migration. */
const TAGGED_TWO = {
  gmail_id: 'two-issues',
  category: CAT_A, sub_category: SUB_A,
  tags: [{ category: CAT_A, sub_category: SUB_A }, { category: CAT_B, sub_category: SUB_B }],
};
const TAGGED_ONE = {
  gmail_id: 'one-issue',
  category: CAT_B, sub_category: SUB_B,
  tags: [{ category: CAT_B, sub_category: SUB_B }],
};
const LEGACY = {                       // analysed before tagging — no tags array
  gmail_id: 'legacy',
  category: CAT_A, sub_category: SUB_A,
};

const hits = filter => [TAGGED_TWO, TAGGED_ONE, LEGACY].filter(d => matches(d, filter)).map(d => d.gmail_id);

describe('tagMatch — finding an item by any of its tags', () => {
  it('finds an item by its PRIMARY tag', () => {
    expect(hits(tagMatch(CAT_A)).sort()).toEqual(['legacy', 'two-issues']);
  });

  it('finds an item by its SECONDARY tag — the whole point of tagging', () => {
    expect(hits(tagMatch(CAT_B)).sort()).toEqual(['one-issue', 'two-issues']);
  });

  it('still finds records that predate tagging, via the scalar pair', () => {
    expect(hits(tagMatch(CAT_A))).toContain('legacy');
  });

  it('requires category and sub-category to sit on the SAME tag', () => {
    // CAT_A pairs with SUB_A and CAT_B with SUB_B on 'two-issues'. The crossed
    // pair exists nowhere, and two independent dotted conditions would wrongly
    // match it.
    expect(hits(tagMatch(CAT_A, SUB_B))).toEqual([]);
    expect(hits(tagMatch(CAT_A, SUB_A)).sort()).toEqual(['legacy', 'two-issues']);
  });

  it('matches a sub-category on its own', () => {
    expect(hits(tagMatch(null, SUB_B)).sort()).toEqual(['one-issue', 'two-issues']);
  });
});

// ─── unwindTagsStage ──────────────────────────────────────────────────────────

describe('unwindTagsStage — counting issues rather than items', () => {
  async function countByCategory(docs) {
    const fake = createFakeDb({ emails: docs });
    const rows = await fake.db.collection('emails').aggregate([
      ...unwindTagsStage(),
      { $group: { _id: '$_tag_list.category', count: { $sum: 1 } } },
    ]).toArray();
    return Object.fromEntries(rows.map(r => [r._id, r.count]));
  }

  it('counts a two-tag item under both of its categories', async () => {
    const counts = await countByCategory([TAGGED_TWO]);
    expect(counts[CAT_A]).toBe(1);
    expect(counts[CAT_B]).toBe(1);
  });

  it('falls back to the scalar pair for records with no tags', async () => {
    const counts = await countByCategory([LEGACY]);
    expect(counts[CAT_A]).toBe(1);
  });

  it('produces a total above the document count, by design', async () => {
    const counts = await countByCategory([TAGGED_TWO, TAGGED_ONE, LEGACY]);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);           // 2 + 1 + 1 tags across 3 documents
  });
});
