import { ClipboardList } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { assessmentHref } from "@/lib/routes";
import { StartAssessmentButton } from "./start-assessment-button";

const COPY = {
  PRE_TEST: {
    eyebrow: "قبل أن تبدأ",
    title: "اختبار قبلي قصير",
    body: "هذا الدرس ضمن قياس أثر التعلّم في تفقّه. أجب عن أسئلة قصيرة قبل قراءة الدرس؛ لا تؤثر نتيجتها في مستوى إتقانك، وتُقارن لاحقًا بالاختبار البعدي.",
    cta: "ابدأ الاختبار القبلي",
  },
  POST_TEST: {
    eyebrow: "خطوة أخيرة",
    title: "الاختبار البعدي",
    body: "الأسئلة نفسها التي أجبت عنها قبل الدرس، لقياس ما تغيّر بعد الدراسة والمراجعة. لا تؤثر نتيجتها في مستوى إتقانك.",
    cta: "ابدأ الاختبار البعدي",
  },
} as const;

/** Pre/post measurement entry point (lessons with measurementEnabled only). */
export function MeasurementCard({
  lessonId,
  kind,
  activeSessionId,
}: {
  lessonId: string;
  kind: "PRE_TEST" | "POST_TEST";
  activeSessionId: string | null;
}) {
  const copy = COPY[kind];
  return (
    <div className="rounded-2xl border border-gold/35 bg-surface p-6 sm:p-8">
      <p className="inline-flex items-center gap-2 text-caption font-medium text-gold-ink">
        <ClipboardList className="size-4" aria-hidden />
        {copy.eyebrow}
      </p>
      <h2 className="mt-2 text-section font-semibold text-ink">{copy.title}</h2>
      <p className="mt-2 max-w-xl text-small leading-7 text-muted">{copy.body}</p>
      <div className="mt-5">
        {activeSessionId ? (
          <ButtonLink href={assessmentHref(lessonId, activeSessionId)}>تابع الاختبار</ButtonLink>
        ) : (
          <StartAssessmentButton lessonId={lessonId} label={copy.cta} kind={kind} />
        )}
      </div>
    </div>
  );
}
