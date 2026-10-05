import { beforeEach, describe, expect, it } from "vitest";
import * as content from "@/server/admin/content";
import { getEvaluationRows } from "@/server/admin/evaluation";
import { resolveApprovedSource } from "@/server/ai/source";
import { AppError } from "@/server/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";

async function expectForbidden(promise: Promise<unknown>) {
  try {
    await promise;
    expect.unreachable("expected FORBIDDEN");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
  }
}

describe.skipIf(!hasTestDb)("H. admin content management (database)", () => {
  let db: PrismaClient;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
  });

  it("denies every admin mutation to a normal student", async () => {
    const student = await createUser(db, "student@example.com");
    const actor = { id: student.id, role: student.role };
    const passage = await db.sourcePassage.findFirstOrThrow({ where: { approved: true } });

    await expectForbidden(content.createCourse(db, actor, { title: "x", slug: "xyz", description: "x", madhhab: "x" }));
    await expectForbidden(content.createLesson(db, actor, {}));
    await expectForbidden(content.createConcept(db, actor, {}));
    await expectForbidden(content.createPassage(db, actor, { conceptId: passage.conceptId, text: "نص مزيف يحاول الطالب إدخاله", sourceTitle: "x", sourceAuthor: "x", sourceReference: "x" }));
    await expectForbidden(content.updatePassage(db, actor, { passageId: passage.id, text: "تعديل غير مصرح", sourceTitle: "x", sourceAuthor: "x", sourceReference: "x" }));
    await expectForbidden(content.setPassageApproval(db, actor, { id: "passage-unapproved", approved: "true" }));
    await expectForbidden(content.bulkApproveLessonReview(db, actor, { lessonId: "lesson-method" }));
    await expectForbidden(getEvaluationRows(db, actor));

    // Nothing changed.
    const unchanged = await db.sourcePassage.findUniqueOrThrow({ where: { id: passage.id } });
    expect(unchanged.text).toBe(passage.text);
    expect((await db.sourcePassage.findUniqueOrThrow({ where: { id: "passage-unapproved" } })).approved).toBe(false);
  });

  it("denies anonymous callers", async () => {
    try {
      await content.setPassageApproval(db, null, { id: "passage-unapproved", approved: "true" });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("lets an admin add a passage that stays unapproved until approved", async () => {
    const admin = await createUser(db, "admin@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const created = await content.createPassage(db, actor, {
      conceptId: "concept-study-stages",
      text: "مقطع جديد يضيفه المشرف لاختبار سير الاعتماد في لوحة الإدارة.",
      sourceTitle: "مصدر",
      sourceAuthor: "مؤلف",
      sourceReference: "ص ١",
    });
    expect(created.approved).toBe(false);

    const approved = await content.setPassageApproval(db, actor, { id: created.id, approved: "true" });
    expect(approved.approved).toBe(true);
    expect(approved.approvedById).toBe(admin.id);
  });

  it("validates every concept before bulk approval and leaves invalid rows unapproved", async () => {
    const admin = await createUser(db, "bulk-invalid@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const lesson = await db.lesson.create({ data: { id: "bulk-invalid", chapterId: "ch1", title: "مراجعة اختبار", description: "اختبار", objectives: [], order: 50, status: "DRAFT" } });
    const concept = await db.concept.create({ data: { id: "bulk-invalid-concept", lessonId: lesson.id, title: "مفهوم اختبار", description: "وصف", order: 1, videoUrl: "https://youtu.be/FdxZylJyi-w", videoStartSecond: 10, videoEndSecond: 20 } });
    const passage = await db.sourcePassage.create({ data: { id: "bulk-invalid-passage", lessonId: lesson.id, conceptId: concept.id, text: "نص اختبار صالح ظاهريًا لكنه بتوقيت مختلف عن فيديو المراجعة.", sourceTitle: "مصدر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 11, endSecond: 20 } });

    const review = await content.getLessonReviewSummary(db, actor, { lessonId: lesson.id });
    expect(review.valid).toBe(false);
    expect(review.concepts[0].problems).toContain("توقيت فيديو المراجعة لا يطابق حدود توقيت المقطع المصدري.");
    await expect(content.bulkApproveLessonReview(db, actor, { lessonId: lesson.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await db.sourcePassage.findUniqueOrThrow({ where: { id: passage.id } })).approved).toBe(false);
    expect((await db.concept.findUniqueOrThrow({ where: { id: concept.id } })).videoApproved).toBe(false);
  });

  it("bulk-approves only a fully valid lesson and records the approving admin", async () => {
    const admin = await createUser(db, "bulk-valid@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const lesson = await db.lesson.create({ data: { id: "bulk-valid", chapterId: "ch1", title: "مراجعة صالحة", description: "اختبار", objectives: [], order: 51, status: "DRAFT" } });
    const concept = await db.concept.create({ data: { id: "bulk-valid-concept", lessonId: lesson.id, title: "مفهوم صالح", description: "وصف", order: 1, videoUrl: "https://youtu.be/FdxZylJyi-w", videoStartSecond: 10, videoEndSecond: 20 } });
    const passage = await db.sourcePassage.create({ data: { id: "bulk-valid-passage", lessonId: lesson.id, conceptId: concept.id, text: "نص اختبار مكتمل للمراجعة البشرية والاعتماد الصريح فقط.", sourceTitle: "مصدر", sourceAuthor: "مؤلف", sourceReference: "موضع", sourceUrl: "https://example.org/source", startSecond: 10, endSecond: 20 } });

    expect((await content.getLessonReviewSummary(db, actor, { lessonId: lesson.id })).valid).toBe(true);
    await content.bulkApproveLessonReview(db, actor, { lessonId: lesson.id });
    expect(await db.sourcePassage.findUniqueOrThrow({ where: { id: passage.id } })).toMatchObject({ approved: true, approvedById: admin.id });
    expect(await db.concept.findUniqueOrThrow({ where: { id: concept.id } })).toMatchObject({ videoApproved: true, videoApprovedById: admin.id });
  });

  it("stores human-entered transcript provenance as unapproved source metadata", async () => {
    const admin = await createUser(db, "admin-transcript@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const created = await content.createPassage(db, actor, {
      conceptId: "concept-study-stages",
      text: "نص اختبار طويل يمثل مقطع تفريغ يراجعه المشرف قبل أي اعتماد صريح للاستخدام.",
      sourceTitle: "Transcript source",
      sourceAuthor: "Content reviewer",
      sourceReference: "00:02:05–00:03:10",
      sourceUrl: "https://example.org/lesson",
      startSecond: 125,
      endSecond: 190,
    });
    expect(created).toMatchObject({
      approved: false,
      sourceUrl: "https://example.org/lesson",
      startSecond: 125,
      endSecond: 190,
    });
  });

  it("rejects incoherent transcript bounds before a passage can be imported", async () => {
    const admin = await createUser(db, "admin-bounds@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    await expect(
      content.createPassage(db, actor, {
        conceptId: "concept-study-stages",
        text: "نص اختبار طويل يمثل مقطع تفريغ يراجعه المشرف قبل أي اعتماد صريح للاستخدام.",
        sourceTitle: "Transcript source",
        sourceAuthor: "Content reviewer",
        sourceReference: "00:03:10–00:02:05",
        sourceUrl: "https://example.org/lesson",
        startSecond: 190,
        endSecond: 125,
      }),
    ).rejects.toThrowError(AppError);
  });

  it("editing passage text bumps the version and revokes approval", async () => {
    const admin = await createUser(db, "admin@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const before = await db.sourcePassage.findUniqueOrThrow({ where: { id: "passage-study-stages" } });

    const metaOnly = await content.updatePassage(db, actor, {
      passageId: before.id,
      text: before.text,
      sourceTitle: "عنوان محدّث",
      sourceAuthor: before.sourceAuthor,
      sourceReference: before.sourceReference,
    });
    expect(metaOnly.approved).toBe(true);
    expect(metaOnly.version).toBe(before.version);

    const edited = await content.updatePassage(db, actor, {
      passageId: before.id,
      text: `${before.text} جملة مضافة.`,
      sourceTitle: "عنوان محدّث",
      sourceAuthor: before.sourceAuthor,
      sourceReference: before.sourceReference,
    });
    expect(edited.version).toBe(before.version + 1);
    expect(edited.approved).toBe(false);

    // The AI pipeline can no longer see this concept's only passage.
    const source = await resolveApprovedSource(db, { sessionId: "no-session", lessonId: "lesson-method", conceptId: "concept-study-stages" });
    expect(source.ok).toBe(false);
  });

  it("editing the wording of a base question revokes its approval, keeps options and answer, and is audited", async () => {
    const admin = await createUser(db, "admin@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    const before = await db.fixedQuestion.findUniqueOrThrow({ where: { id: "fixed-method-5" } });
    expect(before.approved).toBe(true);

    const edited = await content.updateFixedQuestionWording(db, actor, { id: before.id, question: "ماذا يحدث إذا رفض المدقق السؤال؟" });
    expect(edited.approved).toBe(false);
    expect(edited.options).toEqual(before.options);
    expect(edited.correctIndex).toBe(before.correctIndex);
    expect(edited.explanation).toBe(before.explanation);
    expect((await db.auditEvent.findFirstOrThrow({ where: { action: "fixed_question.edited" } })).metadata).toMatchObject({ before: before.question, approvalRevoked: true });

    // An unapproved base question is never served, until a human approves it again.
    expect(await db.fixedQuestion.count({ where: { id: before.id, approved: true } })).toBe(0);
    const approved = await content.setFixedQuestionApproval(db, actor, { id: before.id, approved: "true" });
    expect(approved.approved).toBe(true);
    expect(await db.auditEvent.count({ where: { action: "fixed_question.approved" } })).toBe(1);

    // Students cannot edit wording.
    const student = await createUser(db, "s@example.com");
    await expectForbidden(content.updateFixedQuestionWording(db, { id: student.id, role: student.role }, { id: before.id, question: "تعديل غير مصرح" }));
  });

  it("validates fixed questions against their passage", async () => {
    const admin = await createUser(db, "admin@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    await expect(
      content.createFixedQuestion(db, actor, {
        conceptId: "concept-approved-source",
        sourcePassageId: "passage-study-stages",
        questionType: "TRUE_FALSE",
        question: "سؤال لمفهوم لا يطابق مقطعه",
        correctIndex: 0,
        explanation: "توضيح تجريبي",
        difficulty: 1,
      }),
    ).rejects.toThrowError(AppError);

    const ok = await content.createFixedQuestion(db, actor, {
      conceptId: "concept-study-stages",
      sourcePassageId: "passage-study-stages",
      questionType: "TRUE_FALSE",
      question: "يمرّ كل درس بمرحلتين متتاليتين.",
      correctIndex: 0,
      explanation: "ذكر النص ذلك صراحة.",
      difficulty: 1,
    });
    expect(ok.options).toEqual(["صحيح", "خطأ"]);
    expect(ok.approved).toBe(false);
  });

  it("stores 2–5 dynamic multiple-choice options without changing existing question behaviour", async () => {
    const admin = await createUser(db, "admin-dynamic-options@example.com", "ADMIN");
    const actor = { id: admin.id, role: admin.role };
    for (const count of [2, 3, 4, 5]) {
      const options = Array.from({ length: count }, (_, index) => `خيار ${count}-${index + 1}`);
      const created = await content.createFixedQuestion(db, actor, {
        conceptId: "concept-study-stages",
        sourcePassageId: "passage-study-stages",
        questionType: "MCQ",
        question: `ما الخيار الصحيح في الاختبار التجريبي رقم ${count}؟`,
        options: JSON.stringify(options),
        correctIndex: count - 1,
        explanation: "توضيح مختصر مستند إلى النص التجريبي.",
        difficulty: 2,
      });
      const reloaded = await db.fixedQuestion.findUniqueOrThrow({ where: { id: created.id } });
      expect(reloaded.options).toEqual(options);
      expect(reloaded.correctIndex).toBe(count - 1);
    }

    await expect(content.createFixedQuestion(db, actor, {
      conceptId: "concept-study-stages",
      sourcePassageId: "passage-study-stages",
      questionType: "MCQ",
      question: "هل يمكن حفظ سؤال بلا إجابة محددة؟",
      options: JSON.stringify(["نعم", "لا"]),
      correctIndex: "",
      explanation: "لا يمكن ذلك لأن الإجابة الصحيحة مطلوبة.",
      difficulty: 2,
    })).rejects.toThrow();
  });
});
