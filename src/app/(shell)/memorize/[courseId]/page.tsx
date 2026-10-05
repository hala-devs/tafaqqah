import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { loadMatnJourney } from "@/server/memorization/journey";
import { getMemorizationSummaries } from "@/server/memorization/progress";
import { MatnJourney } from "@/components/memorize/matn-journey";

export const metadata: Metadata = { title: "حفظ المتن" };

type Props = { params: Promise<{ courseId: string }> };

/** One selected Matn: the same journey as on /memorize, scoped to this book. */
export default async function BookMemorizePage({ params }: Props) {
  const { courseId } = await params;
  const user = await requireUser(`/memorize/${courseId}`);
  const now = new Date();
  const summaries = await getMemorizationSummaries(prisma, user.id, now);
  const journey = await loadMatnJourney(prisma, user.id, courseId, summaries, now);
  if (!journey) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <nav aria-label="مسار التنقل" className="animate-fade-up">
        <Link href="/memorize" className="inline-flex items-center gap-1 rounded text-small font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
          <ChevronRight className="size-4" aria-hidden />
          مسار الحفظ
        </Link>
      </nav>
      <h1 className="sr-only">حفظ {journey.title}</h1>
      <div className="mt-4 animate-fade-up overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
        <MatnJourney {...journey} />
      </div>
    </div>
  );
}
