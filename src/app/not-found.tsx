import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <div className="mt-12 flex size-14 items-center justify-center rounded-full bg-surface-2 text-sage-dark">
        <Compass className="size-6" aria-hidden />
      </div>
      <h1 className="mt-6 text-title text-ink">لم نجد هذه الصفحة</h1>
      <p className="mt-2 max-w-md text-muted">ربما نُقلت الصفحة أو أن الرابط غير صحيح. يمكنك العودة إلى مسارك والمتابعة من هناك.</p>
      <ButtonLink href="/dashboard" className="mt-8">
        العودة إلى الرئيسية
      </ButtonLink>
    </main>
  );
}
