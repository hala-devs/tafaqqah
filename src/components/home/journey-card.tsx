import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Ornament } from "@/components/home/ornament";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import type { JourneyCardState } from "@/server/learner/home-view";

export type JourneyAccent = "ink" | "sage";

/** The journey colour language, shared by the journey cards and their weekly goals. */
export const ACCENT = {
  ink: { bar: "bg-ink", mark: "bg-ink-tint text-ink ring-ink/10", wash: "from-ink-tint/45", cta: "bg-ink hover:bg-ink-soft active:bg-ink-dark", text: "text-ink" },
  sage: { bar: "bg-sage-dark", mark: "bg-sage-soft text-sage-deep ring-sage/20", wash: "from-sage-soft/55", cta: "bg-sage-dark hover:bg-sage-deep active:bg-sage-deep", text: "text-sage-deep" },
} as const;

/**
 * One of the two pillars of Tafaqqah on the home (التعلّم والفهم | حفظ المتن). Both cards share this exact anatomy —
 * mark, title, status · one sentence · «موضعك الآن» · primary action — and differ only in their accent colour, so
 * neither reads as secondary. The card's action IS the journey's next step. State is text, never colour alone.
 */
export function JourneyCard({
  id,
  title,
  blurb,
  icon,
  accent,
  state,
  context,
  progress,
  meter,
  extra,
  action,
  testId,
}: {
  id: string;
  title: string;
  blurb: string;
  icon: ReactNode;
  accent: JourneyAccent;
  state: JourneyCardState;
  /** Where the learner is in this journey (lesson / section), or null. */
  context: string | null;
  /** One short truthful state line under the position. */
  progress: string | null;
  /** A thin progress cue — pass only when real progress exists. */
  meter?: { value: number; max: number; label: string } | null;
  extra?: ReactNode;
  action: { label: string; href: string } | null;
  testId?: string;
}) {
  const a = ACCENT[accent];
  return (
    <section
      aria-labelledby={id}
      className="group/card relative flex flex-col overflow-hidden rounded-[1.375rem] border border-line/90 bg-surface p-5 shadow-soft transition-[box-shadow,border-color,transform] duration-300 ease-calm hover:border-line-strong hover:shadow-lift motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:p-7"
      data-testid={testId}
    >
      {/* Restrained identity: a hairline of the journey colour and a faint wash behind the heading. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", a.bar)} />
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b to-transparent", a.wash)} />
      <Ornament className={cn("absolute -end-10 -top-10 size-44 opacity-[0.07] transition-opacity duration-500 ease-calm group-hover/card:opacity-[0.1]", a.text)} />

      <div className="relative flex items-center gap-3.5">
        <span aria-hidden className={cn("flex size-11 shrink-0 items-center justify-center rounded-[0.875rem] ring-1 ring-inset", a.mark)}>
          {icon}
        </span>
        <h2 id={id} className="min-w-0 flex-1 text-section font-bold text-ink">
          {title}
        </h2>
        <Badge tone={state.tone} className="px-2 text-micro">
          {state.label}
        </Badge>
      </div>
      <p className="relative mt-3 text-small text-muted">{blurb}</p>

      <div className="relative mt-5 flex-1 border-t border-line/80 pt-5">
        <p className="text-micro font-medium text-faint">موضعك الآن</p>
        {context ? <p className="mt-1 text-card font-semibold text-ink">{context}</p> : null}
        {progress ? <p className="mt-0.5 text-small text-muted">{progress}</p> : null}
        {meter && meter.value > 0 ? <Progress value={meter.value} max={meter.max} label={meter.label} tone={accent} size="xs" className="mt-3 max-w-60" /> : null}
        {extra ? <div className="mt-2">{extra}</div> : null}
      </div>

      {action ? (
        <div className="relative mt-6">
          <Link
            href={action.href}
            aria-label={`${title}: ${action.label}`}
            className={cn(
              "group/cta inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl px-6 text-body font-semibold text-surface shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_6px_16px_-10px_rgb(23_35_60/0.55)] transition-[background-color,box-shadow,transform] duration-200 ease-calm hover:shadow-[0_1px_0_rgb(255_255_255/0.12)_inset,0_10px_22px_-12px_rgb(23_35_60/0.6)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px motion-reduce:transition-none sm:w-auto sm:min-w-44",
              a.cta,
            )}
          >
            {action.label}
            <ArrowLeft className="size-[1.05rem] transition-transform duration-200 ease-calm group-hover/cta:-translate-x-1 motion-reduce:transition-none" aria-hidden />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
