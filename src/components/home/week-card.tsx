import Link from "next/link";
import { Check } from "lucide-react";
import { Ornament } from "@/components/home/ornament";
import { LearningGoal, MemorizationGoal } from "@/components/home/weekly-goals";
import { WEEKLY_GOAL_PRESETS, type Motivation } from "@/server/learner/motivation";
import type { StripDay } from "@/lib/learning-time";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import type { MemorizationGoalView } from "@/server/memorization/goals";

const STATE_NOTE: Record<StripDay["state"], string> = {
  done: "أنجزت نشاطًا في هذا اليوم",
  "today-done": "اليوم — أنجزت نشاطًا",
  today: "اليوم، لم يُسجَّل نشاط بعد",
  missed: "لا نشاط",
  upcoming: "قادم",
};

const isDone = (d: StripDay) => d.state === "done" || d.state === "today-done";

/** «3 أيام متتالية» split into a figure and its noun, with correct Arabic number agreement. */
function streakUnit(count: number): string {
  if (count === 1) return "يوم واحد";
  if (count === 2) return "يومان متتاليان";
  return count <= 10 ? "أيام متتالية" : "يومًا متتاليًا";
}

/**
 * The week as a continuity path: seven nodes joined by a hairline, read in RTL from Saturday. A segment turns gold
 * only between two real active days. Nodes: filled gold = activity, outlined navy = today, quiet dot = no activity /
 * not yet. Every node carries an sr-only sentence; the visual is never the only signal.
 */
export function WeekStrip({ days }: { days: StripDay[] }) {
  return (
    <ol className="grid grid-cols-7" aria-label="أيام هذا الأسبوع">
      {days.map((day, i) => {
        const next = days[i + 1];
        const today = day.state === "today" || day.state === "today-done";
        return (
          <li key={day.key} className="relative flex flex-col items-center gap-2" aria-current={today ? "date" : undefined}>
            {next ? (
              <span
                aria-hidden
                className={cn("absolute start-1/2 top-4 w-full -translate-y-1/2", isDone(day) && isDone(next) ? "h-0.5 bg-gold/70" : "h-px bg-line-strong/80")}
              />
            ) : null}
            <span aria-hidden className="relative flex h-8 items-center justify-center">
              {day.state === "today-done" ? (
                <span className="flex size-8 items-center justify-center rounded-full bg-gold text-surface shadow-[0_0_0_4px_rgb(185_154_94/0.18),0_6px_14px_-6px_rgb(133_104_58/0.7)]">
                  <Check className="size-4" strokeWidth={2.75} />
                </span>
              ) : day.state === "done" ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-gold text-surface">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              ) : day.state === "today" ? (
                <span className="flex size-8 items-center justify-center rounded-full border-2 border-ink bg-surface shadow-[0_0_0_4px_rgb(23_35_60/0.07)]">
                  <span className="size-2 rounded-full bg-ink" />
                </span>
              ) : day.state === "missed" ? (
                <span className="size-2.5 rounded-full bg-line-strong" />
              ) : (
                <span className="size-2.5 rounded-full border border-line-strong bg-surface" />
              )}
            </span>
            <span className={cn("text-caption", today ? "font-semibold text-ink" : "text-faint")} aria-hidden>
              {day.letter}
            </span>
            <span className="sr-only">
              {day.name}: {STATE_NOTE[day.state]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Shared continuity (LearningDay — written by lesson study, assessments and recitation; never by login). */
function Streak({ motivation }: { motivation: Motivation }) {
  const { streak, strip } = motivation;
  return (
    <div className="relative overflow-hidden rounded-[1.375rem] border border-gold/20 bg-gold-soft/40 p-5 sm:p-7" data-testid="streak">
      <Ornament className="absolute -bottom-14 -start-14 size-48 text-gold opacity-[0.12]" />
      <div className="relative grid gap-6 md:grid-cols-[minmax(0,15rem)_1fr] md:items-center md:gap-10">
        <div>
          <h3 className="inline-flex items-center gap-2 text-caption font-semibold text-gold-ink">
            <span aria-hidden className="size-1.5 rotate-45 bg-gold" />
            أيام نشاطك المتتالية
          </h3>
          {streak.count > 0 ? (
            <p className="mt-2 flex items-baseline gap-2.5" data-testid="streak-count">
              <span className="text-[2.75rem] leading-none font-bold text-ink tabular-nums">{ar(streak.count)}</span>
              <span className="text-card font-medium text-ink">{streakUnit(streak.count)}</span>
            </p>
          ) : (
            <p className="mt-2 text-section font-bold text-ink" data-testid="streak-count">
              ابدأ سلسلتك اليوم
            </p>
          )}
          <p className="mt-2 text-small text-muted">
            {streak.count === 0 ? "أكمل نشاطًا اليوم لبدء سلسلتك." : streak.activeToday ? "استمر على هذا المنوال." : "أكمل نشاطًا اليوم لتبقى سلسلتك متصلة."}
          </p>
        </div>
        <div>
          <WeekStrip days={strip} />
          <p className="mt-4 text-center text-caption text-muted md:text-start">يُحتسب اليوم بإتمام درس أو اختبار أو تسميع.</p>
        </div>
      </div>
    </div>
  );
}

function MonthlyLine({ monthly }: { monthly: NonNullable<Motivation["monthly"]> }) {
  const unit = monthly.kind === "LESSONS" ? "دروس" : "مفهومًا";
  return (
    <p className="mt-4 text-caption text-muted" data-testid="monthly-goal">
      هدف {monthly.monthName}:{" "}
      <span className="font-semibold text-ink tabular-nums">
        {ar(monthly.current)} / {ar(monthly.target)} {unit}
      </span>
      {monthly.done ? <span className="ms-2 text-success-ink">✓ تحقق</span> : null}
    </p>
  );
}

/**
 * «تقدمك هذا الأسبوع» — an open spread: the shared streak first, then two goal columns (lessons | Matn lines) split
 * by a hairline. Never one combined score; no calendar on the home.
 */
export function WeekCard({ motivation, memoGoal }: { motivation: Motivation; memoGoal: MemorizationGoalView }) {
  return (
    <section aria-labelledby="week-title" data-testid="week">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <h2 id="week-title" className="text-section font-bold text-ink">
            تقدمك هذا الأسبوع
          </h2>
          <p className="text-small text-muted">خطوات صغيرة، واستمرار يصنع الفرق.</p>
        </div>
        <Link
          href="/account#goals"
          className="inline-flex min-h-11 items-center rounded text-small font-medium text-muted underline decoration-transparent underline-offset-[6px] transition-colors duration-200 hover:text-ink hover:decoration-line-strong focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        >
          كل أهدافي
        </Link>
      </div>

      <div className="mt-5">
        <Streak motivation={motivation} />
      </div>

      <div className="mt-2 grid md:grid-cols-2">
        <div className="py-6 md:pe-8">
          <LearningGoal weekly={motivation.weekly} presets={WEEKLY_GOAL_PRESETS} />
          {motivation.monthly ? <MonthlyLine monthly={motivation.monthly} /> : null}
        </div>
        <div className="border-t border-line py-6 md:border-t-0 md:border-s md:ps-8">
          <MemorizationGoal goal={memoGoal} />
        </div>
      </div>
    </section>
  );
}
