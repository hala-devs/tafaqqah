import type { Metadata } from "next";
import { Route } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { flattenPath, getLearningPath, getRoadmaps, type PathCourse } from "@/server/content/queries";
import { prisma } from "@/server/db";
import { getWeakConcepts } from "@/server/learner/overview";
import { listMemorizationBooks } from "@/server/memorization/content";
import { EmptyState } from "@/components/ui/empty-state";
import { CourseJourney } from "@/components/learning/course-journey";
import { FutureLevelRow } from "@/components/learning/journey-parts";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "المسار العلمي" };

export default async function CurriculumPage() {
  const user = await requireUser("/curriculum");
  const [roadmaps, courses, memorizeBooks, weak] = await Promise.all([getRoadmaps(), getLearningPath(user.id), listMemorizationBooks(prisma), getWeakConcepts(user.id)]);
  const memorizable = new Set(memorizeBooks.map((b) => b.id));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const weakFor = (course: PathCourse) => {
    const ids = new Set(flattenPath([course]).map((e) => e.lesson.id));
    return weak.filter((w) => ids.has(w.lessonId)).length;
  };

  if (roadmaps.length === 0 && courses.length === 0) {
    return <EmptyState icon={<Route className="size-5" aria-hidden />} title="لم يُنشر المسار العلمي بعد" description="ستظهر هنا دروس المسار فور اعتماد مادتها العلمية." />;
  }

  // Courses not attached to a level (e.g. added by an admin) are still listed.
  const attached = new Set(roadmaps.flatMap((r) => r.levels.flatMap((l) => l.courseIds)));
  const loose = courses.filter((c) => !attached.has(c.id));

  return (
    <div className="mx-auto max-w-5xl space-y-14">
      {roadmaps.map((roadmap) => (
        <article key={roadmap.id} className="animate-fade-up">
          <header>
            <p className="text-caption font-semibold text-gold-ink">المسار العلمي</p>
            <h1 className="mt-1.5 text-title text-ink sm:text-display-sm">{roadmap.title}</h1>
            <p className="mt-2 text-body text-muted">
              {roadmap.description} <span className="text-ink">تعلّم، اختبر فهمك، ثم ثبّت ما تعلمته.</span>
            </p>
          </header>

          <ol className="mt-8 space-y-3" aria-label="مستويات المسار">
            {roadmap.levels.map((level) => {
              const active = level.status === "ACTIVE";
              const levelCourses = level.courseIds.map((id) => courseById.get(id)).filter((c): c is PathCourse => Boolean(c));
              if (active) {
                return (
                  <li key={level.id} aria-current="step" className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
                    {levelCourses.length ? (
                      levelCourses.map((course, i) => (
                        <div key={course.id} className={cn(i > 0 && "border-t-4 border-paper")}>
                          <CourseJourney course={course} levelOrder={level.order} levelTitle={level.title} hasMemorization={memorizable.has(course.id)} weakCount={weakFor(course)} />
                        </div>
                      ))
                    ) : (
                      <div className="p-6">
                        <p className="font-naskh text-section font-semibold text-ink">{level.title}</p>
                        <p className="mt-1 text-small text-muted">تُضاف دروس هذا المستوى بعد اعتماد مادتها.</p>
                      </div>
                    )}
                  </li>
                );
              }
              return (
                <li key={level.id}>
                  <FutureLevelRow order={level.order} title={level.title} />
                </li>
              );
            })}
          </ol>
        </article>
      ))}

      {loose.map((course) => (
        <article key={course.id} className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
          <CourseJourney course={course} levelOrder={null} levelTitle={course.levelTitle} hasMemorization={memorizable.has(course.id)} weakCount={weakFor(course)} />
        </article>
      ))}
    </div>
  );
}
