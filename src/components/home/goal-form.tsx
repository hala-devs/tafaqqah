"use client";

import { useActionState, useState } from "react";
import { saveGoalsAction, type GoalFormState } from "@/app/(shell)/account/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";

type Kind = "LESSONS" | "CONCEPTS";
type Props = {
  weekly: number | null;
  monthlyKind: Kind | null;
  monthlyTarget: number | null;
  weeklyPresets: readonly number[];
  monthlyPresets: Record<Kind, readonly number[]>;
};

const LESSONS: [string, string, string, string] = ["درس واحد", "درسان", "دروس", "درسًا"];

function Chip({ name, value, checked, onChange, children }: { name: string; value: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="cursor-pointer">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={cn(
          "inline-flex h-11 min-w-20 items-center justify-center rounded-lg border px-4 text-small font-medium transition-[background-color,border-color,color] duration-200 ease-calm",
          "border-line-strong bg-surface text-ink hover:border-sage-dark",
          "peer-checked:border-ink peer-checked:bg-ink peer-checked:text-surface",
          "peer-focus-visible:shadow-[var(--shadow-focus)]",
        )}
      >
        {children}
      </span>
    </label>
  );
}

/** Optional weekly and monthly goals. Nothing here is required to use the platform. */
export function GoalForm({ weekly, monthlyKind, monthlyTarget, weeklyPresets, monthlyPresets }: Props) {
  const [state, action, pending] = useActionState(saveGoalsAction, {} as GoalFormState);
  const [weeklyValue, setWeeklyValue] = useState(weekly === null ? "" : String(weekly));
  const [kind, setKind] = useState<Kind | "NONE">(monthlyKind ?? "NONE");
  const [monthly, setMonthly] = useState<Record<Kind, string>>({
    LESSONS: monthlyKind === "LESSONS" && monthlyTarget ? String(monthlyTarget) : "",
    CONCEPTS: monthlyKind === "CONCEPTS" && monthlyTarget ? String(monthlyTarget) : "",
  });

  return (
    <form action={action} className="space-y-8">
      <fieldset>
        <legend className="text-body font-semibold text-ink">هدفي الأسبوعي</legend>
        <p className="mt-1 text-small text-muted">كم درسًا تريد إتمامه كل أسبوع؟ يبدأ الأسبوع يوم السبت.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip name="weekly" value="" checked={weeklyValue === ""} onChange={() => setWeeklyValue("")}>
            بدون هدف
          </Chip>
          {weeklyPresets.map((n) => (
            <Chip key={n} name="weekly" value={String(n)} checked={weeklyValue === String(n)} onChange={() => setWeeklyValue(String(n))}>
              {countLabel(n, LESSONS)}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-body font-semibold text-ink">هدفي الشهري</legend>
        <p className="mt-1 text-small text-muted">اختر هدف دروس، أو هدف إتقان مفاهيم.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip name="monthlyKind" value="NONE" checked={kind === "NONE"} onChange={() => setKind("NONE")}>
            بدون هدف
          </Chip>
          <Chip name="monthlyKind" value="LESSONS" checked={kind === "LESSONS"} onChange={() => setKind("LESSONS")}>
            دروس مكتملة
          </Chip>
          <Chip name="monthlyKind" value="CONCEPTS" checked={kind === "CONCEPTS"} onChange={() => setKind("CONCEPTS")}>
            مفاهيم متقنة
          </Chip>
        </div>
        {kind !== "NONE" ? (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={kind === "LESSONS" ? "عدد الدروس هذا الشهر" : "عدد المفاهيم هذا الشهر"}>
            {monthlyPresets[kind].map((n) => (
              <Chip
                key={`${kind}-${n}`}
                name={`monthly-${kind}`}
                value={String(n)}
                checked={monthly[kind] === String(n)}
                onChange={() => setMonthly((m) => ({ ...m, [kind]: String(n) }))}
              >
                {kind === "LESSONS" ? `${ar(n)} ${n <= 10 ? "دروس" : "درسًا"}` : `${ar(n)} مفهومًا`}
              </Chip>
            ))}
          </div>
        ) : null}
      </fieldset>

      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" loading={pending}>
          حفظ أهدافي
        </Button>
        {state.ok ? (
          <p role="status" className="text-small font-medium text-success-ink">
            ✓ حُفظت أهدافك
          </p>
        ) : null}
      </div>
    </form>
  );
}
