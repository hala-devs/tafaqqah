import { cn } from "@/lib/cn";
import type { RenderedUnit } from "@/server/memorization/reinforcement/coach";

/**
 * Canonical text of one exercise. Before reveal, hidden words and masked cue text are typed placeholders WITHOUT their
 * text (read as «كلمة مخفية» / «نص مخفي» / «سطر مخفي»). A guided-recall cue shows only the words the server sent (the
 * start of the line, a hint letter) followed by «بقية السطر مخفية»; after reveal, the previously hidden words are highlighted.
 */
export function ExerciseText({ units, revealed }: { units: RenderedUnit[]; revealed: boolean }) {
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-line bg-surface p-5 sm:p-6" data-testid="target-context" data-revealed={revealed}>
      {units.map((unit, i) => {
        const isTarget = unit.role === "TARGET";
        if (unit.fullyHidden && !revealed) {
          return (
            <p key={i} className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-body text-muted" data-testid="hidden-unit">
              سطر مخفي — حاول استذكاره كاملًا
            </p>
          );
        }
        return (
          <p key={i} lang="ar" className={cn("font-naskh leading-[2.1] [overflow-wrap:anywhere]", isTarget ? "text-question-lg text-ink-dark" : "text-body text-muted")} data-testid={isTarget ? "target-unit" : "context-unit"}>
            {!isTarget ? <span className="sr-only">سياق: </span> : null}
            {unit.segments.map((s, k) =>
              s.kind === "HIDDEN" && s.rest ? (
                <span key={k} className="mx-0.5 inline-block min-w-32 border-b-2 border-ink/50 align-baseline" data-testid="hidden-rest">
                  <span aria-hidden>&nbsp;</span>
                  <span className="sr-only">بقية السطر مخفية</span>{" "}
                </span>
              ) : s.kind === "PREFIX" ? (
                <span key={k} className="text-sage-deep" data-testid="hint-prefix">
                  <span className="sr-only">تلميح: يبدأ بـ </span>
                  {s.text}
                </span>
              ) : s.kind === "HIDDEN" ? (
                <span key={k} className="mx-0.5 inline-block min-w-12 border-b-2 border-ink/50 align-baseline" data-testid="hidden-token">
                  <span aria-hidden>&nbsp;</span>
                  <span className="sr-only">كلمة مخفية</span>{" "}
                </span>
              ) : s.kind === "MASKED" ? (
                <span key={k} className="mx-0.5 inline-block rounded bg-surface-2 px-2 text-muted" data-testid="masked-text">
                  <span aria-hidden>…</span>
                  <span className="sr-only">نص مخفي</span>{" "}
                </span>
              ) : (
                <span key={k} className={cn(s.wasHidden && "rounded-sm bg-sage-soft px-0.5 text-sage-deep underline decoration-2 decoration-sage-dark")} data-testid={s.wasHidden ? "revealed-token" : undefined}>
                  {s.text}
                  {s.wasHidden ? <span className="sr-only"> (كانت مخفية)</span> : null}{" "}
                </span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}
