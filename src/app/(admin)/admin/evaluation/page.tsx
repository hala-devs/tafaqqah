import type { Metadata } from "next";
import { AiSubNav } from "@/components/admin/ai-subnav";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminPage } from "@/server/auth/current-user";
import { Download } from "lucide-react";
import { prisma } from "@/server/db";
import { assessmentStrategy } from "@/server/auth/accounts";
import { getEvaluationRows, getLatencySummary, getMeasurementRows, summarize, summarizeMeasurements } from "@/server/admin/evaluation";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "التقييم" };

const pct = (v: number | null) => (v === null ? "—" : `${ar(Math.round(v * 100))}٪`);
const num = (v: number | null, digits = 1) => (v === null ? "—" : ar(v.toFixed(digits)));

export default async function EvaluationPage() {
  // Pages render in parallel with the admin layout, so each one guards itself too.
  const actor = await requireAdminPage();
  const [rows, measurementRows, latency] = await Promise.all([
    getEvaluationRows(prisma, actor),
    getMeasurementRows(prisma, actor),
    getLatencySummary(prisma, actor),
  ]);
  const summary = summarize(rows);
  const measurement = summarizeMeasurements(measurementRows);
  const strategy = assessmentStrategy();

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="الاختبارات والذكاء الاصطناعي" description="التقييم والمقارنة بين الاختبار الثابت والتكيفي من بيانات فعلية فقط." />
        <AiSubNav />
      </div>
      <Card tone="muted">
        <h2 className="text-card font-semibold text-ink">مقارنة الاختبار الثابت والتكيفي</h2>
        <p className="mt-2 max-w-3xl text-small leading-7 text-muted">
          تعرض هذه الصفحة بيانات فعلية فقط من قاعدة البيانات. لا تُعدّ هذه الأرقام دليلًا على أفضلية أي نمط قبل إجراء تقييم منهجي
          (اختبار قبلي وبعدي، وعيّنة كافية). نمط التوزيع الحالي: <span className="font-medium text-ink" dir="ltr">ASSESSMENT_MODE_STRATEGY={strategy}</span>
        </p>
        <a
          href="/api/admin/evaluation"
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-small font-medium text-ink hover:border-ink/40"
        >
          <Download className="size-4" aria-hidden />
          تصدير البيانات (JSON)
        </a>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="لا توجد جلسات اختبار بعد" description="ستظهر هنا المؤشرات بعد أن يبدأ المتعلمون الاختبارات." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-small">
            <thead className="bg-surface-2/70 text-caption text-muted">
              <tr>
                <th className="px-4 py-3 text-start font-medium">المؤشر</th>
                {summary.map((s) => (
                  <th key={s.mode} className="px-4 py-3 text-start font-medium">
                    {s.mode === "ADAPTIVE" ? "تكيفي" : "ثابت"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[
                { label: "جلسات بدأت", get: (s: (typeof summary)[number]) => ar(s.started) },
                { label: "جلسات اكتملت", get: (s: (typeof summary)[number]) => ar(s.completed) },
                { label: "نسبة الإكمال", get: (s: (typeof summary)[number]) => pct(s.completionRate) },
                { label: "متوسط عدد الأسئلة", get: (s: (typeof summary)[number]) => num(s.avgQuestions) },
                { label: "متوسط الدقة", get: (s: (typeof summary)[number]) => pct(s.avgAccuracy) },
                { label: "متوسط الأجزاء التي تحتاج إلى تثبيت", get: (s: (typeof summary)[number]) => num(s.avgReviewConcepts) },
                { label: "عدد آراء المتعلمين", get: (s: (typeof summary)[number]) => ar(s.feedbackCount) },
                { label: "متوسط تقييم المتعلمين (من ٥)", get: (s: (typeof summary)[number]) => num(s.avgRating) },
              ].map((metric) => (
                <tr key={metric.label}>
                  <th scope="row" className="px-4 py-3 text-start font-normal text-muted">
                    {metric.label}
                  </th>
                  {summary.map((s) => (
                    <td key={s.mode} className="px-4 py-3 tabular-nums text-ink">
                      {metric.get(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section aria-labelledby="prepost" className="space-y-3">
        <h2 id="prepost" className="text-card font-semibold text-ink">
          القياس القبلي والبعدي
        </h2>
        {measurement.started === 0 ? (
          <p className="text-small text-muted">لا توجد قياسات بعد. فعّل «قياس قبلي وبعدي» لدرس من صفحة تحرير الدرس.</p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "متعلمون بدؤوا القياس", value: ar(measurement.started) },
              { label: "أكملوا القبلي والبعدي", value: ar(measurement.paired) },
              { label: "متوسط القبلي ← البعدي", value: `${pct(measurement.avgPre)} ← ${pct(measurement.avgPost)}` },
              { label: "متوسط الأجزاء المُخطأ فيها قبل ← بعد", value: `${num(measurement.avgWeakBefore)} ← ${num(measurement.avgWeakAfter)}` },
            ].map((stat) => (
              <Card key={stat.label} padded={false} className="px-5 py-4">
                <dt className="text-caption text-muted">{stat.label}</dt>
                <dd className="mt-1 text-card font-semibold text-ink tabular-nums">{stat.value}</dd>
              </Card>
            ))}
          </dl>
        )}
        <p className="text-caption text-faint">تُحسب المتوسطات للمتعلمين الذين أكملوا الاختبارين فقط. الفرق وحده لا يثبت أثرًا سببيًا دون تصميم تقييم مناسب.</p>
      </section>

      <section aria-labelledby="latency" className="space-y-3">
        <h2 id="latency" className="text-card font-semibold text-ink">
          زمن استدعاءات النموذج (مقاس)
        </h2>
        {latency.length === 0 ? (
          <p className="text-small text-muted">لا توجد استدعاءات مسجّلة بعد.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[32rem] text-small" dir="ltr">
              <thead className="bg-surface-2/70 text-caption text-muted">
                <tr>
                  {["provider", "call", "count", "p50", "p95", "max"].map((h) => (
                    <th key={h} className="px-4 py-2 text-start font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {latency.map((row) => (
                  <tr key={`${row.provider}-${row.type}`}>
                    <td className="px-4 py-2">{row.provider}</td>
                    <td className="px-4 py-2">{row.type}</td>
                    <td className="px-4 py-2 tabular-nums">{row.count}</td>
                    <td className="px-4 py-2 tabular-nums">{row.p50 != null ? `${(row.p50 / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{row.p95 != null ? `${(row.p95 / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{row.max != null ? `${(row.max / 1000).toFixed(1)}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-faint">أرقام المزوّد التجريبي (mock) لا تمثّل زمن نموذج حقيقي.</p>
      </section>

      <p className="text-caption text-faint">
        الحقل <span dir="ltr">purpose</span> في جلسات الاختبار (PRACTICE / PRE_TEST / POST_TEST) مُعدّ لدعم الاختبارين القبلي والبعدي في
        التقييم القادم، ويُضمَّن في ملف التصدير.
      </p>
    </div>
  );
}
