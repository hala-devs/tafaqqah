import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getLessonOverviews } from "@/server/admin/content-overview";
import { PageHeader } from "@/components/admin/page-header";
import { CombinedStatusBadge, PublicationBadge } from "@/components/admin/status-chips";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "الدروس" };

export default async function AdminLessonsPage() {
  const admin = await requireAdminPage();
  const lessons = await getLessonOverviews(prisma, admin);

  return (
    <>
      <PageHeader title="الدروس" description="كل درس له حالتان منفصلتان: حالة المحتوى (اعتماد داخلي) وحالة النشر (ما يراه الطلاب). افتح الدرس لمراجعة مفاهيمه ومصادره وتوقيتاته." />
      {lessons.length === 0 ? (
        <EmptyState title="لا دروس بعد" description="أضف درسًا من صفحة المسار العلمي." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[56rem] text-small" data-testid="admin-lessons-table">
            <thead className="bg-surface-2/60 text-caption text-muted">
              <tr className="text-start">
                <th className="px-4 py-3 text-start font-medium">الدرس</th>
                <th className="px-4 py-3 text-start font-medium">الحالة</th>
                <th className="px-4 py-3 text-start font-medium">النشر</th>
                <th className="px-4 py-3 text-start font-medium">المفاهيم</th>
                <th className="px-4 py-3 text-start font-medium">المقاطع المعتمدة</th>
                <th className="px-4 py-3 text-start font-medium">التوقيتات المعتمدة</th>
                <th className="px-4 py-3 text-start font-medium">مراجعة بشرية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lessons.map((lesson) => (
                <tr key={lesson.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/lessons/${lesson.id}`} className="font-medium text-ink hover:underline">
                      {lesson.title}
                    </Link>
                    <p className="text-caption text-muted">
                      {lesson.courseTitle} · {lesson.chapterTitle}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <CombinedStatusBadge status={lesson.combinedStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <PublicationBadge status={lesson.publication} />
                    {lesson.publishedWithRevokedApproval ? <p className="mt-1 text-caption text-warning-ink">اعتماد ملغى</p> : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{ar(lesson.concepts)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {ar(lesson.approvedPassages)}/{ar(lesson.passages)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {ar(lesson.approvedTimestamps)}/{ar(lesson.concepts)}
                  </td>
                  <td className="px-4 py-3">{lesson.humanReviewConcepts ? <Badge tone="error">{ar(lesson.humanReviewConcepts)} مفهومًا</Badge> : <span className="text-faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
