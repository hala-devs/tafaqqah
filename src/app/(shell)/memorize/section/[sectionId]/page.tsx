import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getSectionView } from "@/server/memorization/content";
import { StateBadge } from "@/components/memorize/state-badge";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import { memorizeBookHref, memorizePassageHref } from "@/lib/routes";

export const metadata: Metadata = { title: "مقاطع القسم" };

type Props = { params: Promise<{ sectionId: string }> };

const PASSAGES = ["مقطع واحد", "مقطعين", "مقاطع", "مقطعًا"] as [string, string, string, string];
/** Subject position («مقطعان»). */
const PASSAGES_NOM = ["مقطع واحد", "مقطعان", "مقاطع", "مقطعًا"] as [string, string, string, string];
const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];

export default async function SectionPage({ params }: Props) {
  const { sectionId } = await params;
  const user = await requireUser(`/memorize/section/${sectionId}`);
  const view = await getSectionView(prisma, user.id, sectionId);
  if (!view) notFound();
  const { course, section } = view;
  const done = section.passages.length > 0 && section.masteredPassages === section.passages.length;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="animate-fade-up">
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-small text-muted">
          <Link href={memorizeBookHref(course.id)} className="rounded font-medium underline-offset-4 hover:text-ink hover:underline">
            {course.title}
          </Link>
          {section.groupTitle ? (
            <>
              <ChevronLeft className="size-3.5" aria-hidden />
              <span>{section.groupTitle}</span>
            </>
          ) : null}
        </nav>
        <h1 className="mt-3 font-naskh text-title leading-normal text-ink sm:text-display-sm">{section.title}</h1>
        <p className="mt-2 text-body text-muted">
          {done
            ? "أتممت هذا القسم. راجعه متى حان وقته."
            : section.attemptedPassages > 0
              ? `${ar(section.masteredPassages)} من ${countLabel(section.passages.length, PASSAGES)} متقنة. واصل من حيث توقفت.`
              : `${countLabel(section.passages.length, PASSAGES_NOM)}. ابدأ بالمقطع الأول.`}
        </p>
      </header>

      <ol className="mt-8 divide-y divide-line border-y border-line" aria-label="مقاطع القسم">
        {section.passages.map((p) => (
          <li key={p.id}>
            <Link
              href={memorizePassageHref(p.id)}
              data-testid="passage-link"
              className="group -mx-3 flex items-center gap-4 rounded-xl px-3 py-4 transition-colors duration-200 hover:bg-surface focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:py-5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full font-naskh text-card font-semibold tabular-nums",
                  p.state === "MASTERED" ? "bg-sage-dark text-surface" : p.attempts > 0 ? "bg-sage-soft text-sage-deep" : "bg-surface-2 text-muted",
                )}
              >
                {ar(p.order)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-card font-semibold text-ink">{p.title}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StateBadge state={p.state} />
                  {p.due ? <Badge tone="warning">حان وقت المراجعة</Badge> : null}
                  <span className="text-caption text-muted">{countLabel(p.unitCount, LINES)}</span>
                </div>
              </div>
              <ChevronLeft className="size-5 shrink-0 text-faint transition-transform duration-200 group-hover:-translate-x-0.5 group-hover:text-ink" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
