import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { AUDIT_CATEGORY_LABEL, getAuditTimeline, type AuditCategory } from "@/server/admin/insights";
import { PageHeader } from "@/components/admin/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "سجل العمليات" };

const CATEGORIES = Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[];
const TONE: Record<AuditCategory, BadgeTone> = { approval: "success", revocation: "warning", edit: "ink", publication: "gold", ai: "sage" };

const dateTime = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const admin = await requireAdminPage();
  const { category } = await searchParams;
  const active = CATEGORIES.find((c) => c === category) ?? null;
  const all = await getAuditTimeline(prisma, admin);
  const rows = active ? all.filter((r) => r.category === active) : all;

  return (
    <>
      <PageHeader title="سجل العمليات" description="من اعتمد النص أو التوقيت، ومن نشر الدرس أو عدّله، ومتى أُلغي الاعتماد، وعمليات الذكاء الاصطناعي ونتائج التدقيق. السجل للقراءة فقط." />
      <nav aria-label="تصفية السجل" className="mb-6 flex flex-wrap gap-2">
        <Link href="/admin/audit" aria-current={!active ? "page" : undefined} className={cn("rounded-full border px-3.5 py-1.5 text-small", !active ? "border-ink bg-ink text-surface" : "border-line bg-surface text-muted hover:text-ink")}>
          الكل
        </Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={`/admin/audit?category=${c}`} aria-current={active === c ? "page" : undefined} className={cn("rounded-full border px-3.5 py-1.5 text-small", active === c ? "border-ink bg-ink text-surface" : "border-line bg-surface text-muted hover:text-ink")}>
            {AUDIT_CATEGORY_LABEL[c]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="لا عمليات مسجّلة" description="ستظهر هنا عمليات الاعتماد والنشر والتعديل فور حدوثها." />
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line bg-surface" data-testid="audit-log">
          {rows.map((row) => (
            <li key={row.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_12rem] sm:items-baseline sm:gap-4">
              <time dateTime={row.at.toISOString()} className="text-caption tabular-nums text-muted">
                {dateTime.format(row.at)}
              </time>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[row.category]}>{row.label}</Badge>
                  <span className="text-small text-ink">{row.summary}</span>
                </p>
                {row.lessonTitle && row.lessonId ? (
                  <Link href={`/admin/lessons/${row.lessonId}`} className="text-caption text-muted hover:text-ink hover:underline">
                    {row.lessonTitle}
                  </Link>
                ) : null}
              </div>
              <p className="text-caption text-muted">{row.actorName ? `بواسطة ${row.actorName}` : row.source === "ai" ? "النظام" : "—"}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-caption text-faint">{ar(rows.length)} حدثًا (أحدث ٢٥٠). الاعتمادات القديمة المعلّمة «قبل تفعيل سجل العمليات» أُعيد بناؤها من بيانات الاعتماد المحفوظة على المقاطع والتوقيتات.</p>
    </>
  );
}
