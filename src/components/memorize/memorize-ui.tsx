import { Lock } from "lucide-react";

const STEPS = ["احفظ", "أخفِ المتن", "سمّع", "استمع", "قارن", "قيّم نفسك", "راجع عند الحاجة"];

/** «كيف تعمل جلسة الحفظ؟» — a compact sequence shown as supporting information on /memorize. */
export function SessionSteps() {
  return (
    <section aria-labelledby="how-title">
      <h2 id="how-title" className="text-card font-semibold text-ink">
        كيف تعمل جلسة الحفظ؟
      </h2>
      <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step} className="border-t-2 border-line-strong pt-2.5 first:border-sage-dark">
            <span className="block font-mono text-caption font-medium text-sage-dark tabular-nums" dir="ltr">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="mt-0.5 block text-small font-semibold text-ink">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-col gap-1.5 text-small text-muted">
        <p>تختار مقدار الحفظ (٣ أو ٥ أو ١٠ أسطر أو تحديدًا مخصصًا) عند بدء الجلسة، وأنت من يقيّم تسميعك بعد مقارنته بالمتن.</p>
        <p className="flex items-center gap-1.5">
          <Lock className="size-3.5 text-sage-dark" aria-hidden />
          التسجيل يبقى على جهازك.
        </p>
      </div>
    </section>
  );
}
