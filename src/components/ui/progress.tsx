import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

type ProgressProps = {
  value: number;
  max?: number;
  label: string;
  showValue?: boolean;
  tone?: "ink" | "sage" | "gold";
  size?: "xs" | "sm" | "md" | "lg";
  /** Animate the fill from this percentage (0–100) to the real value. Omit for no animation. */
  animateFrom?: number;
  className?: string;
};

const fills = { ink: "bg-ink", sage: "bg-sage-dark", gold: "bg-gold" };
const heights = { xs: "h-1", sm: "h-1.5", md: "h-2.5", lg: "h-3" };

export function Progress({ value, max = 100, label, showValue, tone = "sage", size = "sm", animateFrom, className }: ProgressProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const animated = animateFrom !== undefined;
  return (
    <div className={cn("w-full", className)}>
      {showValue ? (
        <div className="mb-1.5 flex items-center justify-between text-caption text-muted">
          <span>{label}</span>
          <bdi dir="ltr" className="tabular-nums">{ar(Math.round(pct))}٪</bdi>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn("w-full overflow-hidden rounded-full bg-surface-2", heights[size])}
      >
        <div
          className={cn("h-full rounded-full", fills[tone], animated ? "animate-bar-fill" : "transition-[width] duration-300 ease-calm")}
          style={animated ? ({ width: `${pct}%`, "--bar-from": `${animateFrom}%`, "--bar-to": `${pct}%` } as React.CSSProperties) : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
