import type { Metadata } from "next";
import { AiSubNav } from "@/components/admin/ai-subnav";
import { PageHeader } from "@/components/admin/page-header";
import { requireAdminPage } from "@/server/auth/current-user";
import Link from "next/link";
import { prisma } from "@/server/db";
import { questionVerdict } from "@/server/admin/trace";
import { DisplayedChip, VerdictChip } from "@/components/admin/verdict-chip";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "تتبّع الذكاء الاصطناعي" };

const FILTERS = [
  { value: "all", label: "الكل" },
  { value: "VALID", label: "مقبولة" },
  { value: "REJECTED", label: "مرفوضة" },
] as const;

function when(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

export default async function AdminLogsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdminPage();
  const { status } = await searchParams;
  const filter = status === "VALID" || status === "REJECTED" ? status : undefined;
  const [questions, failedAttempts, statusCounts, requests] = await Promise.all([
    prisma.generatedQuestion.findMany({
      where: { origin: "AI_GENERATED", ...(filter ? { validationStatus: filter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: {
        concept: { select: { title: true } },
        sourcePassage: { select: { sourceTitle: true, sourceReference: true } },
        answer: { select: { id: true } },
      },
    }),
    prisma.aIInteractionLog.findMany({
      where: { type: "GENERATE", status: { in: ["MALFORMED_OUTPUT", "INSUFFICIENT_SOURCE", "PROVIDER_ERROR"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.aIInteractionLog.groupBy({ by: ["type", "status"], where: { type: { not: "GENERATION_REQUEST" } }, _count: { _all: true } }),
    prisma.aIInteractionLog.findMany({ where: { type: "GENERATION_REQUEST" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="الاختبارات والذكاء الاصطناعي" description="سجل الأسئلة والتتبّع: من الدرس والمفهوم والمقطع المصدري إلى المولّد والمدقق." />
        <AiSubNav />
      </div>
      <p className="max-w-3xl text-small text-muted">
        كل محاولة توليد تمرّ بالفحوص الحتمية ثم بالمدقق المستقل. لا يصل إلى المتعلم إلا ما اجتاز المرحلتين. لا تُخزَّن سلاسل تفكير النموذج؛ تُعرض
        نتائج الفحص وأسبابه فقط.
      </p>

      <div className="flex flex-wrap gap-2 text-caption">
        {statusCounts.map((row) => (
          <Badge key={`${row.type}-${row.status}`} tone={row.status === "SUCCESS" ? "success" : row.status === "REJECTED" ? "warning" : "neutral"}>
            {row.type === "GENERATE" ? "توليد" : "تدقيق"} · {row.status} · {ar(row._count._all)}
          </Badge>
        ))}
      </div>

      <nav aria-label="تصفية" className="flex gap-2">
        {FILTERS.map((f) => {
          const active = (filter ?? "all") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/admin/logs" : `/admin/logs?status=${f.value}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-small",
                active ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface text-text hover:border-ink/40",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {questions.length === 0 ? (
        <EmptyState title="لا توجد أسئلة مولّدة بعد" description="تظهر هنا كل محاولة توليد — المقبولة والمرفوضة — مع أسباب الرفض." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[60rem] text-small">
            <thead className="bg-surface-2/70 text-caption text-muted">
              <tr>
                <th className="px-3 py-3 text-start font-medium">#</th>
                <th className="px-3 py-3 text-start font-medium">السؤال · المفهوم · المصدر</th>
                <th className="px-3 py-3 text-start font-medium" dir="ltr">Generator</th>
                <th className="px-3 py-3 text-start font-medium" dir="ltr">Deterministic</th>
                <th className="px-3 py-3 text-start font-medium" dir="ltr">Validator</th>
                <th className="px-3 py-3 text-start font-medium" dir="ltr">Displayed</th>
                <th className="px-3 py-3 text-start font-medium">المحاولة</th>
                <th className="px-3 py-3 text-start font-medium">الوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {questions.map((q) => {
                const v = questionVerdict(q);
                const reasons = [...v.deterministicIssues, ...v.validatorIssues];
                return (
                  <tr key={q.id} className="align-top" data-testid="trace-row">
                    <td className="px-3 py-3 font-mono text-muted">
                      <Link href={`/admin/questions/${q.id}`} className="hover:underline">
                        #{q.number}
                      </Link>
                    </td>
                    <td className="max-w-sm px-3 py-3">
                      <Link href={`/admin/questions/${q.id}`} className="line-clamp-2 text-ink hover:underline">
                        {q.question}
                      </Link>
                      <span className="block text-caption text-faint">
                        <Badge tone="sage" className="me-1.5 font-mono">
                          {q.stage}
                        </Badge>
                        {q.concept.title} · {q.sourcePassage.sourceTitle} ({q.sourcePassage.sourceReference}) · v{q.sourceVersion}
                      </span>
                      <details className="mt-1 text-caption text-muted">
                        <summary className="cursor-pointer text-ink">التفاصيل والدليل</summary>
                        <dl className="mt-2 space-y-1.5">
                          <div>
                            <dt className="inline font-medium text-ink">الإجابة الصحيحة: </dt>
                            <dd className="inline">{q.correctAnswer}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-ink">التوضيح: </dt>
                            <dd className="inline">{q.explanation || "—"}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-ink">دليل الإجابة: </dt>
                            <dd className="inline font-naskh">{q.answerEvidence || "—"}</dd>
                          </div>
                          <div>
                            <dt className="inline font-medium text-ink">دليل التوضيح: </dt>
                            <dd className="inline font-naskh">{q.explanationEvidence || "—"}</dd>
                          </div>
                          <div dir="ltr" className="font-mono">
                            {q.model ?? "—"} · {q.promptVersion ?? "—"} · retries {q.retryCount} · {q.validationStatus === "VALID" ? "PASS" : "REJECT"}
                          </div>
                        </dl>
                      </details>
                      {reasons.length ? (
                        <span className="mt-1 block font-mono text-caption text-error-ink" dir="ltr">
                          {reasons.join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <VerdictChip verdict={v.generator} />
                    </td>
                    <td className="px-3 py-3">
                      <VerdictChip verdict={v.deterministic} />
                    </td>
                    <td className="px-3 py-3">
                      <VerdictChip verdict={v.validator} />
                    </td>
                    <td className="px-3 py-3">
                      <DisplayedChip displayed={v.displayed} />
                    </td>
                    <td className="px-3 py-3 tabular-nums text-muted">{ar(v.attempt)}</td>
                    <td className="px-3 py-3 font-mono text-caption text-muted" dir="ltr">
                      {when(q.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="requests" className="space-y-3">
        <h2 id="requests" className="text-card font-semibold text-ink">
          طلبات التوليد (كل طلب وصل إلى الخادم)
        </h2>
        <p className="text-small text-muted">يُنشأ السجل لحظة وصول الطلب ثم يُحدَّث بنتيجته. «STARTED» بلا تحديث يعني طلبًا ما زال يعمل أو انقطع.</p>
        {requests.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-small" data-testid="generation-requests">
            {requests.map((log) => {
              const meta = (log.metadata ?? {}) as { stage?: string; errorCode?: string | null; elapsedMs?: number };
              return (
                <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={log.status === "SUCCESS" ? "success" : log.status === "STARTED" ? "neutral" : "warning"} className="font-mono">
                      {log.status}
                    </Badge>
                    {meta.stage ? <span className="font-mono text-caption text-muted">{meta.stage}</span> : null}
                    {meta.errorCode ? <span className="font-mono text-caption text-muted">{meta.errorCode}</span> : null}
                    {log.questionId ? (
                      <Link href={`/admin/questions/${log.questionId}`} className="text-caption text-ink underline">
                        السؤال
                      </Link>
                    ) : null}
                  </span>
                  <span className="font-mono text-caption text-muted" dir="ltr">
                    {log.id.slice(-8)} · {typeof meta.elapsedMs === "number" ? `${Math.round(meta.elapsedMs / 1000)}s · ` : ""}
                    {when(log.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-small text-muted">لا توجد.</p>
        )}
      </section>

      <section aria-labelledby="no-question" className="space-y-3">
        <h2 id="no-question" className="text-card font-semibold text-ink">
          محاولات توليد لم تُنتج سؤالًا
        </h2>
        {failedAttempts.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-small">
            {failedAttempts.map((log) => (
              <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning" className="font-mono">
                    {log.status}
                  </Badge>
                  <span className="text-muted">لم يُعرض شيء على المتعلم</span>
                </span>
                <span className="font-mono text-caption text-muted" dir="ltr">
                  {log.provider}/{log.model} · {log.promptVersion} · {when(log.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">لا توجد.</p>
        )}
      </section>
    </div>
  );
}
