/**
 * Renders every tag on a call or email.
 *
 * A tag is a { category, sub_category } pair from the same taxonomy a lone
 * category always came from — an item may now carry several because a caller
 * rarely raises exactly one issue.
 *
 * Records analysed before tagging have no `tags` array, so the scalar
 * category/sub_category pair is the fallback. That mirrors src/lib/tags.js on
 * the backend: both shapes read correctly, before and after the backfill.
 */

/** Returns the tag list to render, falling back to the legacy scalar pair. */
export function tagsOf(item) {
  if (Array.isArray(item?.tags) && item.tags.length > 0) return item.tags;
  if (item?.category) return [{ category: item.category, sub_category: item.sub_category }];
  return [];
}

export function tagKey(tag, i) {
  return `${tag.category}|${tag.sub_category ?? ''}|${i}`;
}

export default function TagChips({ item, max = 2, showSub = false, className = '' }) {
  const tags = tagsOf(item);

  if (tags.length === 0) {
    return <span className="text-slate-300 dark:text-zinc-600 text-xs">pending</span>;
  }

  const shown  = tags.slice(0, max);
  const hidden = tags.length - shown.length;

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`}>
      {shown.map((tag, i) => (
        <span
          key={tagKey(tag, i)}
          // The primary tag is the issue the candidate led with; the rest are
          // real but secondary, and are toned down to say so.
          title={tag.sub_category && tag.sub_category !== '-' ? `${tag.category} · ${tag.sub_category}` : tag.category}
          // A chip carrying its sub-category is roughly twice the text, so it
          // gets room for it rather than truncating the half that says which
          // kind of the category this is.
          className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap truncate ${
            showSub ? 'max-w-[300px]' : 'max-w-[180px]'
          } ${
            i === 0
              ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
              : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
          }`}
        >
          {tag.category}
          {showSub && tag.sub_category && tag.sub_category !== '-' && (
            <span className="opacity-60"> · {tag.sub_category}</span>
          )}
        </span>
      ))}
      {hidden > 0 && (
        <span
          title={tags.slice(max).map(t => t.category).join(', ')}
          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
