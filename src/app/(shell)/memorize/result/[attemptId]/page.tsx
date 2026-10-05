import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, Info, RotateCcw, Sparkles } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getGoalSettings } from "@/server/learner/motivation";
import { MEMORIZATION_STATE_LABEL, SELF_ASSESSMENT_LABEL } from "@/server/memorization/config";
import { getAttemptResult, getMemorizationContinue } from "@/server/memorization/progress";
import { describeReviewDelay } from "@/server/memorization/schedule";
import { getFollowUpComparison, getStoredPlan, loadAttemptFacts } from "@/server/memorization/reinforcement/service";
import { AdaptiveReviewPanel } from "@/components/memorize/adaptive-review-panel";
import { StateBadge } from "@/components/memorize/state-badge";
import { AssessmentDetailDisplay } from "@/components/memorize/assessment-detail-display";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import { memorizeBookHref, memorizePassageHref } from "@/lib/routes";

export const metadata: Metadata = { title: "نتيجة التسميع" };

type Props = { params: Promise<{ attemptId: string }> };

const HOURS = ["ساعة", "ساعتين", "ساعات", "ساعة"] as [string, string, string, string];
const DAYS = ["يوم", "يومين", "أيام", "يومًا"] as [string, string, string, string];
const LINES = ["سطرًا واحدًا", "سطرين", "أسطر", "سطرًا"] as [string, string, string, string];

function delayText(delay: ReturnType<typeof describeReviewDelay>): string {
  if (delay.kind === "now") return "حان وقت مراجعتها الآن";
  if (delay.kind === "hours") return delay.amount === 1 ? "بعد ساعة" : delay.amount === 2 ? "بعد ساعتين" : `بعد ${countLabel(delay.amount, HOURS)}`;
  if (delay.amount === 1) return "غدًا";
  if (delay.amount === 2) return "بعد يومين";
  return `بعد ${countLabel(delay.amount, DAYS)}`;
}

export default async function ResultPage({ params }: Props) {
  const { attemptId } = await params;
  const user = await requireUser(`/memorize/result/${attemptId}`);
  const result = await getAttemptResult(prisma, user.id, attemptId);
  if (!result) notFound();
  const [{ timezone }, next, loaded, storedPlan, comparison] = await Promise.all([
    getGoalSettings(prisma, user.id),
    getMemorizationContinue(prisma, user.id, result.passage.courseId),
    loadAttemptFacts(prisma, user.id, attemptId),
    getStoredPlan(prisma, user.id, attemptId),
    getFollowUpComparison(prisma, user.id, attemptId),
  ]);
  const facts = loaded?.facts ?? null;

  const score = Math.round(result.scorePercentage);
  const delay = describeReviewDelay(result.completedAt, result.nextReviewAt, timezone);
  const a = result.analysis;
  const weak = result.incorrectUnits + result.forgottenUnits;
  const allCorrect = weak === 0;
  // A different passage to move to, from the real continue position (never the one just recited).
  const moveOn = allCorrect && next && next.passageId !== result.passage.id ? next : null;

  return (
    <div className="mx-auto max-w-2xl" data-testid="recitation-result">
      <header className="animate-fade-up">
        <p className="flex items-center gap-2 text-small font-medium text-success-ink">
          <span className="flex size-6 items-center justify-center rounded-full bg-success-soft motion-safe:animate-pop-in">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
          تم حفظ تقييمك
        </p>
        <p className="mt-5 text-small text-muted">
          {result.passage.sectionTitle} — {result.passage.title}
        </p>
        <h1 className="mt-1 text-title text-ink">{allCorrect ? "أتممت هذا المقطع" : "أنهيت التسميع"}</h1>
        <p className="mt-2 text-body text-muted">
          {allCorrect
            ? `سمّعت ${countLabel(result.totalUnits, LINES)} كما هي. أحسنت.`
            : `سمّعت ${countLabel(result.correctUnits, LINES)} من ${ar(result.totalUnits)} كما هي، و${countLabel(weak, LINES)} ${weak === 1 ? "يحتاج" : weak === 2 ? "يحتاجان" : "تحتاج"} إلى تثبيت.`}
        </p>
      </header>

      <section aria-labelledby="score-title" className="mt-7 animate-fade-up rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8" data-testid="result-score">
        <h2 id="score-title" className="sr-only">
          الدرجة
        </h2>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <bdi dir="ltr" className="text-display-sm leading-none font-bold tabular-nums text-ink" data-testid="score-pct">
              {ar(score)}٪
            </bdi>
            <p className="mt-2 text-small text-muted" data-testid="score-fraction">
              {ar(result.correctUnits)} من {ar(result.totalUnits)} صحيحة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-small text-muted">
            إتقان المقطع
            <StateBadge state={result.stateAfter} />
            <bdi dir="ltr" className="tabular-nums" data-testid="mastery-change">
              {result.masteryBefore !== null && result.masteryBefore !== result.masteryAfter
                ? `من ${ar(result.masteryBefore)}٪ إلى ${ar(result.masteryAfter)}٪`
                : `${ar(result.masteryAfter)}٪`}
            </bdi>
          </div>
        </div>
        <div className="mt-6 flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className="bg-sage-dark" style={{ width: `${(result.correctUnits / Math.max(result.totalUnits, 1)) * 100}%` }} />
          <span className="bg-warning" style={{ width: `${(result.incorrectUnits / Math.max(result.totalUnits, 1)) * 100}%` }} />
          <span className="bg-ink" style={{ width: `${(result.forgottenUnits / Math.max(result.totalUnits, 1)) * 100}%` }} />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {[
            { key: "CORRECT", value: result.correctUnits, dot: "bg-sage-dark" },
            { key: "INCORRECT", value: result.incorrectUnits, dot: "bg-warning" },
            { key: "FORGOTTEN", value: result.forgottenUnits, dot: "bg-ink" },
          ].map((row) => (
            <div key={row.key}>
              <dd className="text-section font-bold tabular-nums text-ink" data-testid={`count-${row.key}`}>
                {ar(row.value)}
              </dd>
              <dt className="flex items-center gap-1.5 text-small text-muted">
                <span aria-hidden className={cn("size-2 rounded-full", row.dot)} />
                {SELF_ASSESSMENT_LABEL[row.key as keyof typeof SELF_ASSESSMENT_LABEL]}
              </dt>
            </div>
          ))}
        </dl>
        {facts ? (
          <div className="mt-5 border-t border-line pt-4" data-testid="word-counts">
            <h3 className="text-small font-semibold text-ink">نتيجة التسميع بالكلمات</h3>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-small text-ink">
              <li data-testid="words-correct"><span aria-hidden>✓ </span>{ar(facts.totals.correctTokens)} صحيحة</li>
              <li data-testid="words-incorrect"><span aria-hidden>× </span>{ar(facts.totals.incorrectTokens)} أخطأت</li>
              <li data-testid="words-forgotten"><span aria-hidden>? </span>{ar(facts.totals.forgottenTokens)} لم أتذكر</li>
            </ul>
            {facts.unitSummary.fullUnitIncorrect + facts.unitSummary.fullUnitForgotten + facts.unitSummary.legacyUnits > 0 ? (
              <p className="mt-1 text-caption text-muted" data-testid="unit-level-note">
                {[
                  facts.unitSummary.fullUnitForgotten ? `${countLabel(facts.unitSummary.fullUnitForgotten, LINES)} لم تتذكره كاملًا` : null,
                  facts.unitSummary.fullUnitIncorrect ? `${countLabel(facts.unitSummary.fullUnitIncorrect, LINES)} قيّمته كاملًا بأنه يحتاج إلى تصحيح` : null,
                  facts.unitSummary.legacyUnits ? `${countLabel(facts.unitSummary.legacyUnits, LINES)} قُيّم على مستوى السطر` : null,
                ].filter(Boolean).join("، ")}
                {" "}(لا تُحسب كلماته ضمن الأرقام أعلاه).
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {comparison ? (
        <section aria-labelledby="after-title" className="mt-5 rounded-2xl border border-line bg-surface p-6 sm:p-7" data-testid="before-after">
          <h2 id="after-title" className="text-card font-semibold text-ink">بعد التثبيت</h2>
          <ul className="mt-2 space-y-1 text-body text-ink">
            <li data-testid="after-now-correct">{afterSentence(comparison.nowCorrect, "NOW_CORRECT")}</li>
            <li data-testid="after-remaining">{afterSentence(comparison.remaining, "REMAINING")}</li>
            {comparison.newlyAffected > 0 ? <li data-testid="after-new">{afterSentence(comparison.newlyAffected, "NEW")}</li> : null}
          </ul>
          <p className="mt-3 text-caption text-muted">
            قبل: {ar(comparison.before.incorrectTokens)} أخطأت · {ar(comparison.before.forgottenTokens)} لم أتذكر — بعد: {ar(comparison.after.incorrectTokens)} أخطأت · {ar(comparison.after.forgottenTokens)} لم أتذكر
          </p>
        </section>
      ) : null}

      {loaded ? <AdaptiveReviewPanel attemptId={result.id} hasIssues={loaded.facts.hasIssues} initial={storedPlan} recite={{ passageId: loaded.passageId, startUnitId: loaded.firstUnitId, size: loaded.facts.units.length }} /> : null}

      {result.details.some((detail) => detail.status !== "CORRECT") ? (
        <section aria-labelledby="reinforcement-title" className="mt-5 rounded-2xl border border-line bg-surface p-6 sm:p-7" data-testid="result-reinforcement">
          <h2 id="reinforcement-title" className="text-card font-semibold text-ink">مواضع تحتاج إلى تثبيت</h2>
          <div className="mt-4 space-y-5">
            {result.details.filter((detail) => detail.status !== "CORRECT").map((detail) => {
              const legacy = detail.scope === null;
              const wording = legacy
                ? detail.status === "INCORRECT" ? "أخطأت في هذا المقطع" : "لم أتذكر هذا المقطع"
                : detail.scope === "FULL_UNIT"
                  ? detail.status === "INCORRECT" ? "حددت أن المقطع كاملًا يحتاج إلى تصحيح." : "لم تتذكر المقطع كاملًا."
                  : detail.wordIndexes.length > 0 && detail.forgottenWordIndexes.length > 0
                    ? "أخطأت في كلمات ولم تتذكر أخرى"
                    : detail.status === "INCORRECT" ? "أخطأت في كلمات محددة" : "لم تتذكر كلمات محددة";
              return <article key={detail.unitId} className="border-s border-line-strong ps-4"><p className="text-small font-semibold text-ink">{wording}</p><div className="mt-2"><AssessmentDetailDisplay detail={detail} /></div></article>;
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="next-title" className="mt-5 animate-fade-up rounded-2xl bg-ink p-6 text-surface [animation-delay:60ms] sm:p-7" data-testid="result-next-review">
        <h2 id="next-title" className="flex items-center gap-2 text-small font-semibold text-gold">
          <CalendarClock className="size-4" aria-hidden />
          ماذا بعد؟
        </h2>
        <p className="mt-2 text-section font-semibold text-surface">
          مراجعتك القادمة: <span data-testid="next-review-text">{delayText(delay)}</span>
        </p>
        <p className="mt-1 text-small text-surface/75">
          {result.forgottenUnits > 0
            ? "تقرّبت المراجعة لأن بعض الأسطر لم تتذكرها."
            : result.incorrectUnits > 0
              ? "تقرّبت المراجعة لأن بعض الأسطر أخطأت فيها."
              : "كلما ثبت الحفظ في مراجعات متتالية طالت المدة بين المراجعات."}{" "}
          مستوى الإتقان الحالي: {MEMORIZATION_STATE_LABEL[result.stateAfter]}.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {moveOn ? (
            <>
              <ButtonLink href={memorizePassageHref(moveOn.passageId, moveOn.startUnitId)} variant="light" size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />} data-testid="next-passage">
                {moveOn.kind === "FIRST" ? "ابدأ المقطع التالي" : "ثبّت مقطعًا آخر"}
              </ButtonLink>
              <ButtonLink href={memorizePassageHref(result.passage.id)} variant="ghost" size="lg" className="text-surface hover:bg-surface/10" icon={<RotateCcw className="size-4" aria-hidden />} data-testid="retry-passage">
                أعد التسميع
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href={memorizePassageHref(result.passage.id)} variant="light" size="lg" icon={<RotateCcw className="size-4" aria-hidden />} data-testid="retry-passage">
              {allCorrect ? "أعد التسميع" : "راجع ما يحتاج إلى تثبيت ثم أعد التسميع"}
            </ButtonLink>
          )}
          <ButtonLink href={memorizeBookHref(result.passage.courseId)} variant="ghost" size="lg" className="text-surface/85 hover:bg-surface/10 hover:text-surface" data-testid="back-to-memorize">
            العودة إلى الحفظ
          </ButtonLink>
        </div>
      </section>

      {/* Legacy free-text analysis: only rows stored before the adaptive review existed remain readable. */}
      {a ? (
      <section aria-labelledby="legacy-analysis-title" className="mt-5 animate-fade-up rounded-2xl border border-line bg-surface p-6 [animation-delay:120ms] sm:p-7" data-testid="result-analysis" data-status={result.analysisStatus ?? "NONE"}>
        <h2 id="legacy-analysis-title" className="flex items-center gap-2 text-card font-semibold text-ink">
          <Sparkles className="size-4 text-gold-ink" aria-hidden />
          ملاحظات على أدائك
        </h2>
        {a ? (
          <div className="mt-3 space-y-3 text-body text-ink">
            <p data-testid="analysis-summary">{a.summary}</p>
            {a.patterns.length ? (
              <ul className="list-disc space-y-1 ps-5 text-muted">
                {a.patterns.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {a.priorities.length ? (
              <div>
                <p className="text-small font-medium text-ink">أولويات المراجعة القادمة</p>
                <ul className="mt-1 space-y-1 text-muted">
                  {a.priorities.map((p) => (
                    <li key={p.unitNumber}>
                      <span className="font-medium text-ink">السطر {ar(p.unitNumber)}:</span> {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {a.progressObservation ? <p className="text-muted">{a.progressObservation}</p> : null}
            <p className="flex items-start gap-2 border-t border-line pt-3 text-caption text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              ملاحظات مبنية على تقييمك الذاتي وسجل محاولاتك فقط؛ لا تحكم على صحة تلاوتك.
            </p>
          </div>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}

/** Observational before/after wording with Arabic number agreement. It states what changed, never why. */
function afterSentence(n: number, kind: "NOW_CORRECT" | "REMAINING" | "NEW"): string {
  if (kind === "NOW_CORRECT") {
    if (n === 0) return "لم يصبح أي موضع سابق صحيحًا في هذه المحاولة.";
    if (n === 1) return "موضع واحد كان يحتاج إلى تثبيت أصبح صحيحًا بعد إعادة التسميع.";
    if (n === 2) return "موضعان كانا يحتاجان إلى تثبيت أصبحا صحيحين بعد إعادة التسميع.";
    return `${countLabel(n, ["", "", "مواضع", "موضعًا"])} كانت تحتاج إلى تثبيت أصبحت صحيحة بعد إعادة التسميع.`;
  }
  if (kind === "REMAINING") {
    if (n === 0) return "لم يبق موضع سابق يحتاج إلى تثبيت.";
    if (n === 1) return "بقي موضع واحد يحتاج إلى تثبيت.";
    if (n === 2) return "بقي موضعان يحتاجان إلى تثبيت.";
    return `بقيت ${countLabel(n, ["", "", "مواضع", "موضعًا"])} تحتاج إلى تثبيت.`;
  }
  if (n === 1) return "ظهر موضع جديد يحتاج إلى تثبيت.";
  if (n === 2) return "ظهر موضعان جديدان يحتاجان إلى تثبيت.";
  return `ظهرت ${countLabel(n, ["", "", "مواضع", "موضعًا"])} جديدة تحتاج إلى تثبيت.`;
}
