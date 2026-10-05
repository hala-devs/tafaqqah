"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import { setMatnPassageApproval, setMatnSectionApproval, updateMatnUnitText } from "@/server/admin/matn";
import type { AdminActionState } from "../actions";

type Service = (db: typeof prisma, actor: Awaited<ReturnType<typeof getCurrentUser>>, raw: unknown) => Promise<unknown>;

async function run(service: Service, formData: FormData, success: string): Promise<AdminActionState> {
  try {
    const actor = await getCurrentUser();
    await service(prisma, actor, Object.fromEntries(formData));
  } catch (error) {
    if (isAppError(error)) return { error: error.userMessage };
    if (error instanceof ZodError) return { error: "بيانات غير صالحة." };
    console.error("[admin] matn action failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر الحفظ. حاول مرة أخرى." };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: success };
}

export async function setMatnPassageApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(setMatnPassageApproval, formData, "حُدّثت حالة اعتماد المقطع.");
}
export async function setMatnSectionApprovalAction(_prev: AdminActionState, formData: FormData) {
  return run(setMatnSectionApproval, formData, "حُدّثت حالة اعتماد القسم.");
}
export async function updateMatnUnitTextAction(_prev: AdminActionState, formData: FormData) {
  return run(updateMatnUnitText, formData, "حُفظ نص الوحدة وأُلغي اعتمادها حتى تعتمد مقطعها من جديد.");
}
