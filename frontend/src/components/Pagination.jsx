const PAGE_SIZES = [10, 25, 50, 100];

function getPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
  if (current >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
}

function PagBtn({ children, onClick, disabled, active, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-md text-sm transition-colors ${
        active
          ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200 font-semibold'
          : disabled
            ? 'text-slate-300 dark:text-zinc-600 cursor-not-allowed'
            : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

export default function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between mt-4 gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <p className="text-sm text-slate-500 dark:text-zinc-400">
          Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}
        </p>
        <select
          value={pageSize}
          onChange={e => { onPageSizeChange(Number(e.target.value)); onPageChange(1); }}
          className="px-2 py-1 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-700 dark:text-zinc-300 focus:outline-none focus:border-indigo-500"
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <PagBtn onClick={() => onPageChange(1)} disabled={page === 1} title="First">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v10M6 8l5-4v8L6 8z"/></svg>
          </PagBtn>
          <PagBtn onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} title="Previous">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3L5 8l5 5"/></svg>
          </PagBtn>
          {getPageNumbers(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="w-8 text-center text-sm text-slate-400 dark:text-zinc-500">…</span>
            ) : (
              <PagBtn key={p} onClick={() => onPageChange(p)} active={p === page}>{p}</PagBtn>
            )
          )}
          <PagBtn onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} title="Next">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5"/></svg>
          </PagBtn>
          <PagBtn onClick={() => onPageChange(totalPages)} disabled={page === totalPages} title="Last">
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3v10M10 8L5 4v8l5-4z"/></svg>
          </PagBtn>
        </div>
      )}
    </div>
  );
}
