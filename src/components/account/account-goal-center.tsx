"use client";

import { useState } from "react";
import { BookOpen, Minus, Plus, Target } from "lucide-react";
import { saveLearningJourneyGoalAction } from "@/app/(shell)/account/actions";
import { saveMemorizationGoalAction } from "@/app/(shell)/memorize/actions";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import type { Motivation } from "@/server/learner/motivation";
import type { MemorizationGoalView } from "@/server/memorization/goals";

const LESSONS: [string, string, string, string] = ["درس واحد", "درسان", "دروس", "درسًا"];
const LINES: [string, string, string, string] = ["سطر واحد", "سطران", "أسطر", "سطرًا"];
type Period = "WEEKLY" | "MONTHLY";

function Segments({ value, onChange, tone }: { value: Period; onChange: (period: Period) => void; tone: "ink" | "sage" }) {
  return <div role="radiogroup" aria-label="الفترة" className="grid grid-cols-2 rounded-xl bg-surface-2 p-1">
    {(["WEEKLY", "MONTHLY"] as const).map((period) => <button key={period} type="button" role="radio" aria-checked={value === period} onClick={() => onChange(period)} className={cn("min-h-10 rounded-lg text-small font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]", value === period ? tone === "ink" ? "bg-ink text-surface shadow-soft" : "bg-sage-dark text-surface shadow-soft" : "text-muted hover:text-ink")}>{period === "WEEKLY" ? "أسبوعي" : "شهري"}</button>)}
  </div>;
}

function Counter({ value, setValue, max, label }: { value: number; setValue: (value: number) => void; max: number; label: string }) {
  const safe = (value: number) => Math.max(1, Math.min(max, Number.isInteger(value) ? value : 1));
  return <div className="mt-3 flex items-center justify-between gap-3">
    <button type="button" aria-label={`إنقاص ${label}`} disabled={value <= 1} onClick={() => setValue(safe(value - 1))} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink disabled:opacity-40"><Minus className="size-4" /></button>
    <label className="min-w-28 text-center"><span className="sr-only">{label}</span><input aria-label={label} type="number" inputMode="numeric" min={1} max={max} value={value} onChange={(event) => setValue(safe(Number(event.target.value)))} className="w-16 bg-transparent text-center text-title font-bold text-ink outline-none" /></label>
    <button type="button" aria-label={`زيادة ${label}`} disabled={value >= max} onClick={() => setValue(safe(value + 1))} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink disabled:opacity-40"><Plus className="size-4" /></button>
  </div>;
}

function GoalPanel({ children, title, description, tone, icon }: { children: React.ReactNode; title: string; description: string; tone: "ink" | "sage"; icon: React.ReactNode }) {
  return <article className={cn("rounded-2xl border bg-surface p-5 shadow-soft sm:p-6", tone === "ink" ? "border-ink/15" : "border-sage/30")}>
    <div className="flex items-start gap-3"><span className={cn("flex size-10 items-center justify-center rounded-xl", tone === "ink" ? "bg-ink-tint text-ink" : "bg-sage-soft text-sage-deep")}>{icon}</span><div><h3 className="text-card font-bold text-ink">{title}</h3><p className="mt-0.5 text-small text-muted">{description}</p></div></div>{children}
  </article>;
}

export function AccountGoalCenter({ motivation, memorizationGoal }: { motivation: Motivation; memorizationGoal: MemorizationGoalView }) {
  const [learningPeriod, setLearningPeriod] = useState<Period>(motivation.monthly?.kind === "LESSONS" && !motivation.weekly ? "MONTHLY" : "WEEKLY");
  const [learningTarget, setLearningTarget] = useState(learningPeriod === "WEEKLY" ? motivation.settings.weeklyLessonGoal ?? 3 : motivation.monthly?.target ?? 8);
  const [memoryPeriod, setMemoryPeriod] = useState<Period>(memorizationGoal?.period === "MONTHLY" ? "MONTHLY" : "WEEKLY");
  const [memoryTarget, setMemoryTarget] = useState(memorizationGoal?.targetUnits ?? 10);
  const learningProgress = learningPeriod === "WEEKLY" ? motivation.weekly : motivation.monthly?.kind === "LESSONS" ? motivation.monthly : null;
  const memoryProgress = memorizationGoal?.isActive && memorizationGoal.period === memoryPeriod ? memorizationGoal : null;

  return <div className="mt-5 grid gap-4 lg:grid-cols-2">
    <GoalPanel title="التعلّم والفهم" description="حدد مقدار الدروس التي تريد إكمالها." tone="ink" icon={<BookOpen className="size-5" aria-hidden />}>
      <form action={saveLearningJourneyGoalAction} className="mt-5"><input type="hidden" name="period" value={learningPeriod} /><input type="hidden" name="target" value={learningTarget} /><Segments value={learningPeriod} onChange={(period) => { setLearningPeriod(period); setLearningTarget(period === "WEEKLY" ? motivation.settings.weeklyLessonGoal ?? 3 : motivation.monthly?.target ?? 8); }} tone="ink" /><p className="mt-4 text-small font-semibold text-ink">عدد الدروس</p><Counter value={learningTarget} setValue={setLearningTarget} max={learningPeriod === "WEEKLY" ? 14 : 200} label="عدد الدروس" /><p className="mt-2 text-center text-card font-bold text-ink">{countLabel(learningTarget, LESSONS)}</p>{learningProgress ? <Progress tone="ink" current={learningProgress.current} target={learningProgress.target} noun="دروس" /> : <p className="mt-4 text-small text-muted">هدفك: إكمال {countLabel(learningTarget, LESSONS)} هذا {learningPeriod === "WEEKLY" ? "الأسبوع" : "الشهر"}.</p>}<button type="submit" className="mt-5 min-h-11 rounded-lg bg-ink px-5 text-small font-semibold text-surface">حفظ الهدف</button></form>
    </GoalPanel>
    <GoalPanel title="حفظ المتن" description="هدف مستقل لأسطر الحفظ الجديدة." tone="sage" icon={<Target className="size-5" aria-hidden />}>
      <form action={saveMemorizationGoalAction} className="mt-5"><input type="hidden" name="period" value={memoryPeriod} /><input type="hidden" name="targetUnits" value={memoryTarget} /><input type="hidden" name="isActive" value="on" /><Segments value={memoryPeriod} onChange={(period) => { setMemoryPeriod(period); setMemoryTarget(memorizationGoal?.period === period ? memorizationGoal.targetUnits : period === "WEEKLY" ? 10 : 40); }} tone="sage" /><p className="mt-4 text-small font-semibold text-ink">مقدار الحفظ</p><Counter value={memoryTarget} setValue={setMemoryTarget} max={500} label="عدد أسطر الحفظ" /><p className="mt-2 text-center text-card font-bold text-ink">{countLabel(memoryTarget, LINES)}</p>{memoryProgress ? <Progress tone="sage" current={memoryProgress.completedUnits} target={memoryProgress.targetUnits} noun="أسطر" /> : <p className="mt-4 text-small text-muted">هدفك: حفظ {countLabel(memoryTarget, LINES)} هذا {memoryPeriod === "WEEKLY" ? "الأسبوع" : "الشهر"}.</p>}<button type="submit" className="mt-5 min-h-11 rounded-lg bg-sage-dark px-5 text-small font-semibold text-surface">حفظ الهدف</button></form>
    </GoalPanel>
  </div>;
}

function Progress({ current, target, noun, tone }: { current: number; target: number; noun: string; tone: "ink" | "sage" }) {
  const done = Math.min(current, target); const pct = Math.min(100, Math.round((done / target) * 100));
  return <div className="mt-4"><div className="flex justify-between text-small text-muted"><span>أنجزت {ar(done)} من {ar(target)}</span><span>{noun}</span></div><div role="progressbar" aria-label={`تقدم الهدف: ${ar(done)} من ${ar(target)}`} aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full transition-[width] duration-500", tone === "ink" ? "bg-ink" : "bg-sage-dark")} style={{ width: `${pct}%` }} /></div></div>;
}
