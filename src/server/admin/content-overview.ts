import type { PrismaClient } from "@/generated/prisma/client";
import type { LessonStatus } from "@/generated/prisma/enums";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { analyzeLessonConcepts, HUMAN_REVIEW_PREFIX, REVIEW_CONCEPT_SELECT } from "./content";

type Actor = Pick<SessionUser, "id" | "role"> | null;

/**
 * Content state is about the SOURCE material (internal approval); publication is about what
 * students can see. They are tracked separately: approving a source never publishes a lesson.
 */
export type ContentStatus = "DRAFT" | "READY_FOR_REVIEW" | "APPROVED";
export type CombinedStatus = ContentStatus | "PUBLISHED";

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: "مسودة",
  READY_FOR_REVIEW: "جاهز للمراجعة",
  APPROVED: "معتمد داخليًا",
};
export const COMBINED_STATUS_LABEL: Record<CombinedStatus, string> = { ...CONTENT_STATUS_LABEL, PUBLISHED: "منشور للطلاب" };
export const PUBLICATION_LABEL: Record<LessonStatus, string> = { DRAFT: "غير منشور (مخفي)", COMING_SOON: "قيد الإعداد (ظاهر ومقفل)", PUBLISHED: "منشور للطلاب" };

export type LessonOverview = {
  id: string;
  title: string;
  order: number;
  publication: LessonStatus;
  isSample: boolean;
  courseId: string;
  courseTitle: string;
  chapterId: string;
  chapterTitle: string;
  concepts: number;
  passages: number;
  approvedPassages: number;
  approvedTimestamps: number;
  humanReviewConcepts: number;
  contentStatus: ContentStatus;
  combinedStatus: CombinedStatus;
  /** Approved internally but not yet visible to students. */
  readyToPublish: boolean;
  /** Visible to students although some approval was later revoked. */
  publishedWithRevokedApproval: boolean;
};

export type ReviewKind = "HUMAN_REVIEW" | "TEXT_UNAPPROVED" | "TIMESTAMP_UNAPPROVED" | "SOURCE_CONFLICT" | "READY_TO_APPROVE" | "READY_TO_PUBLISH";

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  HUMAN_REVIEW: "يحتاج مراجعة بشرية",
  TEXT_UNAPPROVED: "نص غير معتمد",
  TIMESTAMP_UNAPPROVED: "توقيت غير معتمد",
  SOURCE_CONFLICT: "مشكلة بين المصادر",
  READY_TO_APPROVE: "جاهز للاعتماد",
  READY_TO_PUBLISH: "درس جاهز للنشر",
};

export type ReviewItem = {
  kind: ReviewKind;
  lessonId: string;
  lessonTitle: string;
  conceptId: string | null;
  conceptTitle: string | null;
  detail: string;
  /** Opens the lesson control centre directly on the concept (or the lesson's approval section). */
  href: string;
};

export const conceptHref = (lessonId: string, conceptId: string) => `/admin/lessons/${lessonId}?concept=${conceptId}#concept-${conceptId}`;

async function readAll(db: PrismaClient, lessonId?: string) {
  const lessons = await db.lesson.findMany({
    where: lessonId ? { id: lessonId } : undefined,
    orderBy: [{ chapter: { course: { order: "asc" } } }, { chapter: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      order: true,
      status: true,
      isSample: true,
      chapter: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
      concepts: {
        orderBy: { order: "asc" },
        select: {
          ...REVIEW_CONCEPT_SELECT,
          passages: { orderBy: { order: "asc" }, select: { ...REVIEW_CONCEPT_SELECT.passages.select, alignmentStatus: true } },
        },
      },
    },
  });
  return lessons;
}

type Row = Awaited<ReturnType<typeof readAll>>[number];

function summarize(row: Row): { overview: LessonOverview; items: ReviewItem[] } {
  const analysis = analyzeLessonConcepts(row.id, row.concepts);
  const passages = row.concepts.flatMap((c) => c.passages);
  const approvedPassages = passages.filter((p) => p.approved).length;
  const approvedTimestamps = row.concepts.filter((c) => c.videoApproved).length;
  const approvedAll =
    row.concepts.length > 0 && row.concepts.every((c) => c.videoApproved && c.passages.length > 0 && c.passages.every((p) => p.approved));
  const contentStatus: ContentStatus = approvedAll ? "APPROVED" : analysis.valid ? "READY_FOR_REVIEW" : "DRAFT";
  const published = row.status === "PUBLISHED";
  const humanReviewConcepts = row.concepts.filter((c) => c.passages.some((p) => p.humanReviewRequired)).length;

  const overview: LessonOverview = {
    id: row.id,
    title: row.title,
    order: row.order,
    publication: row.status,
    isSample: row.isSample,
    courseId: row.chapter.course.id,
    courseTitle: row.chapter.course.title,
    chapterId: row.chapter.id,
    chapterTitle: row.chapter.title,
    concepts: row.concepts.length,
    passages: passages.length,
    approvedPassages,
    approvedTimestamps,
    humanReviewConcepts,
    contentStatus,
    combinedStatus: published ? "PUBLISHED" : contentStatus,
    readyToPublish: approvedAll && !published,
    publishedWithRevokedApproval: published && !approvedAll,
  };

  const items: ReviewItem[] = [];
  const base = { lessonId: row.id, lessonTitle: row.title };
  const analyzed = new Map(analysis.concepts.map((c) => [c.id, c]));
  for (const concept of row.concepts) {
    const info = { ...base, conceptId: concept.id, conceptTitle: concept.title, href: conceptHref(row.id, concept.id) };
    const flagged = concept.passages.some((p) => p.humanReviewRequired && !p.approved);
    const textPending = concept.passages.length > 0 && concept.passages.some((p) => !p.approved);
    const conflict = concept.passages.some((p) => p.alignmentStatus === "CONFLICT" || p.alignmentStatus === "UNCERTAIN");
    const problems = analyzed.get(concept.id)?.problems ?? [];
    const structural = problems.filter((p) => !p.startsWith(HUMAN_REVIEW_PREFIX));

    if (flagged) items.push({ ...info, kind: "HUMAN_REVIEW", detail: "مواضع متعارضة أو غير محسومة بين تفريغ باحث والـPDF تحتاج قرارًا بشريًا." });
    if (textPending && !flagged) items.push({ ...info, kind: "TEXT_UNAPPROVED", detail: "نص المقطع المصدري لم يُعتمد بعد." });
    if (concept.videoUrl && !concept.videoApproved) items.push({ ...info, kind: "TIMESTAMP_UNAPPROVED", detail: "توقيت المراجعة المرئي لم يُعتمد بعد." });
    if (conflict || structural.some((p) => p.includes("توقيت") || p.includes("الارتباط") || p.includes("بيانات المصدر"))) {
      items.push({ ...info, kind: "SOURCE_CONFLICT", detail: structural[0] ?? "تعارض أو عدم يقين في مطابقة المصادر." });
    }
    if (!flagged && structural.length === 0 && (textPending || !concept.videoApproved)) {
      items.push({ ...info, kind: "READY_TO_APPROVE", detail: "اجتاز التحقق الآلي وينتظر اعتمادًا بشريًا." });
    }
  }
  if (overview.readyToPublish) {
    items.push({ ...base, kind: "READY_TO_PUBLISH", conceptId: null, conceptTitle: null, detail: "المحتوى معتمد بالكامل ولم يُنشر للطلاب بعد.", href: `/admin/lessons/${row.id}#publication` });
  }
  return { overview, items };
}

export async function getLessonOverviews(db: PrismaClient, actor: Actor): Promise<LessonOverview[]> {
  assertAdmin(actor);
  return (await readAll(db)).map((row) => summarize(row).overview);
}

export async function getReviewQueue(db: PrismaClient, actor: Actor): Promise<{ items: ReviewItem[]; lessons: LessonOverview[] }> {
  assertAdmin(actor);
  const rows = (await readAll(db)).map(summarize);
  return { items: rows.flatMap((r) => r.items), lessons: rows.map((r) => r.overview) };
}

export async function getLessonOverview(db: PrismaClient, actor: Actor, lessonId: string): Promise<LessonOverview | null> {
  assertAdmin(actor);
  const [row] = await readAll(db, lessonId);
  return row ? summarize(row).overview : null;
}
