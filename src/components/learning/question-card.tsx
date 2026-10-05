"use client";

import { useEffect, useRef } from "react";
import { Compass, FlaskConical, RefreshCcw, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AnswerOption, type OptionState } from "./answer-option";

export type QuestionView = {
  id: string;
  sequence: number;
  type: "MCQ" | "TRUE_FALSE";
  text: string;
  options: string[];
  conceptTitle: string;
  difficultyLabel: string;
  adaptiveNote: string | null;
  isDevelopmentMock: boolean;
  origin: "AI_GENERATED" | "FIXED_BANK";
  stage: "BASELINE" | "VERIFICATION" | "SECOND_VERIFICATION" | "REASSESSMENT";
  /** Baseline position: follow-up questions keep the position of the question they follow. */
  position: number;
};

const STAGE_BADGE = {
  VERIFICATION: { label: "سؤال تحقق", icon: ShieldQuestion },
  SECOND_VERIFICATION: { label: "سؤال تحقق", icon: ShieldQuestion },
  REASSESSMENT: { label: "إعادة اختبار", icon: RefreshCcw },
} as const;

type Props = {
  question: QuestionView;
  selected: number | null;
  answered: { selectedIndex: number; correctIndex: number } | null;
  disabled: boolean;
  onSelect: (index: number) => void;
};

function optionState(index: number, selected: number | null, answered: Props["answered"]): OptionState {
  if (answered) {
    if (index === answered.correctIndex) return "correct";
    if (index === answered.selectedIndex) return "incorrect";
    return "dimmed";
  }
  return index === selected ? "selected" : "default";
}

export function QuestionCard({ question, selected, answered, disabled, onSelect }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to each new question so keyboard and screen-reader users start at the top.
  useEffect(() => {
    headingRef.current?.focus();
  }, [question.id]);

  const count = question.options.length;
  const stage = question.stage === "BASELINE" ? null : STAGE_BADGE[question.stage];
  const focusIndex = answered ? -1 : selected ?? 0;

  function handleKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (answered) return;
    // RTL: ArrowLeft/ArrowDown move forward, ArrowRight/ArrowUp move back.
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = (index + 1) % count;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next = (index - 1 + count) % count;
    if (next !== null) {
      event.preventDefault();
      onSelect(next);
      refs.current[next]?.focus();
    }
  }

  return (
    <section aria-labelledby={`q-${question.id}`} data-question-id={question.id} className="animate-fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ink">{question.conceptTitle}</Badge>
        <Badge tone="neutral">{question.difficultyLabel}</Badge>
        {stage ? (
          <Badge tone="sage" icon={<stage.icon className="size-3" aria-hidden />}>
            {stage.label}
          </Badge>
        ) : null}
        {question.isDevelopmentMock ? (
          <Badge tone="gold" icon={<FlaskConical className="size-3" aria-hidden />}>
            مولّد تجريبي لبيئة التطوير
          </Badge>
        ) : null}
      </div>

      {question.adaptiveNote ? (
        <p className="mt-3 inline-flex items-center gap-2 text-small text-sage-dark">
          <Compass className="size-4" aria-hidden />
          {question.adaptiveNote}
        </p>
      ) : null}

      {question.type === "TRUE_FALSE" ? <p className="mt-8 text-caption font-medium text-muted">صحيح أم خطأ؟</p> : null}
      <h2
        id={`q-${question.id}`}
        ref={headingRef}
        tabIndex={-1}
        className={`${question.type === "TRUE_FALSE" ? "mt-2" : "mt-8"} text-question font-medium text-ink focus:outline-none sm:text-question-lg`}
      >
        {question.text}
      </h2>

      <div
        role="radiogroup"
        aria-labelledby={`q-${question.id}`}
        className={question.type === "TRUE_FALSE" ? "mt-7 grid gap-3 sm:grid-cols-2" : "mt-7 space-y-3"}
      >
        {question.options.map((option, index) => (
          <AnswerOption
            key={`${question.id}-${index}`}
            ref={(el) => {
              refs.current[index] = el;
            }}
            index={index}
            text={option}
            state={optionState(index, selected, answered)}
            checked={answered ? index === answered.selectedIndex : index === selected}
            disabled={disabled || Boolean(answered)}
            focusable={index === focusIndex}
            onSelect={() => onSelect(index)}
            onKeyDown={(event) => handleKey(event, index)}
          />
        ))}
      </div>
    </section>
  );
}
