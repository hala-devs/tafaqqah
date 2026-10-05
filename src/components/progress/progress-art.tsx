import { cn } from "@/lib/cn";

/**
 * Decorative atmosphere for /progress — inline SVG only (no raster assets), aria-hidden, drawn in the palette's own
 * tokens through currentColor / CSS variables so it stays faint and on-brand.
 */

/** A pointed arch with a lattice, for the header corner. */
export function ArchArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 220 260" fill="none" className={cn("pointer-events-none select-none", className)}>
      <defs>
        <pattern id="arch-lattice" width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M11 0 L22 11 L11 22 L0 11 Z" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="11" cy="11" r="2.2" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
        <clipPath id="arch-clip">
          <path d="M40 260 V110 C40 60 80 30 110 12 C140 30 180 60 180 110 V260 Z" />
        </clipPath>
      </defs>
      <rect width="220" height="260" fill="url(#arch-lattice)" clipPath="url(#arch-clip)" opacity="0.55" />
      <path d="M40 260 V110 C40 60 80 30 110 12 C140 30 180 60 180 110 V260" stroke="currentColor" strokeWidth="1.4" />
      <path d="M22 260 V104 C22 48 70 14 110 -6 C150 14 198 48 198 104 V260" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
    </svg>
  );
}

/** An abstract road winding toward a distant arch — continuity, not a place. */
export function PathArt({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" fill="none" className={cn("pointer-events-none select-none", className)}>
      <defs>
        <linearGradient id="path-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-gold-soft)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-gold-soft)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="400" height="260" fill="url(#path-sky)" />
      {/* distant arch */}
      <path d="M262 150 V112 C262 98 272 90 280 84 C288 90 298 98 298 112 V150" stroke="var(--color-gold)" strokeWidth="1.2" opacity="0.55" />
      <path d="M252 150 H308" stroke="var(--color-gold)" strokeWidth="1" opacity="0.4" />
      {/* hills */}
      <path d="M0 170 C70 140 130 150 190 160 C250 170 320 140 400 150 V260 H0 Z" fill="var(--color-sage-soft)" opacity="0.9" />
      <path d="M0 200 C80 175 150 190 220 196 C290 202 340 182 400 186 V260 H0 Z" fill="var(--color-sage)" opacity="0.28" />
      {/* the road */}
      <path d="M40 260 C120 236 250 226 220 200 C196 180 250 166 280 152" stroke="var(--color-surface)" strokeWidth="22" strokeLinecap="round" opacity="0.95" />
      <path d="M40 260 C120 236 250 226 220 200 C196 180 250 166 280 152" stroke="var(--color-gold)" strokeWidth="1.2" strokeDasharray="5 7" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
