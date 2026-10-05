import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpenText, CalendarClock, Lightbulb, Sprout } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { getLearningPath } from "@/server/content/queries";
import { prisma } from "@/server/db";
import { getContinueTarget } from "@/server/learner/home";
import { getWeakConcepts } from "@/server/learner/overview";
import { memorizationAction, understandingAction } from "@/server/learner/progress-view";
import { orderReview, reviewSummary } from "@/server/learner/review-view";
import { loadMatnJourney } from "@/server/memorization/journey";
import { getMemorizationSummaries } from "@/server/memorization/progress";
import { getMemorizationReviewData } from "@/server/memorization/review-data";
import { MemorizationReviewCard, UnderstandingReviewCard } from "@/components/review/review-items";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "المراجعة" };

/**
 * /review — what needs review NOW, from the two independent systems: understanding (getWeakConcepts: repeated
 * evidence of misunderstanding) and memorization (stored schedule + stored mastery state). No combined score.
 */
export default async function ReviewPage() {
  const user = await requireUser("/review");
  const now = new Date();
  const [weak, memo, path, summaries] = await Promise.all([
    getWeakConcepts(user.id),
    getMemorizationReviewData(prisma, user.id, now),
    getLearningPath(user.id),
    getMemorizationSummaries(prisma, user.id, now),
  ]);
  const summary = reviewSummary(weak.length, memo.items);
  const entries = orderReview(memo.items, weak);

  // Only for the global empty state: the real next steps of each journey (same helpers as /progress).
  let learnNext = null;
  let memoNext = null;
  if (summary.empty) {
    const [target, journey] = await Promise.all([getContinueTarget(user.id, path, weak), summaries[0] ? loadMatnJourney(prisma, user.id, summaries[0].courseId, summaries, now) : null]);
    learnNext = understandingAction(target, true);
    memoNext = journey ? memorizationAction(journey.step) : null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="animate-fade-up">
        <p className="text-caption font-semibold text-gold-ink">المراجعة</p>
        <h1 className="mt-1.5 text-title text-ink sm:text-display-sm">ثبّت ما يحتاج إلى مراجعة</h1>
        <p className="mt-2 text-body text-muted">راجع ما ظهر من احتياجك في الفهم والحفظ، ثم اختبر نفسك من جديد.</p>
      </header>

      {summary.empty ? (
        <section aria-labelledby="empty-title" className="animate-fade-up rounded-2xl bg-surface px-6 py-8 text-center shadow-soft sm:px-10" data-testid="review-empty">
          <span aria-hidden className="mx-auto flex size-12 items-center justify-center rounded-full bg-sage-soft text-sage-deep">
            <Sprout className="size-6" />
          </span>
          <h2 id="empty-title" className="mt-4 text-section text-ink">
            لا توجد مراجعات مستحقة الآن
          </h2>
          <p className="mx-auto mt-2 max-w-md text-body text-muted">عندما يظهر مفهوم يحتاج إلى تثبيت أو يحين وقت مراجعة محفوظك، ستجده هنا.</p>
          {memo.nextReviewAt ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-small text-muted" data-testid="next-review-date">
              <CalendarClock className="size-4 text-sage-dark" aria-hidden />
              مراجعة الحفظ القادمة: {formatDate(memo.nextReviewAt)}
            </p>
          ) : null}
          {learnNext || memoNext ? (
            <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
              {learnNext ? (
                <Link href={learnNext.href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ink px-6 text-body font-semibold text-surface shadow-soft hover:bg-ink-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
                  تابع التعلّم
                  <ArrowLeft className="size-4" aria-hidden />
                </Link>
              ) : null}
              {memoNext ? (
                <Link href={memoNext.href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-6 text-body font-semibold text-ink hover:bg-white focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
                  {memoNext.label}
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section aria-labelledby="summary-title" className="animate-fade-up rounded-2xl border border-line bg-surface p-5 sm:p-6" data-testid="review-summary">
            <h2 id="summary-title" className="text-card font-semibold text-ink">
              مراجعتك الآن
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold-soft text-gold-ink">
                  <Lightbulb className="size-4" />
                </span>
                <div>
                  <dt className="text-caption font-semibold text-muted">فهم</dt>
                  <dd className={summary.understanding ? "text-body font-semibold text-ink" : "text-small text-muted"}>{summary.understanding ?? "لا مفاهيم تحتاج إلى تثبيت"}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sage-soft text-sage-deep">
                  <BookOpenText className="size-4" />
                </span>
                <div>
                  <dt className="text-caption font-semibold text-muted">حفظ</dt>
                  <dd className={summary.memorization ? "text-body font-semibold text-ink" : "text-small text-muted"}>{summary.memorization ?? "لا مراجعات حفظ مستحقة"}</dd>
                </div>
              </div>
            </dl>
          </section>

          <section aria-labelledby="now-title">
            <h2 id="now-title" className="text-section text-ink">
              يحتاج إلى مراجعتك الآن
            </h2>
            <p className="mt-1 text-small text-muted">مرتّبة بحسب الأولوية: مراجعات الحفظ المستحقة، ثم مفاهيم الفهم، ثم مقاطع تحتاج إلى تثبيت.</p>
            <ol className="mt-5 space-y-4" aria-label="عناصر المراجعة">
              {entries.map((e) => (
                <li key={e.type === "MEMORIZATION" ? `m-${e.item.passageId}` : `u-${e.item.conceptId}`}>
                  {e.type === "MEMORIZATION" ? <MemorizationReviewCard item={e.item} /> : <UnderstandingReviewCard concept={e.item} />}
                </li>
              ))}
            </ol>
            {weak.length === 0 ? <p className="mt-5 text-small text-muted" data-testid="understanding-empty-line">لا توجد مفاهيم تحتاج إلى تثبيت الآن.</p> : null}
            {memo.items.length === 0 ? (
              <p className="mt-5 text-small text-muted" data-testid="memorization-empty-line">
                لا توجد مراجعات حفظ مستحقة الآن.{memo.nextReviewAt ? ` مراجعة الحفظ القادمة: ${formatDate(memo.nextReviewAt)}.` : ""}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
