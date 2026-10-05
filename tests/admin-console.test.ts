import { beforeEach, describe, expect, it } from "vitest";
import * as content from "@/server/admin/content";
import { generateTrialQuestion } from "@/server/admin/ai-trial";
import { getLessonOverview, getReviewQueue } from "@/server/admin/content-overview";
import { getAiOverview, getAnalytics, getAuditTimeline, getDashboard, getStudentDetail, getStudents, maskEmail } from "@/server/admin/insights";
import { AppError } from "@/server/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { okQuestion, ScriptedProvider, verdict } from "./helpers/scripted-provider";

const PASSAGE_TEXT =
  "يُبنى كل سؤال من مقطع معتمد واحد يسترجعه الخادم بنفسه من قاعدة البيانات، ولا يُقبل نص المصدر من المتصفح. ثم يفحص مدقق مستقل السؤال قبل عرضه، فيتحقق من أن السؤال يُجاب عنه من المقطع وحده، وأن له إجابة صحيحة واحدة. فإن رُفض السؤال أُعيد توليده، وإن تكرر الرفض ثلاث مرات لم يُعرض سؤال مختلَق.";

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

/** A lesson with one concept whose passage and review timestamp are complete and coherent but NOT yet approved. */
async function reviewableLesson(db: PrismaClient, id = "console-lesson") {
  await db.lesson.create({ data: { id, chapterId: "ch1", title: "درس لوحة الإدارة", description: "اختبار", objectives: [], order: 70, status: "DRAFT" } });
  await db.concept.create({ data: { id: `${id}-c`, lessonId: id, title: "مفهوم لوحة الإدارة", description: "وصف المفهوم", order: 1, videoUrl: "https://youtu.be/FdxZylJyi-w", videoStartSecond: 10, videoEndSecond: 20 } });
  await db.sourcePassage.create({
    data: { id: `${id}-p`, lessonId: id, conceptId: `${id}-c`, text: PASSAGE_TEXT, sourceTitle: "مصدر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 10, endSecond: 20 },
  });
  return { lessonId: id, conceptId: `${id}-c`, passageId: `${id}-p` };
}

describe.skipIf(!hasTestDb)("Q. admin console services (database)", () => {
  let db: PrismaClient;
  let admin: { id: string; role: "ADMIN" };
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
    const user = await createUser(db, "console-admin@example.com", "ADMIN");
    admin = { id: user.id, role: "ADMIN" };
  });

  it("denies students every new admin read and write", async () => {
    const student = await createUser(db, "console-student@example.com");
    const actor = { id: student.id, role: student.role };
    await expectCode(content.setLessonPublication(db, actor, { lessonId: "lesson-method", status: "DRAFT" }), "FORBIDDEN");
    await expectCode(content.setConceptApproval(db, actor, { id: "concept-study-stages", approved: "true" }), "FORBIDDEN");
    await expectCode(generateTrialQuestion(db, actor, { conceptId: "concept-study-stages" }), "FORBIDDEN");
    await expectCode(getDashboard(db, actor), "FORBIDDEN");
    await expectCode(getReviewQueue(db, actor), "FORBIDDEN");
    await expectCode(getStudents(db, actor), "FORBIDDEN");
    await expectCode(getStudentDetail(db, actor, student.id), "FORBIDDEN");
    await expectCode(getAnalytics(db, actor), "FORBIDDEN");
    await expectCode(getAiOverview(db, actor), "FORBIDDEN");
    await expectCode(getAuditTimeline(db, actor), "FORBIDDEN");
    await expectCode(getAuditTimeline(db, null), "UNAUTHENTICATED");
  });

  it("never publishes a lesson because its source was approved", async () => {
    const { lessonId } = await reviewableLesson(db);
    await content.bulkApproveLessonReview(db, admin, { lessonId });
    const overview = await getLessonOverview(db, admin, lessonId);
    expect(overview).toMatchObject({ contentStatus: "APPROVED", publication: "DRAFT", combinedStatus: "APPROVED", readyToPublish: true });
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lessonId } })).status).toBe("DRAFT");
  });

  it("publishes only fully approved lessons and records who published", async () => {
    const { lessonId, conceptId, passageId } = await reviewableLesson(db);
    await expectCode(content.setLessonPublication(db, admin, { lessonId, status: "PUBLISHED" }), "BAD_REQUEST");

    await content.setPassageApproval(db, admin, { id: passageId, approved: "true" });
    // text approved, timestamp still pending → still blocked
    await expectCode(content.setLessonPublication(db, admin, { lessonId, status: "PUBLISHED" }), "BAD_REQUEST");

    await content.setConceptVideoApproval(db, admin, { id: conceptId, approved: "true" });
    await content.setLessonPublication(db, admin, { lessonId, status: "PUBLISHED" });
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lessonId } })).status).toBe("PUBLISHED");
    expect((await getLessonOverview(db, admin, lessonId))?.combinedStatus).toBe("PUBLISHED");

    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "lesson.published", entityId: lessonId } });
    expect(event.actorId).toBe(admin.id);
  });

  it("does not let the general edit form or creation form publish a lesson", async () => {
    const { lessonId } = await reviewableLesson(db);
    await content.updateLesson(db, admin, { lessonId, title: "عنوان جديد", description: "وصف", objectives: "", status: "PUBLISHED", order: 70 });
    expect((await db.lesson.findUniqueOrThrow({ where: { id: lessonId } })).status).toBe("DRAFT");
    await expectCode(content.createLesson(db, admin, { chapterId: "ch1", title: "درس منشور مباشرة", description: "وصف", objectives: "", status: "PUBLISHED", order: 99 }), "BAD_REQUEST");
  });

  it("approves and revokes a whole concept, and refuses structurally broken concepts", async () => {
    const { conceptId, passageId } = await reviewableLesson(db);
    await content.setConceptApproval(db, admin, { id: conceptId, approved: "true" });
    expect(await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).toMatchObject({ approved: true, approvedById: admin.id });
    expect(await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).toMatchObject({ videoApproved: true, videoApprovedById: admin.id });

    await content.setConceptApproval(db, admin, { id: conceptId, approved: "false" });
    expect(await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).toMatchObject({ approved: false, approvedById: null });
    expect((await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).videoApproved).toBe(false);

    await db.concept.update({ where: { id: conceptId }, data: { videoEndSecond: null } });
    await expectCode(content.setConceptApproval(db, admin, { id: conceptId, approved: "true" }), "BAD_REQUEST");
  });

  it("revokes approval when approved content changes substantially", async () => {
    const { lessonId, conceptId, passageId } = await reviewableLesson(db);
    await content.bulkApproveLessonReview(db, admin, { lessonId });

    // 1. a text change revokes the passage and bumps its version; a label-only change does not
    await content.updatePassage(db, admin, { passageId, text: PASSAGE_TEXT, sourceTitle: "مصدر آخر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 10, endSecond: 20 });
    expect(await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).toMatchObject({ approved: true, version: 1 });
    await content.updatePassage(db, admin, { passageId, text: PASSAGE_TEXT + " زيادة.", sourceTitle: "مصدر آخر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 10, endSecond: 20 });
    expect(await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).toMatchObject({ approved: false, version: 2 });
    expect((await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).videoApproved).toBe(true);

    // 2. moving the passage bounds revokes the concept's timestamp approval
    await content.updatePassage(db, admin, { passageId, text: PASSAGE_TEXT, sourceTitle: "مصدر آخر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 12, endSecond: 20 });
    expect((await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).videoApproved).toBe(false);

    // 3. changing the concept's title revokes both
    await content.setConceptApproval(db, admin, { id: conceptId, approved: "false" });
    await content.updatePassage(db, admin, { passageId, text: PASSAGE_TEXT, sourceTitle: "مصدر آخر", sourceAuthor: "مؤلف", sourceReference: "موضع", startSecond: 10, endSecond: 20 });
    await content.setConceptApproval(db, admin, { id: conceptId, approved: "true" });
    await content.updateConcept(db, admin, { conceptId, title: "عنوان مفهوم مختلف", description: "وصف المفهوم", order: 1 });
    expect((await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).approved).toBe(false);
    expect((await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).videoApproved).toBe(false);

    // a no-op concept edit (same title/description) does not revoke anything
    await content.setConceptApproval(db, admin, { id: conceptId, approved: "true" });
    await content.updateConcept(db, admin, { conceptId, title: "عنوان مفهوم مختلف", description: "وصف المفهوم", order: 2 });
    expect((await db.sourcePassage.findUniqueOrThrow({ where: { id: passageId } })).approved).toBe(true);

    // 4. editing the review video revokes the timestamp
    await content.updateConceptVideo(db, admin, { conceptId, videoUrl: "https://youtu.be/FdxZylJyi-w", videoStart: "0:10", videoEnd: "0:25" });
    expect((await db.concept.findUniqueOrThrow({ where: { id: conceptId } })).videoApproved).toBe(false);

    const revocations = await db.auditEvent.findMany({ where: { lessonId } });
    expect(revocations.some((e) => e.action === "passage.edited" && (e.metadata as { passageApprovalRevoked?: boolean }).passageApprovalRevoked)).toBe(true);
    expect(revocations.some((e) => e.action === "concept.edited" && (e.metadata as { revokedApprovals?: number }).revokedApprovals === 2)).toBe(true);
    expect(revocations.some((e) => e.action === "timestamp.edited")).toBe(true);
  });

  it("builds one audit timeline from audit events, legacy approvals and AI logs", async () => {
    const { lessonId, passageId, conceptId } = await reviewableLesson(db);
    // Approval fields written before the audit log existed (no AuditEvent row).
    await db.sourcePassage.update({ where: { id: "passage-approved-source" }, data: { approvedAt: new Date("2026-09-01T10:00:00Z"), approvedById: admin.id } });
    await content.setPassageApproval(db, admin, { id: passageId, approved: "true" });
    await content.setPassageApproval(db, admin, { id: passageId, approved: "false" });
    await content.setConceptVideoApproval(db, admin, { id: conceptId, approved: "true" });
    await db.aIInteractionLog.create({ data: { type: "VALIDATE", provider: "scripted", model: "m", promptVersion: "v", status: "REJECTED", metadata: { issues: ["ANSWER_NOT_SUPPORTED"] } } });

    const timeline = await getAuditTimeline(db, admin);
    const labels = timeline.map((r) => `${r.source}:${r.category}`);
    expect(labels).toEqual(expect.arrayContaining(["audit:approval", "audit:revocation", "ai:ai"]));
    const mine = timeline.filter((r) => r.lessonId === lessonId && r.source === "audit");
    expect(mine.every((r) => r.actorName === "مشرف")).toBe(true);
    // An approval stored before the audit log existed is reconstructed and marked legacy.
    expect(timeline.some((r) => r.source === "legacy" && r.category === "approval" && r.actorName === "مشرف")).toBe(true);
    expect(timeline.find((r) => r.source === "ai")?.summary).toContain("ANSWER_NOT_SUPPORTED");
  });

  it("classifies the review queue and reports ready-to-publish lessons", async () => {
    const { lessonId, conceptId, passageId } = await reviewableLesson(db);
    await db.sourcePassage.update({ where: { id: passageId }, data: { humanReviewRequired: true, alignmentStatus: "CONFLICT" } });
    let queue = await getReviewQueue(db, admin);
    const kinds = queue.items.filter((i) => i.lessonId === lessonId).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["HUMAN_REVIEW", "TIMESTAMP_UNAPPROVED", "SOURCE_CONFLICT"]));
    expect(queue.items.find((i) => i.lessonId === lessonId && i.kind === "HUMAN_REVIEW")?.href).toBe(`/admin/lessons/${lessonId}?concept=${conceptId}#concept-${conceptId}`);

    await db.sourcePassage.update({ where: { id: passageId }, data: { humanReviewRequired: false, alignmentStatus: "VERIFIED" } });
    queue = await getReviewQueue(db, admin);
    expect(queue.items.some((i) => i.lessonId === lessonId && i.kind === "READY_TO_APPROVE")).toBe(true);

    await content.bulkApproveLessonReview(db, admin, { lessonId });
    queue = await getReviewQueue(db, admin);
    expect(queue.items.some((i) => i.lessonId === lessonId && i.kind === "READY_TO_PUBLISH")).toBe(true);
    expect(queue.items.some((i) => i.lessonId === lessonId && i.kind === "READY_TO_APPROVE")).toBe(false);
  });

  it("dashboard totals reflect real rows", async () => {
    await createUser(db, "someone@example.com");
    const { totals, actions } = await getDashboard(db, admin);
    expect(totals.lessons).toBe(2);
    expect(totals.published).toBe(2);
    expect(totals.students).toBe(1);
    expect(totals.pendingPassages).toBe(1); // the fixture's unapproved passage
    expect(actions.textUnapproved.length).toBeGreaterThan(0);
  });

  it("analytics return honest empty states when there is no activity", async () => {
    const data = await getAnalytics(db, admin);
    expect(data.lessonRows).toEqual([]);
    expect(data.avgAccuracy).toBeNull();
    expect(data.recovery).toBeNull();
    expect(data.ai.acceptanceRate).toBeNull();
    expect(data.missedConcepts).toEqual([]);
  });

  it("masks student emails and exposes no password data", async () => {
    const student = await createUser(db, "private.person@example.com");
    const list = await getStudents(db, admin);
    const row = list.find((s) => s.id === student.id);
    expect(row?.maskedEmail).toBe("p•••@example.com");
    expect(JSON.stringify(list)).not.toContain("passwordHash");
    expect(JSON.stringify(list)).not.toContain("private.person");
    expect(maskEmail("a@b.co")).toBe("a•••@b.co");
    const detail = await getStudentDetail(db, admin, student.id);
    expect(JSON.stringify(detail)).not.toContain("private.person");
    expect(await getStudentDetail(db, admin, admin.id)).toBeNull(); // admins are not students
  });

  describe("trial question generation", () => {
    const candidate = {
      question: "ماذا يحدث للسؤال إذا رفضه المدقق المستقل؟",
      options: ["أُعيد توليده", "يُعرض مع تنبيه", "يُقبل نص المصدر من المتصفح", "يُحذف المقطع نهائيًا"],
      correctIndex: 0,
      explanation: "إذا رُفض السؤال أُعيد توليده.",
      answerEvidence: "فإن رُفض السؤال أُعيد توليده",
    };

    it("uses only the approved passage, runs generator then validator, and writes no learner state", async () => {
      const { conceptId, passageId } = await reviewableLesson(db);
      // An UNAPPROVED sibling passage with a marker must never reach the model.
      await db.sourcePassage.create({
        data: { id: "console-unapproved", lessonId: "console-lesson", conceptId, text: "نص-غير-معتمد-لا-يجوز-إرساله إلى النموذج أبدًا ولو كان طويلًا بما يكفي.", sourceTitle: "x", sourceAuthor: "x", sourceReference: "x", order: 9 },
      });
      await content.setPassageApproval(db, admin, { id: passageId, approved: "true" });
      const provider = new ScriptedProvider([okQuestion(candidate)], [verdict(true, [0])]);

      const result = await generateTrialQuestion(db, admin, { conceptId, stage: "VERIFICATION" }, { provider });
      expect(result.status).toBe("VALID");
      if (result.status !== "VALID") return;
      expect(result.passage.id).toBe(passageId);
      expect(result.candidate.answerEvidence).toBe("فإن رُفض السؤال أُعيد توليده");
      expect(result.validation.valid).toBe(true);

      expect(provider.generateRequests).toHaveLength(1);
      expect(provider.validateRequests).toHaveLength(1);
      expect(JSON.stringify([provider.generatePrompts, provider.validatePrompts])).not.toContain("نص-غير-معتمد");
      expect(provider.generateRequests[0].passage.text).toBe(PASSAGE_TEXT);

      // No question stored, no session, no mastery — nothing a real student could be affected by.
      expect(await db.generatedQuestion.count()).toBe(0);
      expect(await db.assessmentSession.count()).toBe(0);
      expect(await db.conceptMastery.count()).toBe(0);
      expect(await db.studentAnswer.count()).toBe(0);

      // …but the dry run is traceable.
      const logs = await db.aIInteractionLog.findMany({ orderBy: { createdAt: "asc" } });
      expect(logs.map((l) => l.type)).toEqual(["GENERATE", "VALIDATE"]);
      expect(logs.every((l) => (l.metadata as { trial?: boolean }).trial === true && l.userId === admin.id && l.sessionId === null)).toBe(true);
      expect((await db.auditEvent.findFirstOrThrow({ where: { action: "ai.trial_generation" } })).actorId).toBe(admin.id);
    });

    it("surfaces a validator rejection with its reasons instead of hiding it", async () => {
      const { conceptId, passageId } = await reviewableLesson(db);
      await content.setPassageApproval(db, admin, { id: passageId, approved: "true" });
      const outside = { ...candidate, explanation: "وعند الحنفية يُعرض السؤال دون مراجعة." };
      const result = await generateTrialQuestion(db, admin, { conceptId }, { provider: new ScriptedProvider([okQuestion(outside)], [verdict(true, [0])]) });
      expect(result.status).toBe("REJECTED");
      if (result.status === "REJECTED") expect(result.validation.issues).toContain("OTHER_MADHHAB_MARKER");
      expect(await db.generatedQuestion.count()).toBe(0);
    });

    it("refuses to call the model for a concept with no approved passage", async () => {
      const { conceptId } = await reviewableLesson(db);
      const provider = new ScriptedProvider([okQuestion(candidate)], [verdict(true, [0])]);
      await expectCode(generateTrialQuestion(db, admin, { conceptId }, { provider }), "INSUFFICIENT_SOURCE");
      expect(provider.generateRequests).toHaveLength(0);
      expect(await db.aIInteractionLog.count()).toBe(0);
    });
  });
});
