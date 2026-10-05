import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "sage" | "light" | "quiet-danger";
type Size = "sm" | "md" | "lg" | "xl";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none " +
  "transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-calm " +
  "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-surface hover:bg-ink-soft shadow-soft",
  secondary: "bg-surface text-ink border border-line-strong hover:border-ink/40 hover:bg-white",
  ghost: "text-ink hover:bg-surface-2",
  sage: "bg-sage-dark text-surface hover:bg-sage-deep shadow-soft",
  /** Primary action on a dark (ink) surface. */
  light: "bg-surface text-ink hover:bg-white shadow-soft",
  "quiet-danger": "text-error-ink hover:bg-error-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-small",
  md: "h-11 px-5 text-body",
  lg: "h-13 px-7 text-card",
  xl: "h-14 px-8 text-card",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent motion-reduce:animate-none"
    />
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant, size, loading, icon, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconAfter?: ReactNode;
};

export function ButtonLink({ variant, size, icon, iconAfter, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
      {iconAfter}
    </Link>
  );
}

type IconButtonProps = ComponentProps<"button"> & { label: string; variant?: "ghost" | "secondary" };

export function IconButton({ label, variant = "ghost", className, children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-lg text-ink transition-colors duration-200 ease-calm",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        variant === "ghost" ? "hover:bg-surface-2" : "border border-line bg-surface hover:border-line-strong",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
