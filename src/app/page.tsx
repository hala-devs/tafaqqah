import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronLeft,
  CircleDot,
  FileCheck2,
  Headphones,
  Lock,
  PlayCircle,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Smartphone,
  SquarePen,
} from "lucide-react";
import { getCurrentUser } from "@/server/auth/current-user";
import { getRoadmaps, type RoadmapLevel } from "@/server/content/queries";
import { Logo } from "@/components/shell/logo";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";

const UNDERSTANDING = [
  { title: "تعلّم", text: "ابدأ بالدرس والمادة العلمية المعتمدة." },
  { title: "اختبر", text: "أجب عن أسئلة تتكيّف مع مستوى فهمك." },
  { title: "اكتشف", text: "يتتبع النظام أداءك ويحدد ما يحتاج إلى تثبيت." },
  { title: "راجع", text: "ارجع مباشرة إلى موضع الشرح المرتبط بالمفهوم." },
  { title: "أتقن", text: "اختبر فهمك مرة أخرى وتابع تقدّمك." },
];

const STRUGGLE = [
  { title: "إجابة غير صحيحة", text: "لا يُحكم عليك من خطأ واحد." },
  { title: "سؤال لاحق بصياغة مختلفة", text: "يُختبر المفهوم نفسه من زاوية أخرى." },
  { title: "يحتاج إلى تثبيت", text: "حين يتكرر الضعف في المفهوم ذاته." },
  { title: "مراجعة موجهة", text: "إلى الجزء المرتبط من المادة العلمية." },
  { title: "موضع الشرح", text: "تنتقل إلى الموضع الذي تحتاجه مباشرة." },
  { title: "اختبر فهمي مرة أخرى", text: "أسئلة جديدة على المفهوم نفسه." },
  { title: "تحديث الإتقان", text: "يتحدّث مستوى إتقانك بناءً على أدائك." },
];

const MEMORIZE_STEPS = ["اختر المقطع", "احفظ", "سمّع", "استمع", "قارن بالمتن", "قيّم حفظك", "راجع", "أعد التسميع"];
const SESSION_SIZES = ["3 أسطر", "5 أسطر", "10 أسطر", "تحديد مخصص"];

const TRUST = [
  { icon: BookOpenText, title: "مصدر معتمد", text: "يرتبط السؤال بالمادة العلمية المحددة للمفهوم." },
  { icon: SquarePen, title: "توليد منضبط", text: "تُبنى الأسئلة ضمن حدود المصدر، دون إضافة حكم من خارجه." },
  { icon: FileCheck2, title: "تحقق قبل العرض", text: "لا يصل السؤال إلى المتعلم حتى يجتاز فحوص الجودة والتحقق." },
];
const PIPELINE = ["المصدر", "توليد السؤال", "فحوص الجودة", "التحقق", "المتعلم"];

/** Future levels come from the existing roadmap data; the landing page never invents them. */
async function getUpcomingLevels(): Promise<RoadmapLevel[]> {
  try {
    const roadmaps = await getRoadmaps();
    const main = roadmaps.find((r) => !r.isSample) ?? roadmaps[0];
    return main ? main.levels.filter((l) => l.status !== "ACTIVE") : [];
  } catch {
    return [];
  }
}

/** Inline step chain; wraps naturally and reads right-to-left. */
function FlowChips({ steps, tone = "ink", className }: { steps: string[]; tone?: "ink" | "sage" | "light"; className?: string }) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-2", className)}>
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-caption font-medium",
              tone === "ink" && "border-line-strong bg-paper text-ink",
              tone === "sage" && "border-sage/40 bg-sage-soft text-sage-deep",
              tone === "light" && "border-surface/20 bg-surface/[0.06] text-surface",
            )}
          >
            {step}
          </span>
          {i < steps.length - 1 ? (
            <ChevronLeft aria-hidden className={cn("size-3.5", tone === "light" ? "text-surface/40" : "text-faint")} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SectionHeader({ id, eyebrow, title, text, center }: { id: string; eyebrow?: string; title: ReactNode; text?: string; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow ? <p className="text-caption font-medium text-gold-ink">{eyebrow}</p> : null}
      <h2 id={id} className="mt-2 text-title text-ink">
        {title}
      </h2>
      {text ? <p className="mt-3 leading-8 text-muted">{text}</p> : null}
    </div>
  );
}

/** Static, illustrative product preview: adaptive question → needs reinforcement → targeted review. */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="bg-geometric absolute -inset-10 opacity-80 [mask-image:radial-gradient(circle_at_center,black_30%,transparent_72%)]" />

      {/* Adaptive question */}
      <div className="relative rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-7">
        <div className="flex items-center justify-between text-caption">
          <span className="inline-flex items-center gap-2 font-medium text-gold-ink">
            <ScanSearch className="size-4" /> سؤال متكيّف
          </span>
          <span className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={cn("h-1.5 w-4 rounded-full", i < 2 ? "bg-sage" : i === 2 ? "bg-ink" : "bg-surface-2")} />
            ))}
          </span>
        </div>
        <span className="mt-5 block h-2.5 w-4/5 rounded-full bg-ink/15" />
        <span className="mt-2.5 block h-2.5 w-3/5 rounded-full bg-ink/10" />
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-success bg-success-soft px-3 py-2.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-success text-white">
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <span className="h-2 w-2/3 rounded-full bg-success/30" />
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 opacity-70">
            <span className="flex size-6 items-center justify-center rounded-full border border-line-strong text-micro text-muted">ب</span>
            <span className="h-2 w-1/2 rounded-full bg-surface-2" />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="text-caption text-muted">إتقان المفهوم</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full w-3/5 rounded-full bg-sage" />
          </span>
        </div>
      </div>

      {/* Targeted review */}
      <div className="relative -mt-6 ms-8 me-[-0.5rem] rounded-2xl border border-line bg-surface/95 p-5 shadow-lift backdrop-blur sm:ms-16 lg:me-[-2rem]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption font-medium text-ink">مراجعة موجهة</span>
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-micro font-medium text-warning-ink">يحتاج إلى تثبيت</span>
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2.5">
          <PlayCircle className="size-5 shrink-0 text-ink" />
          <span className="text-small font-medium text-ink">راجع موضع الشرح</span>
          <span className="ms-auto rounded-md bg-ink-tint px-2 py-0.5 font-mono text-micro text-ink" dir="ltr">
            13:30
          </span>
        </div>
      </div>
    </div>
  );
}

function JourneyCard({
  title,
  text,
  steps,
  tone,
  icon,
  cta,
}: {
  title: string;
  text: string;
  steps: string[];
  tone: "ink" | "sage";
  icon: ReactNode;
  cta: { href: string; label: string };
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-7 shadow-soft sm:p-8">
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-xl",
          tone === "ink" ? "bg-ink-tint text-ink" : "bg-sage-soft text-sage-deep",
        )}
        aria-hidden
      >
        {icon}
      </span>
      <h3 className="mt-5 text-section font-semibold text-ink">{title}</h3>
      <p className="mt-2 leading-8 text-muted">{text}</p>
      <FlowChips steps={steps} tone={tone} className="mt-6" />
      <div className="mt-auto pt-8">
        <ButtonLink href={cta.href} variant={tone === "ink" ? "primary" : "sage"} iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
          {cta.label}
        </ButtonLink>
      </div>
    </article>
  );
}

/** Illustrative dashboard preview — states only, no user numbers. */
function ProgressPreview() {
  const rows: { label: string; state: string; width: string; bar: string }[] = [
    { label: "تقدم الدروس", state: "مستمر", width: "w-2/5", bar: "bg-ink" },
    { label: "إتقان المفاهيم", state: "يتحدّث بعد كل اختبار", width: "w-1/2", bar: "bg-sage" },
    { label: "تقدم الحفظ", state: "مستقل عن الفهم", width: "w-1/4", bar: "bg-gold" },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-7" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="text-card font-semibold text-ink">رحلتي</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-micro text-muted">معاينة توضيحية</span>
      </div>
      <div className="mt-6 space-y-5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-center justify-between text-small">
              <span className="font-medium text-ink">{r.label}</span>
              <span className="text-caption text-faint">{r.state}</span>
            </div>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span className={cn("block h-full rounded-full", r.width, r.bar)} />
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-paper p-4">
          <p className="text-caption text-muted">المراجعات</p>
          <p className="mt-1 flex items-center gap-2 text-small font-medium text-ink">
            <span className="size-2 rounded-full bg-warning" /> مفهوم يحتاج إلى تثبيت
          </p>
        </div>
        <div className="rounded-xl border border-line bg-paper p-4">
          <p className="text-caption text-muted">الهدف الأسبوعي</p>
          <p className="mt-1 flex items-center gap-2 text-small font-medium text-ink">
            <CircleDot className="size-3.5 text-sage-dark" /> هدفك الذي تختاره
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const [user, upcomingLevels] = await Promise.all([getCurrentUser(), getUpcomingLevels()]);
  // Guests are sent to registration; signed-in learners go straight to the existing app routes.
  const primary = user ? { href: "/dashboard", label: "أكمل رحلتك" } : { href: "/register", label: "ابدأ رحلة التعلّم" };
  const learnHref = user ? "/curriculum" : "/register";
  const memorizeHref = user ? "/memorize" : "/register";

  return (
    <div className="overflow-x-clip">
      {/* Header */}
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav aria-label="روابط الصفحة" className="flex items-center gap-1 sm:gap-2">
          <a href="#journeys" className="hidden rounded-lg px-3 py-2 text-small text-muted hover:text-ink md:inline-block">
            الرحلتان
          </a>
          <a href="#memorize" className="hidden rounded-lg px-3 py-2 text-small text-muted hover:text-ink md:inline-block">
            الحفظ
          </a>
          <a href="#trust" className="hidden rounded-lg px-3 py-2 text-small text-muted hover:text-ink md:inline-block">
            كيف نتحقق
          </a>
          <a href="#path" className="hidden rounded-lg px-3 py-2 text-small text-muted hover:text-ink md:inline-block">
            المسار
          </a>
          {user ? null : (
            <Link href="/login" className="rounded-lg px-3 py-2 text-small font-medium text-ink hover:bg-surface-2">
              تسجيل الدخول
            </Link>
          )}
          <ButtonLink href={primary.href} size="sm" className="hidden sm:inline-flex">
            {primary.label}
          </ButtonLink>
        </nav>
      </header>

      <main id="main">
        {/* 1 — Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-8 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16 lg:pt-16 lg:pb-28">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-caption text-muted">
              <span className="size-1.5 rounded-full bg-gold" aria-hidden />
              منصة تعليمية متخصصة في الفقه الحنبلي
            </p>
            <h1 className="mt-6 text-display-sm font-semibold text-ink sm:text-display">
              تعلّم الفقه الحنبلي بفهمٍ أعمق،
              <br className="hidden sm:block" /> ومراجعةٍ أذكى.
            </h1>
            <p className="mt-6 max-w-xl text-card leading-9 text-muted">
              تفقّه تجربة تعليمية متخصصة في الفقه الحنبلي، تجمع بين الفهم وحفظ المتن والمراجعة التكيفية، ضمن محتوى علمي موثّق ومعتمد، مع توظيف الذكاء الاصطناعي أداةً مساندة للتعلّم لا مصدرًا للأحكام.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href={primary.href} size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
                {primary.label}
              </ButtonLink>
              <ButtonLink href="#journeys" variant="secondary" size="lg">
                استكشف المسار
              </ButtonLink>
            </div>
            <p className="mt-8 text-caption text-faint">المصدر أولًا · اختبار متكيف · مراجعة موجهة</p>
          </div>
          <HeroVisual />
        </section>

        {/* 2 — Two journeys */}
        <section id="journeys" aria-labelledby="journeys-title" className="scroll-mt-6 border-t border-line bg-surface/70 py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeader id="journeys-title" title="رحلتان تكمل إحداهما الأخرى" text="افهم المسألة أولًا، وثبّت علمك بالحفظ والمراجعة." center />
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <JourneyCard
                title="الفهم والإتقان"
                text="ادرس الدرس، اختبر فهمك، واكتشف ما يحتاج إلى مراجعة."
                steps={["تعلّم", "اختبر", "اكتشف", "راجع", "أتقن"]}
                tone="ink"
                icon={<BookOpenText className="size-5" />}
                cta={{ href: learnHref, label: "ابدأ التعلّم" }}
              />
              <JourneyCard
                title="حفظ المتن"
                text="اختر مقدار حفظك، سمّع لنفسك، قيّم حفظك، وراجع ما يحتاج إلى تثبيت."
                steps={["اختر", "احفظ", "سمّع", "قيّم", "راجع"]}
                tone="sage"
                icon={<Headphones className="size-5" />}
                cta={{ href: memorizeHref, label: "ابدأ الحفظ" }}
              />
            </div>
          </div>
        </section>

        {/* 3 — Understanding journey */}
        <section id="understanding" aria-labelledby="understanding-title" className="border-y border-line py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeader id="understanding-title" eyebrow="رحلة الفهم والإتقان" title="من التعلّم إلى الإتقان، في حلقة واحدة واضحة" />
            <ol className="relative mt-14 grid gap-10 lg:grid-cols-5 lg:gap-6">
              <span aria-hidden className="absolute start-5.5 top-2 bottom-2 w-px bg-line-strong lg:hidden" />
              {UNDERSTANDING.map((step, index) => (
                <li key={step.title} className="relative flex gap-5 lg:block">
                  {index < UNDERSTANDING.length - 1 ? (
                    <span aria-hidden className="absolute start-11 top-5.5 hidden h-px w-[calc(100%-1.25rem)] bg-line-strong lg:block" />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full border font-naskh text-section",
                      index === UNDERSTANDING.length - 1 ? "border-gold bg-gold-soft text-gold-ink" : "border-line-strong bg-paper text-ink",
                    )}
                  >
                    {ar(index + 1)}
                  </span>
                  <div className="lg:mt-5">
                    <h3 className="text-section font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-small leading-7 text-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-12 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-small text-muted">
              <RotateCcw className="size-4 text-gold-ink" aria-hidden />
              ليست اختبارًا لمرة واحدة؛ تتكرر الحلقة حتى يثبت فهمك لكل مفهوم.
            </p>
          </div>
        </section>

        {/* 4 — When you struggle */}
        <section id="struggle" aria-labelledby="struggle-title" className="bg-ink py-20 text-surface lg:py-24">
          <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
            <div aria-hidden className="bg-geometric pointer-events-none absolute inset-0 opacity-40 invert [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
            <div className="relative grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
              <div>
                <p className="text-caption font-medium text-gold">عندما تتعثّر</p>
                <h2 id="struggle-title" className="mt-2 text-title">
                  الخطأ لا ينهي الاختبار؛ بل يوجّه مراجعتك.
                </h2>
                <p className="mt-3 max-w-xl leading-8 text-surface/75">
                  عندما يظهر ضعف متكرر في مفهوم محدد، يوجّهك تفقّه إلى الجزء المرتبط به من المادة العلمية، ثم يعيد اختبار فهمك.
                </p>
                <ol className="mt-10 space-y-0">
                  {STRUGGLE.map((step, i) => (
                    <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
                      {i < STRUGGLE.length - 1 ? <span aria-hidden className="absolute start-3 top-7 bottom-0 w-px bg-surface/20" /> : null}
                      <span
                        className={cn(
                          "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-micro",
                          i === 2 ? "border-warning bg-warning text-ink-dark" : i === STRUGGLE.length - 1 ? "border-gold bg-gold text-ink-dark" : "border-surface/30 text-surface/70",
                        )}
                      >
                        {ar(i + 1)}
                      </span>
                      <div>
                        <h3 className="text-card font-semibold">{step.title}</h3>
                        <p className="text-small text-surface/65">{step.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Illustrative review card */}
              <div className="rounded-2xl border border-surface/15 bg-surface p-6 text-ink shadow-lift sm:p-7" aria-hidden>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-muted">مفهوم من الدرس</span>
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-micro font-medium text-warning-ink">يحتاج إلى تثبيت</span>
                </div>
                <span className="mt-4 block h-2.5 w-3/4 rounded-full bg-ink/15" />
                <p className="mt-4 text-small leading-7 text-muted">ظهر الضعف في سؤالين بصياغتين مختلفتين.</p>
                <div className="mt-5 rounded-xl border border-line bg-paper p-4">
                  <p className="text-caption font-medium text-gold-ink">راجع هذا الجزء</p>
                  <div className="mt-3 flex items-center gap-3">
                    <PlayCircle className="size-5 shrink-0" />
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full w-2/5 rounded-full bg-ink" />
                    </span>
                    <span className="rounded-md bg-ink-tint px-2 py-0.5 font-mono text-micro" dir="ltr">
                      13:30
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-small font-medium text-surface">
                  <RotateCcw className="size-4" /> اختبر فهمي مرة أخرى
                </div>
                <p className="mt-3 text-center text-micro text-faint">مثال توضيحي</p>
              </div>
            </div>
          </div>
        </section>

        {/* 5 — Memorization */}
        <section id="memorize" aria-labelledby="memorize-title" className="scroll-mt-6 py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
              <div>
                <SectionHeader
                  id="memorize-title"
                  eyebrow="رحلة حفظ المتن"
                  title="احفظ المتن بخطوات واضحة"
                  text="اختر مقدار الحفظ المناسب لك، سمّع لنفسك، ثم قارن تسميعك بالمتن وحدّد ما يحتاج إلى مراجعة."
                />
                <FlowChips steps={MEMORIZE_STEPS} tone="sage" className="mt-8" />
                <p className="mt-8 flex items-start gap-2 text-small text-muted">
                  <Smartphone className="mt-1 size-4 shrink-0 text-sage-dark" aria-hidden />
                  تسجيل التسميع يبقى على جهازك ولا يُرسل إلى الذكاء الاصطناعي.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-7">
                <h3 className="text-card font-semibold text-ink">مقدار جلسة الحفظ</h3>
                <p className="mt-1 text-small text-muted">تختار أنت مقدار ما تحفظه في كل جلسة.</p>
                <ul className="mt-5 grid grid-cols-2 gap-3">
                  {SESSION_SIZES.map((size, i) => (
                    <li
                      key={size}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-center text-small font-medium",
                        i === 1 ? "border-sage bg-sage-soft text-sage-deep" : "border-line bg-paper text-ink",
                      )}
                    >
                      {size}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 rounded-xl border border-line bg-paper p-4">
                  <p className="text-caption text-muted">بعد التسميع، تقارن بنفسك مع نص المتن وتقيّم حفظك:</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-caption">
                    <span className="rounded-full bg-success-soft px-2.5 py-1 text-success-ink">متقن</span>
                    <span className="rounded-full bg-warning-soft px-2.5 py-1 text-warning-ink">يحتاج إلى تثبيت</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6 — Source-grounded trust */}
        <section id="trust" aria-labelledby="trust-title" className="scroll-mt-6 border-y border-line bg-surface/70 py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-3xl text-center">
              <Logo className="mx-auto justify-center" imageClassName="w-16 sm:w-20" />
              <h2 id="trust-title" className="mt-6 font-naskh text-quote font-semibold text-ink sm:text-quote-lg">
                المصدر يحدد المعلومة الفقهية،
                <br />
                والذكاء الاصطناعي أداة مساندة تخصّص اختبار فهمها.
              </h2>
              <span aria-hidden className="mx-auto mt-6 block h-px w-20 bg-gold/70" />
            </div>
            <ul className="mt-12 grid gap-5 md:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-2xl border border-line bg-surface p-6">
                  <Icon className="size-5 text-gold-ink" aria-hidden />
                  <h3 className="mt-4 text-card font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 text-small leading-7 text-muted">{text}</p>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex justify-center">
              <FlowChips steps={PIPELINE} className="justify-center" />
            </div>
            <p className="mt-8 flex items-center justify-center gap-2 text-center text-caption text-faint">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              تفقّه أداة تعليمية، ولا يقدّم فتاوى ولا يحلّ محلّ أهل العلم.
            </p>
          </div>
        </section>

        {/* 7 — Learning path */}
        <section id="path" aria-labelledby="path-title" className="scroll-mt-6 py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeader id="path-title" title="المسار العلمي في تفقّه" text="مسار متدرّج في الفقه الحنبلي يبدأ من المستوى الأول، مع بناء الفهم خطوة بخطوة." />
            <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <article className="rounded-2xl border border-line bg-surface p-7 shadow-soft sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-caption font-medium text-muted">المستوى الأول</p>
                  <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-caption font-medium text-success-ink">متاح الآن</span>
                </div>
                <h3 className="mt-3 font-naskh text-quote font-semibold text-ink">أخصر المختصرات</h3>
                <p className="mt-1 text-small text-muted">{ar(55)} درسًا</p>
                <ButtonLink href={learnHref} className="mt-8" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
                  ابدأ المستوى الأول
                </ButtonLink>
              </article>
              {upcomingLevels.length ? (
                <ul className="grid content-start gap-3" aria-label="مستويات قادمة">
                  {upcomingLevels.map((level) => (
                    <li key={level.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3 text-muted">
                      <Lock className="size-4 shrink-0 text-faint" aria-hidden />
                      <span className="text-small">
                        المستوى {ar(level.order)} · {level.title}
                      </span>
                      <span className="ms-auto shrink-0 text-caption text-faint">قريبًا</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </section>

        {/* 8 — Progress */}
        <section aria-labelledby="progress-title" className="border-t border-line bg-surface/70 py-20 lg:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16">
            <SectionHeader
              id="progress-title"
              title="اعرف أين وصلت، وماذا يحتاج إلى تثبيت."
              text="تتابع تقدّمك في الدروس، وإتقانك لكل مفهوم، ومراجعاتك، وتقدّم حفظك للمتن، كلٌّ في موضعه."
            />
            <ProgressPreview />
          </div>
        </section>

        {/* 9 — Final CTA */}
        <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
          <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-soft sm:p-12">
            <Logo className="mx-auto justify-center" imageClassName="w-20" />
            <h2 id="cta-title" className="mt-6 text-title text-ink">
              ابدأ رحلتك في تعلّم الفقه الحنبلي
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">تعلّم، اختبر فهمك، راجع موضع ضعفك، وثبّت ما تعلمته.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <ButtonLink href={primary.href} size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
                {user ? primary.label : "ابدأ الآن"}
              </ButtonLink>
              <ButtonLink href="#path" variant="secondary" size="lg">
                استكشف المسار
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <Logo />
              <p className="mt-3 text-small text-muted">رحلة متدرجة لفهم الفقه الحنبلي وتثبيت العلم.</p>
            </div>
            <nav aria-label="روابط التذييل">
              <ul className="flex flex-wrap gap-x-1 gap-y-1 text-small">
                {[
                  { href: "/", label: "الرئيسية" },
                  { href: "/methodology", label: "المصادر والمنهجية" },
                  { href: "#path", label: "المسار العلمي" },
                  { href: "#memorize", label: "حفظ المتن" },
                  ...(user ? [] : [{ href: "/login", label: "تسجيل الدخول" }]),
                ].map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-block rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-ink focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="mt-8 flex flex-col gap-2 border-t border-line pt-6 text-caption text-faint sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 تفقّه</p>
            <p>تفقّه أداة تعليمية، ولا يقدّم فتاوى.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
