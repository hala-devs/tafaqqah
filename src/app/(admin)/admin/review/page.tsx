import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getReviewQueue, REVIEW_KIND_LABEL, type ReviewKind } from "@/server/admin/content-overview";
import { PageHeader } from "@/components/admin/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "مراجعة المحتوى" };

const KINDS = Object.keys(REVIEW_KIND_LABEL) as ReviewKind[];
const TONE: Record<ReviewKind, BadgeTone> = {
  HUMAN_REVIEW: "error",
  TEXT_UNAPPROVED: "warning",
  TIMESTAMP_UNAPPROVED: "warning",
  SOURCE_CONFLICT: "gold",
  READY_TO_APPROVE: "sage",
  READY_TO_PUBLISH: "success",
};

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const admin = await requireAdminPage();
  const { filter } = await searchParams;
  const active = KINDS.find((k) => k === filter) ?? null;
  const { items } = await getReviewQueue(prisma, admin);
  const counts = new Map<ReviewKind, number>(KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]));
  const visible = active ? items.filter((i) => i.kind === active) : items;

  return (
    <>
      <PageHeader title="مراجعة المحتوى" description="كل ما يحتاج تدخلك في مكان واحد. افتح أي عنصر لتصل مباشرة إلى موضع المشكلة داخل الدرس." />
      <nav aria-label="تصفية عناصر المراجعة" className="mb-6 flex flex-wrap gap-2">
        <Link href="/admin/review" aria-current={!active ? "page" : undefined} className={cn("rounded-full border px-3.5 py-1.5 text-small", !active ? "border-ink bg-ink text-surface" : "border-line bg-surface text-muted hover:text-ink")}>
          الكل ({ar(items.length)})
        </Link>
        {KINDS.map((kind) => (
          <Link
            key={kind}
            href={`/admin/review?filter=${kind}`}
            aria-current={active === kind ? "page" : undefined}
            className={cn("rounded-full border px-3.5 py-1.5 text-small", active === kind ? "border-ink bg-ink text-surface" : "border-line bg-surface text-muted hover:text-ink")}
          >
            {REVIEW_KIND_LABEL[kind]} ({ar(counts.get(kind) ?? 0)})
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <EmptyState title="لا عناصر في هذا التصنيف" description="لا يوجد ما يحتاج تدخلك هنا حاليًا." />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="review-queue">
          {visible.map((item, index) => (
            <li key={`${item.kind}-${item.conceptId ?? item.lessonId}-${index}`}>
              <Link href={item.href} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/50">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[item.kind]}>{REVIEW_KIND_LABEL[item.kind]}</Badge>
                    <span className="text-body text-ink">{item.conceptTitle ?? item.lessonTitle}</span>
                  </span>
                  <span className="mt-0.5 block text-caption text-muted">
                    {item.lessonTitle} — {item.detail}
                  </span>
                </span>
                <ChevronLeft className="size-4 text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
