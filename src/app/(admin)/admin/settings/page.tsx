import type { Metadata } from "next";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { requireAdminPage } from "@/server/auth/current-user";
import { resolveAIStatus } from "@/server/ai/factory";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "الإعدادات" };

/** Read-only configuration overview. Secrets are never read into the page — only whether they are set. */
export default async function SettingsPage() {
  const admin = await requireAdminPage();
  const ai = resolveAIStatus();

  return (
    <>
      <PageHeader title="الإعدادات" description="نظرة للقراءة فقط على إعداد النظام. تُضبط القيم السرية في متغيرات البيئة على الخادم ولا تظهر هنا أبدًا." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card as="section" aria-labelledby="account">
          <h2 id="account" className="text-card font-semibold text-ink">
            حساب المدير
          </h2>
          <dl className="mt-3 space-y-2 text-small">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">الاسم</dt>
              <dd className="text-ink">{admin.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">البريد</dt>
              <dd className="text-ink" dir="ltr">
                {admin.email}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">الصلاحية</dt>
              <dd>
                <Badge tone="ink">ADMIN</Badge>
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-caption text-muted">تُمنح صلاحية المدير من الخادم بالأمر <span dir="ltr">npm run admin:promote</span>؛ لا يمكن منحها من المتصفح.</p>
        </Card>

        <Card as="section" aria-labelledby="ai">
          <h2 id="ai" className="text-card font-semibold text-ink">
            مزوّد الذكاء الاصطناعي
          </h2>
          {ai.configured ? (
            <div className="mt-3 space-y-2 text-small">
              <p className="flex flex-wrap items-center gap-2 text-ink">
                المزوّد: <span className="font-medium" dir="ltr">{ai.provider}</span>
                {ai.isDevelopmentMock ? (
                  <Badge tone="gold" icon={<FlaskConical className="size-3" aria-hidden />}>
                    مولّد تجريبي — للتطوير فقط
                  </Badge>
                ) : (
                  <Badge tone="success">مفعّل</Badge>
                )}
              </p>
              <p className="text-muted">
                المولّد: <span dir="ltr">{ai.generatorModel}</span> · المدقق: <span dir="ltr">{ai.validatorModel}</span>
              </p>
              <p className="text-caption text-muted">مفتاح الخدمة محفوظ على الخادم فقط ولا يُرسل إلى المتصفح.</p>
            </div>
          ) : (
            <p className="mt-3 inline-flex items-start gap-2 text-small text-warning-ink">
              <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />
              غير مهيّأ: <span dir="ltr">{ai.reason}</span>
            </p>
          )}
        </Card>

        <Card as="section" aria-labelledby="rules" className="lg:col-span-2">
          <h2 id="rules" className="text-card font-semibold text-ink">
            قواعد المنصة الثابتة
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 ps-5 text-small text-muted">
            <li>لا يستقبل الذكاء الاصطناعي إلا مقاطع مصدرية معتمدة، ولا يستخدم معرفته العامة في الأحكام الفقهية.</li>
            <li>أي تعديل جوهري على نص أو توقيت بعد الاعتماد يُبطل الاعتماد المرتبط ويستلزم مراجعة بشرية جديدة.</li>
            <li>اعتماد المصدر لا ينشر الدرس؛ النشر قرار منفصل لا يتاح إلا بعد اعتماد كل المقاطع والتوقيتات.</li>
            <li>النص المصدري والتفريغ وبيانات PDF لا تصل إلى واجهة الطالب.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
