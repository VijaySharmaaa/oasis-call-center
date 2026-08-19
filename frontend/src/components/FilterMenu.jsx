import { useState, useRef, useEffect } from 'react';

/**
 * Several dropdowns folded into one control: pick the filter, then its value.
 *
 * A bar with one permanent dropdown per dimension spends the width of the page
 * on questions nobody has asked yet — four controls sitting there to announce
 * "Any Reply State", "Any Analysis", "Any Content", "All Categories" are four
 * widths of nothing. Asking WHICH filter first costs one button instead, and
 * the second step is the same option list the dropdown always showed: same
 * dots, same colours, same order.
 *
 * What a compact bar must not do is hide what is currently narrowing the list.
 * A filter you cannot see is one you forget you set, and then the table is
 * quietly lying about how much mail there is. So every set filter comes straight
 * back out as a chip beside the button, and pressing the chip's × clears it —
 * one press to undo, without going back through the menu to find it.
 *
 * A filter is `{ key, label, value, onChange, options, colorMap }`, where
 * `options` and `colorMap` are exactly what ColorSelect takes.
 */

function DotsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="13" cy="8" r="1.4" />
    </svg>
  );
}

function Chevron({ dir = 'right' }) {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0"
      viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d={dir === 'left' ? 'M10 4L6 8l4 4' : 'M6 4l4 4-4 4'} />
    </svg>
  );
}

/** The option currently chosen, or undefined while the filter is unset. */
function chosen(filter) {
  return filter.value ? filter.options.find(o => o.value === filter.value) : undefined;
}

export default function FilterMenu({ filters, className = '' }) {
  const [open, setOpen] = useState(false);
  // Which filter's own options are showing. null is the list of filters.
  const [openKey, setOpenKey] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const shut = () => { setOpen(false); setOpenKey(null); };
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) shut(); };
    const onKey  = e => { if (e.key === 'Escape') shut(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = filters.filter(f => f.value);
  const pane = openKey ? filters.find(f => f.key === openKey) : null;

  function pick(filter, value) {
    filter.onChange(value);
    setOpen(false);
    setOpenKey(null);
  }

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => { setOpen(o => !o); setOpenKey(null); }}
          title="Filters"
          aria-label="Filters"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
            open || active.length
              ? 'border-indigo-400 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40'
              : 'border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800'
          }`}
        >
          <DotsIcon />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute z-40 top-full mt-1 left-0 w-64 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg shadow-lg py-1"
          >
            {/* Step one: which filter. Each row carries its current setting, so
                the menu doubles as the answer to "what is on right now". */}
            {!pane && filters.map(f => (
              <button
                key={f.key}
                type="button"
                role="menuitem"
                onClick={() => setOpenKey(f.key)}
                // The label and its current value are adjacent spans, which
                // concatenate into "AnalysisFailed" for anything reading the
                // name rather than the layout. Spelled out here instead.
                aria-label={`${f.label}: ${chosen(f)?.label ?? 'Any'}`}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/60 transition-colors"
              >
                <span className="truncate">{f.label}</span>
                <span className="flex items-center gap-1 min-w-0 text-slate-400 dark:text-zinc-500">
                  <span className={`truncate text-xs ${
                    f.value ? (f.colorMap?.[f.value] || 'text-slate-700 dark:text-zinc-300') : ''
                  }`}>
                    {chosen(f)?.label ?? 'Any'}
                  </span>
                  <Chevron />
                </span>
              </button>
            ))}

            {/* Step two: the filter's own options, rendered as ColorSelect
                renders them — this is meant to be the same dropdown, reached
                a different way, not a second design of it. */}
            {pane && (
              <>
                <button
                  type="button"
                  onClick={() => setOpenKey(null)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/60 border-b border-slate-100 dark:border-zinc-800 transition-colors"
                >
                  <Chevron dir="left" />
                  {pane.label}
                </button>
                <div className="max-h-60 overflow-y-auto py-1">
                  {pane.options.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitem"
                      onClick={() => pick(pane, opt.value)}
                      className={`w-full text-left px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                        pane.value === opt.value
                          ? 'bg-slate-100 dark:bg-zinc-800'
                          : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'
                      } ${opt.value && pane.colorMap?.[opt.value] ? pane.colorMap[opt.value] : 'text-slate-700 dark:text-zinc-300'}`}
                    >
                      {opt.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {active.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={() => f.onChange('')}
          title={`${f.label}: ${chosen(f)?.label ?? f.value} — press to clear`}
          className="group inline-flex items-center gap-1.5 h-9 pl-2.5 pr-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-medium hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
        >
          {chosen(f)?.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${chosen(f).dot}`} />}
          <span className={`truncate max-w-[160px] ${f.colorMap?.[f.value] || 'text-slate-700 dark:text-zinc-300'}`}>
            {chosen(f)?.label ?? f.value}
          </span>
          <svg
            className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-200"
            viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      ))}
    </div>
  );
}
