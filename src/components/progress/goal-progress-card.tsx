import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

type Accent = "ink" | "sage";
const A = {
  ink: { tile: "bg-ink text-surface", ring: "var(--color-ink)", title: "text-ink" },
  sage: { tile: "bg-sage-dark text-surface", ring: "var(--color-sage-dark)", title: "text-sage-deep" },
} as const;

/** A restrained progress ring — only ever drawn for a real goal. */
function Ring({ value, max, accent, label }: { value: number; max: number; accent: Accent; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <div role="img" aria-label={label} className="relative size-28 shrink-0 sm:size-32">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={A[accent].ring}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-calm motion-reduce:transition-none"
        />
      </svg>
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-section font-bold text-ink tabular-nums">
        {ar(pct)}٪
      </span>
    </div>
  );
}

export type GoalProgressData = { headline: string; period: string; value: number; max: number; fraction: string; done: boolean } | null;

/**
 * «تقدّم التعلّم والفهم» / «تقدّم حفظ المتن»: progress toward the CURRENT goal only. With no goal there is no ring and
 * no percentage — a calm no-goal state that links to the real goal settings.
 */
export function GoalProgressCard({ accent, icon, title, subtitle, goal, emptyText, detailsHref, testId }: { accent: Accent; icon: ReactNode; title: string; subtitle: string; goal: GoalProgressData; emptyText: string; detailsHref: string; testId: string }) {
  const a = A[accent];
  return (
    <section aria-labelledby={`${testId}-title`} className="relative flex flex-col overflow-hidden rounded-[1.375rem] border border-line/90 bg-surface p-5 shadow-soft sm:p-7" data-testid={testId}>
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", accent === "ink" ? "bg-ink" : "bg-sage-dark")} />
      <div className="flex items-start gap-3.5">
        <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-[0.875rem]", a.tile)}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${testId}-title`} className="text-section font-bold text-ink">
            {title}
          </h2>
          <p className="text-small text-muted">{subtitle}</p>
        </div>
      </div>

      {goal ? (
        <div className="mt-6 flex flex-1 items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-[1.75rem] leading-tight font-bold text-ink">{goal.headline}</p>
            <p className="mt-1 text-small text-muted">{goal.period}</p>
            <Progress value={Math.min(goal.value, goal.max)} max={goal.max} label={`${title}: ${goal.fraction}`} tone={accent} size="sm" className="mt-5" />
            <p className={cn("mt-2 text-small tabular-nums", goal.done ? "font-medium text-success-ink" : "text-muted")}>{goal.done ? `أتممت هدفك — ${goal.fraction}` : goal.fraction}</p>
          </div>
          <Ring value={goal.value} max={goal.max} accent={accent} label={`${title}: ${goal.fraction}`} />
        </div>
      ) : (
        <div className="mt-6 flex-1">
          <p className="text-card font-medium text-ink">لم تحدد هدفًا بعد</p>
          <p className="mt-0.5 text-small text-muted">{emptyText}</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/80 pt-4">
        <Link
          href="/account#goals"
          className={cn(
            "group inline-flex min-h-11 items-center gap-1.5 rounded-lg text-small font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
            goal ? "text-muted hover:text-ink" : a.title,
          )}
        >
          {goal ? "تعديل الهدف" : "حدد هدفك"}
          <ArrowLeft className="size-4 transition-transform duration-200 ease-calm group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </Link>
        <Link href={detailsHref} className="inline-flex min-h-11 items-center rounded-lg text-small font-medium text-muted underline decoration-transparent underline-offset-[6px] transition-colors duration-200 hover:text-ink hover:decoration-line-strong focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
          عرض التفاصيل
        </Link>
      </div>
    </section>
  );
}
