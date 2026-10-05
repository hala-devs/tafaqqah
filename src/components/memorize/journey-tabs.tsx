import Link from "next/link";
import { BookOpenText, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * «تعلّم» | «احفظ المتن»: the two complementary journeys of one book, as one segmented switch. Understanding progress
 * and memorization progress never merge — each segment leads to its own journey. The selected segment is announced
 * with aria-current, not colour alone.
 */
export function JourneyTabs({ active, learnHref = "/curriculum", memorizeHref }: { active: "LEARN" | "MEMORIZE"; learnHref?: string; memorizeHref: string }) {
  const item = (key: "LEARN" | "MEMORIZE", href: string, label: string, hint: string, icon: React.ReactNode) => {
    const selected = active === key;
    return (
      <Link
        key={key}
        href={href}
        aria-current={selected ? "page" : undefined}
        data-testid={`journey-tab-${key.toLowerCase()}`}
        className={cn(
          "flex min-h-14 flex-1 items-center gap-3 rounded-xl px-3 py-2 transition-[background-color,box-shadow,color] duration-200 ease-calm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:px-4",
          selected ? "bg-surface text-ink shadow-soft" : "text-muted hover:bg-surface/60 hover:text-ink",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
            selected ? (key === "LEARN" ? "bg-ink text-surface" : "bg-sage-dark text-surface") : "bg-surface-2 text-muted",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 text-start">
          <span className="block text-body leading-tight font-semibold">{label}</span>
          <span className="block truncate text-caption text-muted">{hint}</span>
        </span>
      </Link>
    );
  };
  return (
    <nav aria-label="مسارات الكتاب" className="flex w-full gap-1 rounded-2xl border border-line bg-surface-2/70 p-1 sm:max-w-md">
      {item("LEARN", learnHref, "تعلّم", "الفهم والاختبار", <Lightbulb className="size-4" />)}
      {item("MEMORIZE", memorizeHref, "احفظ المتن", "الحفظ والمراجعة", <BookOpenText className="size-4" />)}
    </nav>
  );
}
