"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitFeedbackAction, type FeedbackState } from "@/app/(shell)/lessons/[id]/result/actions";
import { Button } from "@/components/ui/button";
import { FormAlert, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

const LABELS = ["غير مفيد", "قليل الفائدة", "مقبول", "مفيد", "مفيد جدًا"];

export function FeedbackForm({ sessionId, existing }: { sessionId: string; existing: { rating: number } | null }) {
  const [state, action, pending] = useActionState(submitFeedbackAction.bind(null, sessionId), {} as FeedbackState);
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);

  if (state.ok || existing) {
    return (
      <p className="inline-flex items-center gap-2 text-small text-success-ink" role="status">
        <CheckCircle2 className="size-4" aria-hidden />
        شكرًا لك، وصلنا رأيك في هذا الاختبار.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="text-small font-medium text-ink">كيف وجدت هذا الاختبار في قياس فهمك؟</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {LABELS.map((label, i) => {
            const value = i + 1;
            const checked = rating === value;
            return (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-full border px-3.5 py-1.5 text-small transition-colors duration-150 has-[:focus-visible]:shadow-[var(--shadow-focus)]",
                  checked ? "border-ink bg-ink text-surface" : "border-line-strong bg-surface text-text hover:border-ink/40",
                )}
              >
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  checked={checked}
                  onChange={() => setRating(value)}
                  className="sr-only"
                />
                <span className="tabular-nums">{ar(value)}</span> · {label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <TextArea id="feedback-comment" name="comment" label="ملاحظة (اختياري)" rows={2} maxLength={1000} />
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <Button type="submit" variant="secondary" size="sm" disabled={rating === null} loading={pending}>
        إرسال الرأي
      </Button>
    </form>
  );
}
