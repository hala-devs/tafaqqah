"use server";
import { revalidatePath } from "next/cache";
import { requireApiLearner } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { saveMemorizationGoal } from "@/server/memorization/goals";

export async function saveMemorizationGoalAction(formData: FormData) {
  const user = await requireApiLearner();
  const period = formData.get("period");
  const targetUnits = Number(formData.get("targetUnits"));
  if (period !== "DAILY" && period !== "WEEKLY" && period !== "MONTHLY") throw new Error("invalid goal");
  await saveMemorizationGoal(prisma, user.id, { targetUnits, period, isActive: formData.get("isActive") === "on" });
  revalidatePath("/memorize");
  revalidatePath("/dashboard");
  revalidatePath("/account");
  revalidatePath("/progress");
}

/** Deactivation is a reversible goal removal; earned memorization credit is never deleted. */
export async function removeMemorizationGoalAction() {
  const user = await requireApiLearner();
  const current = await prisma.memorizationGoal.findUnique({ where: { userId: user.id }, select: { targetUnits: true, period: true } });
  if (!current) return;
  await saveMemorizationGoal(prisma, user.id, { ...current, isActive: false });
  revalidatePath("/memorize");
  revalidatePath("/dashboard");
  revalidatePath("/account");
  revalidatePath("/progress");
}
