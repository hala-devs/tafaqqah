import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, CheckCircle2, ChevronLeft, Hourglass, Lock, Target } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { getLessonView } from "@/server/content/queries";
import { StudyCompletion } from "@/components/learning/study-completion";
import { AssessmentStage } from "@/components/learning/assessment-stage";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MeasurementCard } from "@/components/learning/measurement-card";
import { LessonJourney } from "@/components/learning/lesson-journey";
import { Progress } from "@/components/ui/progress";
import { getLessonStageInfo } from "@/server/learner/lesson-progress";
import { ar, countLabel, learnerDescription, ordinalLesson } from "@/lib/format";

type Props = { params: Promise<{ id: string }> };

// The complete learner-facing recording for Lesson 1. Concept timestamps remain in
// approved database metadata and are used only for targeted review.
const LESSON_VIDEO_URLS: Record<string, string> = {
  "lesson-akhsar-01": "https://www.youtube-nocookie.com/embed/FdxZylJyi-w?rel=0&modestbranding=1",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser(`/lessons/${id}`);
  const view = await getLessonView(user.id, id);
  return { title: view?.lesson.title ?? "الدرس" };
}

export default async function LessonPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser(`/lessons/${id}`);
  const view = await getLessonView(user.id, id);
  if (!view) notFound();

  const { lesson, chapter, concepts, progress } = view;

  if (lesson.status === "COMING_SOON" || !view.accessible) {
    const comingSoon = lesson.status === "COMING_SOON";
    return (
      <div className="mx-auto max-w-xl py-10">
        <EmptyState
          icon={comingSoon ? <Hourglass className="size-5" aria-hidden /> : <Lock className="size-5" aria-hidden />}
          title={comingSoon ? `${lesson.title} — قيد الإعداد` : "هذا الدرس مقفل حاليًا"}
          description={
            comingSoon
              ? "تُضاف مادة هذا الدرس بعد التحقق منها واعتمادها، ثم يُفتح في مسارك."
              : "يُفتح هذا الدرس بعد أن تُكمل دراسة الدرس السابق في المسار."
          }
          action={<ButtonLink href="/curriculum" variant="secondary">العودة إلى المسار العلمي</ButtonLink>}
        />
      </div>
    );
  }

  const studied = Boolean(progress?.studied);
  // Measured lessons start with a short pre-test, before the learner reads the material.
  const needsPreTest = Boolean(view.measurement && !view.measurement.preDone && !studied);
  const offerPostTest = Boolean(view.measurement?.preDone && !view.measurement.postDone && view.lastCompleted);
  const lessonVideoUrl = LESSON_VIDEO_URLS[lesson.id];
  const stageInfo = await getLessonStageInfo(view);

  return (
    <>
      <nav aria-label="مسار التنقل" className="mb-6 flex flex-wrap items-center gap-1 text-caption text-muted">
        <Link href="/curriculum" className="hover:text-ink">
          المسار العلمي
        </Link>
        <ChevronLeft className="size-3.5" aria-hidden />
        <span>{chapter.title}</span>
      </nav>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          {/* ── Lesson header ── */}
          <header className="mx-auto max-w-2xl animate-fade-up">
            <p className="text-small font-medium text-gold-ink">
              {view.course.title} · {ordinalLesson(view.number)}
            </p>
            <h1 className="mt-1 text-title text-ink">{lesson.title}</h1>
            {learnerDescription(lesson.description) ? <p className="mt-3 text-muted">{learnerDescription(lesson.description)}</p> : null}
            <div className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6">
              <LessonJourney stages={stageInfo.stages} />
              <Progress
                value={stageInfo.progressPct}
                label={`تقدمك في الدرس: ${ar(stageInfo.progressPct)}٪`}
                showValue
                size="md"
                animateFrom={0}
                className="mt-6"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-caption text-faint">
              <span>{countLabel(concepts.length, ["مفهوم واحد", "مفهومان", "مفاهيم", "مفهومًا"])}</span>
              {lesson.estimatedMinutes ? <span>نحو {ar(lesson.estimatedMinutes)} دقائق قراءة</span> : null}
              {progress?.completedAt ? <span className="text-success-ink">✓ أتممت هذا الدرس</span> : studied ? <span className="text-success-ink">✓ أكملت مرحلة التعلّم</span> : null}
            </div>
          </header>

          {/* ── Objectives ── */}
          {lesson.objectives.length > 0 ? (
            <section aria-labelledby="objectives" className="mx-auto mt-10 max-w-2xl">
              <h2 id="objectives" className="flex items-center gap-2 text-card font-semibold text-ink">
                <Target className="size-4 text-sage-dark" aria-hidden />
                أهداف الدرس
              </h2>
              <ul className="mt-3 space-y-2">
                {lesson.objectives.map((objective) => (
                  <li key={objective} className="flex gap-3 text-small text-text">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-sage" />
                    {objective}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {needsPreTest && view.measurement ? (
            <section className="mx-auto mt-10 max-w-2xl" aria-label="الاختبار القبلي">
              <MeasurementCard lessonId={lesson.id} kind="PRE_TEST" activeSessionId={view.measurement.activeSession?.purpose === "PRE_TEST" ? view.measurement.activeSession.id : null} />
            </section>
          ) : null}

          {/* ── Student lesson video ── */}
          {needsPreTest ? null : (
          <section className="mx-auto mt-10 max-w-2xl" aria-label="فيديو الدرس">
            {lessonVideoUrl ? (
              <div className="overflow-hidden rounded-2xl border border-line bg-ink shadow-soft">
                <iframe
                  src={lessonVideoUrl}
                  title={`فيديو ${lesson.title}`}
                  className="aspect-video w-full"
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  data-testid="lesson-video-player"
                />
              </div>
            ) : (
              <EmptyState title="فيديو الدرس قيد الإعداد" description="سيظهر الفيديو هنا بعد اعتماده للنشر." />
            )}
          </section>
          )}

          {/* ── Learning → Assessment transition ── */}
          {view.hasApprovedContent && lessonVideoUrl && !needsPreTest ? (
            <section id="assessment" aria-label="الانتقال إلى مرحلة قياس الفهم" className="mx-auto mt-16 max-w-2xl">
              {studied ? (
                <>
                  <div className="flex flex-col items-center text-center" aria-hidden>
                    <span className="inline-flex items-center gap-2 rounded-full bg-success-soft px-4 py-1.5 text-small font-medium text-success-ink">
                      <CheckCircle2 className="size-4" />
                      أكملت مرحلة التعلّم، اختبر فهمك الآن.
                    </span>
                    <span className="my-3 h-8 w-px bg-line-strong" />
                    <ArrowDown className="size-4 text-faint" />
                    <span className="my-3 h-8 w-px bg-line-strong" />
                  </div>
                  <AssessmentStage
                    lessonId={lesson.id}
                    activeSession={view.activeSession}
                    lastCompleted={view.lastCompleted}
                    fixedQuestionCount={view.fixedQuestionCount}
                  />
                  {offerPostTest ? (
                    <div className="mt-6">
                      <MeasurementCard lessonId={lesson.id} kind="POST_TEST" activeSessionId={view.measurement?.activeSession?.purpose === "POST_TEST" ? view.measurement.activeSession.id : null} />
                    </div>
                  ) : null}
                </>
              ) : (
                <StudyCompletion lessonId={lesson.id} />
              )}
            </section>
          ) : null}
        </div>

      </div>
    </>
  );
}
