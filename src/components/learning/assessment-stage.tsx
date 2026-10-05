import { ClipboardCheck, ScrollText } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ar, formatDate } from "@/lib/format";
import { StartAssessmentButton } from "./start-assessment-button";

type Props = {
  lessonId: string;
  activeSession: { id: string; mode: "ADAPTIVE" | "FIXED"; _count: { answers: number } } | null;
  lastCompleted: { id: string; completedAt: Date | null } | null;
  fixedQuestionCount: number;
};

/** The "مرحلة قياس الفهم" card shown once a lesson has been studied. */
export function AssessmentStage({ lessonId, activeSession, lastCompleted, fixedQuestionCount }: Props) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink p-6 text-surface shadow-lift sm:p-8">
      <div aria-hidden className="bg-geometric pointer-events-none absolute inset-0 opacity-50 invert" />
      <div className="relative">
        <p className="inline-flex items-center gap-2 text-caption font-medium text-surface/70">
          <ClipboardCheck className="size-4" aria-hidden />
          مرحلة قياس الفهم
        </p>

        {activeSession ? (
          <>
            <h2 className="mt-3 text-section font-semibold">لديك اختبار لم يكتمل</h2>
            <p className="mt-1 text-small text-surface/75">
              أجبت عن {ar(activeSession._count.answers)} من الأسئلة. تابع من حيث توقفت.
            </p>
            <div className="mt-6">
              <ButtonLink href={`/lessons/${lessonId}/assessment`} variant="secondary" size="lg">
                تابع الاختبار
              </ButtonLink>
            </div>
          </>
        ) : lastCompleted ? (
          <>
            <h2 className="mt-3 text-section font-semibold">أكملت اختبار هذا الدرس</h2>
            {lastCompleted.completedAt ? (
              <p className="mt-1 text-small text-surface/75">آخر محاولة: {formatDate(lastCompleted.completedAt)}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ButtonLink
                href={`/lessons/${lessonId}/result?session=${lastCompleted.id}`}
                variant="secondary"
                size="lg"
                icon={<ScrollText className="size-4" aria-hidden />}
              >
                عرض النتيجة
              </ButtonLink>
              <StartAssessmentButton lessonId={lessonId} label="أعد الاختبار" variant="sage" />
            </div>
          </>
        ) : (
          <>
            <h2 className="mt-3 text-title font-semibold">ابدأ اختبار فهمك</h2>
            <p className="mt-2 max-w-md text-small leading-7 text-surface/75">
              {`${ar(fixedQuestionCount)} أسئلة قصيرة عن هذا الدرس. وإذا أخطأت في فكرة نتأكد منها بسؤال قصير آخر.`}
            </p>
            <div className="mt-6">
              <StartAssessmentButton lessonId={lessonId} label="ابدأ اختبار فهمك" variant="secondary" />
            </div>
          </>
        )}

        <p className="mt-6 border-t border-surface/15 pt-4 text-caption text-surface/65">
          تُراجَع الأسئلة قبل عرضها عليك لتبقى ضمن مادة الدرس.
        </p>
      </div>
    </div>
  );
}
