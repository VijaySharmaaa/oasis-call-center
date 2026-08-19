import { useLayoutEffect, useRef } from "react";

/**
 * The pill row with the sliding background — the Call Report's primary filter,
 * now shared so the Emails tab reads as the same product rather than as a
 * lookalike.
 *
 * A tab is `{ value, label, bg: [light, dark], text }`. `bg` is a pair rather
 * than a class because the slider's colour is animated through inline style,
 * which cannot resolve a Tailwind dark: variant.
 *
 * Reserved for the ONE status a list is primarily read by. Everything else
 * belongs in a dropdown: two pill rows compete for the same attention and
 * neither wins.
 */
export default function StatusTabs({ tabs, value, onChange }) {
  const sliderRef = useRef(null);
  const tabRefs = useRef({});
  const active = tabs.find((t) => t.value === value) || tabs[0];
  const isDark = document.documentElement.classList.contains("dark");

  useLayoutEffect(() => {
    const el = tabRefs.current[value];
    const slider = sliderRef.current;
    if (el && slider) {
      slider.style.transform = `translateX(${el.offsetLeft}px)`;
      slider.style.width = `${el.offsetWidth}px`;
      slider.style.backgroundColor = active.bg[isDark ? 1 : 0];
    }
  }, [value, active, isDark, tabs]);

  return (
    <div className="relative flex gap-1 bg-slate-100 dark:bg-zinc-800/60 rounded-lg p-1">
      <div
        ref={sliderRef}
        className="absolute top-1 bottom-1 left-0 rounded-md shadow-sm will-change-transform"
        style={{
          transition:
            "transform 300ms cubic-bezier(0.4,0,0.2,1), width 300ms cubic-bezier(0.4,0,0.2,1), background-color 300ms cubic-bezier(0.4,0,0.2,1)",
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          ref={(el) => {
            tabRefs.current[tab.value] = el;
          }}
          onClick={() => onChange(tab.value)}
          className={`relative z-10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-300 whitespace-nowrap ${
            value === tab.value
              ? tab.text
              : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
