import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getStudentDetail } from "@/server/admin/insights";
import { PageHeader, StatCard } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";
import { EmptyData } from "@/components/admin/page-header";
import { ar, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "تفاصيل طالب" };

const PURPOSE_LABEL = { PRACTICE: "اختبار الدرس", PRE_TEST: "اختبار قبلي", POST_TEST: "اختبار بعدي", REASSESSMENT: "إعادة تقييم" } as const;

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  const student = await getStudentDetail(prisma, admin, id);
  if (!student) notFound();

  const mastered = student.masteries.filter((m) => m.state === "MASTERED");
  const reinforce = student.masteries.filter((m) => m.state === "NEEDS_REINFORCEMENT");
  const reassessments = student.attempts.filter((a) => a.purpose === "REASSESSMENT");

  return (
    <>
      <nav aria-label="مسار التنقل" className="mb-4 flex items-center gap-1 text-caption text-muted">
        <Link href="/admin/students" className="hover:text-ink">
          الطلاب
        </Link>
        <ChevronLeft className="size-3.5" aria-hidden />
        <span>{student.name}</span>
      </nav>
      <PageHeader title={student.name} description={`انضم ${formatDate(student.joinedAt)} · ${student.maskedEmail}`} />

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="مفاهيم متقنة" value={ar(mastered.length)} tone="success" />
        <StatCard label="مفاهيم تحتاج تثبيتًا" value={ar(reinforce.length)} tone={reinforce.length ? "warning" : "default"} />
        <StatCard label="اختبارات مكتملة" value={ar(student.attempts.length)} />
        <StatCard label="محاولات إعادة التقييم" value={ar(reassessments.length)} />
      </div>

      <div className="space-y-8">
        <section aria-labelledby="path">
          <h2 id="path" className="mb-3 text-section text-ink">
            التقدم في المسار
          </h2>
          {student.path.length === 0 ? (
            <EmptyData>لا دروس منشورة بعد.</EmptyData>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {student.path.map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="text-body text-ink">{lesson.title}</span>
                  {lesson.completed ? <Badge tone="success">أكمله</Badge> : lesson.studied ? <Badge tone="sage">بدأ دراسته</Badge> : <Badge tone="neutral">لم يبدأ</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="mastery">
          <h2 id="mastery" className="mb-3 text-section text-ink">
            الإتقان لكل مفهوم
          </h2>
          {student.masteries.length === 0 ? (
            <EmptyData>لم يجب هذا الطالب عن أسئلة بعد، فلا توجد بيانات إتقان.</EmptyData>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-small">
                <thead className="bg-surface-2/60 text-caption text-muted">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">المفهوم</th>
                    <th className="px-4 py-3 text-start font-medium">المستوى</th>
                    <th className="px-4 py-3 text-start font-medium">إجابات</th>
                    <th className="px-4 py-3 text-start font-medium">صحيحة / خاطئة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {student.masteries.map((m) => (
                    <tr key={m.conceptId}>
                      <td className="px-4 py-3">
                        <span className="text-ink">{m.conceptTitle}</span>
                        <p className="text-caption text-muted">{m.lessonTitle}</p>
                      </td>
                      <td className="px-4 py-3">
                        <MasteryIndicator score={m.score} state={m.state} />
                      </td>
                      <td className="px-4 py-3 tabular-nums">{ar(m.attempts)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {ar(m.correct)} / {ar(m.incorrect)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="attempts">
          <h2 id="attempts" className="mb-3 text-section text-ink">
            الاختبارات ومحاولات إعادة التقييم
          </h2>
          {student.attempts.length === 0 ? (
            <EmptyData>لا اختبارات مكتملة.</EmptyData>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {student.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-small">
                    <span className="text-ink">
                      {PURPOSE_LABEL[a.purpose]} — {a.lessonTitle}
                    </span>
                    <span className="flex items-center gap-3 text-muted">
                      {a.accuracy != null ? `${ar(Math.round(a.accuracy * 100))}٪ صحيحة (${ar(a.totalQuestions ?? 0)} أسئلة)` : "—"}
                      {a.completedAt ? <span className="text-caption text-faint">{formatDate(a.completedAt)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
