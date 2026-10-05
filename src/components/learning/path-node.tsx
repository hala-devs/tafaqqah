import Link from "next/link";
import { ArrowLeft, Check, Hourglass, Lock } from "lucide-react";
import type { PathState } from "@/server/content/path-state";
import { cn } from "@/lib/cn";
import { countLabel, stepNumber } from "@/lib/format";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";

export const PATH_STATE_LABEL: Record<PathState, string> = {
  COMPLETED: "مكتمل",
  CURRENT: "متاح الآن",
  AVAILABLE: "متاح الآن",
  LOCKED: "غير متاح بعد",
  COMING_SOON: "قيد الإعداد",
};

const CONCEPTS = ["مفهوم واحد", "مفهومان", "مفاهيم", "مفهومًا"] as [string, string, string, string];
const MINUTES = ["دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة"] as [string, string, string, string];

export type PathNodeData = {
  id: string;
  number: number;
  title: string;
  description?: string;
  state: PathState;
  studied: boolean;
  assessmentState: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  conceptCount?: number;
  estimatedMinutes?: number | null;
  mastery?: number | null;
};

/** Learner-facing status of a lesson, derived only from its real path and assessment state. */
export function lessonStatusLabel(node: Pick<PathNodeData, "state" | "studied" | "assessmentState">): string {
  if (node.state === "CURRENT" && node.assessmentState === "IN_PROGRESS") return "اختبار قيد التقدم";
  if (node.state === "CURRENT" && node.studied && node.assessmentState === "NOT_STARTED") return "جاهز للاختبار";
  if (node.state === "CURRENT" && node.studied) return "الدرس الحالي";
  return PATH_STATE_LABEL[node.state];
}

/** The next action of an openable lesson (unchanged rule: result → resume test → start test → start lesson). */
export function lessonAction(node: Pick<PathNodeData, "state" | "studied" | "assessmentState">): string {
  if (node.state === "COMPLETED") return "عرض نتيجة الدرس";
  if (node.assessmentState === "IN_PROGRESS") return "تابع الاختبار";
  if (node.studied) return "ابدأ الاختبار";
  return "ابدأ الدرس";
}

/** Metadata line. «المدة التقديرية» is the admin-entered study estimate, not a video duration. */
export function LessonMeta({ conceptCount, estimatedMinutes, mastery, className }: { conceptCount?: number; estimatedMinutes?: number | null; mastery?: number | null; className?: string }) {
  if (mastery == null && !conceptCount && !estimatedMinutes) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted", className)}>
      {mastery != null ? <MasteryIndicator score={mastery} /> : null}
      {conceptCount ? <span>{countLabel(conceptCount, CONCEPTS)}</span> : null}
      {estimatedMinutes ? <span>المدة التقديرية: {countLabel(estimatedMinutes, MINUTES)}</span> : null}
    </div>
  );
}

function Marker({ state }: { state: PathState }) {
  switch (state) {
    case "COMPLETED":
      return (
        <span className="flex size-10 items-center justify-center rounded-full bg-sage-dark text-surface shadow-soft">
          <Check className="size-4.5" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case "CURRENT":
      return (
        <span className="relative flex size-10 items-center justify-center rounded-full bg-ink text-surface shadow-soft">
          <span className="absolute inset-[-5px] rounded-full border border-ink/20 motion-safe:animate-pulse-soft" aria-hidden />
          <span className="size-2.5 rounded-full bg-gold" />
        </span>
      );
    case "AVAILABLE":
      return <span className="flex size-10 items-center justify-center rounded-full border-2 border-ink/40 bg-surface" />;
    case "LOCKED":
      return (
        <span className="flex size-10 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-faint">
          <Lock className="size-3.5" aria-hidden />
        </span>
      );
    case "COMING_SOON":
      return (
        <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-line-strong bg-paper text-faint">
          <Hourglass className="size-3.5" aria-hidden />
        </span>
      );
  }
}

/**
 * One station on the vertical learning path. `isLast` hides the connector.
 * State is conveyed by marker shape + icon + text label (never colour alone).
 */
export function PathNode({ node, isLast, compact }: { node: PathNodeData; isLast: boolean; compact?: boolean }) {
  const openable = node.state === "COMPLETED" || node.state === "CURRENT" || node.state === "AVAILABLE";
  const isCurrent = node.state === "CURRENT";
  const muted = node.state === "LOCKED" || node.state === "COMING_SOON";
  const statusLabel = lessonStatusLabel(node);
  const action = lessonAction(node);

  const body = (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-2xl border transition-[background-color,box-shadow,border-color] duration-200 ease-calm",
        compact ? "px-3 py-2" : "px-4 py-4 sm:px-5",
        isCurrent ? "border-ink/20 bg-surface shadow-soft group-hover:shadow-lift" : "border-transparent",
        openable && !isCurrent && "group-hover:border-line group-hover:bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cn("text-caption font-semibold tabular-nums", isCurrent ? "text-gold-ink" : "text-faint")}>{stepNumber(node.number)}</span>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold",
            node.state === "COMPLETED" && "bg-success-soft text-success-ink",
            isCurrent && "bg-ink text-surface",
            node.state === "AVAILABLE" && "bg-surface-2 text-ink",
            muted && "bg-surface-2 text-muted",
          )}
        >
          {statusLabel}
        </span>
      </div>
      <p className={cn("mt-1.5 font-semibold", compact ? "text-body" : "text-card", muted ? "text-muted" : "text-ink")}>{node.title}</p>

      {!compact && node.description && node.state !== "COMING_SOON" ? <p className="mt-1 line-clamp-2 text-small text-muted">{node.description}</p> : null}

      {node.state !== "COMING_SOON" ? (
        <LessonMeta className="mt-2.5" conceptCount={compact ? undefined : node.conceptCount} estimatedMinutes={compact ? undefined : node.estimatedMinutes} mastery={node.mastery} />
      ) : null}

      {openable && !compact && !isCurrent ? (
        <span className="mt-2.5 inline-flex items-center gap-1.5 text-small font-semibold text-ink opacity-80 group-hover:opacity-100">
          {action}
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
        </span>
      ) : null}
    </div>
  );

  return (
    <li className="relative flex gap-3 sm:gap-4">
      <div className="relative flex w-10 shrink-0 justify-center pt-4">
        <Marker state={node.state} />
        {!isLast ? (
          <span aria-hidden className={cn("absolute top-15 -bottom-4 w-0.5 rounded-full", node.state === "COMPLETED" ? "bg-sage" : "bg-line-strong/70")} />
        ) : null}
      </div>
      {openable ? (
        <Link href={`/lessons/${node.id}`} className="group min-w-0 flex-1 rounded-2xl pb-3 focus-visible:outline-offset-2" aria-label={`${node.title} — ${statusLabel} — ${action}`}>
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1 pb-3" aria-disabled>
          {body}
        </div>
      )}
    </li>
  );
}
