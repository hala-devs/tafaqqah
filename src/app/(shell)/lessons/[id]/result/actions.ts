"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";

export type FeedbackState = { ok?: boolean; error?: string };

const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/** Optional learner feedback after an assessment — stored for the planned evaluation. */
export async function submitFeedbackAction(sessionId: string, _prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const user = await requireApiLearner().catch(() => null);
  if (!user) return { error: "يرجى تسجيل الدخول للمتابعة." };
  const parsed = feedbackSchema.safeParse({ rating: formData.get("rating"), comment: formData.get("comment") || undefined });
  if (!parsed.success) return { error: "اختر تقييمًا من ١ إلى ٥." };

  const session = await prisma.assessmentSession.findUnique({ where: { id: sessionId }, select: { userId: true, status: true, lessonId: true } });
  if (!session || session.userId !== user.id || session.status !== "COMPLETED") return { error: "تعذّر حفظ رأيك." };

  await prisma.learnerFeedback.upsert({
    where: { sessionId },
    update: { rating: parsed.data.rating, comment: parsed.data.comment ?? null },
    create: { sessionId, userId: user.id, rating: parsed.data.rating, comment: parsed.data.comment ?? null },
  });
  revalidatePath(`/lessons/${session.lessonId}/result`);
  return { ok: true };
}
