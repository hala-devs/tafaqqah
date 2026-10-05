"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarMonth, shiftMonth, type CalendarCell } from "@/lib/continuity";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

const WEEKDAYS = [
  { letter: "س", name: "السبت" },
  { letter: "ح", name: "الأحد" },
  { letter: "ن", name: "الاثنين" },
  { letter: "ث", name: "الثلاثاء" },
  { letter: "ر", name: "الأربعاء" },
  { letter: "خ", name: "الخميس" },
  { letter: "ج", name: "الجمعة" },
];
const STATE_TEXT: Record<CalendarCell["state"], string> = {
  active: "يوم نشاط",
  "today-active": "اليوم — يوم نشاط",
  today: "اليوم، لم يُسجَّل نشاط بعد",
  missed: "بدون نشاط",
  future: "يوم قادم",
};
const monthTitle = (key: string) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
const dayTitle = (key: string) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/** A small, restrained flame — the continuity mark (not an emoji, never animated). */
export function FlameMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8.2 1.2c.3 2-1 3-2.1 4.3C5 6.8 4 8.1 4 10a4 4 0 0 0 8 0c0-1.5-.6-2.6-1.3-3.5-.2.9-.7 1.6-1.4 1.9.3-2.5-.2-5.3-1.1-7.2Zm-.1 13a2.2 2.2 0 0 1-2.2-2.2c0-1.1.8-1.8 1.5-2.6.3.6.8 1 1.4 1.1-.1-.5 0-1 .2-1.5.7.8 1.3 1.7 1.3 3a2.2 2.2 0 0 1-2.2 2.2Z" />
    </svg>
  );
}

function Day({ cell }: { cell: CalendarCell }) {
  const active = cell.state === "active" || cell.state === "today-active";
  const today = cell.state === "today" || cell.state === "today-active";
  return (
    <li className="flex justify-center" aria-current={today ? "date" : undefined}>
      <span
        className={cn(
          "relative flex size-9 items-center justify-center rounded-full text-small tabular-nums transition-colors duration-200 sm:size-10",
          active && "bg-sage-dark font-semibold text-surface shadow-[0_4px_12px_-6px_rgb(69_96_79/0.8)]",
          cell.state === "today" && "bg-surface font-semibold text-ink",
          today && "ring-2 ring-gold ring-offset-2 ring-offset-surface",
          cell.state === "missed" && "border border-line text-muted",
          cell.state === "future" && "text-faint/70",
        )}
      >
        {active ? <FlameMark className="size-4 text-gold-soft" /> : ar(cell.day)}
        <span className="sr-only">
          {dayTitle(cell.key)}: {STATE_TEXT[cell.state]}
        </span>
      </span>
    </li>
  );
}

/**
 * Monthly activity calendar. Days come from LearningDay (the streak's own source), never from logins. Active days
 * show the flame instead of the number; every day has an sr-only date + state. Navigation stops at the current month.
 */
export function ActivityCalendar({ activeDays, today }: { activeDays: string[]; today: string }) {
  const current = `${today.slice(0, 7)}-01`;
  const earliest = activeDays.length ? `${activeDays[0].slice(0, 7)}-01` : current;
  const [month, setMonth] = useState(current);
  const active = useMemo(() => new Set(activeDays), [activeDays]);
  const view = useMemo(() => calendarMonth(month, today, active), [month, today, active]);
  const activeCount = view.cells.filter((c) => c.state === "active" || c.state === "today-active").length;
  const nav = "flex size-10 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-200 ease-calm hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:scale-95 disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none";

  return (
    <div data-testid="activity-calendar">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className={nav} aria-label="الشهر السابق" disabled={month <= earliest} onClick={() => setMonth((m) => shiftMonth(m, -1))} data-testid="calendar-prev">
          <ChevronRight className="size-5" aria-hidden />
        </button>
        <div className="text-center">
          <h3 className="text-card font-bold text-ink" aria-live="polite" data-testid="calendar-month">
            {monthTitle(month)}
          </h3>
          <p className="text-caption text-muted">{activeCount === 0 ? "لا أيام نشاط في هذا الشهر" : `أيام النشاط: ${ar(activeCount)}`}</p>
        </div>
        <button type="button" className={nav} aria-label="الشهر التالي" disabled={month >= current} onClick={() => setMonth((m) => shiftMonth(m, 1))} data-testid="calendar-next">
          <ChevronLeft className="size-5" aria-hidden />
        </button>
      </div>

      <ol className="mt-5 grid grid-cols-7 gap-y-2" aria-hidden>
        {WEEKDAYS.map((d) => (
          <li key={d.letter} className="text-center text-caption font-semibold text-muted" title={d.name}>
            {d.letter}
          </li>
        ))}
      </ol>
      <ol className="mt-2 grid grid-cols-7 gap-y-2" aria-label={`أيام ${monthTitle(month)}`}>
        {Array.from({ length: view.lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden />
        ))}
        {view.cells.map((cell) => (
          <Day key={cell.key} cell={cell} />
        ))}
      </ol>
    </div>
  );
}

/** The compact legend — every state named in text. */
export function CalendarLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-3 text-caption text-muted", className)} aria-label="دليل التقويم">
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-sage-dark">
          <FlameMark className="size-3 text-gold-soft" />
        </span>
        يوم نشاط
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="size-6 rounded-full bg-surface ring-2 ring-gold ring-offset-1 ring-offset-surface" />
        اليوم
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="size-6 rounded-full border border-line" />
        بدون نشاط
      </li>
      <li className="inline-flex items-center gap-2">
        <span aria-hidden className="flex size-6 items-center justify-center rounded-full text-micro text-faint/70">١</span>
        مستقبل
      </li>
    </ul>
  );
}
