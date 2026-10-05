import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, CircleCheck } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getDashboard } from "@/server/admin/insights";
import { PageHeader, StatCard } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "الرئيسية" };

type ActionRow = { key: string; label: string; count: number; href: string; hint: string; tone: "warning" | "gold" | "success" | "error" };

export default async function AdminDashboardPage() {
  const admin = await requireAdminPage();
  const { totals, actions } = await getDashboard(prisma, admin);

  const rows: ActionRow[] = [
    { key: "lessons-review", label: "دروس تنتظر الاعتماد", count: actions.lessonsAwaitingApproval.length, href: "/admin/review?filter=READY_TO_APPROVE", hint: "اجتازت التحقق الآلي وتحتاج اعتمادًا بشريًا", tone: "warning" },
    { key: "human", label: "مقاطع مصدرية تحتاج مراجعة بشرية", count: actions.humanReview.length, href: "/admin/review?filter=HUMAN_REVIEW", hint: "تعارض أو عدم يقين بين التفريغ والـPDF", tone: "error" },
    { key: "text", label: "نصوص غير معتمدة", count: actions.textUnapproved.length, href: "/admin/review?filter=TEXT_UNAPPROVED", hint: "مفاهيم نصها لم يُعتمد بعد", tone: "warning" },
    { key: "timestamp", label: "توقيتات غير معتمدة", count: actions.timestampUnapproved.length, href: "/admin/review?filter=TIMESTAMP_UNAPPROVED", hint: "لن يُوجَّه الطالب إلى مقطع غير معتمد", tone: "warning" },
    { key: "rejected", label: "أسئلة ذكاء اصطناعي رُفضت من المدقق", count: actions.aiRejected, href: "/admin/logs", hint: "راجع أسباب الرفض في سجل التتبّع", tone: "gold" },
    { key: "publish", label: "دروس جاهزة للنشر", count: actions.readyToPublish.length, href: "/admin/review?filter=READY_TO_PUBLISH", hint: "معتمدة داخليًا ولم تُنشر للطلاب", tone: "success" },
  ];
  const pending = rows.filter((r) => r.count > 0);

  return (
    <div className="space-y-10">
      <PageHeader title="لوحة الإدارة" description="صورة مباشرة عن حالة المنصة: المحتوى المعتمد، ما ينتظر قرارك، ونشاط الطلاب والذكاء الاصطناعي." />

      <section aria-labelledby="needs-action" data-testid="needs-action">
        <h2 id="needs-action" className="mb-3 text-section text-ink">
          تحتاج إلى إجراء
        </h2>
        {pending.length === 0 ? (
          <Card className="flex items-center gap-3 text-small text-muted">
            <CircleCheck className="size-5 text-success" aria-hidden />
            لا شيء ينتظر قرارك الآن.
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((row) => (
              <li key={row.key}>
                <Link href={row.href} className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2/50">
                  <span className="min-w-0">
                    <span className="block text-body text-ink">{row.label}</span>
                    <span className="block text-caption text-muted">{row.hint}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={row.tone}>{ar(row.count)}</Badge>
                    <ChevronLeft className="size-4 text-faint" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {actions.publishedWithRevokedApproval.length ? (
          <p role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-warning-soft p-3 text-small text-warning-ink">
            تنبيه: {actions.publishedWithRevokedApproval.map((l) => `«${l.title}»`).join("، ")} منشور للطلاب لكن بعض اعتمادات محتواه أُلغيت لاحقًا؛ لا يستخدم الاختبار إلا المقاطع المعتمدة حاليًا.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="stats" className="space-y-6">
        <h2 id="stats" className="text-section text-ink">
          حالة المنصة
        </h2>
        <div>
          <h3 className="mb-2 text-small font-medium text-muted">المحتوى</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="المستويات" value={ar(totals.levels)} />
            <StatCard label="الدروس" value={ar(totals.lessons)} />
            <StatCard label="الدروس المنشورة" value={ar(totals.published)} tone="success" />
            <StatCard label="الدروس قيد الإعداد" value={ar(totals.inPreparation)} />
            <StatCard label="المفاهيم" value={ar(totals.concepts)} />
            <StatCard label="المقاطع المصدرية المعتمدة" value={ar(totals.approvedPassages)} tone="success" />
            <StatCard label="مقاطع تنتظر المراجعة" value={ar(totals.pendingPassages)} tone={totals.pendingPassages ? "warning" : "default"} />
            <StatCard label="التوقيتات المعتمدة" value={ar(totals.approvedTimestamps)} tone="success" />
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-small font-medium text-muted">الطلاب والذكاء الاصطناعي</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="الطلاب" value={ar(totals.students)} />
            <StatCard label="اختبارات منجزة" value={ar(totals.completedAssessments)} />
            <StatCard label="أسئلة ولّدها الذكاء الاصطناعي" value={ar(totals.aiGenerated)} hint={`${ar(totals.aiValid)} مقبولة · ${ar(totals.aiRejected)} مرفوضة`} />
          </div>
        </div>
      </section>
    </div>
  );
}
