import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-title text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-small text-muted">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "warning" | "success";
}) {
  return (
    <Card padded={false} className="p-4">
      <p className="text-caption text-muted">{label}</p>
      <p className={cn("mt-1 text-section font-semibold tabular-nums", tone === "warning" ? "text-warning-ink" : tone === "success" ? "text-success-ink" : "text-ink")}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-caption text-faint">{hint}</p> : null}
    </Card>
  );
}

/** Honest empty state for metrics that have no underlying data yet. */
export function EmptyData({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong bg-surface-2/40 px-4 py-6 text-center text-small text-muted">{children}</p>;
}

export function Bar({ value, max = 1, tone = "ink" }: { value: number; max?: number; tone?: "ink" | "sage" | "warning" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = tone === "sage" ? "bg-sage-dark" : tone === "warning" ? "bg-warning" : "bg-ink";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(pct)}٪`}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
