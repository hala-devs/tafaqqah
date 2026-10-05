import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";
import type { MasteryLevel } from "@/lib/mastery-levels";
import { cn } from "@/lib/cn";
import { reviewHref } from "@/lib/routes";
import { timestampRange, type ApprovedVideo } from "@/lib/video";
import { StartAssessmentButton } from "./start-assessment-button";

type Props = {
  conceptId: string;
  conceptTitle: string;
  lessonId: string;
  lessonTitle: string;
  mastery: number;
  state?: MasteryLevel | null;
  video?: ApprovedVideo | null;
  compact?: boolean;
};

/**
 * A concept that needs reinforcement. "راجع هذا الجزء" opens the focused review screen
 * at its approved timestamp in the lesson video.
 */
export function ReviewCard({ conceptId, conceptTitle, lessonId, lessonTitle, mastery, state, video, compact }: Props) {
  const range = video ? timestampRange(video) : null;
  return (
    <article className={cn("group rounded-xl border border-line bg-surface transition-shadow duration-200 hover:shadow-soft", compact ? "p-4" : "p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption text-muted">{lessonTitle}</p>
          <h3 className="mt-0.5 text-card font-semibold text-ink">{conceptTitle}</h3>
        </div>
        <MasteryIndicator score={mastery} state={state} />
      </div>

      {range ? (
        <p className="mt-3 inline-flex items-center gap-2 text-caption text-muted">
          <PlayCircle className="size-4 text-gold" aria-hidden />
          الجزء المقترح للمراجعة:{" "}
          <span className="tabular-nums">
            {range}
          </span>
        </p>
      ) : null}

      <div className={cn("flex flex-wrap items-center gap-2", compact ? "mt-3" : "mt-5")}>
        <Link
          href={reviewHref(lessonId, conceptId)}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-small font-medium text-surface transition-colors duration-200 hover:bg-ink-soft"
        >
          <PlayCircle className="size-4" aria-hidden />
          راجع الشرح
        </Link>
        {!compact ? (
          <StartAssessmentButton lessonId={lessonId} label="اختبر فهمي مرة أخرى" kind={`REASSESS:${conceptId}`} variant="ghost" size="sm" icon="retry" />
        ) : null}
      </div>
    </article>
  );
}
