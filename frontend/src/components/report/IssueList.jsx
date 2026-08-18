/**
 * A ranked issue block — the repeating unit of page 1.
 *
 * Categories in priority order (most frequent first), each dropping to its
 * sub-categories only while there is room. `subLimit` is what "if space" in the
 * template means: the caller knows how much of the sheet this block owns, so
 * it decides the depth rather than the block guessing.
 */
export default function IssueList({ bucket, colorOf, categoryLimit = 5, subLimit = 2, dense = false }) {
  const categories = (bucket?.categories || []).slice(0, categoryLimit);
  const hidden = (bucket?.categories?.length || 0) - categories.length;

  if (categories.length === 0) {
    return (
      <p className="text-[10px] text-slate-400 italic mt-1">
        {bucket?.total
          ? `${bucket.total} with no issue identified`
          : 'none'}
      </p>
    );
  }

  return (
    <ol className={dense ? 'space-y-0.5' : 'space-y-1'}>
      {categories.map(cat => (
        <li key={cat.category}>
          <div className="flex items-baseline gap-1.5">
            <span data-category={cat.category} className="w-2 h-2 rounded-[2px] shrink-0 translate-y-px" style={{ background: colorOf(cat.category) }} />
            <span className="text-[11px] font-medium text-slate-800 truncate" title={cat.category}>{cat.category}</span>
            <span className="text-[10px] tabular-nums text-slate-500 ml-auto shrink-0">{cat.count}</span>
          </div>
          {subLimit > 0 && cat.subs.length > 0 && (
            <ul className="ml-3.5">
              {cat.subs.slice(0, subLimit).map(sub => (
                <li key={sub.sub_category} className="flex items-baseline gap-1.5">
                  <span className="text-[9.5px] text-slate-500 truncate" title={sub.sub_category}>{sub.sub_category}</span>
                  <span className="text-[9.5px] tabular-nums text-slate-400 ml-auto shrink-0">{sub.count}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      {hidden > 0 && (
        <li className="text-[9.5px] text-slate-400 pl-3.5">+{hidden} more categor{hidden === 1 ? 'y' : 'ies'}</li>
      )}
    </ol>
  );
}
