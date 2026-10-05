import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { AppError } from "@/server/errors";
import { TRUE_FALSE_OPTIONS } from "@/server/ai/types";
import { parseTimestamp, parseVideoUrl } from "@/lib/video";
import { recordAudit } from "./audit";

/**
 * Minimal content management. Every function starts with assertAdmin(actor):
 * students can never create, edit or approve source material.
 */
type Actor = Pick<SessionUser, "id" | "role"> | null;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const id = z.string().trim().min(1).max(64);
const order = z.coerce.number().int().min(0).max(10_000);

export const courseInput = z.object({
  levelId: z.string().trim().max(64).optional().transform((v) => v || null),
  title: text(2, 160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,60}$/, "slug: a-z, 0-9, -"),
  description: text(2, 2000),
  madhhab: text(2, 60),
});

export const chapterInput = z.object({ courseId: id, title: text(2, 160), description: z.string().trim().max(1000).optional(), order });

const lessonFields = {
  title: text(2, 160),
  description: text(2, 2000),
  objectives: z.string().max(3000).transform((v) => v.split("\n").map((l) => l.trim()).filter(Boolean)),
  status: z.enum(["DRAFT", "COMING_SOON", "PUBLISHED"]),
  estimatedMinutes: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(600)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  isSample: z.coerce.boolean().optional().default(false),
  measurementEnabled: z.coerce.boolean().optional().default(false),
  order,
};
export const lessonInput = z.object({ chapterId: id, ...lessonFields });
/** Publication is changed only through setLessonPublication, never by the general edit form. */
export const lessonUpdateInput = z.object({ lessonId: id, ...lessonFields, status: lessonFields.status.optional() });
export const lessonPublicationInput = z.object({ lessonId: id, status: z.enum(["DRAFT", "COMING_SOON", "PUBLISHED"]) });

export const conceptInput = z.object({ lessonId: id, title: text(2, 160), description: text(2, 1000), order });
export const conceptUpdateInput = z.object({ conceptId: id, title: text(2, 160), description: text(2, 1000), order });

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const optionalHttpsUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https:\/\//i.test(v), "يجب أن يكون الرابط https.");

const optionalSecond = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(86_400)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const passageFields = {
  text: text(10, 10_000),
  sourceTitle: text(2, 200),
  sourceAuthor: text(2, 200),
  sourceReference: text(1, 300),
  edition: optionalText(300),
  license: optionalText(300),
  permissionNote: optionalText(1000),
  sourceUrl: optionalHttpsUrl,
  startSecond: optionalSecond,
  endSecond: optionalSecond,
};
export const passageInput = z.object({ conceptId: id, isSample: z.coerce.boolean().optional().default(false), ...passageFields });
export const passageUpdateInput = z.object({ passageId: id, ...passageFields });
export const conceptVideoInput = z.object({
  conceptId: id,
  videoUrl: z.string().trim().max(500).optional(),
  videoStart: z.string().trim().max(10).optional(),
  videoEnd: z.string().trim().max(10).optional(),
});
export const levelStatusInput = z.object({ id, status: z.enum(["ACTIVE", "COMING_SOON"]) });

export const approvalInput = z.object({ id, approved: z.enum(["true", "false"]).transform((v) => v === "true") });
const lessonReviewInput = z.object({ lessonId: id });

type ReviewDb = Pick<PrismaClient, "lesson">;

type ReviewPassage = {
  id: string;
  text: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceReference: string;
  sourceUrl: string | null;
  startSecond: number | null;
  endSecond: number | null;
  approved: boolean;
};

export const REVIEW_CONCEPT_SELECT = {
  id: true,
  title: true,
  videoUrl: true,
  videoStartSecond: true,
  videoEndSecond: true,
  videoApproved: true,
  passages: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      lessonId: true,
      conceptId: true,
      text: true,
      sourceTitle: true,
      sourceAuthor: true,
      sourceReference: true,
      sourceUrl: true,
      startSecond: true,
      endSecond: true,
      approved: true,
      humanReviewRequired: true,
    },
  },
} as const;

export type ReviewConceptRow = {
  id: string;
  title: string;
  videoUrl: string | null;
  videoStartSecond: number | null;
  videoEndSecond: number | null;
  videoApproved: boolean;
  passages: (ReviewPassage & { lessonId: string; conceptId: string; humanReviewRequired: boolean })[];
};

export const HUMAN_REVIEW_PREFIX = "HUMAN_REVIEW_REQUIRED";

/**
 * Pure validation of a lesson's concepts. A review-video range represents the same source
 * segment, so it must exactly match the source-passage range before the two can be
 * bulk-approved together.
 */
export function analyzeLessonConcepts(lessonId: string, rows: ReviewConceptRow[]) {
  const concepts = rows.map((concept) => {
    const problems: string[] = [];
    const passages: ReviewPassage[] = concept.passages.map(
      ({ lessonId: _lessonId, conceptId: _conceptId, humanReviewRequired: _flag, ...passage }) => passage,
    );

    if (!passages.length) problems.push("لا يوجد مقطع مصدري لهذا المفهوم.");
    if (!concept.videoUrl?.trim()) problems.push("رابط فيديو المراجعة مفقود.");
    else if (!parseVideoUrl(concept.videoUrl)) problems.push("رابط فيديو المراجعة غير مدعوم.");
    if (concept.videoStartSecond === null || concept.videoEndSecond === null || concept.videoStartSecond >= concept.videoEndSecond) {
      problems.push("حدود توقيت فيديو المراجعة غير مكتملة أو غير صحيحة.");
    }

    for (const passage of concept.passages) {
      if (passage.lessonId !== lessonId || passage.conceptId !== concept.id) problems.push("ارتباط المقطع بالمفهوم أو الدرس غير صحيح.");
      if (!passage.text.trim()) problems.push("نص المقطع المصدري فارغ.");
      if (passage.humanReviewRequired) {
        problems.push(`${HUMAN_REVIEW_PREFIX}: مواضع متعارضة أو غير محسومة بين تفريغ باحث والـPDF؛ راجعها واعتمد المقطع يدويًا (لا يشمله الاعتماد الجماعي).`);
      }
      if (!passage.sourceTitle.trim() || !passage.sourceAuthor.trim() || !passage.sourceReference.trim()) {
        problems.push("بيانات المصدر أو الإحالة غير مكتملة.");
      }
      if (passage.startSecond === null || passage.endSecond === null || passage.startSecond >= passage.endSecond) {
        problems.push("حدود توقيت المقطع المصدري غير مكتملة أو غير صحيحة.");
      } else if (concept.videoStartSecond !== passage.startSecond || concept.videoEndSecond !== passage.endSecond) {
        problems.push("توقيت فيديو المراجعة لا يطابق حدود توقيت المقطع المصدري.");
      }
    }

    return {
      id: concept.id,
      title: concept.title,
      videoUrl: concept.videoUrl,
      videoStartSecond: concept.videoStartSecond,
      videoEndSecond: concept.videoEndSecond,
      videoApproved: concept.videoApproved,
      passages,
      problems: [...new Set(problems)],
    };
  });

  return { lessonId, concepts, valid: concepts.length > 0 && concepts.every((concept) => concept.problems.length === 0) };
}

/** Builds the human review record from the database, never from submitted form data. */
async function readLessonReview(db: ReviewDb, lessonId: string) {
  const lesson = await db.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { id: true, concepts: { orderBy: { order: "asc" }, select: REVIEW_CONCEPT_SELECT } },
  });
  return analyzeLessonConcepts(lesson.id, lesson.concepts);
}

/** Review data for an admin before their explicit bulk-approval action. */
export async function getLessonReviewSummary(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = lessonReviewInput.parse(raw);
  return readLessonReview(db, input.lessonId);
}

/**
 * Explicit human bulk approval. Validation is deliberately repeated inside the
 * transaction so no client-supplied status can cause an invalid row to be approved.
 */
export async function bulkApproveLessonReview(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = lessonReviewInput.parse(raw);

  return db.$transaction(async (tx) => {
    const review = await readLessonReview(tx, input.lessonId);
    if (!review.valid) throw new AppError("BAD_REQUEST", "لا يمكن اعتماد الدرس قبل إصلاح عناصر المراجعة المبيّنة.");

    const now = new Date();
    const passageIds = review.concepts.flatMap((concept) => concept.passages.map((passage) => passage.id));
    const conceptIds = review.concepts.map((concept) => concept.id);
    await tx.sourcePassage.updateMany({ where: { id: { in: passageIds } }, data: { approved: true, approvedAt: now, approvedById: actor.id } });
    await tx.concept.updateMany({ where: { id: { in: conceptIds } }, data: { videoApproved: true, videoApprovedAt: now, videoApprovedById: actor.id } });
    await recordAudit(tx, actor, {
      action: "lesson.bulk_approved",
      entityType: "lesson",
      entityId: input.lessonId,
      lessonId: input.lessonId,
      summary: `اعتماد جماعي: ${passageIds.length} مقطعًا و${conceptIds.length} توقيتًا`,
      metadata: { passages: passageIds.length, concepts: conceptIds.length },
    });
    return { approvedConcepts: conceptIds.length, approvedPassages: passageIds.length };
  });
}

export const fixedQuestionInput = z.object({
  conceptId: id,
  sourcePassageId: id,
  questionType: z.enum(["MCQ", "TRUE_FALSE"]),
  question: text(5, 600),
  /**
   * The builder submits the complete, ordered option list as JSON.  The four
   * legacy fields remain accepted so existing callers and older admin pages
   * continue to work during the rollout.
   */
  options: z.union([z.string().max(4000), z.array(z.string().max(300))]).optional(),
  option0: z.string().trim().max(300).optional(),
  option1: z.string().trim().max(300).optional(),
  option2: z.string().trim().max(300).optional(),
  option3: z.string().trim().max(300).optional(),
  correctIndex: z.preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number().int().min(0).max(7)),
  explanation: text(5, 800),
  difficulty: z.coerce.number().int().min(1).max(3),
});

export async function createCourse(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = courseInput.parse(raw);
  const exists = await db.course.findUnique({ where: { slug: input.slug } });
  if (exists) throw new AppError("BAD_REQUEST", "هذا المعرّف مستخدم لمسار آخر.");
  const count = await db.course.count();
  return db.course.create({ data: { ...input, order: count } });
}

export async function createChapter(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = chapterInput.parse(raw);
  await db.course.findUniqueOrThrow({ where: { id: input.courseId } });
  return db.chapter.create({ data: { ...input, description: input.description || null } });
}

export async function createLesson(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = lessonInput.parse(raw);
  if (input.status === "PUBLISHED") throw new AppError("BAD_REQUEST", "لا يُنشأ الدرس منشورًا؛ اعتمد محتواه أولًا ثم انشره من صفحة الدرس.");
  await db.chapter.findUniqueOrThrow({ where: { id: input.chapterId } });
  const lesson = await db.lesson.create({ data: input });
  await recordAudit(db, actor, { action: "lesson.created", entityType: "lesson", entityId: lesson.id, lessonId: lesson.id, summary: `إنشاء الدرس «${lesson.title}»` });
  return lesson;
}

export async function updateLesson(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const { lessonId, status: _ignored, ...data } = lessonUpdateInput.parse(raw);
  const lesson = await db.lesson.update({ where: { id: lessonId }, data });
  await recordAudit(db, actor, { action: "lesson.edited", entityType: "lesson", entityId: lessonId, lessonId, summary: `تعديل بيانات الدرس «${lesson.title}»` });
  return lesson;
}

/** Whether every concept has an approved passage and an approved review timestamp. */
export async function isLessonContentApproved(db: Pick<PrismaClient, "concept">, lessonId: string): Promise<boolean> {
  const concepts = await db.concept.findMany({
    where: { lessonId },
    select: { videoApproved: true, passages: { select: { approved: true } } },
  });
  return concepts.length > 0 && concepts.every((c) => c.videoApproved && c.passages.length > 0 && c.passages.every((p) => p.approved));
}

/**
 * The only way to change what students can see. Approving sources never publishes a lesson;
 * publishing requires fully approved content (text and timestamps) and is recorded.
 */
export async function setLessonPublication(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = lessonPublicationInput.parse(raw);
  const lesson = await db.lesson.findUniqueOrThrow({ where: { id: input.lessonId }, select: { id: true, title: true, status: true } });
  if (lesson.status === input.status) return lesson;
  if (input.status === "PUBLISHED" && !(await isLessonContentApproved(db, lesson.id))) {
    throw new AppError("BAD_REQUEST", "لا يمكن نشر الدرس قبل اعتماد جميع مقاطعه وتوقيتاته.");
  }
  const updated = await db.lesson.update({ where: { id: lesson.id }, data: { status: input.status } });
  await recordAudit(db, actor, {
    action: input.status === "PUBLISHED" ? "lesson.published" : "lesson.unpublished",
    entityType: "lesson",
    entityId: lesson.id,
    lessonId: lesson.id,
    summary: input.status === "PUBLISHED" ? `نشر الدرس «${lesson.title}» للطلاب` : `إيقاف نشر الدرس «${lesson.title}» (${input.status === "COMING_SOON" ? "قيد الإعداد" : "مسودة"})`,
    metadata: { from: lesson.status, to: input.status },
  });
  return updated;
}

export async function createConcept(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = conceptInput.parse(raw);
  await db.lesson.findUniqueOrThrow({ where: { id: input.lessonId } });
  const concept = await db.concept.create({ data: input });
  await recordAudit(db, actor, { action: "concept.created", entityType: "concept", entityId: concept.id, lessonId: input.lessonId, summary: `إضافة المفهوم «${concept.title}»` });
  return concept;
}

export async function updateConcept(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const { conceptId, ...data } = conceptUpdateInput.parse(raw);
  const before = await db.concept.findUniqueOrThrow({ where: { id: conceptId }, select: { title: true, description: true, lessonId: true } });
  const substantive = before.title !== data.title || before.description !== data.description;
  return db.$transaction(async (tx) => {
    const concept = await tx.concept.update({ where: { id: conceptId }, data });
    let revoked = 0;
    if (substantive) {
      // The concept's title/description frame every question about it, so approvals are re-earned.
      const passages = await tx.sourcePassage.updateMany({ where: { conceptId, approved: true }, data: { approved: false, approvedAt: null, approvedById: null } });
      const video = await tx.concept.updateMany({ where: { id: conceptId, videoApproved: true }, data: { videoApproved: false, videoApprovedAt: null, videoApprovedById: null } });
      revoked = passages.count + video.count;
    }
    await recordAudit(tx, actor, {
      action: "concept.edited",
      entityType: "concept",
      entityId: conceptId,
      lessonId: before.lessonId,
      summary: `تعديل المفهوم «${concept.title}»${revoked ? " — أُلغي الاعتماد المرتبط وتلزم مراجعة بشرية جديدة" : ""}`,
      metadata: { substantive, revokedApprovals: revoked },
    });
    return concept;
  });
}

/** New passages always start unapproved. */
export async function createPassage(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = passageInput.parse(raw);
  if (input.endSecond !== null && (input.startSecond === null || input.endSecond <= input.startSecond)) {
    throw new AppError("BAD_REQUEST", "وقت نهاية المقطع يجب أن يكون بعد وقت البداية.");
  }
  const concept = await db.concept.findUniqueOrThrow({ where: { id: input.conceptId }, select: { lessonId: true } });
  const count = await db.sourcePassage.count({ where: { conceptId: input.conceptId } });
  const passage = await db.sourcePassage.create({
    data: { ...input, lessonId: concept.lessonId, approved: false, order: count + 1 },
  });
  await recordAudit(db, actor, { action: "passage.created", entityType: "passage", entityId: passage.id, lessonId: concept.lessonId, summary: "إضافة مقطع مصدري (غير معتمد)" });
  return passage;
}

/**
 * Changing the text bumps the version and revokes approval until it is reviewed again (source labels
 * such as the title do not change the content); changing the passage's time bounds also revokes the concept's timestamp approval.
 */
export async function updatePassage(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const { passageId, ...data } = passageUpdateInput.parse(raw);
  if (data.endSecond !== null && (data.startSecond === null || data.endSecond <= data.startSecond)) {
    throw new AppError("BAD_REQUEST", "وقت نهاية المقطع يجب أن يكون بعد وقت البداية.");
  }
  const existing = await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } });
  const textChanged = existing.text !== data.text;
  const boundsChanged = existing.startSecond !== data.startSecond || existing.endSecond !== data.endSecond;
  return db.$transaction(async (tx) => {
    const updated = await tx.sourcePassage.update({
      where: { id: passageId },
      data: {
        ...data,
        ...(textChanged ? { version: existing.version + 1 } : {}),
        ...(textChanged ? { approved: false, approvedAt: null, approvedById: null } : {}),
      },
    });
    let timestampRevoked = false;
    if (boundsChanged) {
      const result = await tx.concept.updateMany({
        where: { id: existing.conceptId, videoApproved: true },
        data: { videoApproved: false, videoApprovedAt: null, videoApprovedById: null },
      });
      timestampRevoked = result.count > 0;
    }
    const revokedText = existing.approved && textChanged;
    await recordAudit(tx, actor, {
      action: "passage.edited",
      entityType: "passage",
      entityId: passageId,
      lessonId: existing.lessonId,
      summary: `تعديل مقطع مصدري${textChanged ? " (النص)" : ""}${revokedText || timestampRevoked ? " — أُلغي الاعتماد وتلزم مراجعة بشرية جديدة" : ""}`,
      metadata: { textChanged, boundsChanged, versionAfter: updated.version, passageApprovalRevoked: revokedText, timestampApprovalRevoked: timestampRevoked },
    });
    return updated;
  });
}

export async function setPassageApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = approvalInput.parse(raw);
  const passage = await db.sourcePassage.update({
    where: { id: input.id },
    data: input.approved
      ? { approved: true, approvedAt: new Date(), approvedById: actor.id }
      : { approved: false, approvedAt: null, approvedById: null },
  });
  await recordAudit(db, actor, {
    action: input.approved ? "passage.approved" : "passage.revoked",
    entityType: "passage",
    entityId: passage.id,
    lessonId: passage.lessonId,
    summary: input.approved ? `اعتماد نص المقطع (الإصدار ${passage.version})` : "إلغاء اعتماد نص المقطع",
    metadata: { version: passage.version },
  });
  return passage;
}

export async function createFixedQuestion(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = fixedQuestionInput.parse(raw);
  const passage = await db.sourcePassage.findUniqueOrThrow({ where: { id: input.sourcePassageId } });
  if (passage.conceptId !== input.conceptId) throw new AppError("BAD_REQUEST", "المقطع لا يتبع هذا المفهوم.");

  let submittedOptions: string[] | null = null;
  if (input.options !== undefined) {
    try {
      submittedOptions = typeof input.options === "string" ? JSON.parse(input.options) : input.options;
    } catch {
      throw new AppError("BAD_REQUEST", "خيارات الإجابة غير صالحة.");
    }
    if (!Array.isArray(submittedOptions) || submittedOptions.some((option) => typeof option !== "string")) {
      throw new AppError("BAD_REQUEST", "خيارات الإجابة غير صالحة.");
    }
  }

  const options = input.questionType === "TRUE_FALSE"
    ? [...TRUE_FALSE_OPTIONS]
    : (submittedOptions ?? [input.option0, input.option1, input.option2, input.option3]).map((option) => option?.trim() ?? "");

  if (input.questionType === "MCQ" && (options.length < 2 || options.length > 8)) {
    throw new AppError("BAD_REQUEST", "أضف من خيارين إلى ثمانية خيارات.");
  }
  if (options.some((option) => !option)) throw new AppError("BAD_REQUEST", "أكمل نص كل خيار قبل الحفظ.");
  if (new Set(options).size !== options.length) throw new AppError("BAD_REQUEST", "الخيارات يجب أن تكون مختلفة.");
  if (input.correctIndex >= options.length) throw new AppError("BAD_REQUEST", "رقم الإجابة الصحيحة غير صالح.");

  const count = await db.fixedQuestion.count({ where: { lessonId: passage.lessonId } });
  return db.fixedQuestion.create({
    data: {
      lessonId: passage.lessonId,
      conceptId: input.conceptId,
      sourcePassageId: passage.id,
      questionType: input.questionType,
      question: input.question,
      options,
      correctIndex: input.correctIndex,
      explanation: input.explanation,
      difficulty: input.difficulty,
      order: count + 1,
      approved: false,
    },
  });
}

export async function setFixedQuestionApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = approvalInput.parse(raw);
  const updated = await db.fixedQuestion.update({ where: { id: input.id }, data: { approved: input.approved } });
  await recordAudit(db, actor, {
    action: input.approved ? "fixed_question.approved" : "fixed_question.revoked",
    entityType: "fixed_question",
    entityId: updated.id,
    lessonId: updated.lessonId,
    summary: input.approved ? "اعتماد سؤال أساسي" : "إلغاء اعتماد سؤال أساسي",
  });
  return updated;
}

export const fixedQuestionWordingInput = z.object({ id, question: text(5, 600) });

/**
 * Edits ONLY the wording of a base question (never its options, answer, concept or explanation).
 * A changed question is no longer approved: it must go back through `setFixedQuestionApproval`.
 */
export async function updateFixedQuestionWording(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = fixedQuestionWordingInput.parse(raw);
  const existing = await db.fixedQuestion.findUniqueOrThrow({ where: { id: input.id } });
  if (existing.question === input.question) return existing;
  const updated = await db.fixedQuestion.update({ where: { id: input.id }, data: { question: input.question, approved: false } });
  await recordAudit(db, actor, {
    action: "fixed_question.edited",
    entityType: "fixed_question",
    entityId: updated.id,
    lessonId: updated.lessonId,
    summary: existing.approved ? "تعديل صياغة سؤال معتمد — أُلغي اعتماده وتلزم مراجعة جديدة" : "تعديل صياغة سؤال",
    metadata: { before: existing.question, after: input.question, approvalRevoked: existing.approved },
  });
  return updated;
}

/**
 * Sets (or clears) a concept's review video. Timestamps are typed by a human; any change
 * revokes approval so the segment is re-checked before learners are sent to it.
 */
export async function updateConceptVideo(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = conceptVideoInput.parse(raw);
  const url = input.videoUrl?.trim() || null;
  if (!url) {
    const cleared = await db.concept.update({
      where: { id: input.conceptId },
      data: { videoUrl: null, videoStartSecond: null, videoEndSecond: null, videoApproved: false, videoApprovedAt: null, videoApprovedById: null },
    });
    await recordAudit(db, actor, { action: "timestamp.edited", entityType: "concept", entityId: cleared.id, lessonId: cleared.lessonId, summary: "حذف مقطع المراجعة المرئي وإلغاء اعتماده" });
    return cleared;
  }
  if (!parseVideoUrl(url)) throw new AppError("BAD_REQUEST", "رابط الفيديو غير مدعوم. استخدم رابط YouTube أو ملف فيديو (https).");
  const start = parseTimestamp(input.videoStart);
  const end = input.videoEnd ? parseTimestamp(input.videoEnd) : null;
  if (start === null) throw new AppError("BAD_REQUEST", "أدخل وقت البداية بصيغة دقائق:ثوانٍ مثل 12:35.");
  if (input.videoEnd && end === null) throw new AppError("BAD_REQUEST", "صيغة وقت النهاية غير صحيحة.");
  if (end !== null && end <= start) throw new AppError("BAD_REQUEST", "وقت النهاية يجب أن يكون بعد وقت البداية.");
  const concept = await db.concept.update({
    where: { id: input.conceptId },
    data: {
      videoUrl: url,
      videoStartSecond: start,
      videoEndSecond: end,
      videoApproved: false,
      videoApprovedAt: null,
      videoApprovedById: null,
    },
  });
  await recordAudit(db, actor, {
    action: "timestamp.edited",
    entityType: "concept",
    entityId: concept.id,
    lessonId: concept.lessonId,
    summary: "تعديل توقيت المراجعة — أُلغي اعتماده وتلزم مراجعة بشرية جديدة",
    metadata: { start, end },
  });
  return concept;
}

export async function setConceptVideoApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = approvalInput.parse(raw);
  const concept = await db.concept.findUniqueOrThrow({ where: { id: input.id } });
  if (input.approved && (!concept.videoUrl || concept.videoStartSecond == null)) {
    throw new AppError("BAD_REQUEST", "أضف رابط الفيديو ووقت البداية قبل الاعتماد.");
  }
  const updated = await db.concept.update({
    where: { id: input.id },
    data: input.approved
      ? { videoApproved: true, videoApprovedAt: new Date(), videoApprovedById: actor.id }
      : { videoApproved: false, videoApprovedAt: null, videoApprovedById: null },
  });
  await recordAudit(db, actor, {
    action: input.approved ? "timestamp.approved" : "timestamp.revoked",
    entityType: "concept",
    entityId: updated.id,
    lessonId: updated.lessonId,
    summary: input.approved ? "اعتماد توقيت المراجعة" : "إلغاء اعتماد توقيت المراجعة",
    metadata: { start: concept.videoStartSecond, end: concept.videoEndSecond },
  });
  return updated;
}

/**
 * Approves (or revokes) one concept as a whole: all of its passages plus its review timestamp.
 * A human decision on a flagged concept is allowed; structural problems still block approval.
 */
export async function setConceptApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = approvalInput.parse(raw);
  return db.$transaction(async (tx) => {
    const concept = await tx.concept.findUniqueOrThrow({
      where: { id: input.id },
      select: { ...REVIEW_CONCEPT_SELECT, lessonId: true },
    });
    if (input.approved) {
      const [analysis] = analyzeLessonConcepts(concept.lessonId, [concept]).concepts;
      const blocking = analysis.problems.filter((problem) => !problem.startsWith(HUMAN_REVIEW_PREFIX));
      if (blocking.length) throw new AppError("BAD_REQUEST", `لا يمكن اعتماد المفهوم قبل إصلاح: ${blocking[0]}`);
    }
    const now = new Date();
    await tx.sourcePassage.updateMany({
      where: { conceptId: concept.id },
      data: input.approved ? { approved: true, approvedAt: now, approvedById: actor.id } : { approved: false, approvedAt: null, approvedById: null },
    });
    const updated = await tx.concept.update({
      where: { id: concept.id },
      data: input.approved
        ? { videoApproved: true, videoApprovedAt: now, videoApprovedById: actor.id }
        : { videoApproved: false, videoApprovedAt: null, videoApprovedById: null },
    });
    await recordAudit(tx, actor, {
      action: input.approved ? "concept.approved" : "concept.revoked",
      entityType: "concept",
      entityId: concept.id,
      lessonId: concept.lessonId,
      summary: input.approved ? `اعتماد المفهوم «${concept.title}» (نصه وتوقيته)` : `إلغاء اعتماد المفهوم «${concept.title}»`,
      metadata: { passages: concept.passages.length },
    });
    return updated;
  });
}

export async function setLevelStatus(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = levelStatusInput.parse(raw);
  const level = await db.level.update({ where: { id: input.id }, data: { status: input.status } });
  await recordAudit(db, actor, { action: "level.status_changed", entityType: "level", entityId: level.id, summary: `المستوى «${level.title}»: ${input.status === "ACTIVE" ? "تفعيل" : "إرجاع إلى قريبًا"}`, metadata: { status: input.status } });
  return level;
}
