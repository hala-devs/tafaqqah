import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-lg border border-line-strong bg-white px-3.5 text-body text-text placeholder:text-faint " +
  "transition-[border-color,box-shadow] duration-150 ease-calm " +
  "focus:outline-none focus:border-ink/50 focus:shadow-[var(--shadow-focus)] " +
  "aria-invalid:border-error aria-invalid:focus:shadow-none";

type FieldShellProps = { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode };

function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-small font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-error-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = ComponentProps<"input"> & {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Optional control positioned over the input (e.g. a password visibility toggle). */
  adornment?: ReactNode;
};

export function TextField({ id, label, error, hint, adornment, className, ...props }: TextFieldProps) {
  const input = (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      className={cn(control, "h-11", className)}
      {...props}
    />
  );
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      {adornment ? (
        <div className="relative">
          {input}
          {adornment}
        </div>
      ) : (
        input
      )}
    </FieldShell>
  );
}

type TextAreaProps = ComponentProps<"textarea"> & { id: string; label: string; error?: string; hint?: ReactNode };

export function TextArea({ id, label, error, hint, className, ...props }: TextAreaProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(control, "py-2.5 leading-[1.9]", className)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectProps = ComponentProps<"select"> & { id: string; label: string; error?: string; hint?: ReactNode };

export function SelectField({ id, label, error, hint, className, children, ...props }: SelectProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <select id={id} aria-invalid={error ? true : undefined} className={cn(control, "h-11", className)} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-3 text-small",
        tone === "error" ? "border-error/25 bg-error-soft text-error-ink" : "border-success/25 bg-success-soft text-success-ink",
      )}
    >
      {children}
    </div>
  );
}
