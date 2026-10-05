import type { Metadata } from "next";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { prisma } from "@/server/db";
import { requireAdminPage } from "@/server/auth/current-user";
import { getMatnOverview, type MatnAdminSection } from "@/server/admin/matn";
import { setMatnPassageApprovalAction, setMatnSectionApprovalAction, updateMatnUnitTextAction } from "./actions";
import { AdminForm } from "@/components/admin/admin-form";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TextArea } from "@/components/ui/field";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "حفظ المتن — المراجعة والاعتماد" };

const statusBadge = (status: "DRAFT" | "APPROVED") => (status === "APPROVED" ? <Badge tone="success">معتمد</Badge> : <Badge tone="warning">مسودة</Badge>);

function SectionCard({ section }: { section: MatnAdminSection }) {
  const units = section.passages.flatMap((p) => p.units);
  const approvedPassages = section.passages.filter((p) => p.status === "APPROVED").length;
  return (
    <details className="group rounded-xl border border-line bg-surface" data-testid="matn-section">
      <summary className="cursor-pointer list-none px-5 py-4 marker:hidden">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ChevronLeft className="size-4 shrink-0 transition-transform duration-200 group-open:-rotate-90" aria-hidden />
          <span className="font-naskh text-card font-semibold text-ink">{section.title}</span>
          {section.titleIsDerived ? <Badge tone="gold">عنوان تنقّل مشتق من التطبيق</Badge> : null}
          {statusBadge(section.status)}
          <span className="text-caption text-muted">
            {ar(section.passages.length)} مقاطع · {ar(units.length)} وحدة · معتمد {ar(approvedPassages)}/{ar(section.passages.length)}
          </span>
        </span>
      </summary>

      <div className="space-y-6 border-t border-line px-5 py-5">
        {section.sourceHeading ? <p className="text-caption text-muted">العنوان في المصدر: «{section.sourceHeading}»</p> : null}
        <div className="flex flex-wrap gap-3">
          <AdminForm action={setMatnSectionApprovalAction} submitLabel="اعتماد القسم مع كل مقاطعه" size="sm" inline>
            <input type="hidden" name="id" value={section.id} />
            <input type="hidden" name="approved" value="true" />
            <input type="hidden" name="cascade" value="true" />
          </AdminForm>
          <AdminForm action={setMatnSectionApprovalAction} submitLabel="إلغاء اعتماد القسم ومقاطعه" size="sm" variant="secondary" inline>
            <input type="hidden" name="id" value={section.id} />
            <input type="hidden" name="approved" value="false" />
            <input type="hidden" name="cascade" value="true" />
          </AdminForm>
        </div>

        {section.passages.map((passage) => (
          <Card key={passage.id} as="article" aria-label={passage.title} data-testid="matn-passage" className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-card font-semibold text-ink">
                المقطع {ar(passage.order)}: {passage.title}
              </h3>
              {statusBadge(passage.status)}
              <span className="text-caption text-muted">
                {ar(passage.units.length)} وحدات · {ar(passage.words)} كلمة
              </span>
            </div>

            <ol className="mt-4 space-y-3">
              {passage.units.map((unit) => (
                <li key={unit.id} className="rounded-lg border border-line bg-paper/60 p-3" data-testid="matn-admin-unit">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-caption font-medium tabular-nums text-muted">{ar(unit.order)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-naskh text-matn text-ink [overflow-wrap:anywhere]" lang="ar">
                        {unit.text}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted">
                        <span>{ar(unit.words)} كلمة</span>
                        {statusBadge(unit.status)}
                        {unit.suspicious.length ? (
                          <Badge tone="error" icon={<TriangleAlert className="size-3" aria-hidden />}>
                            رمز مشبوه: {unit.suspicious.join(" ")} — يمنع الاعتماد
                          </Badge>
                        ) : null}
                      </div>
                      {unit.notes.length ? (
                        <ul className="mt-2 list-disc space-y-0.5 ps-5 text-caption text-warning-ink">
                          {unit.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      ) : null}
                      <details className="mt-3">
                        <summary className="cursor-pointer text-caption font-medium text-ink underline-offset-4 hover:underline">تحرير النص (يُلغي الاعتماد)</summary>
                        <AdminForm action={updateMatnUnitTextAction} submitLabel="حفظ النص" size="sm" className="mt-3 space-y-3">
                          <input type="hidden" name="unitId" value={unit.id} />
                          <TextArea id={`unit-${unit.id}`} name="text" label="النص القانوني" defaultValue={unit.text} rows={3} dir="rtl" lang="ar" className="py-2 font-naskh" />
                        </AdminForm>
                      </details>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-4 flex flex-wrap gap-3">
              <AdminForm action={setMatnPassageApprovalAction} submitLabel="اعتماد المقطع" size="sm" inline>
                <input type="hidden" name="id" value={passage.id} />
                <input type="hidden" name="approved" value="true" />
              </AdminForm>
              <AdminForm action={setMatnPassageApprovalAction} submitLabel="إلغاء الاعتماد" size="sm" variant="secondary" inline>
                <input type="hidden" name="id" value={passage.id} />
                <input type="hidden" name="approved" value="false" />
              </AdminForm>
            </div>
          </Card>
        ))}
      </div>
    </details>
  );
}

export default async function MatnAdminPage() {
  await requireAdminPage();
  const books = await getMatnOverview(prisma);
  const all = books.flatMap((b) => b.sections);
  const units = all.flatMap((s) => s.passages.flatMap((p) => p.units));
  const approved = units.filter((u) => u.status === "APPROVED").length;

  return (
    <div>
      <PageHeader
        title="حفظ المتن — المراجعة والاعتماد"
        description="راجع كل قسم ومقطع ووحدة بنصها القانوني قبل أن يراه الطلاب. التقسيم المستورد مسودة، ولا يظهر لأي طالب إلا بعد اعتمادك. تعديل نص وحدة يُلغي اعتمادها ويخفي مقطعها حتى يُعتمد من جديد."
      />
      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong bg-surface-2/40 px-4 py-8 text-center text-small text-muted">لم يُستورد متن بعد. شغّل: npm run content:import-matn</p>
      ) : (
        <>
          <p className="mb-6 text-small text-muted" data-testid="matn-admin-totals">
            {ar(all.length)} أقسام · {ar(all.reduce((n, s) => n + s.passages.length, 0))} مقطعًا · {ar(units.length)} وحدة · المعتمد منها {ar(approved)}
          </p>
          <div className="space-y-10">
            {books.map((book) => (
              <section key={book.courseTitle} aria-label={book.courseTitle} className="space-y-3">
                <h2 className="font-naskh text-section font-semibold text-ink">{book.courseTitle}</h2>
                {book.sections.map((s) => (
                  <SectionCard key={s.id} section={s} />
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
