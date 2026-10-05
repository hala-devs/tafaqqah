"use client";

import { useActionState, useRef, type ReactNode } from "react";
import type { AdminActionState } from "@/app/(admin)/admin/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

type Props = {
  action: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  submitLabel: string;
  children?: ReactNode;
  resetOnSuccess?: boolean;
  variant?: "primary" | "secondary" | "sage" | "ghost";
  size?: "sm" | "md";
  className?: string;
  inline?: boolean;
};

/** Shared admin form: pending state, inline errors and a toast on success. */
export function AdminForm({ action, submitLabel, children, resetOnSuccess, variant = "primary", size = "md", className, inline }: Props) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: AdminActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) {
      toast(result.message ?? "تم الحفظ.", "success");
      if (resetOnSuccess) formRef.current?.reset();
    }
    return result;
  }, {});

  return (
    <form ref={formRef} action={formAction} className={className ?? (inline ? "inline" : "space-y-4")}>
      {children}
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <Button type="submit" variant={variant} size={size} loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
