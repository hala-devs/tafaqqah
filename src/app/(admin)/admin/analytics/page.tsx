import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getAnalytics } from "@/server/admin/insights";
import { Bar, EmptyData, PageHeader, StatCard } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "التحليلات" };

const pct = (v: number) => `${ar(Math.round(v * 100))}٪`;

export default async function AnalyticsPage() {
  const admin = await requireAdminPage();
  const data = await getAnalytics(prisma, admin);
  const maxStarted = Math.max(1, ...data.lessonRows.map((r) => r.started));
  const maxWrong = Math.max(1, ...data.missedConcepts.map((m) => m.wrong));
  const maxStudents = Math.max(1, ...data.repeatedReview.map((r) => r.students));

  return (
    <div className="space-y-10">
      <PageHeader title="التحليلات" description="أرقام حقيقية من نشاط الطلاب فقط. حين لا توجد بيانات كافية يُعرض ذلك صراحة بدل تقدير أرقام." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="اختبارات منجزة" value={ar(data.completedAssessments)} />
        <StatCard label="متوسط أداء اختبارات الدروس" value={data.avgAccuracy == null ? "—" : pct(data.avgAccuracy)} hint={data.avgAccuracy == null ? "لا بيانات بعد" : "نسبة الإجابات الصحيحة"} />
        <StatCard label="أسئلة أنشأها الذكاء الاصطناعي" value={ar(data.ai.generated)} hint={`${ar(data.ai.valid)} مقبولة · ${ar(data.ai.rejected)} مرفوضة`} />
        <StatCard label="نسبة قبول المدقق" value={data.ai.acceptanceRate == null ? "—" : pct(data.ai.acceptanceRate)} hint={data.ai.acceptanceRate == null ? "لا أسئلة مولّدة بعد" : "من الأسئلة المولّدة"} />
      </div>

      <section aria-labelledby="lessons">
        <h2 id="lessons" className="mb-3 text-section text-ink">
          الدروس الأكثر دراسة ونسبة الإكمال
        </h2>
        {data.lessonRows.length === 0 ? (
          <EmptyData>لم يبدأ أي طالب دراسة درس بعد. يُحسب هنا عدد الطلاب الذين أتمّوا مرحلة الدراسة.</EmptyData>
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {data.lessonRows.map((row) => (
                <li key={row.lessonId} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_14rem_8rem] sm:items-center">
                  <span className="text-body text-ink">{row.title}</span>
                  <div className="flex items-center gap-3">
                    <Bar value={row.started} max={maxStarted} />
                    <span className="w-16 shrink-0 text-caption tabular-nums text-muted">{ar(row.started)} طالبًا</span>
                  </div>
                  <span className="text-caption text-muted">
                    الإكمال: <span className="font-medium text-ink">{pct(row.completionRate)}</span> ({ar(row.completed)}/{ar(row.started)})
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="missed">
          <h2 id="missed" className="mb-3 text-section text-ink">
            المفاهيم الأكثر خطأً
          </h2>
          {data.missedConcepts.length === 0 ? (
            <EmptyData>لا إجابات خاطئة مسجّلة بعد.</EmptyData>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {data.missedConcepts.map((m) => (
                  <li key={m.conceptId} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body text-ink">{m.title}</span>
                      <span className="text-caption tabular-nums text-muted">
                        {ar(m.wrong)} من {ar(m.total)} إجابة خاطئة
                      </span>
                    </div>
                    <p className="mb-1.5 text-caption text-faint">{m.lessonTitle}</p>
                    <Bar value={m.wrong} max={maxWrong} tone="warning" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section aria-labelledby="repeated">
          <h2 id="repeated" className="mb-3 text-section text-ink">
            مفاهيم تحتاج مراجعة متكررة
          </h2>
          {data.repeatedReview.length === 0 ? (
            <EmptyData>لا يوجد حاليًا مفهوم في حالة «يحتاج إلى تثبيت» عند أي طالب.</EmptyData>
          ) : (
            <Card padded={false}>
              <ul className="divide-y divide-line">
                {data.repeatedReview.map((r) => (
                  <li key={r.conceptId} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body text-ink">{r.title}</span>
                      <span className="text-caption tabular-nums text-muted">{ar(r.students)} طالبًا</span>
                    </div>
                    <p className="mb-1.5 text-caption text-faint">{r.lessonTitle}</p>
                    <Bar value={r.students} max={maxStudents} tone="warning" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>

      <section aria-labelledby="recovery">
        <h2 id="recovery" className="mb-3 text-section text-ink">
          من المراجعة إلى الإتقان
        </h2>
        {data.recovery == null ? (
          <EmptyData>لم يمرّ أي طالب بحالة «يحتاج إلى تثبيت» بعد، فلا يمكن حساب المعدل.</EmptyData>
        ) : (
          <Card>
            <p className="text-small text-muted">
              من بين {ar(data.recovery.total)} حالة (طالب × مفهوم) احتاجت إلى تثبيت، انتقلت {ar(data.recovery.recovered)} إلى «جيد» أو «متقن»:
            </p>
            <p className="mt-2 text-section font-semibold text-ink">{pct(data.recovery.recovered / data.recovery.total)}</p>
            <div className="mt-3">
              <Bar value={data.recovery.recovered} max={data.recovery.total} tone="sage" />
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
