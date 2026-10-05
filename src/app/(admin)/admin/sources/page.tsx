import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { formatTimestamp } from "@/lib/video";
import { conceptHref } from "@/server/admin/content-overview";

export const metadata: Metadata = { title: "المحتوى والمصادر" };

const ALIGNMENT_LABEL: Record<string, string> = {
  VERIFIED: "موثّق",
  VERIFIED_WITH_CLEANUP: "موثّق بعد تنظيف",
  HUMAN_REVIEW_REQUIRED: "مراجعة بشرية",
  PDF_ONLY_UNTIMED: "PDF بلا توقيت",
  MATCH: "مطابق",
  PDF_CORRECTION: "تصحيح من PDF",
  CONFLICT: "تعارض",
  UNCERTAIN: "غير محسوم",
};

function Host({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {}
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" dir="ltr" className="text-ink underline decoration-line-strong underline-offset-2">
      {host}
    </a>
  );
}

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  await requireAdminPage();
  const { lesson: lessonFilter } = await searchParams;
  const lessons = await prisma.lesson.findMany({ orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }], select: { id: true, title: true } });
  const active = lessons.find((l) => l.id === lessonFilter) ?? lessons[0] ?? null;
  const passages = active
    ? await prisma.sourcePassage.findMany({
        where: { lessonId: active.id },
        orderBy: [{ concept: { order: "asc" } }, { order: "asc" }],
        select: {
          id: true,
          conceptId: true,
          concept: { select: { title: true } },
          approved: true,
          version: true,
          humanReviewRequired: true,
          alignmentStatus: true,
          pdfSource: true,
          pdfPageStart: true,
          pdfPageEnd: true,
          bahethUrl: true,
          videoUrl: true,
          sourceUrl: true,
          sourceTitle: true,
          sourceAuthor: true,
          sourceReference: true,
          edition: true,
          license: true,
          startSecond: true,
          endSecond: true,
        },
      })
    : [];

  return (
    <>
      <PageHeader title="المحتوى والمصادر" description="بيانات المصدر والإسناد لكل مقطع: ملف PDF وصفحاته، تفريغ باحث، رابط الفيديو، الإصدار وحالة المطابقة. هذه المعلومات للإدارة فقط ولا تصل إلى الطلاب." />
      {lessons.length === 0 || !active ? (
        <EmptyState title="لا مصادر بعد" description="أضف درسًا ومفاهيمه أولًا." />
      ) : (
        <>
          <nav aria-label="اختر الدرس" className="mb-5 flex flex-wrap gap-2">
            {lessons.map((l) => (
              <Link key={l.id} href={`/admin/sources?lesson=${l.id}`} aria-current={l.id === active.id ? "page" : undefined} className={cn("rounded-full border px-3.5 py-1.5 text-small", l.id === active.id ? "border-ink bg-ink text-surface" : "border-line bg-surface text-muted hover:text-ink")}>
                {l.title}
              </Link>
            ))}
          </nav>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[64rem] text-small" data-testid="admin-sources-table">
              <thead className="bg-surface-2/60 text-caption text-muted">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">المفهوم</th>
                  <th className="px-4 py-3 text-start font-medium">الاعتماد</th>
                  <th className="px-4 py-3 text-start font-medium">الإصدار</th>
                  <th className="px-4 py-3 text-start font-medium">PDF والصفحات</th>
                  <th className="px-4 py-3 text-start font-medium">تفريغ باحث</th>
                  <th className="px-4 py-3 text-start font-medium">الفيديو / التوقيت</th>
                  <th className="px-4 py-3 text-start font-medium">المطابقة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                {passages.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/40">
                    <td className="px-4 py-3">
                      <Link href={conceptHref(active.id, p.conceptId)} className="font-medium text-ink hover:underline">
                        {p.concept.title}
                      </Link>
                      <p className="text-caption text-muted">
                        {p.sourceTitle} · {p.sourceReference}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.approved ? "success" : "warning"}>{p.approved ? "معتمد" : "غير معتمد"}</Badge>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{ar(p.version)}</td>
                    <td className="px-4 py-3 text-caption text-muted">
                      {p.pdfSource ? <span className="block max-w-64 break-words">{p.pdfSource}</span> : "—"}
                      {p.pdfPageStart != null ? <span className="block text-ink">ص {ar(p.pdfPageStart)}{p.pdfPageEnd != null && p.pdfPageEnd !== p.pdfPageStart ? `–${ar(p.pdfPageEnd)}` : ""}</span> : null}
                    </td>
                    <td className="px-4 py-3">{p.bahethUrl ? <Host url={p.bahethUrl} /> : <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-3">
                      {p.videoUrl ? <Host url={p.videoUrl} /> : <span className="text-faint">—</span>}
                      {p.startSecond != null ? (
                        <span className="block text-caption text-muted" dir="ltr">
                          {formatTimestamp(p.startSecond)}
                          {p.endSecond != null ? `–${formatTimestamp(p.endSecond)}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {p.humanReviewRequired ? <Badge tone="error">مراجعة بشرية</Badge> : null}
                      {p.alignmentStatus ? <Badge tone="neutral" className="mt-1">{ALIGNMENT_LABEL[p.alignmentStatus] ?? p.alignmentStatus}</Badge> : !p.humanReviewRequired ? <span className="text-faint">—</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
