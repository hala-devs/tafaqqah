import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "ink" | "sage" | "success" | "warning" | "error" | "gold";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  ink: "bg-ink-tint text-ink border-ink/10",
  sage: "bg-sage-soft text-sage-dark border-sage/25",
  success: "bg-success-soft text-success-ink border-success/25",
  warning: "bg-warning-soft text-warning-ink border-warning/30",
  error: "bg-error-soft text-error-ink border-error/25",
  gold: "bg-gold-soft text-gold-ink border-gold/35",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
