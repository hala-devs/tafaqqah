"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import * as content from "@/server/admin/content";
import { isAppError } from "@/server/errors";
import { assertAdmin } from "@/server/auth/authorization";
import { generateTrialQuestion, type TrialOutcome } from "@/server/admin/ai-trial";
import { hitRateLimit } from "@/server/rate-limit";

export type AdminActionState = { ok?: boolean; message?: string; error?: string };

type Service = (db: typeof prisma, actor: Awaited<ReturnType<typeof getCurrentUser>>, raw: unknown) => Promise<unknown>;

async function run(service: Service, formData: FormData, success: string): Promise<AdminActionState> {
  try {
    const actor = await getCurrentUser();
    await service(prisma, actor, Object.fromEntries(formData));
  } catch (error) {
    if (isAppError(error)) return { error: error.userMessage };
    if (error instanceof ZodError) {
      const first = error.issues[0];
      return { error: `تحقق من الحقل «${String(first?.path[0] ?? "")}»: ${first?.message ?? "قيمة غير صالحة"}` };
    }
    console.error("[admin] action failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر الحفظ. تحقق من البيانات ثم حاول مرة أخرى." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: success };
}

export async function createCourseAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createCourse, formData, "أُنشئ المسار.");
}
export async function createChapterAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createChapter, formData, "أُنشئ الباب.");
}
export async function createLessonAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createLesson, formData, "أُنشئ الدرس.");
}
export async function updateLessonAction(_prev: AdminActionState, formData: FormData) {
  return run(content.updateLesson, formData, "حُفظت بيانات الدرس.");
}
export async function createConceptAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createConcept, formData, "أُضيف المفهوم.");
}
export async function updateConceptAction(_prev: AdminActionState, formData: FormData) {
  return run(content.updateConcept, formData, "حُفظ المفهوم.");
}
export async function createPassageAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createPassage, formData, "أُضيف المقطع (غير معتمد حتى تعتمده).");
}
export async function updatePassageAction(_prev: AdminActionState, formData: FormData) {
  return run(content.updatePassage, formData, "حُفظ المقطع. إن تغيّر النص فقد أُلغي اعتماده.");
}
export async function setPassageApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setPassageApproval, formData, "حُدّثت حالة الاعتماد.");
}
export async function createFixedQuestionAction(_prev: AdminActionState, formData: FormData) {
  return run(content.createFixedQuestion, formData, "أُضيف السؤال الثابت (غير معتمد حتى تعتمده).");
}
export async function setFixedQuestionApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setFixedQuestionApproval, formData, "حُدّثت حالة السؤال.");
}
export async function updateConceptVideoAction(_prev: AdminActionState, formData: FormData) {
  return run(content.updateConceptVideo, formData, "حُفظ المقطع المرئي (غير معتمد حتى تعتمده).");
}
export async function setConceptVideoApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setConceptVideoApproval, formData, "حُدّثت حالة اعتماد المقطع المرئي.");
}
export async function bulkApproveLessonReviewAction(_prev: AdminActionState, formData: FormData) {
  const state = await run(content.bulkApproveLessonReview, formData, "اعتمدت المقاطع والتوقيتات بعد المراجعة البشرية.");
  const lessonId = formData.get("lessonId");
  if (state.ok && typeof lessonId === "string" && lessonId) {
    revalidatePath(`/admin/lessons/${lessonId}`);
  }
  return state;
}
export async function setLevelStatusAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setLevelStatus, formData, "حُدّثت حالة المستوى.");
}
export async function setLessonPublicationAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setLessonPublication, formData, "حُدّثت حالة نشر الدرس.");
}
export async function setConceptApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(content.setConceptApproval, formData, "حُدّثت حالة اعتماد المفهوم.");
}

export type TrialActionState = { error?: string; outcome?: TrialOutcome };

/** Dry-run generator → validator on one approved passage. Never touches sessions, questions served or mastery. */
export async function generateTrialQuestionAction(_prev: TrialActionState, formData: FormData): Promise<TrialActionState> {
  try {
    const actor = await getCurrentUser();
    assertAdmin(actor);
    if (hitRateLimit(`admin-trial:${actor.id}`, 20, 60 * 60 * 1000)) return { error: "طلبات توليد تجريبي كثيرة. انتظر قليلًا ثم حاول مرة أخرى." };
    const outcome = await generateTrialQuestion(prisma, actor, Object.fromEntries(formData));
    revalidatePath("/admin/ai");
    return { outcome };
  } catch (error) {
    if (isAppError(error)) return { error: error.userMessage };
    if (error instanceof ZodError) return { error: "اختر مفهومًا ونوع السؤال والمستوى." };
    console.error("[admin] trial generation failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر التوليد التجريبي. تحقق من إعداد مزوّد الذكاء الاصطناعي." };
  }
}
