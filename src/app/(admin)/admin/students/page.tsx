import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getStudents } from "@/server/admin/insights";
import { PageHeader, StatCard } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ar, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "الطلاب" };

export default async function StudentsPage() {
  const admin = await requireAdminPage();
  const students = await getStudents(prisma, admin);

  return (
    <>
      <PageHeader title="الطلاب" description="معلومات تعليمية فقط: ما بدأه الطالب وأتمّه ومستوى إتقانه. لا تُعرض كلمات المرور ولا العناوين البريدية كاملة." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="عدد الطلاب" value={ar(students.length)} />
        <StatCard label="طلاب أجروا اختبارًا" value={ar(students.filter((s) => s.assessments > 0).length)} />
        <StatCard label="طلاب لديهم مفاهيم تحتاج تثبيتًا" value={ar(students.filter((s) => s.reinforceConcepts > 0).length)} />
      </div>
      {students.length === 0 ? (
        <EmptyState title="لا طلاب مسجّلون بعد" description="سيظهر الطلاب هنا بعد تسجيلهم." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[50rem] text-small" data-testid="admin-students-table">
            <thead className="bg-surface-2/60 text-caption text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">الطالب</th>
                <th className="px-4 py-3 text-start font-medium">دروس بدأها</th>
                <th className="px-4 py-3 text-start font-medium">دروس أكملها</th>
                <th className="px-4 py-3 text-start font-medium">اختبارات</th>
                <th className="px-4 py-3 text-start font-medium">متوسط الإتقان</th>
                <th className="px-4 py-3 text-start font-medium">تحتاج تثبيتًا</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/students/${s.id}`} className="font-medium text-ink hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-caption text-muted">
                      <span dir="ltr">{s.maskedEmail}</span> · انضم {formatDate(s.joinedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{ar(s.lessonsStarted)}</td>
                  <td className="px-4 py-3 tabular-nums">{ar(s.lessonsCompleted)}</td>
                  <td className="px-4 py-3 tabular-nums">{ar(s.assessments)}</td>
                  <td className="px-4 py-3 tabular-nums">{s.avgMastery == null ? <span className="text-faint">لا بيانات</span> : `${ar(Math.round(s.avgMastery))}٪`}</td>
                  <td className="px-4 py-3">{s.reinforceConcepts ? <Badge tone="warning">{ar(s.reinforceConcepts)}</Badge> : <span className="text-faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
