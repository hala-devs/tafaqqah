"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { markLessonStudied } from "@/server/content/study";
import { isAppError } from "@/server/errors";

export type StudyState = { ok?: boolean; error?: string };

export async function markStudiedAction(lessonId: string, _prev: StudyState): Promise<StudyState> {
  try {
    const user = await requireApiLearner();
    await markLessonStudied(prisma, user.id, lessonId);
  } catch (error) {
    if (isAppError(error)) return { error: error.userMessage };
    console.error("[lesson] markStudied failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر حفظ تقدّمك الآن. حاول مرة أخرى." };
  }
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/dashboard");
  revalidatePath("/curriculum");
  return { ok: true };
}
