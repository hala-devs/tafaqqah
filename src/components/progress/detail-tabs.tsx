"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * «تفاصيل التقدّم»: two panels (الفهم | الحفظ) behind an accessible tab list. Both panels are server-rendered; only the
 * visible one changes. Arrow keys move between tabs (RTL: ArrowLeft goes forward).
 */
export function DetailTabs({ tabs }: { tabs: { key: string; label: string; hint: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const next = (to + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="تفاصيل التقدّم" className="flex w-full gap-1 rounded-2xl border border-line bg-surface-2/70 p-1 sm:max-w-md">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.key}`}
            aria-selected={active === i}
            aria-controls={`${base}-panel-${tab.key}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") move(i + 1);
              if (e.key === "ArrowRight") move(i - 1);
            }}
            className={cn(
              "min-h-12 flex-1 rounded-xl px-3 py-1.5 text-start transition-[background-color,box-shadow,color] duration-200 ease-calm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
              active === i ? "bg-surface text-ink shadow-soft" : "text-muted hover:bg-surface/60 hover:text-ink",
            )}
          >
            <span className="block text-body leading-tight font-semibold">{tab.label}</span>
            <span className="block text-caption text-muted">{tab.hint}</span>
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.key} role="tabpanel" id={`${base}-panel-${tab.key}`} aria-labelledby={`${base}-tab-${tab.key}`} hidden={active !== i} className="mt-6">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
