"use client";

import { useActionState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { startAssessmentAction, type StartKind, type StartState } from "@/app/(focus)/lessons/[id]/assessment/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";

type Props = {
  lessonId: string;
  label: string;
  kind?: StartKind;
  variant?: "primary" | "secondary" | "sage" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: "arrow" | "retry";
};

export function StartAssessmentButton({ lessonId, label, kind = "DEFAULT", variant = "primary", size = "lg", icon = "arrow" }: Props) {
  const [state, action, pending] = useActionState(startAssessmentAction.bind(null, lessonId, kind), {} as StartState);
  return (
    <form action={action} className="space-y-3">
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <Button
        type="submit"
        variant={variant}
        size={size}
        loading={pending}
        icon={icon === "retry" && !pending ? <RotateCcw className="size-4" aria-hidden /> : undefined}
      >
        {label}
        {icon === "arrow" && !pending ? <ArrowLeft className="size-4" aria-hidden /> : null}
      </Button>
    </form>
  );
}
