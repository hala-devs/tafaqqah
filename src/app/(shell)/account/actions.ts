"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { GOAL_LIMITS, updateGoalSettings, type MonthlyGoalKind } from "@/server/learner/motivation";
import { isValidTimezone } from "@/lib/learning-time";

export type GoalFormState = { ok?: boolean; error?: string };

function toInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}

function refresh() {
  revalidatePath("/dashboard");
  revalidatePath("/account");
  revalidatePath("/progress");
}

/** Quick weekly goal from the home screen (one tap). `target` empty = no goal. */
export async function setWeeklyGoalAction(formData: FormData): Promise<void> {
  const user = await requireApiLearner();
  const target = toInt(formData.get("target"));
  if (target !== null && !(target >= GOAL_LIMITS.weekly.min && target <= GOAL_LIMITS.weekly.max)) return;
  await updateGoalSettings(prisma, user.id, { weeklyLessonGoal: target });
  refresh();
}

/** Account goal center: saves one real lesson-count goal while retaining the other period's existing target. */
export async function saveLearningJourneyGoalAction(formData: FormData): Promise<void> {
  const user = await requireApiLearner();
  const period = formData.get("period");
  const target = toInt(formData.get("target"));
  if ((period !== "WEEKLY" && period !== "MONTHLY") || target === null || Number.isNaN(target)) return;
  const limits = period === "WEEKLY" ? GOAL_LIMITS.weekly : GOAL_LIMITS.monthly;
  if (target < limits.min || target > limits.max) return;
  if (period === "WEEKLY") await updateGoalSettings(prisma, user.id, { weeklyLessonGoal: target });
  else await updateGoalSettings(prisma, user.id, { monthlyGoalKind: "LESSONS", monthlyGoalTarget: target });
  refresh();
}

/** Removes only the selected learning-goal period; progress and learning history remain intact. */
export async function removeLearningJourneyGoalAction(formData: FormData): Promise<void> {
  const user = await requireApiLearner();
  const period = formData.get("period");
  if (period === "WEEKLY") await updateGoalSettings(prisma, user.id, { weeklyLessonGoal: null });
  else if (period === "MONTHLY") await updateGoalSettings(prisma, user.id, { monthlyGoalKind: null, monthlyGoalTarget: null });
  else return;
  refresh();
}

/** Full goals form on the account page: weekly + monthly, all optional. */
export async function saveGoalsAction(_prev: GoalFormState, formData: FormData): Promise<GoalFormState> {
  let user;
  try {
    user = await requireApiLearner();
  } catch {
    return { error: "يرجى تسجيل الدخول للمتابعة." };
  }
  const weekly = toInt(formData.get("weekly"));
  const kindRaw = formData.get("monthlyKind");
  const kind: MonthlyGoalKind | null = kindRaw === "LESSONS" || kindRaw === "CONCEPTS" ? kindRaw : null;
  const monthlyTarget = kind ? toInt(formData.get(`monthly-${kind}`)) : null;

  if (Number.isNaN(weekly) || Number.isNaN(monthlyTarget)) return { error: "اختر قيمة صحيحة للهدف." };
  if (kind && monthlyTarget === null) return { error: "اختر قيمة للهدف الشهري أو اختر «بدون هدف»." };
  try {
    await updateGoalSettings(prisma, user.id, { weeklyLessonGoal: weekly, monthlyGoalKind: kind, monthlyGoalTarget: monthlyTarget });
  } catch (error) {
    if (error instanceof RangeError) return { error: "قيمة الهدف خارج الحدّ المسموح." };
    console.error("[goals] save failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر حفظ أهدافك الآن. حاول مرة أخرى." };
  }
  refresh();
  return { ok: true };
}

/** Keeps the learner's day/week/month boundaries aligned with their real timezone. */
export async function syncTimezoneAction(timezone: string): Promise<void> {
  if (!isValidTimezone(timezone)) return;
  const user = await requireApiLearner();
  await updateGoalSettings(prisma, user.id, { timezone });
  refresh();
}
