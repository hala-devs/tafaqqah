import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type RingProps = {
  /** Real percentage, 0–100. */
  value: number;
  /** Accessible description, e.g. «٦٨٪ من الدرس». */
  label: string;
  /** Sizing classes for the whole ring (e.g. "size-20 sm:size-32"). */
  className?: string;
  tone?: "sage" | "gold";
  /** Draw on the dark ink hero surface. */
  onDark?: boolean;
  /** The ring fills from this percentage (default 0) to the real value. */
  animateFrom?: number;
  children?: ReactNode;
};

const R = 44;
const C = 2 * Math.PI * R;

/**
 * Quiet circular progress for real data only. It starts at the top and fills counter-clockwise,
 * which reads naturally in right-to-left layouts. Children are centred inside the ring.
 */
export function ProgressRing({ value, label, className, tone = "sage", onDark, animateFrom, children }: RingProps) {
  const pct = Math.max(0, Math.min(100, value));
  const to = C * (1 - pct / 100);
  const from = C * (1 - Math.max(0, Math.min(100, animateFrom ?? 0)) / 100);
  return (
    <div role="img" aria-label={label} className={cn("relative shrink-0", className)}>
      <svg viewBox="0 0 100 100" className="size-full -scale-x-100 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="7" className={onDark ? "stroke-surface/15" : "stroke-surface-2"} />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={to}
          className={cn("animate-ring-fill", tone === "gold" ? "stroke-gold" : onDark ? "stroke-sage" : "stroke-sage-dark")}
          style={{ "--ring-from": from, "--ring-to": to } as React.CSSProperties}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div> : null}
    </div>
  );
}
