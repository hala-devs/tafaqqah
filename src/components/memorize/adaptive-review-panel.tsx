"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { ensurePlanAction } from "@/app/(shell)/memorize/result/[attemptId]/actions";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/lib/format";
import { memorizeReinforceHref, memorizeReReciteHref } from "@/lib/routes";
import type { EnsurePlanResult, PlanSummary } from "@/server/memorization/reinforcement/service";

type Props = {
  attemptId: string;
  hasIssues: boolean;
  initial: EnsurePlanResult | null;
  recite: { passageId: string; startUnitId: string; size: number };
};

const POSITIONS = ["موضع واحد", "موضعان", "مواضع", "موضعًا"] as [string, string, string, string];
const POLL_MS = 1500;
const MAX_POLLS = 10;

/**
 * «تحليل حفظك» + «مراجعتك التكيفية». The deterministic result above never waits for this panel: only this panel shows a
 * loading line while the plan is prepared (once per attempt; a refresh reuses the stored plan). The learner never sees
 * which planner produced it, nor any provider/model detail.
 */
export function AdaptiveReviewPanel({ attemptId, hasIssues, initial, recite }: Props) {
  const [plan, setPlan] = useState<PlanSummary | null>(initial?.kind === "PLAN" ? initial.plan : null);
  const [failed, setFailed] = useState(false);
  const needsFetch = hasIssues && initial?.kind !== "PLAN";

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const state = await ensurePlanAction(attemptId);
      if (cancelled) return;
      if (state.ok && state.result.kind === "PLAN") return setPlan(state.result.plan);
      if (state.ok && state.result.kind === "PENDING" && polls++ < MAX_POLLS) {
        timer = setTimeout(run, POLL_MS);
        return;
      }
      setFailed(true);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attemptId, needsFetch]);

  if (!hasIssues) {
    return (
      <section aria-labelledby="adaptive-title" className="mt-5 rounded-2xl border border-line bg-surface p-6 sm:p-7" data-testid="adaptive-none">
        <h2 id="adaptive-title" className="text-card font-semibold text-ink">تحليل حفظك</h2>
        <p className="mt-2 text-body text-muted">أتممت هذا التسميع دون مواضع تحتاج إلى تثبيت.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="analysis-title" className="mt-5 rounded-2xl border border-line bg-surface p-6 sm:p-7" data-testid="adaptive-review" aria-busy={!plan && !failed}>
      <h2 id="analysis-title" className="text-card font-semibold text-ink">تحليل حفظك</h2>
      <div aria-live="polite">
        {plan ? (
          <>
            <p className="mt-2 text-body text-ink" data-testid="analysis-observation">{plan.observation}</p>
            <h3 className="mt-6 text-card font-semibold text-ink">مراجعتك التكيفية</h3>
            {plan.status === "READY" ? (
              <>
                <p className="mt-2 text-body text-muted">
                  {plan.reviewMode === "BASELINE_REVIEW"
                    ? "راجع المواضع التي حددتها في النص المعتمد، ثم أعد التسميع."
                    : `جهزنا لك جلسة تثبيت تفاعلية تبدأ بالمواضع التي تحتاجها الآن (${countLabel(plan.targetCount, POSITIONS)}) وتتكيف مع استذكارك.`}
                </p>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <ButtonLink href={memorizeReinforceHref(plan.planId)} variant="sage" size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />} data-testid="start-reinforcement">
                    ابدأ التثبيت
                  </ButtonLink>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-body text-muted" data-testid="reinforcement-done">
                  {plan.status === "COMPLETED" ? "أتممت جولة التثبيت. سمّع الأسطر نفسها مرة أخرى لتقيّم حفظك من جديد." : "يمكنك إعادة تسميع الأسطر نفسها متى شئت."}
                </p>
                <div className="mt-4">
                  <ButtonLink href={memorizeReReciteHref(recite.passageId, recite.startUnitId, recite.size, plan.planId)} variant="sage" size="lg" icon={<RotateCcw className="size-4" aria-hidden />} data-testid="re-recite">
                    أعد التسميع
                  </ButtonLink>
                </div>
              </>
            )}
          </>
        ) : failed ? (
          <p className="mt-2 text-body text-muted" data-testid="adaptive-unavailable">
            راجع المواضع المحددة أدناه، ثم أعد التسميع.
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-body text-muted" data-testid="adaptive-loading">
            <span aria-hidden className="size-2 rounded-full bg-sage-dark motion-safe:animate-pulse" />
            نجهز مراجعتك المخصصة...
          </p>
        )}
      </div>
    </section>
  );
}
