"use client";

import { useId, useState } from "react";
import { Target } from "lucide-react";
import { saveMemorizationGoalAction } from "@/app/(shell)/memorize/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import type { MemorizationGoalView } from "@/server/memorization/goals";

const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];
const PERIODS = [
  { value: "DAILY", label: "يومي", noun: "اليوم" },
  { value: "WEEKLY", label: "أسبوعي", noun: "هذا الأسبوع" },
  { value: "MONTHLY", label: "شهري", noun: "هذا الشهر" },
] as const;
const TITLE = { DAILY: "هدفك اليومي", WEEKLY: "هدفك الأسبوعي", MONTHLY: "هدفك الشهري" } as const;

/**
 * «هدف الحفظ»: a compact summary; the editor opens only when the learner asks. It posts exactly the fields the
 * existing action reads (targetUnits, period, isActive) — goal calculation and crediting are unchanged.
 */
export function MemorizationGoalForm({ goal }: { goal: MemorizationGoalView }) {
  const [editing, setEditing] = useState(false);
  const editorId = useId();
  const active = goal?.isActive ?? false;
  const completed = goal ? Math.min(goal.completedUnits, goal.targetUnits) : 0;
  const pct = goal && goal.targetUnits > 0 ? Math.round((completed / goal.targetUnits) * 100) : 0;
  const period = goal ? PERIODS.find((p) => p.value === goal.period)! : null;

  return (
    <section aria-labelledby="goal-title" className="rounded-2xl border border-line bg-surface p-5 sm:p-6" data-testid={active ? "memorization-goal-progress" : "memorization-goal-empty"}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-ink">
          <Target className="size-[1.125rem]" />
        </span>
        <h2 id="goal-title" className="flex-1 text-card font-semibold text-ink">
          هدف الحفظ
        </h2>
        <Button
          variant={active ? "ghost" : "secondary"}
          size="sm"
          aria-expanded={editing}
          aria-controls={editorId}
          onClick={() => setEditing((v) => !v)}
          data-testid="goal-edit-toggle"
        >
          {editing ? "إغلاق" : active || goal ? "تعديل الهدف" : "تحديد هدف"}
        </Button>
      </div>

      {active && goal && period ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-small text-muted">{TITLE[goal.period]}</p>
            <p className="text-card font-bold text-ink">{countLabel(goal.targetUnits, LINES)}</p>
          </div>
          <div role="progressbar" aria-label="تقدم هدف الحفظ" aria-valuemin={0} aria-valuemax={goal.targetUnits} aria-valuenow={completed} className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gold transition-[width] duration-700 ease-calm motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-small text-muted">
            {goal.completedUnits >= goal.targetUnits ? `أتممت هدفك ${period.noun}.` : `أنجزت ${ar(goal.completedUnits)} من ${ar(goal.targetUnits)} ${period.noun}.`}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-small text-muted">{goal && !goal.isActive ? "هدفك متوقف الآن. فعّله متى شئت." : "لم تحدد هدفًا بعد. الهدف اختياري ويساعدك على الاستمرار."}</p>
      )}

      <div id={editorId} hidden={!editing} className="motion-safe:animate-fade-in">
        {editing ? <GoalEditor goal={goal} /> : null}
      </div>
    </section>
  );
}

export function GoalEditor({ goal }: { goal: MemorizationGoalView }) {
  const [isActive, setIsActive] = useState(goal?.isActive ?? true);
  const [period, setPeriod] = useState<string>(goal?.period ?? "WEEKLY");
  const [target, setTarget] = useState<number>(goal?.targetUnits ?? 5);
  const amountId = useId();

  return (
    <form action={saveMemorizationGoalAction} className="mt-5 space-y-5 border-t border-line pt-5">
      {isActive ? <input type="hidden" name="isActive" value="on" /> : null}
      <input type="hidden" name="period" value={period} />

      <div className="flex items-center justify-between gap-4">
        <span id={`${amountId}-switch`} className="text-small font-medium text-ink">
          تفعيل الهدف
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-labelledby={`${amountId}-switch`}
          onClick={() => setIsActive((v) => !v)}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
            isActive ? "bg-sage-dark" : "bg-line-strong",
          )}
        >
          <span aria-hidden className={cn("absolute size-5 rounded-full bg-white shadow-soft transition-[inset-inline-start] duration-200 motion-reduce:transition-none", isActive ? "start-6" : "start-1")} />
        </button>
      </div>

      {/* Not a disabled fieldset: disabled inputs are not submitted and the action always reads targetUnits. */}
      <div className={cn("space-y-5 transition-opacity duration-200", !isActive && "opacity-55")}>
        <div>
          <p className="text-small font-medium text-ink">الفترة</p>
          <div role="radiogroup" aria-label="الفترة" className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "min-h-10 rounded-lg text-small font-semibold transition-[background-color,color,box-shadow] duration-200 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
                  period === p.value ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor={amountId} className="text-small font-medium text-ink">
            عدد الأسطر الجديدة
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="secondary" size="md" aria-label="إنقاص" className="w-11 px-0" onClick={() => setTarget((t) => Math.max(1, t - 1))}>
              −
            </Button>
            <input
              id={amountId}
              name="targetUnits"
              type="number"
              inputMode="numeric"
              min={1}
              max={500}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value) || 1)}
              className="h-11 w-20 rounded-lg border border-line-strong bg-white text-center text-card font-semibold tabular-nums text-ink focus:border-ink/50 focus:shadow-[var(--shadow-focus)] focus:outline-none"
            />
            <Button type="button" variant="secondary" size="md" aria-label="زيادة" className="w-11 px-0" onClick={() => setTarget((t) => Math.min(500, t + 1))}>
              +
            </Button>
          </div>
          <p className="mt-1.5 text-caption text-muted">يُحتسب كل سطر تسمّعه لأول مرة، ولا تُحتسب المراجعات.</p>
        </div>
      </div>

      <Button type="submit" variant="sage" className="w-full sm:w-auto" data-testid="goal-save">
        حفظ الهدف
      </Button>
    </form>
  );
}
