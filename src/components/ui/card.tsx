import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type CardProps = ComponentProps<"div"> & {
  as?: "div" | "section" | "article" | "aside";
  tone?: "surface" | "muted" | "ink";
  padded?: boolean;
  interactive?: boolean;
};

const tones = {
  surface: "bg-surface border border-line",
  muted: "bg-surface-2/70 border border-line/70",
  ink: "bg-ink text-surface border border-ink-dark",
};

export function Card({ as: Tag = "div", tone = "surface", padded = true, interactive, className, ...props }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-xl",
        tones[tone],
        padded && "p-5 sm:p-6",
        interactive &&
          "transition-[box-shadow,transform,border-color] duration-200 ease-calm hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeading({
  title,
  description,
  action,
  id,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-section text-ink">
          {title}
        </h2>
        {description ? <p className="mt-1 text-small text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
