"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { TextField } from "./field";

type PasswordFieldProps = Omit<ComponentProps<"input">, "type" | "dir"> & { id: string; label: string; error?: string; hint?: ReactNode };

/**
 * Password input with an accessible show/hide toggle. Purely presentational:
 * name, value and validation are unchanged. Passwords are typed LTR, so the
 * toggle sits on the physical left (the input's end).
 */
export function PasswordField({ className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      dir="ltr"
      className={cn("pl-12!", className)}
      adornment={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
          aria-pressed={visible}
          aria-controls={props.id}
          className="absolute top-1/2 left-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
        >
          {visible ? <EyeOff className="size-4.5" aria-hidden /> : <Eye className="size-4.5" aria-hidden />}
        </button>
      }
    />
  );
}
