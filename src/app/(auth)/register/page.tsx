import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <>
      <h1 className="text-title text-ink">ابدأ رحلتك مع تفقّه</h1>
      <p className="mt-2 mb-8 text-card leading-8 text-muted">أنشئ حسابك وابدأ التعلّم بخطوات متدرجة وواضحة.</p>
      <RegisterForm />
    </>
  );
}
