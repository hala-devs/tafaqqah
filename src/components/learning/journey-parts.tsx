import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ar } from "@/lib/format";

/**
 * Shared building blocks of the two parallel journeys of one scientific path: /curriculum (understanding) and
 * /memorize (memorization). Presentation only — every value is supplied by the caller from real data.
 */

/** Level medallion + level name + «المستوى الحالي» + the book title + a short metadata line. */
export function LevelIdentity({ levelOrder, levelTitle, title, meta }: { levelOrder: number | null; levelTitle: string | null; title: string; meta: ReactNode[] }) {
  const items = meta.filter(Boolean);
  return (
    <div className="flex items-start gap-4">
      <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-ink font-naskh text-section font-semibold text-surface shadow-soft">
        {ar(levelOrder ?? 1)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {levelTitle ? <p className="text-small font-medium text-muted">{levelTitle}</p> : null}
          <Badge tone="sage">المستوى الحالي</Badge>
        </div>
        <h2 className="mt-1 font-naskh text-title leading-snug font-semibold text-ink">{title}</h2>
        {items.length ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
            {items.map((item, i) => (
              <span key={i} className="contents">
                {i > 0 ? (
                  <span aria-hidden className="text-line-strong">
                    •
                  </span>
                ) : null}
                <span>{item}</span>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Progress summary. The percentage and the bar come from the SAME (done, total) pair, so they always agree; the
 * percentage is isolated LTR so «٪» never jumps sides in RTL.
 */
export function JourneyProgress({ title, done, total, fraction, line, testId }: { title: string; done: number; total: number; fraction: string; line: string; testId?: string }) {
  const pct = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <div className="rounded-2xl bg-paper p-5" data-testid={testId}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-small font-semibold text-ink">{title}</p>
          <p className="mt-0.5 text-small text-muted">{fraction}</p>
        </div>
        <bdi dir="ltr" className="text-title leading-none font-bold tabular-nums text-ink">
          {ar(pct)}
          <span className="ms-0.5 text-card font-semibold text-muted">٪</span>
        </bdi>
      </div>
      <div role="progressbar" aria-label={`${title}: ${fraction}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(done, total)} className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-sage-dark transition-[width] duration-700 ease-calm motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-small text-muted">{line}</p>
    </div>
  );
}

/** «خطوتك التالية»: the single dominant action of a journey. */
export function NextStepPanel({
  id,
  title,
  badge,
  text,
  meta,
  href,
  cta,
  tone = "ink",
  testId,
  ctaTestId,
}: {
  id: string;
  title: string;
  badge?: string;
  text: string;
  meta?: ReactNode;
  href: string;
  cta: string;
  tone?: "ink" | "review";
  testId?: string;
  ctaTestId?: string;
}) {
  return (
    <section aria-labelledby={id} className="relative overflow-hidden rounded-2xl bg-ink p-6 text-surface shadow-lift sm:p-7" data-testid={testId}>
      <div aria-hidden className="bg-geometric pointer-events-none absolute inset-0 opacity-25 invert [mask-image:linear-gradient(to_left,black,transparent_75%)]" />
      <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className={tone === "review" ? "text-caption font-semibold text-warning-soft" : "text-caption font-semibold text-gold"}>خطوتك التالية</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 id={id} className="text-title leading-snug text-surface">
              {title}
            </h3>
            {badge ? <span className="rounded-full bg-surface/12 px-2.5 py-0.5 text-caption font-semibold text-surface">{badge}</span> : null}
          </div>
          <p className="mt-2 max-w-xl text-body text-surface/80">{text}</p>
          {meta}
        </div>
        <Link
          href={href}
          data-testid={ctaTestId}
          className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-surface px-7 text-card font-semibold text-ink shadow-soft transition-[background-color,transform] duration-200 ease-calm hover:bg-white active:translate-y-px focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgb(255_253_248/0.55)]"
        >
          {cta}
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}

/** A compact row for a level that exists in the roadmap but is not open yet. Only real roadmap data is shown. */
export function FutureLevelRow({ order, title, subtitle }: { order: number; title: string; subtitle?: string | null }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-dashed border-line-strong px-5 py-3.5">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line-strong font-naskh text-card text-faint">
        {ar(order)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-caption text-muted">المستوى {ar(order)}</p>
        <p className="truncate font-naskh text-card font-semibold text-muted">{title}</p>
        {subtitle ? <p className="truncate text-caption text-faint">{subtitle}</p> : null}
      </div>
      <Badge tone="neutral" icon={<Hourglass className="size-3" aria-hidden />}>
        قريبًا
      </Badge>
    </div>
  );
}
