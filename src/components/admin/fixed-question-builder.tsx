"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createFixedQuestionAction, type AdminActionState } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { FormAlert, SelectField, TextArea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

type Passage = { id: string; conceptId: string; conceptTitle: string; text: string };
type Concept = { id: string; title: string };
type FieldErrors = Partial<Record<"sourcePassageId" | "conceptId" | "question" | "options" | "correctIndex" | "explanation", string>>;

const optionLetters = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
const initialState: AdminActionState = {};

export function FixedQuestionBuilder({ passages, concepts }: { passages: Passage[]; concepts: Concept[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<"MCQ" | "TRUE_FALSE">("MCQ");
  const [conceptId, setConceptId] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, action, pending] = useActionState(createFixedQuestionAction, initialState);

  useEffect(() => {
    if (state.ok) {
      toast(state.message ?? "أُضيف السؤال الثابت.", "success");
      formRef.current?.reset();
      const resetTimer = window.setTimeout(() => {
        setType("MCQ");
        setConceptId("");
        setOptions(["", ""]);
        setCorrectIndex(null);
        setErrors({});
      });
      return () => window.clearTimeout(resetTimer);
    }
  }, [state, toast]);

  function changeType(next: "MCQ" | "TRUE_FALSE") {
    setType(next);
    setCorrectIndex(null);
    setErrors((current) => ({ ...current, options: undefined, correctIndex: undefined }));
  }

  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? value : option)));
    setErrors((current) => ({ ...current, options: undefined }));
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
    setCorrectIndex((current) => (current === index ? null : current !== null && current > index ? current - 1 : current));
    setErrors((current) => ({ ...current, options: undefined, correctIndex: current.correctIndex }));
  }

  function validate(formData: FormData): FieldErrors {
    const next: FieldErrors = {};
    if (!String(formData.get("sourcePassageId") ?? "")) next.sourcePassageId = "اختر المقطع المصدري.";
    if (!String(formData.get("conceptId") ?? "")) next.conceptId = "اختر المفهوم.";
    if (!String(formData.get("question") ?? "").trim()) next.question = "اكتب نص السؤال.";
    if (!String(formData.get("explanation") ?? "").trim()) next.explanation = "اكتب توضيحًا مختصرًا للإجابة.";
    if (type === "MCQ") {
      if (options.length < 2) next.options = "أضف خيارين على الأقل.";
      else if (options.some((option) => !option.trim())) next.options = "أكمل نص كل خيار قبل الحفظ.";
    }
    if (correctIndex === null) next.correctIndex = "حدد الإجابة الصحيحة.";
    return next;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const next = validate(new FormData(event.currentTarget));
    setErrors(next);
    if (Object.keys(next).length) event.preventDefault();
  }

  const answerOptions = type === "TRUE_FALSE" ? ["صح", "خطأ"] : options;

  return (
    <section aria-labelledby="fixed-question-builder-title" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" data-testid="fixed-question-builder">
      <div className="border-b border-line bg-surface-2/55 px-5 py-5 sm:px-7">
        <h3 id="fixed-question-builder-title" className="text-section font-semibold text-ink">إنشاء سؤال ثابت</h3>
        <p className="mt-1 text-small text-muted">أضف سؤالًا معتمدًا مرتبطًا بالمقطع والمفهوم.</p>
      </div>

      <form ref={formRef} action={action} onSubmit={onSubmit} className="space-y-7 p-5 sm:p-7">
        <BuilderSection number="١" title="الارتباط بالمحتوى">
          <div className="grid gap-4">
            <SelectField id="fq-passage" name="sourcePassageId" label="المقطع المصدري" error={errors.sourcePassageId} onChange={(event) => { const passage = passages.find((item) => item.id === event.target.value); if (passage) setConceptId(passage.conceptId); setErrors((current) => ({ ...current, sourcePassageId: undefined, conceptId: undefined })); }} required>
              <option value="">اختر المقطع…</option>
              {passages.map((passage) => <option key={passage.id} value={passage.id}>{passage.conceptTitle} — {passage.text.slice(0, 60)}…</option>)}
            </SelectField>
            <SelectField id="fq-concept" name="conceptId" label="المفهوم" value={conceptId} onChange={(event) => { setConceptId(event.target.value); setErrors((current) => ({ ...current, conceptId: undefined })); }} error={errors.conceptId} hint="يُحدّد تلقائيًا حسب المقطع، ويمكن مراجعته." required>
              <option value="">اختر المفهوم…</option>
              {concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
            </SelectField>
          </div>
        </BuilderSection>

        <BuilderSection number="٢" title="إعداد السؤال">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField id="fq-type" name="questionType" label="نوع السؤال" value={type} onChange={(event) => changeType(event.target.value as "MCQ" | "TRUE_FALSE")}>
              <option value="MCQ">اختيار من متعدد</option>
              <option value="TRUE_FALSE">صح / خطأ</option>
            </SelectField>
            <SelectField id="fq-diff" name="difficulty" label="مستوى الصعوبة" defaultValue="2">
              <option value="1">تأسيسي</option><option value="2">متوسط</option><option value="3">تطبيقي</option>
            </SelectField>
          </div>
        </BuilderSection>

        <BuilderSection number="٣" title="السؤال">
          <TextArea id="fq-q" name="question" label="نص السؤال" placeholder="اكتب نص السؤال…" rows={3} error={errors.question} onChange={() => setErrors((current) => ({ ...current, question: undefined }))} required />
        </BuilderSection>

        <BuilderSection number="٤" title={type === "MCQ" ? "خيارات الإجابة" : "الإجابة الصحيحة"} description={type === "MCQ" ? "أضف الخيارات وحدد الدائرة بجانب الإجابة الصحيحة." : "اختر الإجابة الصحيحة."}>
          <input type="hidden" name="options" value={type === "MCQ" ? JSON.stringify(options) : "[]"} />
          <input type="hidden" name="correctIndex" value={correctIndex ?? ""} />
          <div className="space-y-3" role="radiogroup" aria-describedby={errors.correctIndex ? "fq-correct-error" : undefined}>
            {answerOptions.map((option, index) => {
              const selected = correctIndex === index;
              return (
                <label key={type === "MCQ" ? index : option} className={cn("flex min-h-14 items-center gap-3 rounded-xl border p-2.5 transition-colors", selected ? "border-sage/60 bg-sage-soft/70" : "border-line bg-white hover:border-line-strong")}>
                  <input type="radio" name="correct-choice" value={index} checked={selected} onChange={() => { setCorrectIndex(index); setErrors((current) => ({ ...current, correctIndex: undefined })); }} className="size-4 shrink-0 accent-sage-dark" aria-label={type === "MCQ" ? `تحديد الخيار ${optionLetters[index]} إجابة صحيحة` : `تحديد ${option} إجابة صحيحة`} />
                  {type === "MCQ" ? <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-small font-semibold text-ink">{optionLetters[index]}</span> : null}
                  {type === "MCQ" ? <input value={option} onChange={(event) => updateOption(index, event.target.value)} aria-label={`نص الخيار ${optionLetters[index]}`} placeholder={`اكتب الخيار ${index === 0 ? "الأول" : index === 1 ? "الثاني" : `${optionLetters[index]}`}…`} className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-faint" /> : <span className="text-body font-medium text-ink">{option}</span>}
                  {type === "MCQ" && options.length > 2 ? <button type="button" onClick={() => removeOption(index)} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-error-soft hover:text-error-ink focus:outline-none focus:ring-2 focus:ring-ink/30" aria-label={`حذف الخيار ${optionLetters[index]}`}><Trash2 className="size-4" aria-hidden /></button> : null}
                </label>
              );
            })}
          </div>
          {errors.options ? <p className="mt-2 text-caption text-error-ink" role="alert">{errors.options}</p> : null}
          {errors.correctIndex ? <p id="fq-correct-error" className="mt-2 text-caption text-error-ink" role="alert">{errors.correctIndex}</p> : null}
          {type === "MCQ" ? <Button type="button" variant="secondary" size="sm" onClick={() => setOptions((current) => current.length < 8 ? [...current, ""] : current)} disabled={options.length >= 8} className="mt-4" icon={<Plus className="size-4" aria-hidden />}>إضافة خيار</Button> : null}
        </BuilderSection>

        <BuilderSection number="٥" title="توضيح الإجابة" description="اكتب توضيحًا مختصرًا مستندًا إلى المحتوى المعتمد.">
          <TextArea id="fq-exp" name="explanation" label="التوضيح" rows={3} error={errors.explanation} onChange={() => setErrors((current) => ({ ...current, explanation: undefined }))} required />
        </BuilderSection>

        {state.error ? <FormAlert>{state.error}</FormAlert> : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button type="submit" size="md" loading={pending}>إضافة السؤال</Button>
          <Button type="reset" variant="secondary" size="md" disabled={pending} onClick={() => { setType("MCQ"); setConceptId(""); setOptions(["", ""]); setCorrectIndex(null); setErrors({}); }}>إلغاء</Button>
        </div>
      </form>
    </section>
  );
}

function BuilderSection({ number, title, description, children }: { number: string; title: string; description?: string; children: React.ReactNode }) {
  return <section className="border-s-2 border-sage/35 ps-4 sm:ps-5"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-sage-soft text-caption font-semibold text-sage-dark">{number}</span><h4 className="text-card font-semibold text-ink">{title}</h4></div>{description ? <p className="mt-1 text-caption text-muted">{description}</p> : null}<div className="mt-4">{children}</div></section>;
}
