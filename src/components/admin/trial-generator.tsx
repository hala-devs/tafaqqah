"use client";

import { useActionState } from "react";
import { FlaskConical } from "lucide-react";
import { generateTrialQuestionAction, type TrialActionState } from "@/app/(admin)/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormAlert, SelectField } from "@/components/ui/field";
import { ar } from "@/lib/format";

type ConceptOption = { id: string; title: string; lessonTitle: string };

const STATUS_LABEL = {
  VALID: { tone: "success", text: "قبِل المدقق السؤال" },
  REJECTED: { tone: "error", text: "رفض المدقق السؤال" },
  INSUFFICIENT_SOURCE: { tone: "gold", text: "INSUFFICIENT_SOURCE — المصدر لا يكفي لسؤال آمن" },
  MALFORMED: { tone: "warning", text: "مخرجات النموذج غير صالحة" },
  PROVIDER_ERROR: { tone: "error", text: "خطأ في المزوّد" },
} as const;

/** Admin-only dry run. The result is shown here and never stored as a question or counted in any student's mastery. */
export function TrialGenerator({ concepts, configured }: { concepts: ConceptOption[]; configured: boolean }) {
  const [state, action, pending] = useActionState<TrialActionState, FormData>(generateTrialQuestionAction, {});
  const outcome = state.outcome;

  return (
    <div className="space-y-5" data-testid="trial-generator">
      <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div className="sm:col-span-2">
          <SelectField id="trial-concept" name="conceptId" label="المفهوم المعتمد" required disabled={concepts.length === 0}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.lessonTitle} — {c.title}
              </option>
            ))}
          </SelectField>
        </div>
        <SelectField id="trial-stage" name="stage" label="المرحلة" defaultValue="VERIFICATION">
          <option value="VERIFICATION">سؤال تحقق</option>
          <option value="SECOND_VERIFICATION">تحقق ثانٍ</option>
          <option value="REASSESSMENT">إعادة اختبار</option>
        </SelectField>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" loading={pending} disabled={!configured || concepts.length === 0} icon={<FlaskConical className="size-4" aria-hidden />}>
            توليد سؤال تجريبي
          </Button>
          {!configured ? <span className="ms-3 text-caption text-warning-ink">مزوّد الذكاء الاصطناعي غير مهيّأ.</span> : null}
          {concepts.length === 0 ? <span className="ms-3 text-caption text-warning-ink">لا مفاهيم معتمدة بعد؛ اعتمد نص مفهوم أولًا.</span> : null}
        </div>
      </form>
      <p className="text-caption text-muted">يستخدم النص المعتمد وحده، ويمر السؤال بالمولّد ثم المدقق. لا يُحفظ كسؤال، ولا يؤثر على إتقان أي طالب.</p>

      {state.error ? <FormAlert>{state.error}</FormAlert> : null}

      {outcome ? (
        <Card tone="muted" aria-live="polite" data-testid="trial-result">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_LABEL[outcome.status].tone}>{STATUS_LABEL[outcome.status].text}</Badge>
            <Badge tone="neutral">
              <span dir="ltr">{outcome.meta.provider}</span>
            </Badge>
            {outcome.meta.isDevelopmentMock ? <Badge tone="gold">مولّد تجريبي</Badge> : null}
            <span className="text-caption text-muted" dir="ltr">
              {outcome.meta.generatorModel}
              {outcome.meta.validatorModel !== outcome.meta.generatorModel ? ` / ${outcome.meta.validatorModel}` : ""}
            </span>
          </div>

          {"reason" in outcome ? <p className="mt-3 text-small text-muted">{outcome.reason}</p> : null}

          {"candidate" in outcome ? (
            <div className="mt-4 space-y-3">
              <p className="text-body font-medium text-ink">{outcome.candidate.question}</p>
              <ol className="space-y-1 text-small">
                {outcome.candidate.options.map((option, i) => {
                  const correct = option.trim() === outcome.candidate.correctAnswer.trim();
                  return (
                    <li key={i} className={correct ? "font-medium text-success-ink" : "text-muted"}>
                      {correct ? "✓ " : `${ar(i + 1)}. `}
                      {option}
                    </li>
                  );
                })}
              </ol>
              <p className="text-small text-muted">
                <span className="font-medium text-ink">التوضيح: </span>
                {outcome.candidate.explanation}
              </p>
              <div className="rounded-lg border border-line bg-surface p-3 text-small" data-testid="trial-validation">
                <p className="font-medium text-ink">نتيجة المدقق</p>
                <p className="mt-1 text-muted">
                  {outcome.validation.valid ? "اجتاز الفحوص الآلية والمراجعة الدلالية." : `رُفض: ${outcome.validation.issues.join("، ") || "—"}`}
                </p>
                {outcome.validation.notes ? <p className="mt-1 text-caption text-muted">{outcome.validation.notes}</p> : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-lg border border-line bg-surface p-3" data-testid="trial-source">
            <p className="text-caption font-medium text-gold-ink">
              الدليل المقتبس من المصدر المعتمد (المفهوم: {outcome.passage.conceptTitle} · الإصدار {ar(outcome.passage.version)})
            </p>
            <p className="mt-2 font-naskh text-card leading-9 text-ink-dark">{"candidate" in outcome ? outcome.candidate.answerEvidence : outcome.passage.text}</p>
            <p className="mt-2 text-caption text-muted">
              {outcome.passage.sourceTitle} — {outcome.passage.sourceAuthor} · {outcome.passage.sourceReference}
            </p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
