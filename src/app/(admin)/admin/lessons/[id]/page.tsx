import type { Metadata } from "next";
import { requireAdminPage } from "@/server/auth/current-user";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShieldCheck, ShieldOff } from "lucide-react";
import { prisma } from "@/server/db";
import { getLessonReviewSummary } from "@/server/admin/content";
import { getLessonOverview } from "@/server/admin/content-overview";
import {
  bulkApproveLessonReviewAction,
  createConceptAction,
  createPassageAction,
  setFixedQuestionApprovalAction,
  setConceptVideoApprovalAction,
  setPassageApprovalAction,
  setConceptApprovalAction,
  setLessonPublicationAction,
  updateConceptAction,
  updateConceptVideoAction,
  updateLessonAction,
  updatePassageAction,
} from "../../actions";
import { AdminForm } from "@/components/admin/admin-form";
import { AlignmentReview } from "@/components/admin/alignment-review";
import { ConceptReviewWorkspace } from "@/components/admin/concept-review-workspace";
import { CombinedStatusBadge, ContentStatusBadge, PublicationBadge } from "@/components/admin/status-chips";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SelectField, TextArea, TextField } from "@/components/ui/field";
import { FixedQuestionBuilder } from "@/components/admin/fixed-question-builder";
import { ar } from "@/lib/format";
import { formatTimestamp, timestampRange } from "@/lib/video";

export const metadata: Metadata = { title: "تحرير الدرس" };

function Details({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group mt-3" open={open}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-small font-medium text-ink marker:hidden">
        <ChevronLeft className="size-4 transition-transform duration-200 group-open:-rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

export default async function AdminLessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ concept?: string }> }) {
  const actor = await requireAdminPage();
  const { id } = await params;
  const { concept: focusConceptId } = await searchParams;
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    include: {
      chapter: { include: { course: { include: { level: true } } } },
      concepts: { orderBy: { order: "asc" }, include: { passages: { orderBy: { order: "asc" } } } },
      fixedQuestions: { orderBy: { order: "asc" }, include: { concept: { select: { title: true } }, sourcePassage: { select: { sourceReference: true } } } },
    },
  });
  if (!lesson) notFound();
  const review = await getLessonReviewSummary(prisma, actor, { lessonId: lesson.id });
  const overview = await getLessonOverview(prisma, actor, lesson.id);
  if (!overview) notFound();
  const allPassages = lesson.concepts.flatMap((c) => c.passages);
  const distinct = <T,>(values: (T | null | undefined)[]) => [...new Set(values.filter((v): v is T => v != null && v !== ""))];
  const videoUrls = distinct([...lesson.concepts.map((c) => c.videoUrl), ...allPassages.map((p) => p.videoUrl)]);
  const pdfSources = distinct(allPassages.map((p) => p.pdfSource?.split(" — ")[0]));
  const pdfPages = allPassages.flatMap((p) => [p.pdfPageStart, p.pdfPageEnd]).filter((n): n is number => n != null);
  const bahethUrls = distinct(allPassages.map((p) => p.bahethUrl));
  const sourceUrls = distinct(allPassages.map((p) => p.sourceUrl));
  const versions = allPassages.map((p) => p.version);
  const durationSeconds = Math.max(0, ...allPassages.map((p) => p.endSecond ?? 0), ...lesson.concepts.map((c) => c.videoEndSecond ?? 0));
  const provenance = distinct(allPassages.map((p) => [p.sourceTitle, p.sourceAuthor, p.edition].filter(Boolean).join(" — ")));
  const reviewWorkspaceConcepts = lesson.concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
    videoUrl: concept.videoUrl,
    startSecond: concept.videoStartSecond,
    endSecond: concept.videoEndSecond,
    videoApproved: concept.videoApproved,
    passages: concept.passages.map((passage) => ({
      id: passage.id,
      text: passage.text,
      reviewText: passage.reviewText,
      approved: passage.approved,
      humanReviewRequired: passage.humanReviewRequired,
      version: passage.version,
      sourceReference: passage.sourceReference,
      startSecond: passage.startSecond,
      endSecond: passage.endSecond,
    })),
  }));
  const totalPassages = review.concepts.flatMap((concept) => concept.passages);
  const approvedPassageCount = totalPassages.filter((passage) => passage.approved).length;
  const approvedTimestampCount = review.concepts.filter((concept) => concept.videoApproved).length;
  const passages = lesson.concepts.flatMap((c) => c.passages.map((p) => ({ ...p, conceptTitle: c.title })));
  const flaggedConcepts = lesson.concepts.filter((c) => c.passages.some((p) => p.humanReviewRequired));
  const statusCounts: Record<string, number> = {};
  for (const c of lesson.concepts) for (const p of c.passages) if (p.alignmentStatus) statusCounts[p.alignmentStatus] = (statusCounts[p.alignmentStatus] ?? 0) + 1;
  const approvedBaseQuestions = lesson.fixedQuestions.filter((question) => question.approved);
  const coveredConceptIds = new Set(approvedBaseQuestions.map((question) => question.conceptId));
  const uncoveredConcepts = lesson.concepts.filter((concept) => !coveredConceptIds.has(concept.id));

  return (
    <div className="space-y-10">
      <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-1 text-caption text-muted">
        <Link href="/admin/lessons" className="hover:text-ink">
          الدروس
        </Link>
        <ChevronLeft className="size-3.5" aria-hidden />
        <span>
          {lesson.chapter.title} — {lesson.title}
        </span>
      </nav>

      <header className="-mt-4 space-y-3">
        <h1 className="text-title text-ink" data-testid="lesson-admin-title">
          {lesson.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2" data-testid="lesson-status-chips">
          <CombinedStatusBadge status={overview.combinedStatus} />
          <ContentStatusBadge status={overview.contentStatus} />
          <PublicationBadge status={overview.publication} />
          {overview.publishedWithRevokedApproval ? <Badge tone="warning">منشور وبعض الاعتماد ملغى</Badge> : null}
        </div>
        <nav aria-label="أقسام الدرس" className="flex flex-wrap gap-x-5 gap-y-1 text-small">
          {[
            ["#lesson-info", "معلومات الدرس"],
            ["#publication", "النشر"],
            ["#source-info", "المصدر"],
            ["#video-verifier", "الفيديو"],
            ["#concepts", "المفاهيم"],
            ["#lesson-review", "الاعتماد"],
            ["#fixed", "الأسئلة الثابتة"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="text-muted underline-offset-4 hover:text-ink hover:underline">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Card as="section" id="lesson-info" aria-labelledby="lesson-info-title">
        <h2 id="lesson-info-title" className="text-section text-ink">
          معلومات الدرس
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 [overflow-wrap:anywhere] [&>div]:min-w-0 text-small sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-muted">الاسم</dt><dd className="text-ink">{lesson.title}</dd></div>
          <div><dt className="text-muted">رقم الدرس</dt><dd className="text-ink">{ar(lesson.order)}</dd></div>
          <div><dt className="text-muted">المستوى</dt><dd className="text-ink">{lesson.chapter.course.level ? `المستوى ${ar(lesson.chapter.course.level.order)} — ${lesson.chapter.course.level.title}` : "بلا مستوى"}</dd></div>
          <div><dt className="text-muted">الكتاب</dt><dd className="text-ink">{lesson.chapter.course.title} · {lesson.chapter.title}</dd></div>
          <div>
            <dt className="text-muted">فيديو YouTube</dt>
            <dd className="space-y-0.5 break-all text-ink" dir="ltr">
              {videoUrls.length ? videoUrls.map((u) => <span key={u} className="block">{u}</span>) : "غير مسجل"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">مدة الفيديو</dt>
            <dd className="text-ink">{durationSeconds > 0 ? `نحو ${ar(formatTimestamp(durationSeconds))} (أبعد توقيت مسجّل)` : "غير معروفة"}</dd>
          </div>
          <div><dt className="text-muted">حالة المحتوى</dt><dd><ContentStatusBadge status={overview.contentStatus} /></dd></div>
          <div><dt className="text-muted">حالة النشر</dt><dd><PublicationBadge status={overview.publication} /></dd></div>
        </dl>
      </Card>

      <Card as="section" id="publication" aria-labelledby="publication-title" tone="muted" data-testid="publication-card">
        <h2 id="publication-title" className="text-card font-semibold text-ink">
          النشر للطلاب
        </h2>
        <p className="mt-1 text-small text-muted">
          النشر قرار منفصل عن الاعتماد: اعتماد المقاطع والتوقيتات لا ينشر الدرس تلقائيًا. لا يمكن نشر الدرس إلا بعد اعتماد كل مقاطعه وتوقيتاته، ويُسجَّل اسمك ووقت القرار.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {overview.publication !== "PUBLISHED" ? (
            overview.contentStatus === "APPROVED" ? (
              <AdminForm action={setLessonPublicationAction} submitLabel="نشر الدرس للطلاب" variant="sage" inline>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <input type="hidden" name="status" value="PUBLISHED" />
              </AdminForm>
            ) : (
              <p className="text-small text-warning-ink" data-testid="publish-blocked">النشر غير متاح: اعتمد جميع المقاطع والتوقيتات أولًا.</p>
            )
          ) : (
            <AdminForm action={setLessonPublicationAction} submitLabel="إيقاف النشر (إرجاع إلى مسودة)" variant="ghost" inline>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <input type="hidden" name="status" value="DRAFT" />
            </AdminForm>
          )}
          {overview.publication === "DRAFT" ? (
            <AdminForm action={setLessonPublicationAction} submitLabel="إظهاره كـ«قيد الإعداد» (مقفل)" variant="ghost" inline>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <input type="hidden" name="status" value="COMING_SOON" />
            </AdminForm>
          ) : null}
          {overview.publication === "COMING_SOON" ? (
            <AdminForm action={setLessonPublicationAction} submitLabel="إخفاؤه (مسودة)" variant="ghost" inline>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <input type="hidden" name="status" value="DRAFT" />
            </AdminForm>
          ) : null}
        </div>
      </Card>

      <Card as="section" id="source-info" aria-labelledby="source-info-title" data-testid="lesson-source-info">
        <h2 id="source-info-title" className="text-section text-ink">
          المصدر <span className="text-caption font-normal text-faint">(للإدارة فقط)</span>
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 [overflow-wrap:anywhere] [&>div]:min-w-0 text-small sm:grid-cols-2">
          <div><dt className="text-muted">ملف PDF / Word</dt><dd className="text-ink">{pdfSources.length ? pdfSources.join("، ") : "لا يوجد"}</dd></div>
          <div><dt className="text-muted">الصفحات</dt><dd className="text-ink">{pdfPages.length ? `${ar(Math.min(...pdfPages))}–${ar(Math.max(...pdfPages))}` : "غير مسجلة"}</dd></div>
          <div>
            <dt className="text-muted">تفريغ باحث / metadata الفيديو</dt>
            <dd className="break-all text-ink" dir="ltr">{bahethUrls.length ? bahethUrls.map((u) => <span key={u} className="block">{u}</span>) : "لا يوجد"}</dd>
          </div>
          <div>
            <dt className="text-muted">رابط المصدر الأصلي (source URL)</dt>
            <dd className="break-all text-ink" dir="ltr">{sourceUrls.length ? sourceUrls.map((u) => <span key={u} className="block">{u}</span>) : "لا يوجد"}</dd>
          </div>
          <div><dt className="text-muted">الإسناد (provenance)</dt><dd className="text-ink">{provenance.length ? provenance.join(" | ") : "غير مسجل"}</dd></div>
          <div><dt className="text-muted">الإصدار (version)</dt><dd className="text-ink">{versions.length ? `${ar(Math.min(...versions))}${Math.max(...versions) !== Math.min(...versions) ? `–${ar(Math.max(...versions))}` : ""}` : "—"}</dd></div>
        </dl>
      </Card>

      <Card as="section" id="video-verifier" aria-labelledby="video-verifier-title">
        <h2 id="video-verifier-title" className="text-section text-ink">
          التحقق من الفيديو والتوقيتات
        </h2>
        <p className="mt-1 mb-4 text-small text-muted">اختر مفهومًا وشغّل الفيديو من بداية مقطعه للتحقق من توافق النص مع الشرح قبل اعتماد التوقيت.</p>
        <ConceptReviewWorkspace concepts={reviewWorkspaceConcepts} initialConceptId={focusConceptId} />
      </Card>

      <Card as="section" aria-labelledby="lesson-meta">
        <h2 id="lesson-meta" className="text-section text-ink">
          تعديل بيانات الدرس
        </h2>
        <AdminForm action={updateLessonAction} submitLabel="حفظ بيانات الدرس" className="mt-5 space-y-4">
          <input type="hidden" name="lessonId" value={lesson.id} />
          <TextField id="lesson-title" name="title" label="العنوان" defaultValue={lesson.title} required />
          <TextArea id="lesson-desc" name="description" label="الوصف" rows={2} defaultValue={lesson.description} required />
          <TextArea id="lesson-obj" name="objectives" label="الأهداف (هدف في كل سطر)" rows={3} defaultValue={lesson.objectives.join("\n")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="lesson-order" name="order" label="الترتيب" type="number" min={0} defaultValue={lesson.order} />
            <TextField id="lesson-min" name="estimatedMinutes" label="دقائق القراءة" type="number" min={1} defaultValue={lesson.estimatedMinutes ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-small text-ink">
            <input type="checkbox" name="isSample" defaultChecked={lesson.isSample} className="size-4 accent-ink" />
            محتوى تجريبي (يظهر للمتعلم تنبيه «محتوى تجريبي»)
          </label>
          <label className="flex items-center gap-2 text-small text-ink">
            <input type="checkbox" name="measurementEnabled" defaultChecked={lesson.measurementEnabled} className="size-4 accent-ink" />
            قياس قبلي وبعدي (اختبار قبلي قبل الدراسة، واختبار بعدي بعد الاختبار — من بنك الأسئلة الثابتة)
          </label>
        </AdminForm>
      </Card>

      <details id="concepts" className="group rounded-xl border border-line bg-surface p-5">
        <summary className="cursor-pointer text-section font-semibold text-ink">إدارة تفصيلية للمفاهيم والمقاطع المصدرية</summary>
        <div className="mt-5 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="concepts" className="text-section text-ink">
            المفاهيم والمقاطع المصدرية
          </h2>
          <a href="#lesson-review" className="rounded-md bg-ink px-4 py-2 text-small font-semibold text-surface hover:bg-ink-dark">
            مراجعة واعتماد الدرس كاملًا
          </a>
        </div>

        {flaggedConcepts.length ? (
          <div role="alert" className="rounded-lg border border-red-600/40 bg-red-50 p-4 text-small text-red-800" data-testid="human-review-summary">
            <p className="font-semibold">
              HUMAN_REVIEW_REQUIRED — {ar(flaggedConcepts.length)} من {ar(lesson.concepts.length)} مفهومًا فيها نقطة محددة تحتاج قرارًا بشريًا؛ بقية المفاهيم موثّقة ({ar(statusCounts.VERIFIED ?? 0)} موثّق، {ar(statusCounts.VERIFIED_WITH_CLEANUP ?? 0)} موثّق بعد تنظيف آلي).
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {flaggedConcepts.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="underline">
                    {ar(c.order)}. {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {lesson.pdfOnlyUntimedText ? (
          <Card as="section" aria-labelledby="pdf-only-untimed" tone="muted" data-testid="pdf-only-untimed">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="pdf-only-untimed" className="text-card font-semibold text-ink">نص PDF بلا توقيت (PDF_ONLY_UNTIMED)</h3>
              <Badge tone="neutral">غير معتمد · لا يصل إلى المتعلم أو Gemini</Badge>
            </div>
            <p className="mt-1 text-small text-muted">{lesson.pdfOnlyUntimedNote}</p>
            <Details summary="عرض النص الخام">
              <p className="whitespace-pre-wrap font-naskh text-card leading-9 text-muted">{lesson.pdfOnlyUntimedText}</p>
            </Details>
          </Card>
        ) : null}

        <Card as="section" id="lesson-review" aria-labelledby="lesson-review-title" tone="muted">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="lesson-review-title" className="text-card font-semibold text-ink">مراجعة واعتماد الدرس كاملًا</h3>
              <p className="mt-1 text-small text-muted">راجع كل مفهوم ومصدر وتوقيت يدويًا. لا ينشئ هذا الإجراء نصًا أو توقيتًا ولا ينشر الدرس.</p>
            </div>
            <Badge tone={review.valid ? "success" : "warning"}>{review.valid ? "جاهز للاعتماد" : "يلزم إصلاح"}</Badge>
          </div>
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2" aria-label="حالة اعتماد الدرس">
              <Badge tone={approvedPassageCount === totalPassages.length && totalPassages.length > 0 ? "success" : "warning"}>
                المقاطع المعتمدة {ar(approvedPassageCount)}/{ar(totalPassages.length)}
              </Badge>
              <Badge tone={approvedTimestampCount === review.concepts.length && review.concepts.length > 0 ? "success" : "warning"}>
                التوقيتات المعتمدة {ar(approvedTimestampCount)}/{ar(review.concepts.length)}
              </Badge>
            </div>
            {review.concepts.map((concept) => (
              <article key={concept.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-semibold text-ink">{concept.title}</h4>
                  <div className="flex gap-2">
                    <Badge tone={concept.passages.length > 0 && concept.passages.every((passage) => passage.approved) ? "success" : "warning"}>المقاطع {concept.passages.length > 0 && concept.passages.every((passage) => passage.approved) ? "معتمدة" : "غير معتمدة"}</Badge>
                    <Badge tone={concept.videoApproved ? "success" : "warning"}>توقيت المراجعة {concept.videoApproved ? "معتمد" : "غير معتمد"}</Badge>
                  </div>
                </div>
                <dl className="mt-3 grid gap-3 text-small sm:grid-cols-2">
                  <div><dt className="text-muted">فيديو المراجعة</dt><dd className="mt-1 break-all text-ink" dir="ltr">{concept.videoUrl ?? "غير مسجل"}</dd></div>
                  <div><dt className="text-muted">توقيت المراجعة</dt><dd className="mt-1 text-ink">{concept.videoStartSecond != null && concept.videoEndSecond != null ? `${formatTimestamp(concept.videoStartSecond)}–${formatTimestamp(concept.videoEndSecond)}` : "غير مكتمل"}</dd></div>
                </dl>
                {concept.passages.map((passage) => (
                  <div key={passage.id} className="mt-4 border-t border-line pt-4 text-small">
                    <p className="font-naskh text-ink">{passage.text || "(نص فارغ)"}</p>
                    <p className="mt-2 text-muted">{passage.sourceTitle || "مصدر غير مسجل"} — {passage.sourceAuthor || "مؤلف غير مسجل"} · {passage.sourceReference || "إحالة غير مسجلة"}</p>
                    <p className="mt-1 break-all text-muted" dir="ltr">{passage.sourceUrl ?? "No source URL"}</p>
                    <p className="mt-1 text-muted">توقيت المصدر: {passage.startSecond != null && passage.endSecond != null ? `${formatTimestamp(passage.startSecond)}–${formatTimestamp(passage.endSecond)}` : "غير مكتمل"}</p>
                  </div>
                ))}
                {concept.problems.length ? <ul className="mt-4 list-disc space-y-1 pr-5 text-small text-red-700">{concept.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : <p className="mt-4 text-small text-success-ink">لا توجد مشكلات تحقق.</p>}
              </article>
            ))}
          </div>
          {review.valid ? (
            <AdminForm action={bulkApproveLessonReviewAction} submitLabel="اعتماد جميع المقاطع والتوقيتات" variant="sage" className="mt-5 space-y-3">
              <input type="hidden" name="lessonId" value={lesson.id} />
              <p className="text-small text-muted">بالضغط على الاعتماد تؤكد أنك راجعت جميع العناصر أعلاه. سيُسجَّل حسابك ووقت الاعتماد لكل مقطع وتوقيت.</p>
            </AdminForm>
          ) : (
            <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-50 p-3 text-small text-warning-ink">أصلح المشكلات الموضحة أعلاه أولًا؛ لن يعتمد النظام أي مقطع أو توقيت في هذا الدرس حتى تصبح المراجعة صالحة بالكامل.</p>
          )}
        </Card>
        {lesson.concepts.map((concept) => (
          <Card key={concept.id} as="article" id={`concept-${concept.id}`} className={focusConceptId === concept.id ? "ring-2 ring-gold" : undefined}>
            <span id={concept.id} aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-card font-semibold text-ink">
                {ar(concept.order)}. {concept.title}
              </h3>
              <span className="max-w-full break-all text-caption text-faint" dir="ltr">
                {concept.id}
              </span>
            </div>
            <p className="mt-1 text-small text-muted">{concept.description}</p>
            {(() => {
              const reviewed = review.concepts.find((r) => r.id === concept.id);
              const textApproved = concept.passages.length > 0 && concept.passages.every((p) => p.approved);
              const flagged = concept.passages.some((p) => p.humanReviewRequired);
              const worst = concept.passages.find((p) => p.alignmentStatus === "CONFLICT" || p.alignmentStatus === "UNCERTAIN")?.alignmentStatus ?? concept.passages[0]?.alignmentStatus ?? null;
              const blocking = (reviewed?.problems ?? []).filter((p) => !p.startsWith("HUMAN_REVIEW_REQUIRED"));
              return (
                <div className="mt-3 rounded-lg border border-line bg-surface-2/40 p-3" data-testid="concept-status-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={flagged ? "error" : blocking.length ? "warning" : "success"}>
                      التحقق: {flagged ? "يحتاج مراجعة بشرية" : blocking.length ? "به مشكلات" : "اجتاز التحقق"}
                    </Badge>
                    {worst ? <Badge tone="neutral">المطابقة: <span dir="ltr">{worst}</span></Badge> : null}
                    <Badge tone={textApproved ? "success" : "warning"}>النص: {textApproved ? "معتمد" : "غير معتمد"}</Badge>
                    <Badge tone={concept.videoApproved ? "success" : "warning"}>التوقيت: {concept.videoApproved ? "معتمد" : "غير معتمد"}</Badge>
                    <span className="text-caption text-muted tabular-nums" dir="ltr">
                      {concept.videoStartSecond != null ? formatTimestamp(concept.videoStartSecond) : "—"} → {concept.videoEndSecond != null ? formatTimestamp(concept.videoEndSecond) : "—"}
                    </span>
                  </div>
                  {blocking.length ? <ul className="mt-2 list-disc space-y-0.5 ps-5 text-caption text-error-ink">{blocking.map((b) => <li key={b}>{b}</li>)}</ul> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AdminForm action={setConceptApprovalAction} submitLabel={textApproved && concept.videoApproved ? "إلغاء اعتماد المفهوم" : "اعتماد المفهوم (النص والتوقيت)"} variant={textApproved && concept.videoApproved ? "ghost" : "sage"} size="sm" inline>
                      <input type="hidden" name="id" value={concept.id} />
                      <input type="hidden" name="approved" value={textApproved && concept.videoApproved ? "false" : "true"} />
                    </AdminForm>
                    <a href={`/admin/lessons/${lesson.id}?concept=${concept.id}#video-verifier`} className="text-small text-ink underline underline-offset-4">
                      تحقق من الفيديو
                    </a>
                  </div>
                </div>
              );
            })()}
            <Details summary="تعديل المفهوم">
              <AdminForm action={updateConceptAction} submitLabel="حفظ المفهوم" size="sm">
                <input type="hidden" name="conceptId" value={concept.id} />
                <TextField id={`c-title-${concept.id}`} name="title" label="العنوان" defaultValue={concept.title} required />
                <TextArea id={`c-desc-${concept.id}`} name="description" label="الوصف" rows={2} defaultValue={concept.description} required />
                <TextField id={`c-order-${concept.id}`} name="order" label="الترتيب" type="number" min={0} defaultValue={concept.order} />
              </AdminForm>
            </Details>

            <div className="mt-4 rounded-lg border border-line bg-surface p-4" data-testid="concept-video-admin">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-small font-medium text-ink">المقطع المرئي للمراجعة</p>
                {concept.videoUrl ? (
                  concept.videoApproved ? (
                    <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />}>
                      معتمد · <span>{concept.videoStartSecond != null ? timestampRange({ url: concept.videoUrl, startSecond: concept.videoStartSecond, endSecond: concept.videoEndSecond }) : ""}</span>
                    </Badge>
                  ) : (
                    <Badge tone="warning" icon={<ShieldOff className="size-3" aria-hidden />}>
                      غير معتمد — لا يُعرض على المتعلم
                    </Badge>
                  )
                ) : (
                  <Badge tone="neutral">لا يوجد</Badge>
                )}
              </div>
              <p className="mt-1 text-caption text-muted">
                يُدخل الرابط ووقتا البداية والنهاية يدويًا بعد مشاهدة الشرح. أي تعديل يُلغي الاعتماد حتى يُراجع من جديد.
              </p>
              <Details summary={concept.videoUrl ? "تعديل المقطع" : "إضافة مقطع"}>
                <AdminForm action={updateConceptVideoAction} submitLabel="حفظ المقطع" size="sm">
                  <input type="hidden" name="conceptId" value={concept.id} />
                  <TextField id={`v-url-${concept.id}`} name="videoUrl" label="رابط الفيديو (YouTube أو ملف https)" dir="ltr" defaultValue={concept.videoUrl ?? ""} hint="اتركه فارغًا لحذف المقطع." />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField id={`v-start-${concept.id}`} name="videoStart" label="بداية الجزء (دقائق:ثوانٍ)" dir="ltr" placeholder="12:35" defaultValue={concept.videoStartSecond != null ? formatTimestamp(concept.videoStartSecond) : ""} />
                    <TextField id={`v-end-${concept.id}`} name="videoEnd" label="نهاية الجزء (اختياري)" dir="ltr" placeholder="16:20" defaultValue={concept.videoEndSecond != null ? formatTimestamp(concept.videoEndSecond) : ""} />
                  </div>
                </AdminForm>
              </Details>
              {concept.videoUrl ? (
                <div className="mt-3">
                  <AdminForm action={setConceptVideoApprovalAction} submitLabel={concept.videoApproved ? "إلغاء اعتماد المقطع" : "اعتماد المقطع والتوقيت"} variant={concept.videoApproved ? "ghost" : "sage"} size="sm" inline>
                    <input type="hidden" name="id" value={concept.id} />
                    <input type="hidden" name="approved" value={concept.videoApproved ? "false" : "true"} />
                  </AdminForm>
                </div>
              ) : null}
            </div>

            <div className="mt-5 space-y-4">
              {concept.passages.map((passage) => (
                <div
                  key={passage.id}
                  id={`source-passage-${passage.id}`}
                  data-concept-passage={concept.id}
                  tabIndex={-1}
                  className="rounded-lg border border-line bg-paper/60 p-4 outline-none"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {passage.approved ? (
                        <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />}>
                          معتمد
                        </Badge>
                      ) : (
                        <Badge tone="warning" icon={<ShieldOff className="size-3" aria-hidden />}>
                          غير معتمد — لا يُرسل إلى التوليد
                        </Badge>
                      )}
                      <Badge tone="neutral">الإصدار {ar(passage.version)}</Badge>
                      {passage.isSample ? <Badge tone="gold">تجريبي</Badge> : null}
                    </div>
                    <AdminForm action={setPassageApprovalAction} submitLabel={passage.approved ? "إلغاء الاعتماد" : "اعتماد المقطع"} variant={passage.approved ? "ghost" : "sage"} size="sm" inline>
                      <input type="hidden" name="id" value={passage.id} />
                      <input type="hidden" name="approved" value={passage.approved ? "false" : "true"} />
                    </AdminForm>
                  </div>
                  <p className="mt-3 text-caption font-medium text-gold-ink">reviewText — النص المراجَع (الذي يُستخدم في التوليد بعد الاعتماد)</p>
                  <p className="mt-1 font-naskh text-card leading-9 text-ink-dark" data-testid="passage-review-text">{passage.text}</p>
                  <AlignmentReview passage={passage} />
                  {passage.reviewText && passage.reviewText !== passage.text ? <Details summary="النص المُراجع الكامل (يختلف عن المقطع الحالي)"><p className="font-naskh text-card leading-9 text-ink-dark">{passage.reviewText}</p></Details> : null}
                  {passage.rawPdfText ? <Details summary="نص PDF الخام"><p className="whitespace-pre-wrap font-naskh text-card leading-9 text-muted">{passage.rawPdfText}</p></Details> : null}
                  {passage.rawBahethText ? <Details summary="تفريغ باحث الخام"><p className="font-naskh text-card leading-9 text-muted">{passage.rawBahethText}</p></Details> : null}
                  <p className="mt-2 text-caption text-muted">
                    {passage.sourceTitle} — {passage.sourceAuthor} · {passage.sourceReference}
                    {passage.edition ? ` · الطبعة: ${passage.edition}` : ""}
                  </p>
                  <p className="text-caption text-muted">
                    الترخيص: {passage.license ?? "غير محدد"} · الإذن: {passage.permissionNote ?? "غير مسجّل"}
                  </p>
                  {passage.sourceUrl || passage.startSecond != null ? (
                    <p className="text-caption text-muted" dir="ltr">
                      {passage.sourceUrl ?? "No source URL"}
                      {passage.startSecond != null ? ` · ${formatTimestamp(passage.startSecond)}${passage.endSecond != null ? `–${formatTimestamp(passage.endSecond)}` : ""}` : ""}
                    </p>
                  ) : null}
                  <Details summary="تعديل النص أو بيانات المصدر">
                    <AdminForm action={updatePassageAction} submitLabel="حفظ المقطع" size="sm">
                      <input type="hidden" name="passageId" value={passage.id} />
                      <TextArea id={`p-text-${passage.id}`} name="text" label="النص (تغييره يُلغي الاعتماد)" rows={5} defaultValue={passage.text} className="font-naskh" required />
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextField id={`p-st-${passage.id}`} name="sourceTitle" label="عنوان المصدر" defaultValue={passage.sourceTitle} required />
                        <TextField id={`p-sa-${passage.id}`} name="sourceAuthor" label="المؤلف" defaultValue={passage.sourceAuthor} required />
                        <TextField id={`p-sr-${passage.id}`} name="sourceReference" label="الموضع / المرجع" defaultValue={passage.sourceReference} required />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextField id={`p-ed-${passage.id}`} name="edition" label="الطبعة / التحقيق" defaultValue={passage.edition ?? ""} />
                        <TextField id={`p-li-${passage.id}`} name="license" label="الترخيص" defaultValue={passage.license ?? ""} />
                        <TextField id={`p-pn-${passage.id}`} name="permissionNote" label="الإذن بالنشر" defaultValue={passage.permissionNote ?? ""} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextField id={`p-url-${passage.id}`} name="sourceUrl" label="رابط المصدر الأصلي (https)" dir="ltr" defaultValue={passage.sourceUrl ?? ""} />
                        <TextField id={`p-start-${passage.id}`} name="startSecond" label="بداية مقطع التفريغ (ثوانٍ)" type="number" min={0} defaultValue={passage.startSecond ?? ""} />
                        <TextField id={`p-end-${passage.id}`} name="endSecond" label="نهاية مقطع التفريغ (ثوانٍ)" type="number" min={0} defaultValue={passage.endSecond ?? ""} />
                      </div>
                    </AdminForm>
                  </Details>
                </div>
              ))}
            </div>

            <Details summary="إضافة مقطع مصدري لهذا المفهوم">
              <AdminForm action={createPassageAction} submitLabel="إضافة المقطع" size="sm" resetOnSuccess>
                <input type="hidden" name="conceptId" value={concept.id} />
                <TextArea id={`np-text-${concept.id}`} name="text" label="النص المعتمد كما في المصدر" rows={5} className="font-naskh" required />
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField id={`np-st-${concept.id}`} name="sourceTitle" label="عنوان المصدر" defaultValue="أخصر المختصرات" required />
                  <TextField id={`np-sa-${concept.id}`} name="sourceAuthor" label="المؤلف" defaultValue="محمد بن بدر الدين بن بلبان الحنبلي" required />
                  <TextField id={`np-sr-${concept.id}`} name="sourceReference" label="الموضع / المرجع" required />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField id={`np-ed-${concept.id}`} name="edition" label="الطبعة / التحقيق" />
                  <TextField id={`np-li-${concept.id}`} name="license" label="الترخيص" hint="مثال: ملك عام، أو بإذن الناشر" />
                  <TextField id={`np-pn-${concept.id}`} name="permissionNote" label="الإذن بالنشر" hint="من منح الإذن ومتى" />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField id={`np-url-${concept.id}`} name="sourceUrl" label="رابط المصدر الأصلي (https)" dir="ltr" hint="للتتبع فقط؛ لا يجلبه النظام تلقائيًا." />
                  <TextField id={`np-start-${concept.id}`} name="startSecond" label="بداية مقطع التفريغ (ثوانٍ)" type="number" min={0} />
                  <TextField id={`np-end-${concept.id}`} name="endSecond" label="نهاية مقطع التفريغ (ثوانٍ)" type="number" min={0} />
                </div>
                <p className="text-caption text-muted">يُحفظ هذا المقطع كمراجعة بشرية غير معتمدة؛ لا يصبح صالحًا للتوليد إلا بعد اعتماد صريح.</p>
              </AdminForm>
            </Details>
          </Card>
        ))}

        <Card tone="muted">
          <h3 className="text-card font-semibold text-ink">مفهوم جديد</h3>
          <AdminForm action={createConceptAction} submitLabel="إضافة المفهوم" size="sm" resetOnSuccess className="mt-4 space-y-4">
            <input type="hidden" name="lessonId" value={lesson.id} />
            <TextField id="nc-title" name="title" label="العنوان" required />
            <TextArea id="nc-desc" name="description" label="الوصف" rows={2} required />
            <TextField id="nc-order" name="order" label="الترتيب" type="number" min={0} defaultValue={lesson.concepts.length + 1} />
          </AdminForm>
        </Card>
        </div>
      </details>

      <section aria-labelledby="fixed" className="space-y-5">
        <div>
          <h2 id="fixed" className="text-section text-ink">
            بنك الأسئلة الثابتة
          </h2>
          <p className="mt-1 text-small text-muted">الاختبار الأساسي للطلاب يُسحب من هذا البنك المعتمد في قاعدة البيانات.</p>
          <p className="mt-2 text-small font-medium text-ink" data-testid="question-bank-coverage">
            {ar(approvedBaseQuestions.length)} سؤالًا معتمدًا · التغطية: {ar(coveredConceptIds.size)}/{ar(lesson.concepts.length)}
          </p>
          {uncoveredConcepts.length ? <p className="mt-1 text-caption text-warning-ink">بلا سؤال أساسي: {uncoveredConcepts.map((concept) => concept.title).join("، ")}</p> : null}
        </div>
        {lesson.fixedQuestions.length ? (
          <ul className="space-y-3">
            {lesson.fixedQuestions.map((q) => (
              <li key={q.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={q.approved ? "success" : "warning"}>{q.approved ? "معتمد" : "غير معتمد"}</Badge>
                    <Badge tone="neutral">{q.questionType === "MCQ" ? "اختيار من متعدد" : "صح أو خطأ"}</Badge>
                    <Badge tone="ink">{q.concept.title}</Badge>
                    <Badge tone="neutral">{q.sourcePassage.sourceReference}</Badge>
                  </div>
                  <AdminForm action={setFixedQuestionApprovalAction} submitLabel={q.approved ? "إلغاء الاعتماد" : "اعتماد"} variant={q.approved ? "ghost" : "sage"} size="sm" inline>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="approved" value={q.approved ? "false" : "true"} />
                  </AdminForm>
                </div>
                <p className="mt-3 text-body text-ink">{q.question}</p>
                <ol className="mt-2 space-y-1 text-small">
                  {q.options.map((o, i) => (
                    <li key={i} className={i === q.correctIndex ? "font-medium text-success-ink" : "text-muted"}>
                      {i === q.correctIndex ? "✓ " : "· "}
                      {o}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">لا أسئلة ثابتة لهذا الدرس بعد.</p>
        )}

        {passages.length ? <FixedQuestionBuilder passages={passages} concepts={lesson.concepts.map((concept) => ({ id: concept.id, title: concept.title }))} /> : null}
      </section>
    </div>
  );
}
