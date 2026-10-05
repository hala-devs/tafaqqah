import { cn } from "@/lib/cn";

/**
 * A faint khatam (eight-point star) in fine line work — the home's only ornament. Pure SVG, inherits currentColor,
 * decorative only. Callers keep it near-invisible (opacity ≤ 0.1) so it never competes with content.
 */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="0.9" className={cn("pointer-events-none select-none", className)}>
      <circle cx="60" cy="60" r="56" />
      <circle cx="60" cy="60" r="44" strokeDasharray="1.5 3.5" />
      <rect x="24" y="24" width="72" height="72" />
      <rect x="24" y="24" width="72" height="72" transform="rotate(45 60 60)" />
      <rect x="38" y="38" width="44" height="44" transform="rotate(22.5 60 60)" />
      <rect x="38" y="38" width="44" height="44" transform="rotate(67.5 60 60)" />
      <circle cx="60" cy="60" r="9" />
    </svg>
  );
}
