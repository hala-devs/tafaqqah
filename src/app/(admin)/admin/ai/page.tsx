import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getAiOverview } from "@/server/admin/insights";
import { AiSubNav } from "@/components/admin/ai-subnav";
import { EmptyData, PageHeader, StatCard } from "@/components/admin/page-header";
import { TrialGenerator } from "@/components/admin/trial-generator";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "الاختبارات والذكاء الاصطناعي" };

export default async function AiAdminPage() {
  const admin = await requireAdminPage();
  const ai = await getAiOverview(prisma, admin);
  const { status } = ai;

  return (
    <>
      <PageHeader title="الاختبارات والذكاء الاصطناعي" description="حالة المزوّد وعمليات التوليد والتدقيق. لا يظهر أي مفتاح سرّي هنا؛ يبقى على الخادم." />
      <AiSubNav />

      <div className="space-y-10">
        <section aria-labelledby="provider">
          <h2 id="provider" className="sr-only">
            حالة المزوّد
          </h2>
          <Card data-testid="ai-provider-status">
            {status.configured ? (
              <div className="space-y-2 text-small">
                <p className="flex flex-wrap items-center gap-2 text-ink">
                  المزوّد: <span className="font-medium" dir="ltr">{status.provider}</span>
                  {status.isDevelopmentMock ? (
                    <Badge tone="gold" icon={<FlaskConical className="size-3" aria-hidden />}>
                      مولّد تجريبي — للتطوير فقط
                    </Badge>
                  ) : (
                    <Badge tone="success">مفعّل</Badge>
                  )}
                </p>
                <p className="text-muted">
                  النموذج المهيّأ — المولّد: <span dir="ltr">{status.generatorModel}</span> · المدقق: <span dir="ltr">{status.validatorModel}</span>
                </p>
                <p className="text-muted" data-testid="models-actually-used">
                  النموذج الذي أجاب فعليًا (من سجل الاستدعاءات):{" "}
                  {ai.modelsUsed.length ? (
                    ai.modelsUsed.map((m, i) => (
                      <span key={`${m.provider}/${m.model}`}>
                        {i ? "، " : ""}
                        <span dir="ltr" className="font-medium text-ink">{m.provider}/{m.model}</span> ({ar(m.calls)} توليد)
                      </span>
                    ))
                  ) : (
                    "لا استدعاءات ناجحة بعد"
                  )}
                </p>
              </div>
            ) : (
              <p className="inline-flex items-start gap-2 text-small text-warning-ink">
                <TriangleAlert className="mt-1 size-4 shrink-0" aria-hidden />
                المزوّد غير مهيّأ: <span dir="ltr">{status.reason}</span> — يبقى الاختبار الثابت متاحًا.
              </p>
            )}
          </Card>
        </section>

        <section aria-labelledby="counts">
          <h2 id="counts" className="mb-3 text-section text-ink">
            العمليات والنتائج
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Generated" value={ar(ai.accepted + ai.rejected)} hint="أسئلة مولّدة وصلت إلى التدقيق" />
            <StatCard label="Passed validation" value={ar(ai.accepted)} tone="success" hint="اجتازت التدقيق وعُرضت أو ستُعرض" />
            <StatCard label="Rejected" value={ar(ai.rejected)} tone={ai.rejected ? "warning" : "default"} hint="لم تصل إلى أي طالب" />
            <StatCard label="عمليات التوليد" value={ar(ai.generations)} hint={ai.trialGenerations ? `منها ${ar(ai.trialGenerations)} تجريبية` : undefined} />
            <StatCard label="عمليات التدقيق" value={ar(ai.validations)} hint={ai.trialValidations ? `منها ${ar(ai.trialValidations)} تجريبية` : undefined} />
            <StatCard label="INSUFFICIENT_SOURCE" value={ar(ai.insufficientSource)} hint="مصدر لا يكفي لسؤال آمن" />
            <StatCard label="أخطاء المزوّد" value={ar(ai.providerErrors)} tone={ai.providerErrors ? "warning" : "default"} />
            <StatCard label="مخرجات غير صالحة" value={ar(ai.malformed)} />
          </div>
        </section>

        <section aria-labelledby="stages">
          <h2 id="stages" className="mb-3 text-section text-ink">
            حسب مرحلة السؤال
          </h2>
          <Card padded={false}>
            <ul className="divide-y divide-line text-small" data-testid="ai-stage-breakdown">
              {ai.stages.map((row) => (
                <li key={row.stage} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span dir="ltr" className="text-ink">{row.stage}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="success">اجتاز {ar(row.passed)}</Badge>
                    <Badge tone={row.rejected ? "warning" : "neutral"}>رُفض {ar(row.rejected)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="reasons">
            <h2 id="reasons" className="mb-3 text-section text-ink">
              أسباب الرفض
            </h2>
            {ai.reasons.length === 0 ? (
              <EmptyData>لا أسئلة مرفوضة.</EmptyData>
            ) : (
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {ai.reasons.map((r) => (
                    <li key={r.issue} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                      <span dir="ltr" className="text-ink">
                        {r.issue}
                      </span>
                      <Badge tone="warning">{ar(r.n)}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          {ai.failureKinds.length ? (
            <section aria-labelledby="kinds">
              <h2 id="kinds" className="mb-3 text-section text-ink">
                أنواع الإخفاق الداخلية
              </h2>
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {ai.failureKinds.map((r) => (
                    <li key={r.kind} className="flex items-center justify-between gap-3 px-4 py-2.5 text-small">
                      <span dir="ltr" className="text-ink">{r.kind}</span>
                      <Badge tone="warning">{ar(r.n)}</Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}

          <section aria-labelledby="errors">
            <h2 id="errors" className="mb-3 text-section text-ink">
              آخر الأخطاء
            </h2>
            {ai.recentErrors.length === 0 ? (
              <EmptyData>لا أخطاء مسجّلة.</EmptyData>
            ) : (
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {ai.recentErrors.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-small">
                      <span className="text-ink">
                        {e.type === "GENERATE" ? "توليد" : "تدقيق"} · <span dir="ltr">{e.provider}/{e.model}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone="error">{e.code ?? e.status}</Badge>
                        <time dateTime={e.createdAt.toISOString()} className="text-caption text-faint">
                          {new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(e.createdAt)}
                        </time>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        {ai.latency.length ? (
          <section aria-labelledby="latency">
            <h2 id="latency" className="mb-3 text-section text-ink">
              زمن الاستجابة المقاس
            </h2>
            <Card padded={false}>
              <ul className="divide-y divide-line text-small">
                {ai.latency.map((l) => (
                  <li key={`${l.provider}:${l.type}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span dir="ltr" className="text-ink">
                      {l.provider} · {l.type}
                    </span>
                    <span className="text-muted tabular-nums">
                      {ar(l.count)} نداء · p50 {ar(l.p50 ?? 0)}ms · p95 {ar(l.p95 ?? 0)}ms
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="trial">
          <h2 id="trial" className="mb-3 text-section text-ink">
            توليد سؤال تجريبي
          </h2>
          <Card>
            <TrialGenerator concepts={ai.trialConcepts.map((c) => ({ id: c.id, title: c.title, lessonTitle: c.lessonTitle }))} configured={status.configured} />
          </Card>
          <p className="mt-2 text-caption text-muted">
            للتتبع الكامل لأسئلة الطلاب افتح <Link href="/admin/logs" className="underline">سجل الأسئلة والتتبّع</Link>.
          </p>
        </section>
      </div>
    </>
  );
}
