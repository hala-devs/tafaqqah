import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, BookOpenText, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { countLabel } from "@/lib/format";
import type { ReviewEntry } from "@/server/learner/review-view";
import type { WeakConcept } from "@/server/learner/overview";

const CONCEPTS = ["مفهوم واحد", "مفهومان", "مفاهيم", "مفهومًا"] as [string, string, string, string];
const PASSAGES = ["مقطع واحد", "مقطعان", "مقاطع", "مقطعًا"] as [string, string, string, string];

/**
 * «يحتاج إلى مراجعتك» on the home: the /review list (same data) summarised per journey — understanding in navy,
 * memorization in green — each opening /review. Calm, not a warning. Not rendered at all when nothing needs review.
 */
export function HomeAttention({ entries }: { entries: ReviewEntry<WeakConcept>[] }) {
  if (entries.length === 0) return null;
  const concepts = entries.filter((e) => e.type === "UNDERSTANDING").length;
  const memo = entries.flatMap((e) => (e.type === "MEMORIZATION" ? [e.item] : []));
  const due = memo.filter((m) => m.due).length;
  const reinforce = memo.length - due;
  const memoText = [due > 0 ? `${countLabel(due, PASSAGES)} حان وقت مراجعتها` : null, reinforce > 0 ? `${countLabel(reinforce, PASSAGES)} تحتاج إلى تثبيت` : null].filter(Boolean).join("، ");
  const conceptText = concepts === 1 ? "مفهوم واحد يحتاج إلى تثبيت" : `${countLabel(concepts, CONCEPTS)} تحتاج إلى تثبيت`;

  return (
    <section aria-labelledby="attention-title" data-testid="review-callout">
      <h2 id="attention-title" className="text-section font-bold text-ink">
        يحتاج إلى مراجعتك
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {concepts > 0 ? <ReviewRow accent="ink" icon={<Lightbulb className="size-[1.125rem]" />} title="مراجعة الفهم" text={conceptText} testId="review-understanding" /> : null}
        {memo.length > 0 ? <ReviewRow accent="sage" icon={<BookOpenText className="size-[1.125rem]" />} title="مراجعة الحفظ" text={memoText} testId="review-memorization" /> : null}
      </ul>
    </section>
  );
}

function ReviewRow({ accent, icon, title, text, testId }: { accent: "ink" | "sage"; icon: ReactNode; title: string; text: string; testId: string }) {
  return (
    <li data-testid={testId}>
      <Link
        href="/review"
        aria-label={`${title}: ${text} — عرض المراجعة`}
        className="group flex min-h-18 items-center gap-4 rounded-2xl border border-line/90 bg-surface px-4 py-3.5 shadow-soft transition-[border-color,box-shadow] duration-200 ease-calm hover:border-line-strong hover:shadow-lift focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:px-5"
      >
        <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", accent === "ink" ? "bg-ink-tint text-ink ring-ink/10" : "bg-sage-soft text-sage-deep ring-sage/20")}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-small font-semibold", accent === "ink" ? "text-ink" : "text-sage-deep")}>{title}</span>
          <span className="block text-small text-muted">{text}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-ink">
          <span className="hidden sm:inline">عرض المراجعة</span>
          <ArrowLeft className="size-4 transition-transform duration-200 ease-calm group-hover:-translate-x-1 motion-reduce:transition-none" aria-hidden />
        </span>
      </Link>
    </li>
  );
}
