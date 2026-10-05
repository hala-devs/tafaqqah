import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CircleCheck, RotateCcw, Route, Sprout } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { getLessonView } from "@/server/content/queries";
import { readReport, type ReportConcept, type SessionReport } from "@/server/assessment/report";
import { CompletionExperience } from "@/components/learning/completion-experience";
import { getCompletionSummary } from "@/server/learner/completion-summary";
import { getWeakConcepts } from "@/server/learner/overview";
import { FeedbackForm } from "@/components/learning/feedback-form";
import { MeasurementCard } from "@/components/learning/measurement-card";
import { ReviewCard } from "@/components/learning/review-card";
import { StartAssessmentButton } from "@/components/learning/start-assessment-button";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";
import { MASTERY_LEVEL_META } from "@/lib/mastery-levels";
import { ar, formatDate } from "@/lib/format";
import { reviewHref } from "@/lib/routes";

export const metadata: Metadata = { title: "نتيجة الدرس" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ session?: string }> };

/** Subtle drawn check — no confetti, no trophies. */
function SuccessMark() {
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0" aria-hidden>
      <circle cx="28" cy="28" r="26" className="fill-sage-soft" />
      <circle cx="28" cy="28" r="26" fill="none" className="stroke-sage animate-draw" strokeWidth="2" strokeDasharray="164" style={{ ["--dash" as string]: 164 }} />
      <path
        d="M18 29 l7 7 l13 -15"
        fill="none"
        className="stroke-sage-dark animate-draw [animation-delay:200ms]"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="40"
        style={{ ["--dash" as string]: 40 }}
      />
    </svg>
  );
}

const HEADINGS: Record<SessionReport["purpose"], string> = {
  PRACTICE: "أحسنت، أكملت اختبار الدرس",
  REASSESSMENT: "نتيجة إعادة الاختبار",
  PRE_TEST: "سُجّلت نتيجة الاختبار القبلي",
  POST_TEST: "قياس أثر الدرس",
};

function Stats({ report }: { report: SessionReport }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
      <div>
        <dt className="text-caption text-muted">عدد الأسئلة</dt>
        <dd className="mt-1 text-section font-semibold text-ink tabular-nums">{ar(report.totalQuestions)}</dd>
      </div>
      <div>
        <dt className="text-caption text-muted">إجابات صحيحة</dt>
        <dd className="mt-1 text-section font-semibold text-ink tabular-nums">
          {ar(report.correctCount)} <span className="text-small font-normal text-muted">من {ar(report.totalQuestions)}</span>
        </dd>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <dt className="text-caption text-muted">مفاهيم اختُبرت</dt>
        <dd className="mt-1 text-section font-semibold text-ink tabular-nums">{ar(report.concepts.length)}</dd>
      </div>
    </dl>
  );
}

export default async function ResultPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { session: sessionParam } = await searchParams;
  const user = await requireUser(`/lessons/${id}/result`);
  const view = await getLessonView(user.id, id);
  if (!view) notFound();

  const session = await prisma.assessmentSession.findFirst({
    where: {
      userId: user.id,
      lessonId: id,
      status: "COMPLETED",
      ...(sessionParam ? { id: sessionParam } : { purpose: "PRACTICE" }),
    },
    orderBy: { completedAt: "desc" },
    include: { feedback: { select: { rating: true } } },
  });
  const report = readReport(session?.report);

  if (!session || !report) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <EmptyState
          title="لم تُكمل اختبار هذا الدرس بعد"
          description="عند إكمال اختبار الفهم ستظهر هنا نتيجة الدرس ومواضع المراجعة."
          action={<ButtonLink href={`/lessons/${id}`}>العودة إلى الدرس</ButtonLink>}
        />
      </div>
    );
  }

  const conceptInfo = new Map(view.concepts.map((c) => [c.id, c]));
  const strong = report.concepts.filter((c) => c.status === "STRONG");
  const learning = report.concepts.filter((c) => c.status === "LEARNING");
  const reinforce = report.concepts.filter((c) => c.status === "NEEDS_REINFORCEMENT");
  const next = view.nextLesson;
  const nextOpen = next && next.state !== "LOCKED" && next.state !== "COMING_SOON";
  const measured = report.purpose === "PRE_TEST" || report.purpose === "POST_TEST";
  const measurement = measured || view.measurement
    ? await prisma.lessonMeasurement.findUnique({ where: { userId_lessonId: { userId: user.id, lessonId: id } } })
    : null;
  const offerPostTest = report.purpose === "PRACTICE" && view.measurement?.preDone && !view.measurement.postDone;
  const celebrate = report.purpose === "PRACTICE";
  const [summary, weak] = celebrate
    ? await Promise.all([getCompletionSummary(prisma, user.id, session, view.progress?.completedAt ?? null, report), getWeakConcepts(user.id)])
    : [null, []];
  const titleOf = (conceptId: string) => conceptInfo.get(conceptId)?.title ?? "";

  const reinforceCard = (c: ReportConcept) => (
    <ReviewCard
      key={c.conceptId}
      conceptId={c.conceptId}
      conceptTitle={c.title}
      lessonId={id}
      lessonTitle={view.lesson.title}
      mastery={c.masteryEnd}
      state={c.level}
      video={conceptInfo.get(c.conceptId)?.video ?? null}
    />
  );

  return (
    <div className="mx-auto max-w-3xl">
      {celebrate && summary ? (
        <CompletionExperience
          lessonNumber={view.number}
          summary={summary}
          next={nextOpen && next ? { id: next.id, title: next.title } : null}
          weakCount={weak.length}
          weakHref={weak[0] ? reviewHref(weak[0].lessonId, weak[0].conceptId) : null}
        />
      ) : (
        <header className="flex flex-col items-start gap-5 animate-fade-up sm:flex-row sm:items-center">
          <SuccessMark />
          <div>
            <p className="text-small text-muted">
              {view.lesson.title} · {session.completedAt ? formatDate(session.completedAt) : null}
            </p>
            <h1 className="mt-1 text-title text-ink">{HEADINGS[report.purpose]}</h1>
          </div>
        </header>
      )}
      {celebrate ? (
        <p className="mt-12 text-caption font-medium text-gold-ink">تفاصيل نتيجتك</p>
      ) : null}

      {measured ? (
        <Card as="section" className="mt-10" aria-labelledby="measure">
          <h2 id="measure" className="text-card font-semibold text-ink">
            {report.purpose === "PRE_TEST" ? "نتيجتك قبل الدرس" : "قبل الدرس وبعده"}
          </h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-2/60 p-4">
              <dt className="text-caption text-muted">الاختبار القبلي</dt>
              <dd className="mt-1 text-section font-semibold text-ink tabular-nums">
                {measurement?.preScore != null ? `${ar(Math.round(measurement.preScore * 100))}٪` : "—"}
              </dd>
            </div>
            <div className="rounded-xl bg-surface-2/60 p-4">
              <dt className="text-caption text-muted">الاختبار البعدي</dt>
              <dd className="mt-1 text-section font-semibold text-ink tabular-nums">
                {measurement?.postScore != null ? `${ar(Math.round(measurement.postScore * 100))}٪` : "بعد إكمال الدرس"}
              </dd>
            </div>
          </dl>
          {report.purpose === "POST_TEST" && measurement ? (
            <div className="mt-5 grid gap-4 text-small sm:grid-cols-2">
              <div>
                <p className="text-caption text-muted">أجزاء أخطأت فيها قبل الدرس</p>
                <p className="mt-1 text-text">{measurement.weakBefore.map(titleOf).filter(Boolean).join("، ") || "لا شيء"}</p>
              </div>
              <div>
                <p className="text-caption text-muted">أجزاء أخطأت فيها بعد الدرس</p>
                <p className="mt-1 text-text">{measurement.weakAfter.map(titleOf).filter(Boolean).join("، ") || "لا شيء"}</p>
              </div>
            </div>
          ) : null}
          <p className="mt-5 text-caption text-faint">
            {report.purpose === "PRE_TEST"
              ? "لا تؤثر هذه النتيجة في مستوى إتقانك. ابدأ الآن بدراسة الدرس."
              : "هذه نتيجتك الفعلية في هذا الدرس، وتُستخدم مع نتائج أخرى لتقييم أثر المنصة لاحقًا."}
          </p>
          <div className="mt-5">
            <ButtonLink href={`/lessons/${id}`} iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
              {report.purpose === "PRE_TEST" ? "ابدأ دراسة الدرس" : "العودة إلى الدرس"}
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <>
          <Card as="section" className={celebrate ? "mt-3" : "mt-10"} aria-labelledby="understanding">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="understanding" className="text-card font-semibold text-ink">
                {report.purpose === "REASSESSMENT" ? "مستواك في هذا الجزء الآن" : "مستوى فهمك للدرس"}
              </h2>
              <Badge tone="neutral">{report.mode === "ADAPTIVE" ? "اختبار تكيفي" : "أسئلة معتمدة مسبقًا"}</Badge>
            </div>
            {report.purpose === "REASSESSMENT" ? (
              <ul className="mt-5 space-y-4">
                {report.concepts.map((c) => (
                  <li key={c.conceptId} className="rounded-xl border border-line bg-paper/60 p-4">
                    <p className="text-body font-medium text-ink">{c.title}</p>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-small text-muted" data-testid="reassessment-change">
                      قبل: <span className="text-ink">{MASTERY_LEVEL_META[c.levelStart].label}</span>
                      <ArrowLeft className="size-4" aria-hidden />
                      الآن: <span className="font-medium text-ink">{MASTERY_LEVEL_META[c.level].label}</span>
                    </p>
                    <MasteryIndicator score={c.masteryEnd} state={c.level} variant="full" className="mt-3" />
                  </li>
                ))}
              </ul>
            ) : (
              <MasteryIndicator score={report.overallMastery} variant="full" showPercent className="mt-5" />
            )}
            <Stats report={report} />
            <p className="mt-5 text-caption text-faint">
              مستوى الإتقان مؤشر تعليمي تقريبي مبني على إجاباتك، وليس قياسًا علميًا دقيقًا ولا حكمًا نهائيًا على فهمك. ولا يُعدّ الجزء محتاجًا إلى
              تثبيت من خطأ واحد.
            </p>
          </Card>

          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <section aria-labelledby="mastered">
              <h2 id="mastered" className="flex items-center gap-2 text-card font-semibold text-ink">
                <CircleCheck className="size-5 text-success" aria-hidden />
                أتقنت
              </h2>
              {strong.length ? (
                <ul className="mt-4 space-y-3">
                  {strong.map((c) => (
                    <li key={c.conceptId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3">
                      <span className="text-body text-ink">{c.title}</span>
                      <MasteryIndicator score={c.masteryEnd} state={c.level} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-small text-muted">لم تتضح بعد أجزاء متقنة في هذه المحاولة.</p>
              )}

              {learning.length ? (
                <div className="mt-8">
                  <h3 className="flex items-center gap-2 text-small font-semibold text-ink">
                    <Sprout className="size-4 text-ink/70" aria-hidden />
                    قيد التعلّم
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {learning.map((c) => (
                      <li key={c.conceptId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/80 px-3 py-2 text-small">
                        <span className="text-text">{c.title}</span>
                        <a href={reviewHref(id, c.conceptId)} className="text-caption font-medium text-ink hover:underline">
                          راجع الشرح
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="to-reinforce">
              <h2 id="to-reinforce" className="flex items-center gap-2 text-card font-semibold text-ink">
                <RotateCcw className="size-5 text-warning" aria-hidden />
                يحتاج إلى تثبيت
              </h2>
              {reinforce.length ? (
                <div className="mt-4 space-y-3">{reinforce.map(reinforceCard)}</div>
              ) : (
                <p className="mt-4 text-small text-muted">لا توجد أجزاء تكرّر فيها الخطأ في هذه المحاولة.</p>
              )}
            </section>
          </div>

          {celebrate ? null : (
          <section aria-labelledby="next-step" className="mt-12 rounded-2xl border border-line bg-surface-2/60 p-6 sm:p-8">
            <h2 id="next-step" className="text-section text-ink">
              خطوتك التالية
            </h2>
            {reinforce.length ? (
              <>
                <p className="mt-1 text-small text-muted">راجع الجزء الذي تكرّر فيه الخطأ، ثم اختبر فهمك له من جديد.</p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <ButtonLink href={reviewHref(id, reinforce[0].conceptId)} size="lg" icon={<BookOpen className="size-4" aria-hidden />}>
                    راجع الشرح
                  </ButtonLink>
                  <StartAssessmentButton lessonId={id} label="اختبر فهمي مرة أخرى" kind={`REASSESS:${reinforce[0].conceptId}`} variant="secondary" icon="retry" />
                </div>
              </>
            ) : report.purpose === "REASSESSMENT" ? (
              <>
                <p className="mt-1 text-small text-muted">لم يعد هذا الجزء في قائمة التثبيت. تابع رحلتك.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <ButtonLink href="/review" size="lg">
                    المراجعة الذكية
                  </ButtonLink>
                  <ButtonLink href={`/lessons/${id}`} variant="secondary" size="lg">
                    العودة إلى الدرس
                  </ButtonLink>
                </div>
              </>
            ) : nextOpen && next ? (
              <>
                <p className="mt-1 text-small text-muted">أظهرت فهمًا جيدًا لهذا الدرس. الدرس التالي: {next.title}.</p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <ButtonLink href={`/lessons/${next.id}`} size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
                    انتقل إلى الدرس التالي
                  </ButtonLink>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-small text-muted">أتممت الدروس المتاحة حاليًا. تُفتح الدروس التالية بعد اعتماد مادتها.</p>
                <div className="mt-5">
                  <ButtonLink href="/curriculum" size="lg" icon={<Route className="size-4" aria-hidden />}>
                    العودة إلى المسار العلمي
                  </ButtonLink>
                </div>
              </>
            )}
          </section>
          )}

          {offerPostTest ? (
            <div className="mt-8">
              <MeasurementCard lessonId={id} kind="POST_TEST" activeSessionId={null} />
            </div>
          ) : null}

          <section aria-label="رأيك في الاختبار" className="mt-10 border-t border-line pt-8">
            <FeedbackForm sessionId={session.id} existing={session.feedback} />
          </section>
        </>
      )}
    </div>
  );
}
