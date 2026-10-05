import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import type { LessonStages } from "@/lib/home-state";

/** «تعلّم ← اختبر ← راجع ← أتقن»: the current stage is plainly marked, finished ones carry a check. */
export function LessonJourney({ stages }: { stages: LessonStages }) {
  return (
    <ol className="grid grid-cols-4" aria-label="مراحل الدرس">
      {stages.map((stage, index) => {
        const last = index === stages.length - 1;
        return (
          <li key={stage.key} className="relative flex flex-col items-center text-center" aria-current={stage.state === "current" ? "step" : undefined}>
            {last ? null : (
              <span
                aria-hidden
                className={cn(
                  "absolute top-4 -translate-y-1/2 h-0.5 rounded-full transition-colors duration-300",
                  stage.state === "done" && stages[index + 1].state !== "upcoming" ? "bg-sage" : "bg-line-strong/70",
                )}
                style={{ insetInlineStart: "50%", insetInlineEnd: "-50%" }}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 flex size-8 items-center justify-center rounded-full border-2 text-caption font-semibold transition-[background-color,border-color,box-shadow] duration-300 ease-calm",
                stage.state === "done" && "border-sage-dark bg-sage-dark text-surface",
                stage.state === "current" && "border-ink bg-ink text-surface ring-4 ring-ink/10",
                stage.state === "upcoming" && "border-line-strong bg-surface text-faint",
              )}
            >
              {stage.state === "done" ? <Check className="size-4" strokeWidth={3} /> : ar(index + 1)}
            </span>
            <span className={cn("mt-2 text-small", stage.state === "current" ? "font-semibold text-ink" : stage.state === "done" ? "text-ink" : "text-faint")}>
              {stage.label}
              <span className="sr-only">{stage.state === "done" ? " — مكتملة" : stage.state === "current" ? " — المرحلة الحالية" : " — لاحقًا"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
