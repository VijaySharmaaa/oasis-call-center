import { useState, useRef, useEffect } from 'react';

export default function ColorSelect({ value, onChange, options, placeholder, colorMap = {} }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = options.find(o => o.value === value);
  /* An unset filter is not a value — it reads muted, so a row of dropdowns
     shows at a glance which ones are actually narrowing the list. The old
     fallback was `text-slate-900 dark:text-white`, which made every placeholder
     as loud as a selection, and went invisible outright if a `dark` class was
     left on the page: white resolves to the beige surface these sit on. */
  const displayColor = value
    ? (colorMap[value] || 'text-slate-900')
    : 'text-slate-500';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-between gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm font-medium focus:outline-none transition-colors min-w-[120px] ${displayColor}`}
      >
        <span className="truncate">{selected?.label || placeholder}</span>
        <svg className={`w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-40 top-full mt-1 left-0 min-w-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 max-h-60 overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-2 ${
                value === opt.value
                  ? 'bg-slate-100 dark:bg-zinc-800'
                  : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'
              } ${opt.value && colorMap[opt.value] ? colorMap[opt.value] : 'text-slate-700 dark:text-zinc-300'}`}
            >
              {opt.dot && <span className={`w-2 h-2 rounded-full shrink-0 ${opt.dot}`} />}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
