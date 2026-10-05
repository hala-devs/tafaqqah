import { Check } from "lucide-react";
import type { MilestonePath as Path } from "@/lib/continuity";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

/** «٣ أيام», «١٤ يومًا», «١٠٠ يوم». */
export function daysLabel(n: number): string {
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  if (n >= 3 && n <= 10) return `${ar(n)} أيام`;
  if (n % 100 === 0) return `${ar(n)} يوم`;
  return `${ar(n)} يومًا`;
}

/** Continuity stations on one line, read right-to-left. Gold where the best real streak has passed; text for all states. */
export function MilestoneTrack({ path }: { path: Path }) {
  return (
    <ol className="grid grid-cols-6 pt-9" aria-label="محطات الاستمرارية">
      {path.milestones.map((m, i) => {
        const next = path.milestones[i + 1];
        return (
          <li key={m.days} className="relative flex flex-col items-center gap-2.5" aria-current={m.current ? "step" : undefined}>
            {next ? <span aria-hidden className={cn("absolute start-1/2 top-[1.125rem] w-full -translate-y-1/2", m.reached && next.reached ? "h-0.5 bg-gold/70" : "h-px bg-line-strong")} /> : null}
            {m.current ? (
              <span aria-hidden className="absolute -top-9 rounded-full border border-line bg-surface px-2.5 py-0.5 text-micro font-semibold whitespace-nowrap text-ink shadow-soft">
                أنت هنا
              </span>
            ) : null}
            <span aria-hidden className="relative flex h-9 items-center justify-center">
              {m.current ? (
                <span className="flex size-9 items-center justify-center rounded-full border-2 border-gold bg-surface shadow-[0_0_0_5px_rgb(185_154_94/0.16)]">
                  <span className="size-2.5 rounded-full bg-ink" />
                </span>
              ) : m.reached ? (
                <span className="flex size-7 items-center justify-center rounded-full bg-sage-dark text-surface">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              ) : (
                <span className="size-4 rounded-full border-2 border-line-strong bg-surface" />
              )}
            </span>
            <span className={cn("text-caption whitespace-nowrap", m.current ? "font-semibold text-ink" : m.reached ? "font-medium text-ink" : "text-faint")}>{daysLabel(m.days)}</span>
            <span className="sr-only">{m.current ? "— موضعك الحالي" : m.reached ? "— محطة بلغتها" : "— لم تبلغها بعد"}</span>
          </li>
        );
      })}
    </ol>
  );
}
