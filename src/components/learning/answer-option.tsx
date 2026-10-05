"use client";

import { forwardRef } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type OptionState = "default" | "selected" | "correct" | "incorrect" | "dimmed";

const LETTERS = ["أ", "ب", "ج", "د"];

type Props = {
  index: number;
  text: string;
  state: OptionState;
  checked: boolean;
  disabled: boolean;
  focusable: boolean;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
};

/**
 * Large selectable answer card (role="radio"). Correct/incorrect are conveyed with an
 * icon and a text label as well as colour.
 */
export const AnswerOption = forwardRef<HTMLButtonElement, Props>(function AnswerOption(
  { index, text, state, checked, disabled, focusable, onSelect, onKeyDown },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={focusable ? 0 : -1}
      onClick={() => !disabled && onSelect()}
      onKeyDown={onKeyDown}
      className={cn(
        "group flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-start transition-[background-color,border-color,box-shadow,opacity,transform] duration-200 ease-calm sm:px-5",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        state === "default" && "border-line bg-surface hover:-translate-y-px hover:border-line-strong hover:shadow-soft",
        state === "selected" && "border-ink bg-ink-tint shadow-soft",
        state === "correct" && "border-success bg-success-soft",
        state === "incorrect" && "border-error bg-error-soft",
        state === "dimmed" && "border-line bg-surface opacity-60",
        disabled && "cursor-default",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border text-small font-semibold transition-colors duration-200",
          state === "default" && "border-line-strong text-muted group-hover:border-ink/40 group-hover:text-ink",
          state === "selected" && "border-ink bg-ink text-surface",
          state === "correct" && "border-success bg-success text-white",
          state === "incorrect" && "border-error bg-error text-white",
          state === "dimmed" && "border-line text-faint",
        )}
      >
        {state === "correct" ? <Check className="size-4" strokeWidth={2.75} /> : state === "incorrect" ? <X className="size-4" strokeWidth={2.75} /> : LETTERS[index]}
      </span>
      <span className="min-w-0 flex-1 text-card leading-8 text-text">{text}</span>
      {state === "correct" ? (
        <span className="shrink-0 text-caption font-medium text-success-ink">الإجابة الصحيحة</span>
      ) : state === "incorrect" ? (
        <span className="shrink-0 text-caption font-medium text-error-ink">إجابتك</span>
      ) : null}
    </button>
  );
});
