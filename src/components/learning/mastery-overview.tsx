import Link from "next/link";
import type { LessonMastery } from "@/server/learner/overview";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { MASTERY_LEVEL_META, type MasteryLevel } from "@/lib/mastery-levels";

const ORDER: MasteryLevel[] = ["MASTERED", "GOOD", "LEARNING", "NEEDS_REINFORCEMENT"];
const FILL: Record<MasteryLevel, string> = {
  MASTERED: "bg-success",
  GOOD: "bg-sage",
  LEARNING: "bg-ink/60",
  NEEDS_REINFORCEMENT: "bg-warning",
};

/**
 * Meaningful mastery view: how many assessed concepts sit at each human-readable level,
 * followed by the concepts themselves. Only concepts with real answers are counted.
 */
export function MasteryOverview({ lessons }: { lessons: LessonMastery[] }) {
  const assessed = lessons.flatMap((l) =>
    l.concepts.filter((c) => c.mastery !== null).map((c) => ({ ...c, lessonId: l.lessonId, lessonTitle: l.lessonTitle })),
  );
  const counts = ORDER.map((level) => ({
    level,
    count: assessed.filter((c) => c.state === level).length,
  }));

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={counts.map((c) => `${MASTERY_LEVEL_META[c.level].label}: ${ar(c.count)}`).join("، ")}>
        {counts
          .filter((c) => c.count > 0)
          .map((c) => (
            <span key={c.level} className={cn("h-full transition-[width] duration-300", FILL[c.level])} style={{ width: `${(c.count / assessed.length) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {counts.map((c) => (
          <li key={c.level} className="inline-flex items-center gap-2 text-caption text-muted">
            <span aria-hidden className={cn("size-2 rounded-full", FILL[c.level])} />
            {MASTERY_LEVEL_META[c.level].label}
            <span className="font-medium text-ink tabular-nums">{ar(c.count)}</span>
          </li>
        ))}
      </ul>

      <ul className="mt-6 divide-y divide-line">
        {assessed
          .sort((a, b) => (a.mastery as number) - (b.mastery as number))
          .slice(0, 6)
          .map((concept) => (
            <li key={concept.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <Link href={`/lessons/${concept.lessonId}#concept-${concept.id}`} className="min-w-0 hover:underline">
                <span className="block text-body text-ink">{concept.title}</span>
                <span className="block text-caption text-faint">{concept.lessonTitle}</span>
              </Link>
              <MasteryIndicator score={concept.mastery as number} state={concept.state} />
            </li>
          ))}
      </ul>
    </div>
  );
}
