"use client";

import { useId, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { setWeeklyGoalAction } from "@/app/(shell)/account/actions";
import { GoalEditor } from "@/components/memorize/memorization-goal-form";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import type { GoalProgress } from "@/server/learner/motivation";
import type { MemorizationGoalView } from "@/server/memorization/goals";

const LESSONS = ["درس واحد", "درسان", "دروس", "درسًا"] as [string, string, string, string];
const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];
const PERIOD_NOUN = { DAILY: "اليوم", WEEKLY: "هذا الأسبوع", MONTHLY: "هذا الشهر" } as const;

type Accent = "ink" | "sage";
const DOT = { ink: "bg-ink", sage: "bg-sage-dark" };
const LABEL = { ink: "text-ink", sage: "text-sage-deep" };

/**
 * One goal column: journey label (same accent as its journey card), the goal's own name, a compact summary, and an
 * editor that opens only on request.
 */
function GoalColumn({ accent, title, summary, toggleLabel, primaryToggle, editor, testId }: { accent: Accent; title: string; summary: ReactNode; toggleLabel: string; primaryToggle: boolean; editor: ReactNode; testId: string }) {
  const [open, setOpen] = useState(false);
  const editorId = useId();
  const titleId = useId();
  return (
    <div data-testid={testId}>
      <h3 id={titleId} className={cn("inline-flex items-center gap-2 text-small font-semibold", LABEL[accent])}>
        <span aria-hidden className={cn("h-3.5 w-[3px] rounded-full", DOT[accent])} />
        {title}
      </h3>
      <div className="mt-3">{summary}</div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={editorId}
        aria-describedby={titleId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "mt-4 inline-flex min-h-11 items-center rounded-lg text-small font-semibold transition-[background-color,border-color,color] duration-200 ease-calm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
          primaryToggle && !open ? "border border-line-strong bg-surface px-4 text-ink hover:border-ink/35 hover:bg-white" : "-ms-1 px-1 text-muted underline decoration-line-strong underline-offset-[6px] hover:text-ink hover:decoration-ink/40",
        )}
      >
        {open ? "إغلاق" : toggleLabel}
      </button>
      <div id={editorId} hidden={!open} className="motion-safe:animate-fade-up">
        {open ? editor : null}
      </div>
    </div>
  );
}

/** An unset (or paused) goal: one plain statement and one line of guidance — no zeros. */function Unset({ title, hint }: { title: string; hint: string }) {  return (    <>      <p className="text-card font-medium text-ink">{title}</p>      <p className="mt-0.5 text-small text-muted">{hint}</p>    </>  );}
/** The set-goal summary: the target as the headline, then a thin track and «x من y». */
function GoalSummary({ accent, headline, caption, value, max, progressText, label, done }: { accent: Accent; headline: string; caption: string; value: number; max: number; progressText: string; label: string; done: boolean }) {
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-section font-bold text-ink">{headline}</span>
        <span className="text-caption text-muted">{caption}</span>
      </p>
      <Progress value={Math.min(value, max)} max={max} label={label} tone={accent} size="xs" animateFrom={0} className="mt-3" />
      <p className="mt-2 text-caption text-muted tabular-nums">
        {done ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-success-ink">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
            أتممت هدفك — {progressText}
          </span>
        ) : (
          progressText
        )}
      </p>
    </>
  );
}

/** Learning goal: lessons per week (LearnerSettings.weeklyLessonGoal, same action and presets as before). */
export function LearningGoal({ weekly, presets }: { weekly: GoalProgress | null; presets: readonly number[] }) {
  return (
    <GoalColumn
      accent="ink"
      title="هدف التعلّم والفهم"
      testId={weekly ? "weekly-goal" : "weekly-goal-empty"}
      toggleLabel={weekly ? "تعديل الهدف" : "حدد عدد الدروس"}
      primaryToggle={!weekly}
      summary={
        weekly ? (
          <GoalSummary
            accent="ink"
            headline={countLabel(weekly.target, LESSONS)}
            caption="هذا الأسبوع"
            value={weekly.current}
            max={weekly.target}
            done={weekly.done}
            progressText={`${ar(weekly.current)} من ${ar(weekly.target)} مكتمل`}
            label={`هدف التعلّم: ${ar(weekly.current)} من ${ar(weekly.target)} دروس هذا الأسبوع`}
          />
        ) : (
          <Unset title="لم تحدد هدفًا بعد" hint="اختر عدد الدروس التي تريد إنجازها هذا الأسبوع." />
        )
      }
      editor={
        <form action={setWeeklyGoalAction} className="mt-3 rounded-xl bg-surface-2/60 p-4">
          <p id="learning-goal-hint" className="text-caption text-muted">
            كم درسًا تريد إتمامه هذا الأسبوع؟
          </p>
          <div role="group" aria-labelledby="learning-goal-hint" className="mt-3 flex flex-wrap gap-2">
            {presets.map((n) => (
              <button
                key={n}
                type="submit"
                name="target"
                value={n}
                aria-pressed={weekly?.target === n}
                className="inline-flex h-11 min-w-20 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-small font-medium text-ink transition-[background-color,border-color,color] duration-200 ease-calm hover:border-ink/40 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface"
              >
                {countLabel(n, LESSONS)}
              </button>
            ))}
            {weekly ? (
              <button type="submit" name="target" value="" className="inline-flex h-11 items-center rounded-lg px-3 text-small font-medium text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
                إزالة الهدف
              </button>
            ) : null}
          </div>
        </form>
      }
    />
  );
}

/** Memorization goal: amount of new Matn lines (MemorizationGoal). Not the session size; same editor as /memorize. */
export function MemorizationGoal({ goal }: { goal: MemorizationGoalView }) {
  const active = goal?.isActive ? goal : null;
  return (
    <GoalColumn
      accent="sage"
      title="هدف حفظ المتن"
      testId={active ? "memo-goal" : "memo-goal-empty"}
      toggleLabel={goal ? "تعديل الهدف" : "حدد مقدار الحفظ"}
      primaryToggle={!goal}
      summary={
        active ? (
          <GoalSummary
            accent="sage"
            headline={countLabel(active.targetUnits, LINES)}
            caption={PERIOD_NOUN[active.period]}
            value={active.completedUnits}
            max={active.targetUnits}
            done={active.completedUnits >= active.targetUnits}
            progressText={`${ar(active.completedUnits)} من ${ar(active.targetUnits)}`}
            label={`هدف الحفظ: ${ar(active.completedUnits)} من ${ar(active.targetUnits)} أسطر ${PERIOD_NOUN[active.period]}`}
          />
        ) : (
          goal ? <Unset title="هدف الحفظ متوقف الآن" hint="فعّله متى شئت من «تعديل الهدف»." /> : <Unset title="لم تحدد مقدار الحفظ بعد" hint="حدد مقدار المتن الذي تريد حفظه هذا الأسبوع." />
        )
      }
      editor={
        <div className="[&>form]:mt-3 [&>form]:rounded-xl [&>form]:border-0 [&>form]:bg-surface-2/60 [&>form]:p-4">
          <GoalEditor goal={goal} />
        </div>
      }
    />
  );
}
