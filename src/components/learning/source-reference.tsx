import { BookOpenText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type Source = { sourceTitle: string; sourceAuthor: string; sourceReference?: string; isSample?: boolean };

/** "المصدر العلمي" — visually authoritative, deliberately distinct from anything AI-generated. */
export function SourceReference({ sources, className }: { sources: Source[]; className?: string }) {
  const unique = Array.from(new Map(sources.map((s) => [`${s.sourceTitle}|${s.sourceAuthor}`, s])).values());
  const anySample = sources.some((s) => s.isSample);

  return (
    <aside
      aria-label="المصدر العلمي"
      className={cn("relative overflow-hidden rounded-xl border border-gold/30 bg-surface px-5 py-4", className)}
    >
      <span aria-hidden className="absolute inset-y-3 start-0 w-[3px] rounded-full bg-gold/70" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-caption font-medium tracking-wide text-gold-ink">
          <BookOpenText className="size-4" aria-hidden />
          المصدر العلمي
        </p>
        {anySample ? (
          <Badge tone="gold">محتوى تجريبي</Badge>
        ) : (
          <Badge tone="success" icon={<ShieldCheck className="size-3.5" aria-hidden />}>
            نص معتمد
          </Badge>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {unique.map((s) => (
          <li key={`${s.sourceTitle}|${s.sourceAuthor}`}>
            <span className="font-naskh text-card font-semibold text-ink">{s.sourceTitle}</span>
            <span className="text-small text-muted"> — {s.sourceAuthor}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Compact per-passage reference line placed directly under the passage text. */
export function PassageReference({ source }: { source: Source }) {
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-caption text-muted">
      <BookOpenText className="size-3.5 text-gold" aria-hidden />
      <span className="font-medium text-gold-ink">{source.sourceTitle}</span>
      <span aria-hidden>·</span>
      <span>{source.sourceReference}</span>
    </p>
  );
}
