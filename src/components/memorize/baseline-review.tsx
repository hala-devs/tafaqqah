"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { finishReinforcementAction } from "@/app/(focus)/memorize/reinforce/[planId]/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { memorizeReReciteHref } from "@/lib/routes";
import type { BaselineView } from "@/server/memorization/reinforcement/baseline";

/**
 * BASELINE_REVIEW (evaluation condition only): the learner's marked positions on the exact canonical text, all at once,
 * at the learner's own pace. Nothing is hidden, nothing is personalised, nothing is timed.
 */
export function BaselineReview({ view }: { view: BaselineView }) {
  const [done, setDone] = useState(view.status !== "READY");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reciteHref = memorizeReReciteHref(view.recite.passageId, view.recite.startUnitId, view.recite.size, view.planId);

  async function finish() {
    setSaving(true);
    setError(null);
    const result = await finishReinforcementAction({ planId: view.planId, completed: true });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setDone(true);
  }

  return (
    <section aria-labelledby="baseline-title" data-testid="baseline-review">
      <h1 id="baseline-title" className="text-title text-ink">راجع المواضع التي حددتها</h1>
      <p className="mt-2 text-body text-muted">هذا هو النص المعتمد للأسطر التي احتاجت إلى تثبيت، وقد ميّزنا المواضع التي حددتها. راجعها بالقدر الذي تحتاجه ثم أعد التسميع.</p>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted" aria-hidden>
        <span><span className="rounded-sm bg-warning-soft px-1 text-ink underline decoration-warning decoration-2">كلمة</span> أخطأت فيها</span>
        <span><span className="rounded-sm bg-surface-2 px-1 text-ink underline decoration-ink decoration-dotted decoration-2">كلمة</span> لم تتذكرها</span>
      </p>

      <ol className="mt-5 space-y-4">
        {view.units.map((u) => (
          <li key={u.position} className="rounded-2xl border border-line bg-surface p-5 sm:p-6" data-testid="baseline-unit">
            <p className="text-small font-semibold text-ink">
              السطر {ar(u.position)}
              {u.unitIssue ? <span className="ms-2 font-normal text-muted" data-testid="baseline-unit-issue">{u.unitIssue === "FORGOTTEN" ? "— لم تتذكره كاملًا" : "— حددت أنه كاملًا يحتاج إلى تصحيح"}</span> : null}
            </p>
            <p lang="ar" className={cn("mt-2 font-naskh text-question-lg leading-[2.1] text-ink-dark [overflow-wrap:anywhere]", u.unitIssue && "rounded-lg bg-warning-soft/60 px-2")}>
              {u.tokens.map((t, i) => (
                <span
                  key={i}
                  data-testid={t.mark ? `baseline-mark-${t.mark}` : undefined}
                  className={cn(t.mark === "INCORRECT" && "rounded-sm bg-warning-soft px-0.5 underline decoration-warning decoration-2", t.mark === "FORGOTTEN" && "rounded-sm bg-surface-2 px-0.5 underline decoration-ink decoration-dotted decoration-2")}
                >
                  {t.text}
                  {t.mark ? <span className="sr-only">{t.mark === "INCORRECT" ? " (أخطأت فيها)" : " (لم تتذكرها)"}</span> : null}{" "}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-error/25 bg-error-soft px-4 py-3 text-small text-error-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-6" aria-live="polite">
        {done ? (
          view.alreadyReRecited ? (
            <p className="text-body text-muted">سبق أن أعدت تسميع هذه الأسطر بعد هذه المراجعة.</p>
          ) : (
            <ButtonLink href={reciteHref} variant="sage" size="lg" icon={<RotateCcw className="size-4" aria-hidden />} data-testid="re-recite">
              أعد التسميع
            </ButtonLink>
          )
        ) : (
          <Button variant="sage" size="lg" loading={saving} onClick={() => void finish()} data-testid="finish-baseline">
            أنهيت المراجعة
          </Button>
        )}
      </div>
    </section>
  );
}
