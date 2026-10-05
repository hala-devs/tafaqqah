import Link from "next/link";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import { Logo } from "@/components/shell/logo";

const STEPS = ["تعلّم", "اختبر", "راجع", "أتقن"];

/** Compact supporting panel: explains Tafaqqah in seconds, secondary to the form. */
function LearningPanel() {
  return (
    <aside
      aria-label="عن تفقّه"
      className="relative overflow-hidden bg-ink p-7 text-surface sm:p-9 lg:flex lg:flex-col lg:justify-center lg:p-10"
    >
      <div aria-hidden className="bg-geometric pointer-events-none absolute inset-0 opacity-35 invert [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      <div className="relative mx-auto w-full max-w-md lg:mx-0">
        <p className="text-caption font-medium text-gold">رحلة تعلّم متدرجة</p>
        <p className="mt-3 text-section leading-9 font-semibold">تعلّم، اختبر فهمك، راجع موضع ضعفك، ثم أتقن.</p>

        <ol className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="خطوات الرحلة">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-1.5">
              <span
                className={
                  i === STEPS.length - 1
                    ? "rounded-full border border-gold/60 bg-gold/15 px-3 py-1 text-caption font-medium text-surface"
                    : "rounded-full border border-surface/20 bg-surface/[0.06] px-3 py-1 text-caption font-medium text-surface"
                }
              >
                {step}
              </span>
              {i < STEPS.length - 1 ? <ChevronLeft aria-hidden className="size-3.5 text-surface/40" /> : null}
            </li>
          ))}
        </ol>

        <div aria-hidden className="mt-8 hidden h-px w-16 bg-gold/60 sm:block" />
        <p className="mt-6 hidden font-naskh text-card leading-9 text-surface/85 sm:block">
          المصدر يحدد المعلومة الفقهية،
          <br />
          والذكاء الاصطناعي يخصص اختبار فهمها.
        </p>
      </div>
    </aside>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-20 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-small font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          العودة للرئيسية
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 pt-2 pb-10 sm:px-6 lg:pb-16">
        <div className="w-full max-w-5xl animate-fade-up">
          <div className="grid overflow-hidden rounded-2xl border border-line bg-surface shadow-lift lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="px-6 py-9 sm:px-12 sm:py-12 lg:px-14 lg:py-14">
              <div className="mx-auto w-full max-w-md lg:mx-0">{children}</div>
            </div>
            <LearningPanel />
          </div>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-caption text-faint">
            <span>© 2026 تفقّه</span>
            <span aria-hidden>·</span>
            <span>تفقّه أداة تعليمية، ولا يقدّم فتاوى.</span>
          </p>
        </div>
      </main>
    </div>
  );
}
