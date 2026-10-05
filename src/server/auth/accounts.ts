import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { EvaluationGroup } from "@/generated/prisma/enums";
import type { Role } from "@/generated/prisma/enums";
import { getDummyHash, hashPassword, verifyPassword } from "./password";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "الاسم قصير جدًا").max(60, "الاسم طويل جدًا"),
  email: z.string().trim().toLowerCase().email("صيغة البريد الإلكتروني غير صحيحة").max(160),
  password: z.string().min(8, "كلمة المرور يجب ألا تقل عن ٨ أحرف").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("صيغة البريد الإلكتروني غير صحيحة").max(160),
  password: z.string().min(1, "أدخل كلمة المرور").max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;

type Strategy = "adaptive" | "fixed" | "split";

export function assessmentStrategy(): Strategy {
  const raw = (process.env.ASSESSMENT_MODE_STRATEGY ?? "adaptive").toLowerCase();
  return raw === "fixed" || raw === "split" ? raw : "adaptive";
}

/** Which assessment arm a learner gets by default (see ASSESSMENT_MODE_STRATEGY). */
export function defaultModeFor(evaluationGroup: EvaluationGroup): "ADAPTIVE" | "FIXED" {
  const strategy = assessmentStrategy();
  if (strategy === "fixed") return "FIXED";
  if (strategy === "adaptive") return "ADAPTIVE";
  return evaluationGroup;
}

async function assignEvaluationGroup(db: PrismaClient): Promise<EvaluationGroup> {
  const strategy = assessmentStrategy();
  if (strategy === "fixed") return "FIXED";
  if (strategy === "adaptive") return "ADAPTIVE";
  // split: alternate assignment so the two arms stay balanced
  const count = await db.user.count({ where: { role: "STUDENT" } });
  return count % 2 === 0 ? "ADAPTIVE" : "FIXED";
}

export type RegisterResult = { ok: true; userId: string } | { ok: false; reason: "EMAIL_TAKEN" };

export async function registerUser(db: PrismaClient, input: RegisterInput): Promise<RegisterResult> {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) return { ok: false, reason: "EMAIL_TAKEN" };
  const user = await db.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      evaluationGroup: await assignEvaluationGroup(db),
    },
    select: { id: true },
  });
  return { ok: true, userId: user.id };
}

export async function authenticate(db: PrismaClient, email: string, password: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  if (!user) {
    // Spend comparable time so response timing does not reveal which emails exist.
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user.id : null;
}

export type LoginPortal = "LEARNER" | "ADMIN";
export type PortalAuthentication = { userId: string; role: Role } | null;

/** Verifies credentials and returns the current database role before a session is created. */
export async function authenticateForPortal(db: PrismaClient, email: string, password: string): Promise<PortalAuthentication> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true, passwordHash: true } });
  if (!user) {
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? { userId: user.id, role: user.role } : null;
}

export function isPortalRoleCompatible(portal: LoginPortal, role: Role): boolean {
  return portal === "ADMIN" ? role === "ADMIN" : role === "STUDENT";
}
