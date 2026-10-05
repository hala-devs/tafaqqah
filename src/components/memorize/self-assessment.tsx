"use client";

import { useState } from "react";
import { Check, CircleHelp, ListChecks, ScanText, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { type SelfAssessment } from "@/server/memorization/config";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { changeAssessmentScope, changeAssessmentStatus, startWordAssessment, toggleAssessmentWord, type AssessmentDetail } from "@/lib/recitation-detail";

export function markingModeCopy(mode: "INCORRECT" | "FORGOTTEN") {
  return mode === "INCORRECT"
    ? { heading: "ما الذي أخطأت فيه؟", helper: "اضغط على الكلمات التي أخطأت فيها." }
    : { heading: "ما الذي لم تتذكره؟", helper: "اضغط على الكلمات التي لم تتذكرها." };
}

/**
 * The option's semantic content has one source of truth.  Selection controls
 * only the card presentation; it never changes the card's children.
 */
const ASSESSMENT_OPTIONS = [
  {
    status: "CORRECT",
    label: "صحيح",
    description: "استذكرته كما هو",
    Icon: Check,
    selectedClassName: "border-sage-dark bg-sage-soft text-sage-deep shadow-[inset_0_0_0_1px_var(--color-sage-dark)]",
  },
  {
    status: "INCORRECT",
    label: "أخطأت",
    description: "فيه خطأ أو نقص",
    Icon: X,
    selectedClassName: "border-warning bg-warning-soft text-warning-ink shadow-[inset_0_0_0_1px_var(--color-warning)]",
  },
  {
    status: "FORGOTTEN",
    label: "لم أتذكر",
    description: "لم يستحضره",
    Icon: CircleHelp,
    selectedClassName: "border-ink bg-ink-tint text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]",
  },
] as const satisfies readonly {
  status: SelfAssessment;
  label: string;
  description: string;
  Icon: typeof Check;
  selectedClassName: string;
}[];

type Props = {
  units: { id: string; order: number; text: string }[];
  answers: Record<string, AssessmentDetail | undefined>;
  onChange: (unitId: string, detail: AssessmentDetail) => void;
  onClear?: (unitId: string) => void;
  disabled?: boolean;
};

/**
 * One native radio group per unit (keyboard and screen-reader friendly). The state is shown with an icon AND a word,
 * never by colour alone. Nothing here is chosen by a machine: only the learner picks a status.
 */
export function SelfAssessmentList({ units, answers, onChange, onClear = () => {}, disabled }: Props) {
  const [markModes, setMarkModes] = useState<Record<string, "INCORRECT" | "FORGOTTEN">>({});
  return (
    <ol className="divide-y divide-line rounded-2xl border border-line bg-surface shadow-soft" aria-label="أسطر المقطع">
      {units.map((unit, index) => {
        const current = answers[unit.id];
        const selectingWords = current?.scope === "WORDS";
        const correcting = current?.status !== "CORRECT" && current?.scope !== null && current !== undefined;
        const markMode = markModes[unit.id] ?? "INCORRECT";
        const activeModeCopy = markingModeCopy(markMode);
        const tokens = tokenizeCanonicalMatn(unit.text);
        return (
          <li key={unit.id} data-testid="matn-unit" className={cn("p-4 transition-colors duration-200 sm:p-6", current && "bg-paper/60")}>
            <fieldset disabled={disabled} className="min-w-0">
              <legend className="sr-only">تقييم السطر {ar(index + 1)}</legend>
              <div className="flex items-baseline gap-3">
                <span aria-hidden className="w-6 shrink-0 text-end text-caption font-medium tabular-nums text-faint">
                  {ar(index + 1)}
                </span>
                {selectingWords ? (
                  <p className="min-w-0 flex-1 font-naskh text-question-lg leading-[2.1] text-ink-dark [overflow-wrap:anywhere]" lang="ar" data-testid="matn-unit-text">
                    {tokens.map((token, wordIndex) => {
                      const kind = current.wordIndexes.includes(wordIndex) ? "INCORRECT" : (current.forgottenWordIndexes ?? []).includes(wordIndex) ? "FORGOTTEN" : null;
                      const tokenState = kind === "INCORRECT" ? "محددة كخطأ" : kind === "FORGOTTEN" ? "لم أتذكر" : "صحيحة";
                      return (
                        <span key={`${wordIndex}-${token}`} className="inline-block align-bottom" data-testid="matn-token" data-word-index={wordIndex} data-selected={kind !== null}>
                          <button
                            type="button"
                            aria-pressed={kind !== null}
                            aria-label={`${token} — ${tokenState}`}
                            onClick={() => onChange(unit.id, toggleAssessmentWord(current, wordIndex, markMode))}
                            className={cn(
                              "rounded-sm px-0.5 text-inherit underline-offset-4 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
                              "hover:bg-paper",
                              kind ? "inline-flex flex-col items-center align-bottom py-0.5 underline decoration-2" : "inline",
                              kind === "INCORRECT" && "bg-warning-soft text-warning-ink decoration-warning",
                              kind === "FORGOTTEN" && "bg-error-soft text-error-ink decoration-error",
                            )}
                          >
                            {kind ? <span className={cn("rounded-full px-1.5 font-sans text-micro font-semibold leading-tight", kind === "INCORRECT" ? "bg-warning text-surface" : "bg-error text-surface")} data-testid="matn-token-label">{kind === "INCORRECT" ? "خطأ" : "لم أتذكر"}</span> : null}
                            <span data-testid="matn-token-text">{token}</span>
                          </button>{" "}
                        </span>
                      );
                    })}
                  </p>
                ) : <p className="min-w-0 flex-1 font-naskh text-question-lg leading-[2.1] text-ink-dark [overflow-wrap:anywhere]" lang="ar" data-testid="matn-unit-text">{unit.text}</p>}
              </div>
              {!correcting ? <div className="mt-4 sm:ps-9" data-testid="assessment-stage-1">
                <p className="mb-2 text-small font-semibold text-ink">كيف كان تسميعك لهذا السطر؟</p>
                <div className="grid grid-cols-2 gap-3">
                {ASSESSMENT_OPTIONS.filter((option) => option.status === "CORRECT").map((option) => {
                  const selected = current?.status === option.status;
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.status}
                      type="button"
                      aria-pressed={selected}
                      aria-label={option.label}
                      onClick={() => onChange(unit.id, changeAssessmentStatus(option.status))}
                      data-testid={`assess-${index + 1}-${option.status}`}
                      className="block w-full text-start focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                    >
                      <span
                        className={cn(
                          "flex min-h-20 flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center",
                          "transition-[background-color,border-color,color,box-shadow] duration-200",
                          selected ? option.selectedClassName : "border-line-strong bg-surface text-ink hover:border-ink/40",
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-small font-semibold">
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-micro leading-snug opacity-80">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
                <button type="button" aria-label="يحتاج تصحيحًا" onClick={() => onChange(unit.id, startWordAssessment())} className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-warning/50 bg-warning-soft/60 px-2 py-2 text-center text-warning-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"><span className="flex items-center gap-1.5 text-small font-semibold"><Sparkles className="size-4" aria-hidden />يحتاج تصحيحًا</span><span className="mt-0.5 text-micro opacity-80">فيه خطأ أو كلمات لم أتذكرها</span></button>
                </div>
              </div> : null}
              {correcting ? (
                <div className="mt-4 rounded-xl border border-line bg-paper/60 p-3 sm:ms-9 sm:p-4" data-testid="assessment-stage-2">
                  <style>{`[data-testid="assessment-stage-2"] > p.mt-1.text-small.text-muted, [data-testid="assessment-stage-2"] [role="group"] + p, [data-testid="assessment-stage-2"] .mt-3.grid.grid-cols-2.gap-2 + p { display: none; }`}</style>
                  <div className="flex items-center justify-between gap-2"><p className="text-section font-semibold text-ink">تحديد الكلمات</p><button type="button" onClick={() => onClear(unit.id)} className="min-h-11 px-2 text-small font-semibold text-ink underline">تغيير الإجابة</button></div>
                  <p className="mt-1 text-small text-muted">اضغط على الكلمات حسب نوع المشكلة.</p>
                  <div className="mt-3 grid grid-cols-2 rounded-xl border border-line-strong bg-surface p-1" role="group" aria-label="نوع علامة الكلمة"><button type="button" aria-pressed={markMode === "INCORRECT"} onClick={() => setMarkModes((value) => ({ ...value, [unit.id]: "INCORRECT" }))} className={cn("min-h-11 rounded-lg text-small font-semibold", markMode === "INCORRECT" ? "bg-warning-soft text-warning-ink" : "text-ink")}>× أخطأت</button><button type="button" aria-pressed={markMode === "FORGOTTEN"} onClick={() => setMarkModes((value) => ({ ...value, [unit.id]: "FORGOTTEN" }))} className={cn("min-h-11 rounded-lg text-small font-semibold", markMode === "FORGOTTEN" ? "bg-error-soft text-error-ink" : "text-ink")}>؟ لم أتذكر</button></div>
                  <p className="text-small font-semibold text-ink">{current.status === "INCORRECT" ? "أين كان الخطأ؟" : "ما الذي لم تتذكره؟"}</p>
                  <p className="mt-3 text-small font-semibold text-ink" data-testid="active-marking-heading">{activeModeCopy.heading}</p>
                  <p className="mt-1 text-small text-muted" data-testid="active-marking-helper">{activeModeCopy.helper}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" aria-pressed={current.scope === "WORDS"} onClick={() => onChange(unit.id, changeAssessmentScope(current, "WORDS"))} className={cn("flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 text-small font-semibold focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]", current.scope === "WORDS" ? "border-sage-dark bg-sage-soft text-sage-deep" : "border-line-strong bg-surface text-ink")}><ListChecks className="size-4" aria-hidden />تحديد الكلمات</button>
                    <button type="button" aria-pressed={current.scope === "FULL_UNIT"} onClick={() => onChange(unit.id, changeAssessmentScope(current, "FULL_UNIT"))} className={cn("flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 text-small font-semibold focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]", current.scope === "FULL_UNIT" ? "border-sage-dark bg-sage-soft text-sage-deep" : "border-line-strong bg-surface text-ink")}><ScanText className="size-4" aria-hidden />المقطع كاملًا</button>
                  </div>
                  {current.scope === "WORDS" ? <p className="mt-3 text-small text-muted">{current.status === "INCORRECT" ? "اضغط على الكلمات التي أخطأت فيها." : "اضغط على الكلمات التي لم تتذكرها."}</p> : null}
                  {current.scope === "FULL_UNIT" ? <p className="mt-3 text-small text-muted" data-testid="full-unit-state">المقطع كاملًا — {current.status === "INCORRECT" ? "خطأ" : "لم أتذكر"}</p> : null}
                </div>
              ) : null}
            </fieldset>
          </li>
        );
      })}
    </ol>
  );
}
