/**
 * Query helpers for the tag axis.
 *
 * A tag is a { category, sub_category } pair from CATEGORIZATION_SCHEMA — the
 * same vocabulary a lone category always came from. Tagging changed how many an
 * item may carry, not what they may say.
 *
 * Two shapes coexist on every calls/emails/analysis document:
 *   tags          — every issue the item raises, most important first
 *   category /
 *   sub_category  — tags[0], mirrored so that filters, exports and dashboards
 *                   written before tagging keep working untouched
 *
 * Records analysed before tagging have no `tags` array at all, so every filter
 * below matches the tag array OR the scalar pair. That makes the queries
 * correct before, during and after the backfill in scripts/backfillTags.js —
 * no flag day, and a half-migrated collection still answers correctly.
 */

/**
 * Filter matching items carrying this category on ANY tag.
 *
 * Pass a sub-category too and both must sit on the SAME tag: an email tagged
 * (Payment & Fee, Refund) + (Uploads & Documents, Photo Upload Issue) must not
 * match (Payment & Fee, Photo Upload Issue), which a pair of independent dotted
 * conditions would wrongly do.
 *
 * @param {string} category
 * @param {string} [subCategory]
 * @returns {object} a Mongo filter fragment
 */
function tagMatch(category, subCategory) {
  if (category && subCategory) {
    return { $or: [
      { tags: { $elemMatch: { category, sub_category: subCategory } } },
      { category, sub_category: subCategory },
    ]};
  }
  if (category) {
    return { $or: [{ 'tags.category': category }, { category }] };
  }
  return { $or: [{ 'tags.sub_category': subCategory }, { sub_category: subCategory }] };
}

/**
 * The aggregation stage that turns one document into one row per tag, so a
 * two-tag email counts once under each of its categories. Items with no tags
 * fall back to their scalar pair rather than dropping out of the totals.
 *
 * Counts produced this way sum to MORE than the document count. That is the
 * point of tagging, and any UI showing them has to say "mentions", not "emails".
 */
function unwindTagsStage() {
  return [
    { $addFields: {
      _tag_list: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$tags', []] } }, 0] },
          '$tags',
          [{ category: '$category', sub_category: '$sub_category' }],
        ],
      },
    }},
    { $unwind: '$_tag_list' },
  ];
}

module.exports = { tagMatch, unwindTagsStage };
