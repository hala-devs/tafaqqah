import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { safePortalNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = next ? safePortalNextPath(next, "LEARNER") : undefined;
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : nextPath ?? "/dashboard");

  return (
    <>
      <h1 className="text-title text-ink">مرحبًا بعودتك</h1>
      <p className="mt-2 mb-8 text-card leading-8 text-muted">سجّل دخولك لمتابعة رحلتك من حيث توقفت.</p>
      <LoginForm next={nextPath} />
    </>
  );
}
