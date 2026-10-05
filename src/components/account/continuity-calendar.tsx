"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { cn } from "@/lib/cn";
import { addDays, weekdayOf } from "@/lib/learning-time";

const DAYS = ["س", "ح", "ن", "ث", "ر", "خ", "ج"];
const MONTH = (key: string) => new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
const nextMonth = (key: string, delta: number) => { const [year, month] = key.slice(0, 7).split("-").map(Number); const date = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`; };
const daysInMonth = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();

export function ContinuityCalendar({ activeDays, today }: { activeDays: string[]; today: string }) {
  const [month, setMonth] = useState(`${today.slice(0, 7)}-01`);
  const active = useMemo(() => new Set(activeDays), [activeDays]);
  const first = weekdayOf(month); // Sunday=0; calendar begins Saturday=6.
  const lead = (first - 6 + 7) % 7;
  const cells = Array.from({ length: lead + daysInMonth(month) }, (_, index) => index < lead ? null : `${month.slice(0, 8)}${String(index - lead + 1).padStart(2, "0")}`);
  const canGoForward = month < `${today.slice(0, 7)}-01`;
  return <section aria-labelledby="activity-calendar-title" className="mt-5 rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-6">
    <div className="flex items-center justify-between gap-3"><button type="button" aria-label="الشهر السابق" onClick={() => setMonth((value) => nextMonth(value, -1))} className="flex size-10 items-center justify-center rounded-lg text-ink hover:bg-surface-2"><ChevronRight className="size-5" /></button><h3 id="activity-calendar-title" className="text-card font-bold text-ink">{MONTH(month)}</h3><button type="button" aria-label="الشهر التالي" disabled={!canGoForward} onClick={() => setMonth((value) => nextMonth(value, 1))} className="flex size-10 items-center justify-center rounded-lg text-ink hover:bg-surface-2 disabled:opacity-35"><ChevronLeft className="size-5" /></button></div>
    <div className="mt-5 grid grid-cols-7 gap-1.5 text-center" dir="rtl">{DAYS.map((day) => <span key={day} className="text-caption font-semibold text-muted">{day}</span>)}{cells.map((day, index) => { if (!day) return <span key={`empty-${index}`} aria-hidden />; const isToday = day === today; const isFuture = day > today; const isActive = active.has(day); const dateLabel = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)); const state = isActive ? "يوم نشاط مكتمل" : isToday ? "اليوم، لم يكتمل نشاط بعد" : isFuture ? "يوم قادم" : "لا يوجد نشاط"; return <span key={day} aria-label={`${dateLabel} — ${state}`} className={cn("relative flex aspect-square min-h-9 items-center justify-center rounded-lg text-caption font-semibold", isActive ? "bg-sage-soft text-sage-deep" : isFuture ? "text-faint/55" : "text-muted", isToday && "ring-2 ring-gold ring-offset-2 ring-offset-surface", !isActive && !isFuture && !isToday && "bg-surface-2/70")}>{Number(day.slice(-2))}{isActive ? <Flame aria-hidden className="absolute bottom-0.5 end-0.5 size-2.5 text-gold-ink" /> : null}</span>; })}</div>
    <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-caption text-muted"><span className="inline-flex items-center gap-1"><Flame className="size-3 text-gold-ink" aria-hidden />يوم نشاط</span><span className="inline-flex items-center gap-1"><i className="size-3 rounded-full border-2 border-gold" aria-hidden />اليوم</span><span className="inline-flex items-center gap-1"><i className="size-3 rounded-full bg-surface-2" aria-hidden />بدون نشاط</span></div>
  </section>;
}
