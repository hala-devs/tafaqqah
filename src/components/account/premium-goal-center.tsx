"use client";

import { useState } from "react";
import { BookOpen, Lightbulb, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { removeLearningJourneyGoalAction, saveLearningJourneyGoalAction } from "@/app/(shell)/account/actions";
import { removeMemorizationGoalAction, saveMemorizationGoalAction } from "@/app/(shell)/memorize/actions";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import type { Motivation } from "@/server/learner/motivation";
import type { MemorizationGoalView } from "@/server/memorization/goals";

type Period = "WEEKLY" | "MONTHLY";
type Tone = "ink" | "sage";
const LESSONS: [string, string, string, string] = ["درس واحد", "درسان", "دروس", "درسًا"];
const LINES: [string, string, string, string] = ["سطر واحد", "سطران", "أسطر", "سطرًا"];

function Segments({ value, onChange, tone }: { value: Period; onChange: (value: Period) => void; tone: Tone }) {
  return <div role="radiogroup" aria-label="الفترة" className="mt-2 grid grid-cols-2 rounded-xl border border-line bg-surface-2 p-1">{(["WEEKLY", "MONTHLY"] as const).map((period) => <button key={period} type="button" role="radio" aria-checked={value === period} onClick={() => onChange(period)} className={cn("min-h-10 rounded-lg px-3 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]", value === period ? tone === "ink" ? "bg-ink text-surface shadow-soft" : "bg-sage-dark text-surface shadow-soft" : "text-muted hover:text-ink")}>{period === "WEEKLY" ? "أسبوعي" : "شهري"}</button>)}</div>;
}

function Counter({ value, setValue, max, label, forms }: { value: number; setValue: (value: number) => void; max: number; label: string; forms: typeof LESSONS }) {
  return <div className="mt-3 flex items-center justify-center gap-5" dir="ltr"><button type="button" aria-label={`إنقاص ${label}`} disabled={value <= 1} onClick={() => setValue(value - 1)} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-40"><Minus className="size-4" aria-hidden /></button><output aria-label={label} className="min-w-32 text-center text-card font-bold text-ink" dir="rtl">{countLabel(value, forms)}</output><button type="button" aria-label={`زيادة ${label}`} disabled={value >= max} onClick={() => setValue(value + 1)} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-40"><Plus className="size-4" aria-hidden /></button></div>;
}

function Progress({ current, target, tone, forms }: { current: number; target: number; tone: Tone; forms: typeof LESSONS }) {
  const done = Math.min(current, target); const percent = Math.min(100, Math.round((done / target) * 100));
  return <div className="mt-5"><div className="flex items-center justify-between gap-3 text-small text-muted"><span>{countLabel(done, forms)} من {countLabel(target, forms)}</span><span className="rounded-md border border-line bg-surface px-2 py-1 font-semibold text-ink">{ar(percent)}%</span></div><div role="progressbar" aria-label={`تقدم الهدف: ${ar(done)} من ${ar(target)}`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none", tone === "ink" ? "bg-ink" : "bg-sage-dark")} style={{ width: `${percent}%` }} /></div></div>;
}

function Card({ tone, icon, title, description, children }: { tone: Tone; icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <article className={cn("relative overflow-hidden rounded-2xl border bg-surface p-5 shadow-soft sm:p-6", tone === "ink" ? "border-ink/15" : "border-sage/30")}><span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", tone === "ink" ? "bg-ink" : "bg-sage-dark")} /><div className="flex items-start gap-3"><span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", tone === "ink" ? "bg-ink-tint text-ink" : "bg-sage-soft text-sage-deep")}>{icon}</span><div><h3 className="text-card font-bold text-ink">{title}</h3><p className="mt-1 text-small leading-6 text-muted">{description}</p></div></div>{children}</article>;
}

export function PremiumGoalCenter({ motivation, memorizationGoal }: { motivation: Motivation; memorizationGoal: MemorizationGoalView }) {
  const learning = motivation.weekly ?? (motivation.monthly?.kind === "LESSONS" ? motivation.monthly : null);
  const [learningEdit, setLearningEdit] = useState(!learning);
  const initialLearning: Period = motivation.monthly?.kind === "LESSONS" && !motivation.weekly ? "MONTHLY" : "WEEKLY";
  const [learningPeriod, setLearningPeriod] = useState<Period>(initialLearning);
  const [learningTarget, setLearningTarget] = useState(initialLearning === "WEEKLY" ? motivation.settings.weeklyLessonGoal ?? 3 : motivation.monthly?.target ?? 8);
  const memory = memorizationGoal?.isActive ? memorizationGoal : null;
  const [memoryEdit, setMemoryEdit] = useState(!memory);
  const [memoryPeriod, setMemoryPeriod] = useState<Period>(memory?.period === "MONTHLY" ? "MONTHLY" : "WEEKLY");
  const [memoryTarget, setMemoryTarget] = useState(memory?.targetUnits ?? 10);

  return <div className="mt-6 grid gap-5 xl:grid-cols-2">
    <Card tone="ink" icon={<Lightbulb className="size-5" aria-hidden />} title="هدف التعلّم والفهم" description="اختر الفترة وعدد الدروس التي تريد إنجازها.">
      {learning && !learningEdit ? <><div className="mt-6 rounded-xl bg-ink-tint/70 p-4"><p className="text-caption font-semibold text-ink">هدفك</p><p className="mt-1 text-card font-bold text-ink">إكمال {countLabel(learning.target, LESSONS)} {learning === motivation.weekly ? "هذا الأسبوع" : "هذا الشهر"}</p></div><Progress current={learning.current} target={learning.target} tone="ink" forms={LESSONS} /><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => setLearningEdit(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-4 text-small font-semibold text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"><Pencil className="size-4" aria-hidden />تعديل الهدف</button><form action={removeLearningJourneyGoalAction}><input type="hidden" name="period" value={learning === motivation.weekly ? "WEEKLY" : "MONTHLY"} /><button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-error/45 px-4 text-small font-semibold text-error-ink"><Trash2 className="size-4" aria-hidden />إزالة الهدف</button></form></div></> : <form action={saveLearningJourneyGoalAction} className="mt-6"><p className="text-small font-semibold text-ink">الفترة</p><Segments value={learningPeriod} onChange={(period) => { setLearningPeriod(period); setLearningTarget(period === "WEEKLY" ? motivation.settings.weeklyLessonGoal ?? 3 : motivation.monthly?.target ?? 8); }} tone="ink" /><p className="mt-5 text-small font-semibold text-ink">عدد الدروس</p><Counter value={learningTarget} setValue={setLearningTarget} max={learningPeriod === "WEEKLY" ? 14 : 200} label="عدد الدروس" forms={LESSONS} /><input type="hidden" name="period" value={learningPeriod} /><input type="hidden" name="target" value={learningTarget} /><div className="mt-6 flex gap-3"><button className="min-h-11 rounded-lg bg-ink px-5 text-small font-semibold text-surface shadow-soft">حفظ الهدف</button>{learning ? <button type="button" onClick={() => setLearningEdit(false)} className="min-h-11 px-3 text-small font-semibold text-muted">إلغاء</button> : null}</div></form>}
    </Card>
    <Card tone="sage" icon={<BookOpen className="size-5" aria-hidden />} title="هدف حفظ المتن" description="اختر الفترة ومقدار الحفظ الجديد الذي تريد الوصول إليه.">
      {memory && !memoryEdit ? <><div className="mt-6 rounded-xl bg-sage-soft/70 p-4"><p className="text-caption font-semibold text-sage-deep">هدفك {memory.period === "DAILY" ? "اليومي" : ""}</p><p className="mt-1 text-card font-bold text-ink">حفظ {countLabel(memory.targetUnits, LINES)} {memory.period === "WEEKLY" ? "هذا الأسبوع" : memory.period === "MONTHLY" ? "هذا الشهر" : "اليوم"}</p></div><Progress current={memory.completedUnits} target={memory.targetUnits} tone="sage" forms={LINES} /><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => setMemoryEdit(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-4 text-small font-semibold text-ink"><Pencil className="size-4" aria-hidden />تعديل الهدف</button><form action={removeMemorizationGoalAction}><button className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-error/45 px-4 text-small font-semibold text-error-ink"><Trash2 className="size-4" aria-hidden />إزالة الهدف</button></form></div></> : <form action={saveMemorizationGoalAction} className="mt-6"><p className="text-small font-semibold text-ink">الفترة</p>{memorizationGoal?.period === "DAILY" ? <p className="mt-2 rounded-lg bg-gold-soft/50 p-3 text-caption text-gold-ink">هدفك السابق يومي؛ اختر أسبوعي أو شهري عند الحفظ.</p> : null}<Segments value={memoryPeriod} onChange={(period) => { setMemoryPeriod(period); setMemoryTarget(memory?.period === period ? memory.targetUnits : period === "WEEKLY" ? 10 : 40); }} tone="sage" /><p className="mt-5 text-small font-semibold text-ink">مقدار الحفظ</p><Counter value={memoryTarget} setValue={setMemoryTarget} max={500} label="مقدار الحفظ" forms={LINES} /><input type="hidden" name="period" value={memoryPeriod} /><input type="hidden" name="targetUnits" value={memoryTarget} /><input type="hidden" name="isActive" value="on" /><div className="mt-6 flex gap-3"><button className="min-h-11 rounded-lg bg-sage-dark px-5 text-small font-semibold text-surface shadow-soft">حفظ الهدف</button>{memory ? <button type="button" onClick={() => setMemoryEdit(false)} className="min-h-11 px-3 text-small font-semibold text-muted">إلغاء</button> : null}</div></form>}
    </Card>
  </div>;
}
