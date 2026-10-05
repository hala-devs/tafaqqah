"use client";

import { useActionState } from "react";
import { BookOpenCheck } from "lucide-react";
import { markStudiedAction, type StudyState } from "@/app/(shell)/lessons/[id]/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";

export function StudyCompletion({ lessonId }: { lessonId: string }) {
  const [state, action, pending] = useActionState(markStudiedAction.bind(null, lessonId), {} as StudyState);

  return (
    <form action={action} className="rounded-xl border border-line bg-surface p-6 text-center sm:p-8">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-sage-soft text-sage-dark">
        <BookOpenCheck className="size-5" aria-hidden />
      </div>
      <h2 className="mt-4 text-section text-ink">هل أتممت مشاهدة الدرس؟</h2>
      <p className="mx-auto mt-1 max-w-md text-small text-muted">
        بعد تسجيل إتمام المشاهدة يُفتح لك اختبار الفهم المبني على المادة العلمية المعتمدة.
      </p>
      {state.error ? (
        <div className="mx-auto mt-4 max-w-md text-start">
          <FormAlert>{state.error}</FormAlert>
        </div>
      ) : null}
      <Button type="submit" size="lg" variant="sage" className="mt-6" loading={pending}>
        ابدأ اختبار فهمك
      </Button>
    </form>
  );
}
