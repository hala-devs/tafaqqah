import Link from "next/link";
import { ArrowLeft, Sprout } from "lucide-react";
import { flattenPath, type PathCourse, type PathLesson } from "@/server/content/queries";
import { JourneyTabs } from "@/components/memorize/journey-tabs";
import { LearningPath } from "@/components/learning/learning-path";
import { LessonMeta, lessonAction, lessonStatusLabel } from "@/components/learning/path-node";
import { SampleNotice } from "@/components/learning/sample-notice";
import { JourneyProgress, LevelIdentity, NextStepPanel } from "@/components/learning/journey-parts";
import { ar, availableLessonsLabel, countLabel, lessonDenominator } from "@/lib/format";

const CONCEPTS = ["مفهوم واحد", "مفهومان", "مفاهيم", "مفهومًا"] as [string, string, string, string];

/** The lesson the learner should open next: the real CURRENT lesson, otherwise the first open, unfinished one. */
function nextLesson(lessons: PathLesson[]): PathLesson | null {
  return lessons.find((l) => l.state === "CURRENT") ?? lessons.find((l) => l.state === "AVAILABLE" && !l.completed) ?? null;
}

/** State-aware line under the progress — only statements that are true for this learner. */
function progressLine(completed: number, total: number, next: PathLesson | null): string {
  if (total > 0 && completed === total) return "أتممت الدروس المتاحة في هذا المستوى.";
  if (completed === 0 && next && !next.studied && next.assessmentState === "NOT_STARTED") return next.number === 1 ? "ابدأ الدرس الأول لتبدأ تقدمك." : "ابدأ الدرس التالي لتبدأ تقدمك.";
  return "واصل من حيث توقفت.";
}

function nextLessonLine(lesson: PathLesson, completed: number): string {
  if (lesson.assessmentState === "IN_PROGRESS") return "لديك اختبار لم يكتمل. تابع من حيث توقفت.";
  if (lesson.studied) return "أتممت الدرس، والخطوة التالية اختبار فهمك.";
  if (completed === 0 && lesson.number === 1) return "ابدأ الدرس الأول لتبدأ رحلتك.";
  return lesson.description;
}

export function CourseJourney({ course, levelOrder, levelTitle, hasMemorization, weakCount }: { course: PathCourse; levelOrder: number | null; levelTitle: string | null; hasMemorization: boolean; weakCount: number }) {
  const lessons = flattenPath([course]).map((e) => e.lesson);
  const published = lessons.filter((l) => l.status === "PUBLISHED");
  const completed = published.filter((l) => l.completed).length;
  const next = nextLesson(published);
  const preparing = lessons.length - published.length;

  return (
    <div>
      {/* Level summary + progress */}
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <LevelIdentity
          levelOrder={levelOrder}
          levelTitle={levelTitle}
          title={course.title}
          meta={[`المذهب ${course.madhhab}`, availableLessonsLabel(published.length), preparing > 0 ? `${ar(preparing)} قيد الإعداد` : null]}
        />
        {published.length > 0 ? (
          <JourneyProgress
            title="تقدمك في المستوى"
            done={completed}
            total={published.length}
            fraction={`أكملت ${ar(completed)} من ${lessonDenominator(published.length)}`}
            line={progressLine(completed, published.length, next)}
            testId="level-progress"
          />
        ) : null}
      </div>

      {hasMemorization ? (
        <div className="border-t border-line px-5 py-4 sm:px-7">
          <JourneyTabs active="LEARN" memorizeHref="/memorize" />
        </div>
      ) : null}

      <div className="border-t border-line p-5 sm:p-7">
        {course.isSample ? <SampleNotice className="mb-6" /> : null}

        {next ? (
          <NextStepPanel
            id={`next-${course.id}`}
            title={next.title}
            badge={lessonStatusLabel(next)}
            text={nextLessonLine(next, completed)}
            meta={<LessonMeta className="mt-3 text-surface/65 [&_*]:text-surface/70" conceptCount={next.conceptCount} estimatedMinutes={next.estimatedMinutes} />}
            href={`/lessons/${next.id}`}
            cta={lessonAction(next)}
            testId="next-lesson"
            ctaTestId="next-lesson-cta"
          />
        ) : published.length > 0 && completed === published.length ? (
          <p className="rounded-2xl bg-success-soft px-5 py-4 text-body font-medium text-success-ink">أتممت الدروس المتاحة في هذا المستوى. ستظهر الدروس الجديدة هنا فور نشرها.</p>
        ) : null}

        {weakCount > 0 ? (
          <Link
            href="/review"
            className="group mt-4 flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft/60 px-4 py-3 text-small transition-colors hover:bg-warning-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            data-testid="weak-concepts-hint"
          >
            <Sprout className="size-4 shrink-0 text-warning-ink" aria-hidden />
            <span className="flex-1 font-medium text-ink">
              {weakCount === 1 ? "لديك مفهوم يحتاج إلى تثبيت." : `لديك ${countLabel(weakCount, CONCEPTS)} ${weakCount === 2 ? "يحتاجان" : "تحتاج"} إلى تثبيت.`}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-warning-ink">
              راجعها
              <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
            </span>
          </Link>
        ) : null}

        {lessons.length > 0 ? (
          <div className="mt-9">
            <h3 className="text-section text-ink">مسار الدروس</h3>
            <div className="mt-4">
              <LearningPath chapters={course.chapters} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

