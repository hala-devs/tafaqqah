import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getLessonOverviews } from "@/server/admin/content-overview";
import { createChapterAction, createCourseAction, createLessonAction, setLevelStatusAction } from "../actions";
import { AdminForm } from "@/components/admin/admin-form";
import { PageHeader } from "@/components/admin/page-header";
import { CombinedStatusBadge, PublicationBadge } from "@/components/admin/status-chips";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SelectField, TextArea, TextField } from "@/components/ui/field";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "المسار العلمي" };

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer list-none px-5 py-3.5 text-small font-medium text-ink marker:hidden">
        <span className="inline-flex items-center gap-2">
          <ChevronLeft className="size-4 transition-transform duration-200 group-open:-rotate-90" aria-hidden />
          {title}
        </span>
      </summary>
      <div className="border-t border-line px-5 py-5">{children}</div>
    </details>
  );
}

export default async function CurriculumAdminPage() {
  const admin = await requireAdminPage();
  const [paths, courses, overviews] = await Promise.all([
    prisma.learningPath.findMany({
      orderBy: { order: "asc" },
      include: {
        levels: {
          orderBy: { order: "asc" },
          include: { courses: { orderBy: { order: "asc" }, include: { chapters: { orderBy: { order: "asc" }, select: { id: true, title: true, lessons: { orderBy: { order: "asc" }, select: { id: true } } } } } } },
        },
      },
    }),
    prisma.course.findMany({ orderBy: { order: "asc" }, include: { chapters: { orderBy: { order: "asc" }, select: { id: true, title: true } } } }),
    getLessonOverviews(prisma, admin),
  ]);
  const byId = new Map(overviews.map((o) => [o.id, o]));
  const chapters = courses.flatMap((c) => c.chapters.map((ch) => ({ ...ch, courseTitle: c.title })));
  const orphanCourses = await prisma.course.findMany({
    where: { levelId: null },
    orderBy: { order: "asc" },
    include: { chapters: { orderBy: { order: "asc" }, select: { id: true, title: true, lessons: { orderBy: { order: "asc" }, select: { id: true } } } } },
  });

  function CourseTree({ course }: { course: { id: string; title: string; madhhab: string; isSample: boolean; chapters: { id: string; title: string; lessons: { id: string }[] }[] } }) {
    return (
      <li className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-naskh text-card font-semibold text-ink">{course.title}</h4>
          <Badge tone="ink">{course.madhhab}</Badge>
          {course.isSample ? <Badge tone="gold">يتضمن محتوى تجريبيًا</Badge> : null}
        </div>
        <div className="mt-3 space-y-4">
          {course.chapters.map((chapter) => (
            <div key={chapter.id}>
              <p className="text-small font-medium text-muted">{chapter.title}</p>
              <ul className="mt-1.5 divide-y divide-line rounded-lg border border-line">
                {chapter.lessons.map((l) => {
                  const lesson = byId.get(l.id);
                  if (!lesson) return null;
                  return (
                    <li key={lesson.id}>
                      <Link href={`/admin/lessons/${lesson.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                        <span className="text-body text-ink">
                          {lesson.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-caption text-muted">
                          <CombinedStatusBadge status={lesson.combinedStatus} />
                          {lesson.publication !== "PUBLISHED" ? <PublicationBadge status={lesson.publication} /> : null}
                          {ar(lesson.approvedPassages)}/{ar(lesson.passages)} مقاطع معتمدة
                          <ChevronLeft className="size-4" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {chapter.lessons.length === 0 ? <li className="px-4 py-3 text-small text-muted">لا دروس بعد.</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="المسار العلمي"
        description="هيكل المسار: المستويات والكتب والأبواب والدروس. «معتمد داخليًا» يعني أن المصدر والتوقيت راجعهما إنسان، أما «منشور للطلاب» فقرار منفصل يتخذه المدير من صفحة الدرس؛ اعتماد المصدر لا ينشر الدرس تلقائيًا."
      />

      {paths.map((path) => (
        <section key={path.id} aria-labelledby={`path-${path.id}`} className="space-y-4">
          <h2 id={`path-${path.id}`} className="text-section text-ink">
            {path.title}
          </h2>
          <ol className="space-y-4 border-s-2 border-line ps-4 sm:ps-6">
            {path.levels.map((level) => (
              <li key={level.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-card font-semibold text-ink">
                      المستوى {ar(level.order)} — {level.title}
                    </h3>
                    {level.courses.length === 0 ? <p className="text-caption text-muted">لا كتب مرتبطة بهذا المستوى بعد.</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={level.status === "ACTIVE" ? "success" : "neutral"}>{level.status === "ACTIVE" ? "مفعّل للطلاب" : "قريبًا"}</Badge>
                    <AdminForm action={setLevelStatusAction} submitLabel={level.status === "ACTIVE" ? "إرجاعه إلى «قريبًا»" : "تفعيل المستوى"} variant="ghost" size="sm" inline>
                      <input type="hidden" name="id" value={level.id} />
                      <input type="hidden" name="status" value={level.status === "ACTIVE" ? "COMING_SOON" : "ACTIVE"} />
                    </AdminForm>
                  </div>
                </div>
                {level.courses.length ? (
                  <ul className="mt-3 space-y-3">
                    {level.courses.map((course) => (
                      <CourseTree key={course.id} course={course} />
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-caption text-faint">لا تفعّل مستوى قبل إدخال مادته المعتمدة؛ المستوى المفعّل يظهر للمتعلمين قابلًا للفتح.</p>
        </section>
      ))}

      {orphanCourses.length ? (
        <section aria-labelledby="orphans" className="space-y-3">
          <h2 id="orphans" className="text-section text-ink">
            كتب بلا مستوى
          </h2>
          <ul className="space-y-3">
            {orphanCourses.map((course) => (
              <CourseTree key={course.id} course={course} />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="create" className="space-y-3">
        <h2 id="create" className="text-section text-ink">
          إضافة هيكل أو درس
        </h2>
        <Disclosure title="درس جديد">
          <AdminForm action={createLessonAction} submitLabel="إنشاء الدرس" resetOnSuccess>
            <SelectField id="new-lesson-chapter" name="chapterId" label="الباب" required>
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.courseTitle} — {ch.title}
                </option>
              ))}
            </SelectField>
            <TextField id="new-lesson-title" name="title" label="عنوان الدرس" required />
            <TextArea id="new-lesson-desc" name="description" label="وصف مختصر" rows={2} required />
            <TextArea id="new-lesson-obj" name="objectives" label="أهداف الدرس (هدف في كل سطر)" rows={3} />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField id="new-lesson-status" name="status" label="الحالة الابتدائية" defaultValue="DRAFT">
                <option value="DRAFT">مسودة (مخفي)</option>
                <option value="COMING_SOON">قيد الإعداد (ظاهر ومقفل)</option>
              </SelectField>
              <TextField id="new-lesson-order" name="order" label="الترتيب" type="number" min={0} defaultValue={1} />
              <TextField id="new-lesson-min" name="estimatedMinutes" label="دقائق القراءة" type="number" min={1} />
            </div>
            <p className="text-caption text-muted">لا يُنشأ الدرس منشورًا؛ النشر يتم من صفحة الدرس بعد اعتماد محتواه.</p>
          </AdminForm>
        </Disclosure>
        <Disclosure title="باب جديد">
          <AdminForm action={createChapterAction} submitLabel="إنشاء الباب" resetOnSuccess>
            <SelectField id="new-chapter-course" name="courseId" label="الكتاب" required>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </SelectField>
            <TextField id="new-chapter-title" name="title" label="عنوان الباب" required />
            <TextArea id="new-chapter-desc" name="description" label="وصف (اختياري)" rows={2} />
            <TextField id="new-chapter-order" name="order" label="الترتيب" type="number" min={0} defaultValue={1} />
          </AdminForm>
        </Disclosure>
        <Disclosure title="كتاب / مسار جديد">
          <AdminForm action={createCourseAction} submitLabel="إنشاء الكتاب" resetOnSuccess>
            <SelectField id="new-course-level" name="levelId" label="المستوى" defaultValue="">
              <option value="">بلا مستوى</option>
              {paths.flatMap((path) =>
                path.levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {path.title} — {ar(level.order)}. {level.title}
                  </option>
                )),
              )}
            </SelectField>
            <TextField id="new-course-title" name="title" label="عنوان الكتاب" required />
            <TextField id="new-course-slug" name="slug" label="المعرّف (بالإنجليزية)" dir="ltr" placeholder="hanbali-fiqh" required />
            <TextArea id="new-course-desc" name="description" label="الوصف" rows={2} required />
            <TextField id="new-course-madhhab" name="madhhab" label="المذهب" defaultValue="الحنبلي" required />
          </AdminForm>
        </Disclosure>
      </section>
      <Card tone="muted" padded className="text-small text-muted">
        يمكنك مراجعة كل درس واعتماده من «الدروس». المستويات القادمة تبقى «قريبًا» إلى أن تُدخل موادها المعتمدة.
      </Card>
    </div>
  );
}
