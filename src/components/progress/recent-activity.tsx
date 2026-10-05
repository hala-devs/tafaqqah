import { BookOpenText, Clock3, Lightbulb, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { activityText, type ActivityItem } from "@/server/learner/recent-activity";

const ICON = {
  LESSON_STUDIED: BookOpenText,
  LESSON_COMPLETED: BookOpenText,
  ASSESSMENT: Lightbulb,
  REASSESSMENT: RotateCcw,
  RECITATION: BookOpenText,
  RECITATION_REVIEW: RotateCcw,
} as const;

/** «نشاطي الأخير» — real persisted completions only, newest first; navy for understanding, green for memorization. */
export function RecentActivity({ items, timezone }: { items: ActivityItem[]; timezone: string }) {
  const date = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "long", year: "numeric", timeZone: timezone });
  return (
    <section aria-labelledby="recent-title" className="rounded-[1.375rem] border border-line/90 bg-surface p-5 shadow-soft sm:p-7" data-testid="recent-activity">
      <div className="flex items-start gap-3.5">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-[0.875rem] bg-gold-soft text-gold-ink ring-1 ring-inset ring-gold/25">
          <Clock3 className="size-5" />
        </span>
        <div>
          <h2 id="recent-title" className="text-section font-bold text-ink">
            نشاطي الأخير
          </h2>
          <p className="text-small text-muted">أحدث ما قمت به في رحلتك العلمية.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-6 rounded-xl bg-surface-2/60 px-4 py-4 text-small text-muted" data-testid="recent-empty">
          سيظهر هنا ما تنجزه من دروس واختبارات وتسميع.
        </p>
      ) : (
        <ol className="mt-5 divide-y divide-line/80">
          {items.map((item) => {
            const Icon = ICON[item.kind];
            const memo = item.journey === "MEMORIZATION";
            return (
              <li key={item.id} className="-mx-2 flex items-center gap-3.5 rounded-xl px-2 py-3 transition-colors duration-200 hover:bg-paper/70" data-testid="recent-item">
                <span aria-hidden className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg text-surface", memo ? "bg-sage-dark" : "bg-ink")}>
                  <Icon className="size-4" />
                </span>
                <span className="sr-only">{memo ? "حفظ:" : "فهم:"}</span>
                <p className="min-w-0 flex-1 text-small text-ink">{activityText(item)}</p>
                <time dateTime={item.at.toISOString()} className="shrink-0 text-caption text-muted">
                  {date.format(item.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
