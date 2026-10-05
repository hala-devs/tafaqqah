import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "../../auth-forms";
import { getCurrentUser } from "@/server/auth/current-user";
import { safePortalNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "تسجيل دخول الإدارة" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? safePortalNextPath(next, "ADMIN") : "/dashboard");
  return <><h1 className="text-title text-ink">بوابة الإدارة</h1><p className="mt-2 mb-8 text-card leading-8 text-muted">سجّل الدخول بحساب الإدارة فقط.</p><LoginForm next={safePortalNextPath(next, "ADMIN")} portal="ADMIN" /></>;
}
