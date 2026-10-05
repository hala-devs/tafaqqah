"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/ui/field";
import { PasswordField } from "@/components/ui/password-field";
import { adminLoginAction, loginAction, registerAction, type AuthFormState } from "./actions";

const initial: AuthFormState = {};

const switchLink =
  "font-semibold text-ink underline decoration-gold/60 underline-offset-4 hover:decoration-ink rounded-sm";

export function LoginForm({ next, portal = "LEARNER" }: { next?: string; portal?: "LEARNER" | "ADMIN" }) {
  const [state, action, pending] = useActionState(portal === "ADMIN" ? adminLoginAction : loginAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <TextField
        id="email"
        name="email"
        type="email"
        label="البريد الإلكتروني"
        autoComplete="email"
        inputMode="email"
        dir="ltr"
        className="h-12 text-start"
        required
        defaultValue={state.values?.email}
      />
      <PasswordField id="password" name="password" label="كلمة المرور" autoComplete="current-password" className="h-12" required />
      <Button type="submit" size="lg" className="mt-2 w-full" loading={pending}>
        {pending ? "جارٍ الدخول…" : "تسجيل الدخول"}
      </Button>
      {portal === "LEARNER" ? <p className="border-t border-line pt-5 text-center text-small text-muted">
        ليس لديك حساب؟{" "}
        <Link href="/register" className={switchLink}>
          أنشئ حسابًا
        </Link>
      </p> : null}
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <TextField
        id="name"
        name="name"
        label="الاسم"
        autoComplete="name"
        className="h-12"
        required
        defaultValue={state.values?.name}
        error={state.fieldErrors?.name}
      />
      <TextField
        id="email"
        name="email"
        type="email"
        label="البريد الإلكتروني"
        autoComplete="email"
        inputMode="email"
        dir="ltr"
        className="h-12 text-start"
        required
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <PasswordField
        id="password"
        name="password"
        label="كلمة المرور"
        autoComplete="new-password"
        className="h-12"
        required
        hint="ثمانية أحرف على الأقل."
        error={state.fieldErrors?.password}
      />
      <Button type="submit" size="lg" className="mt-2 w-full" loading={pending}>
        {pending ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
      </Button>
      <p className="border-t border-line pt-5 text-center text-small text-muted">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className={switchLink}>
          تسجيل الدخول
        </Link>
      </p>
    </form>
  );
}
