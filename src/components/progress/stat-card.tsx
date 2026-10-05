import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

export type StatTone = "gold" | "ink" | "sage";

const TILE: Record<StatTone, string> = {
  gold: "bg-gold-soft text-gold-ink ring-gold/25",
  ink: "bg-ink-tint text-ink ring-ink/10",
  sage: "bg-sage-soft text-sage-deep ring-sage/20",
};

/** One summary figure: icon tile, short label, real value and its Arabic unit. */
export function StatCard({ icon, label, value, unit, hint, tone, className, testId }: { icon: ReactNode; label: string; value: number; unit: string; hint?: string; tone: StatTone; className?: string; testId?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.25rem] border border-line/90 bg-surface p-4 shadow-soft transition-[border-color,box-shadow] duration-300 ease-calm hover:border-line-strong hover:shadow-lift sm:p-5",
        className,
      )}
      data-testid={testId}
    >
      <div aria-hidden className="bg-geometric absolute inset-0 opacity-[0.18]" />
      <div className="relative flex items-start gap-3">
        <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TILE[tone])}>
          {icon}
        </span>
        <dl className="min-w-0 flex-1">
          <dt className="text-caption font-medium text-muted">{label}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[1.75rem] leading-none font-bold text-ink tabular-nums">{ar(value)}</span>
            <span className="text-small text-muted">{unit}</span>
          </dd>
          {hint ? <dd className="mt-1 text-micro text-muted">{hint}</dd> : null}
        </dl>
      </div>
    </div>
  );
}
