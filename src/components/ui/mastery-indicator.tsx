import { BadgeCheck, Check, RotateCcw, Sprout } from "lucide-react";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { approximatePercent, MASTERY_LEVEL_META, scoreLevel, type MasteryLevel } from "@/lib/mastery-levels";

const LEVEL_ICON: Record<MasteryLevel, typeof Check> = {
  NEEDS_REINFORCEMENT: RotateCcw,
  LEARNING: Sprout,
  GOOD: Check,
  MASTERED: BadgeCheck,
};

const TONE_TEXT = {
  warning: "text-warning-ink",
  ink: "text-ink",
  sage: "text-sage-dark",
  success: "text-success-ink",
};

const TONE_FILL = {
  warning: "bg-warning",
  ink: "bg-ink/70",
  sage: "bg-sage",
  success: "bg-success",
};

type Props = {
  score: number;
  /** Stored learning state. Without it the level is derived from the score alone. */
  state?: MasteryLevel | null;
  variant?: "compact" | "full";
  showPercent?: boolean;
  className?: string;
};

/**
 * Four-step mastery scale. Meaning is carried by the label and icon, never by colour alone.
 */
export function MasteryIndicator({ score, state, variant = "compact", showPercent = false, className }: Props) {
  const level = state ?? scoreLevel(score);
  const meta = MASTERY_LEVEL_META[level];
  const Icon = LEVEL_ICON[level];

  const segments = (
    <div className="flex items-center gap-1" aria-hidden>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={cn(
            "h-1.5 rounded-full transition-[background-color,width] duration-300 ease-calm",
            variant === "full" ? "w-9 sm:w-12" : "w-4",
            step <= meta.step ? TONE_FILL[meta.tone] : "bg-surface-2 ring-1 ring-line ring-inset",
          )}
        />
      ))}
    </div>
  );

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2.5", className)}>
        {segments}
        <span className={cn("inline-flex items-center gap-1 text-caption font-medium", TONE_TEXT[meta.tone])}>
          <Icon className="size-3.5" aria-hidden />
          {meta.label}
        </span>
        <span className="sr-only">مستوى الإتقان: {meta.label}</span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn("inline-flex items-center gap-2 text-section font-semibold", TONE_TEXT[meta.tone])}>
          <Icon className="size-5" aria-hidden />
          {meta.label}
        </span>
        {showPercent ? (
          <span className="text-small text-muted" title="مؤشر تعليمي تقريبي وليس قياسًا علميًا دقيقًا">
            مؤشر تقريبي: <span className="tabular-nums">≈ {ar(approximatePercent(score))}٪</span>
          </span>
        ) : null}
      </div>
      {segments}
      <p className="text-small text-muted">{meta.hint}</p>
      <span className="sr-only">مستوى الإتقان: {meta.label}</span>
    </div>
  );
}
