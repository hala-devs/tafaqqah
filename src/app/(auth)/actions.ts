"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { authenticateForPortal, isPortalRoleCompatible, loginSchema, registerSchema, registerUser, type LoginPortal } from "@/server/auth/accounts";
import { endSession, startSession } from "@/server/auth/current-user";
import { hitRateLimit } from "@/server/rate-limit";
import { safePortalNextPath } from "@/lib/safe-redirect";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
  values?: { name?: string; email?: string };
};

async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { name: raw.name, email: raw.email };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: AuthFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "name" | "email" | "password";
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors, values };
  }
  if (hitRateLimit(`register:${await clientKey()}`, 10, 60 * 60 * 1000)) {
    return { error: "محاولات كثيرة. حاول لاحقًا.", values };
  }

  let userId: string;
  try {
    const result = await registerUser(prisma, parsed.data);
    if (!result.ok) return { fieldErrors: { email: "هذا البريد مسجّل بالفعل. جرّب تسجيل الدخول." }, values };
    userId = result.userId;
    await startSession(userId);
  } catch (error) {
    console.error("[auth] register failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر إنشاء الحساب الآن. حاول مرة أخرى.", values };
  }
  redirect("/dashboard");
}

async function loginForPortal(portal: LoginPortal, _prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const values = { email: raw.email };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "تحقق من البريد الإلكتروني وكلمة المرور.", values };

  if (hitRateLimit(`login:${await clientKey()}:${parsed.data.email}`, 8, 15 * 60 * 1000)) {
    return { error: "محاولات دخول كثيرة. انتظر قليلًا ثم حاول مرة أخرى.", values };
  }

  try {
    const account = await authenticateForPortal(prisma, parsed.data.email, parsed.data.password);
    if (!account) return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة.", values };
    if (!isPortalRoleCompatible(portal, account.role)) {
      return { error: portal === "ADMIN" ? "هذا الحساب غير مخوّل للدخول إلى لوحة الإدارة." : "هذا الحساب مخصص للإدارة. يرجى تسجيل الدخول من بوابة الإدارة.", values };
    }
    await startSession(account.userId);
  } catch (error) {
    console.error("[auth] login failed", error instanceof Error ? error.message : error);
    return { error: "تعذّر تسجيل الدخول الآن. حاول مرة أخرى.", values };
  }
  redirect(safePortalNextPath(formData.get("next"), portal));
}

export async function loginAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return loginForPortal("LEARNER", prev, formData);
}

export async function adminLoginAction(prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  return loginForPortal("ADMIN", prev, formData);
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
