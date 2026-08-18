import { RULE_COLOR, BORDER_COLOR } from '../../lib/reportPalette';

/**
 * One printed page.
 *
 * The sheet is always white and always dark-on-light, in either portal theme —
 * it is paper, and the template specifies a plain white ground with red side
 * borders. The surrounding portal chrome still follows the user's theme; only
 * what will physically print is pinned.
 *
 * Sized to A4 at 96dpi (794 × 1123) so what is on screen is what comes out of
 * the printer, and marked `break-after` so each sheet claims its own page.
 */
export default function Sheet({ children, className = '' }) {
  return (
    <section
      className={`report-sheet relative bg-white text-slate-900 mx-auto shadow-sm print:shadow-none ${className}`}
      style={{ width: '794px', minHeight: '1123px' }}
    >
      {/* The "reddish coating on sides" — a gradient band on each edge rather
          than a flat rule, so it reads as a coating at print resolution. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-3"
        style={{ background: `linear-gradient(90deg, ${BORDER_COLOR} 0%, ${RULE_COLOR} 55%, rgba(192,57,43,0.15) 100%)` }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 right-0 w-3"
        style={{ background: `linear-gradient(270deg, ${BORDER_COLOR} 0%, ${RULE_COLOR} 55%, rgba(192,57,43,0.15) 100%)` }}
      />
      <div className="px-10 py-8 h-full">{children}</div>
    </section>
  );
}

/** The thin red rule the template uses to divide sections horizontally. */
export function Rule({ className = '' }) {
  return <hr className={`border-0 my-3 ${className}`} style={{ height: '2px', background: RULE_COLOR, opacity: 0.85 }} />;
}

/** The same rule, vertical — for the side-by-side splits on page 1. */
export function VRule() {
  return <span aria-hidden className="w-0.5 self-stretch shrink-0" style={{ background: RULE_COLOR, opacity: 0.85 }} />;
}

/** Page furniture: the title line every sheet after the first carries. */
export function SheetHeader({ title, date, page }) {
  return (
    <header className="flex items-baseline justify-between mb-1">
      <h2 className="text-base font-bold tracking-tight uppercase" style={{ color: BORDER_COLOR }}>{title}</h2>
      <span className="text-[10px] text-slate-400 tabular-nums">{date} · page {page}</span>
    </header>
  );
}
