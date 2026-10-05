import type { Metadata } from "next";
import { requireAdminPage } from "@/server/auth/current-user";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { questionVerdict } from "@/server/admin/trace";
import { DisplayedChip, VerdictChip } from "@/components/admin/verdict-chip";

export const metadata: Metadata = { title: "تتبّع سؤال" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="min-w-0 text-small text-ink">{children}</dd>
    </div>
  );
}

/** Full audit trail of one question: lesson → concept → exact passage version → prompts → models → verdict. */
export default async function QuestionTracePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const q = await prisma.generatedQuestion.findUnique({
    where: { id },
    include: {
      lesson: true,
      concept: true,
      sourcePassage: true,
      answer: true,
      session: { select: { id: true, userId: true, purpose: true } },
      previousQuestion: { select: { id: true, number: true, question: true, stage: true } },
    },
  });
  if (!q) notFound();
  const validatorResult = (q.validatorResult ?? null) as {
    verdict?: string;
    modelChecks?: Record<string, boolean> | null;
    reasons?: string[];
  } | null;
  const meta = (q.generatorMetadata ?? {}) as Record<string, unknown>;
  const verdict = questionVerdict(q);
  const traceId = typeof meta.traceId === "string" ? meta.traceId : null;
  const logs = await prisma.aIInteractionLog.findMany({
    where: traceId ? { metadata: { path: ["traceId"], equals: traceId } } : { questionId: q.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-8">
      <nav aria-label="مسار التنقل" className="flex items-center gap-1 text-caption text-muted">
        <Link href="/admin/logs" className="hover:text-ink">
          سجل الأسئلة
        </Link>
        <ChevronLeft className="size-3.5" aria-hidden />
        <span dir="ltr">#{q.number}</span>
      </nav>

      <Card aria-label="ملخص التحقق" data-testid="trace-summary">
        <p className="font-mono text-card font-semibold text-ink" dir="ltr">
          Question #{q.number}
        </p>
        <dl className="mt-4 grid gap-3 text-small sm:grid-cols-2" dir="ltr">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Source</dt>
            <dd className="truncate text-muted">
              {q.sourcePassage.sourceTitle} · {q.sourcePassage.sourceReference} · v{q.sourceVersion}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Generator</dt>
            <dd><VerdictChip verdict={verdict.generator} /></dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Deterministic checks</dt>
            <dd><VerdictChip verdict={verdict.deterministic} /></dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Validator</dt>
            <dd><VerdictChip verdict={verdict.validator} /></dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Displayed to learner</dt>
            <dd><DisplayedChip displayed={verdict.displayed} /></dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2">
            <dt>Attempt / retries</dt>
            <dd className="tabular-nums text-muted">{verdict.attempt} / {verdict.retries}</dd>
          </div>
        </dl>
        {verdict.deterministicIssues.length || verdict.validatorIssues.length ? (
          <p className="mt-3 font-mono text-caption text-error-ink" dir="ltr">
            Reason: {[...verdict.deterministicIssues, ...verdict.validatorIssues].join(", ")}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          <Badge tone={q.validationStatus === "VALID" ? "success" : "warning"}>{q.validationStatus}</Badge>
          <Badge tone="neutral">{q.questionType}</Badge>
          <Badge tone="neutral">difficulty {q.difficulty}</Badge>
          <Badge tone="neutral">{q.origin}</Badge>
          <Badge tone="sage">{q.stage}</Badge>
          {q.model ? (
            <Badge tone="ink">
              <span dir="ltr">{q.model}</span>
            </Badge>
          ) : null}
        </div>
        <p className="mt-4 text-section text-ink">{q.question}</p>
        <ol className="mt-3 space-y-1 text-small">
          {q.options.map((o, i) => (
            <li key={i} className={i === q.correctIndex ? "font-medium text-success-ink" : "text-muted"}>
              {i === q.correctIndex ? "✓ " : "· "}
              {o}
            </li>
          ))}
        </ol>
        <dl className="mt-5 divide-y divide-line border-t border-line">
          <Row label="التوضيح">{q.explanation}</Row>
          <Row label="الإجابة الصحيحة">{q.correctAnswer}</Row>
          <Row label="دليل الإجابة (answerEvidence)">
            {q.answerEvidence ? <span className="font-naskh text-card leading-9">{q.answerEvidence}</span> : "—"}
          </Row>
          <Row label="دليل التوضيح (explanationEvidence)">
            {q.explanationEvidence ? <span className="font-naskh text-card leading-9">{q.explanationEvidence}</span> : "—"}
          </Row>
          <Row label="نتيجة المدقق">
            <span dir="ltr" className="font-mono text-caption">
              {validatorResult?.verdict ?? (q.origin === "FIXED_BANK" ? "—" : q.validationStatus === "VALID" ? "PASS" : "REJECT")}
              {validatorResult?.modelChecks
                ? ` · ${Object.entries(validatorResult.modelChecks)
                    .map(([name, ok]) => `${name}:${ok ? "ok" : "FAIL"}`)
                    .join(" ")}`
                : ""}
            </span>
            {validatorResult?.reasons?.length ? (
              <span className="mt-1 block text-caption text-muted" dir="ltr">
                {validatorResult.reasons.join(" · ")}
              </span>
            ) : null}
          </Row>
          <Row label="المرحلة / السؤال السابق">
            <span dir="ltr" className="font-mono text-caption">
              {q.stage}
            </span>
            {q.previousQuestion ? (
              <>
                {" · "}
                <Link href={`/admin/questions/${q.previousQuestion.id}`} className="underline">
                  #{q.previousQuestion.number} ({q.previousQuestion.stage})
                </Link>
                <span className="mt-1 block text-muted">{q.previousQuestion.question}</span>
              </>
            ) : null}
          </Row>
          <Row label="إجابة المتعلم السابقة (سياق فقط)">{q.studentPreviousAnswer ?? "—"}</Row>
          <Row label="النموذج / نسخة التعليمات / الإعادات">
            <span dir="ltr" className="font-mono text-caption">
              {q.model ?? "—"} / {q.promptVersion ?? "—"} / retries {q.retryCount}
            </span>
          </Row>
          <Row label="الجلسة / المتعلم">
            <span dir="ltr" className="font-mono text-caption">
              {q.session.id} / {q.session.userId}
            </span>
          </Row>
          <Row label="أسباب الرفض">
            <span dir="ltr" className="font-mono text-caption">
              {q.validationIssues.join(", ") || "—"}
            </span>
          </Row>
          <Row label="إجابة المتعلم">{q.answer ? `${q.answer.selectedAnswer} (${q.answer.correct ? "صحيحة" : "خاطئة"})` : "—"}</Row>
          <Row label="أُنشئ">{formatDate(q.createdAt)}</Row>
        </dl>
      </Card>

      <Card>
        <h2 className="text-card font-semibold text-ink">التتبّع</h2>
        <dl className="mt-3 divide-y divide-line">
          <Row label="الدرس">{q.lesson.title}</Row>
          <Row label="المفهوم">{q.concept.title}</Row>
          <Row label="المقطع المصدري">
            <span dir="ltr" className="font-mono text-caption">
              {q.sourcePassageId}
            </span>{" "}
            · الإصدار المستخدم v{q.sourceVersion} (الحالي v{q.sourcePassage.version}
            {q.sourcePassage.approved ? "، معتمد" : "، غير معتمد الآن"})
          </Row>
          <Row label="نص المقطع وقت التوليد">
            <span className="font-naskh text-card leading-9">{q.sourceSnapshot}</span>
          </Row>
        </dl>
      </Card>

      <Card>
        <h2 className="text-card font-semibold text-ink">بيانات المولّد والمدقق</h2>
        <pre dir="ltr" className="mt-3 max-h-96 overflow-auto rounded-lg bg-ink-dark p-4 text-caption leading-6 text-surface">
          {JSON.stringify(meta, null, 2)}
        </pre>
        {q.generatorRaw ? (
          <>
            <h3 className="mt-5 text-small font-semibold text-ink">مخرجات المولّد الخام (generatorRaw)</h3>
            <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-4 text-caption leading-6 text-text">
              {JSON.stringify(q.generatorRaw, null, 2)}
            </pre>
          </>
        ) : null}
        {q.validatorResult ? (
          <>
            <h3 className="mt-5 text-small font-semibold text-ink">حكم المدقق (validatorResult)</h3>
            <pre dir="ltr" className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-4 text-caption leading-6 text-text">
              {JSON.stringify(q.validatorResult, null, 2)}
            </pre>
          </>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-card font-semibold text-ink">استدعاءات الذكاء الاصطناعي ({logs.length})</h2>
        <ul className="mt-3 space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2 text-caption">
                <Badge tone="ink">{log.type}</Badge>
                <Badge tone={log.status === "SUCCESS" ? "success" : "warning"}>{log.status}</Badge>
                <span dir="ltr" className="text-muted">
                  {log.provider} / {log.model} / {log.promptVersion} / {log.latencyMs ?? "–"}ms
                </span>
              </div>
              <pre dir="ltr" className="mt-2 max-h-56 overflow-auto rounded bg-surface-2 p-3 text-caption leading-5 text-text">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
