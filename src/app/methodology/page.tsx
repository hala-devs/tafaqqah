import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpLeft,
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  CircleCheck,
  FileCheck2,
  Headphones,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { ButtonLink } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "المصادر والمنهجية | تفقّه",
  description: "تعرّف على مصادر تفقّه، ومنهجية اعتماد المحتوى، ودور الذكاء الاصطناعي في الاختبار التكيفي والمراجعة الموجّهة.",
};

// Current published lesson metadata: SourcePassage.videoUrl.
const explanationVideoUrl = "https://youtu.be/FdxZylJyi-w";

function Flow({ steps, className = "" }: { steps: string[]; className?: string }) {
  return (
    <ol className={`flex flex-wrap items-center gap-x-2 gap-y-3 ${className}`}>
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-small font-medium text-ink">{step}</span>
          {index < steps.length - 1 ? <ChevronLeft className="size-4 text-faint" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      {eyebrow ? <p className="text-caption font-semibold text-gold-ink">{eyebrow}</p> : null}
      <h2 className="mt-2 text-title text-ink">{title}</h2>
      {children ? <div className="mt-3 leading-8 text-muted">{children}</div> : null}
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg font-semibold text-ink underline decoration-gold/60 underline-offset-4 transition-colors hover:text-sage-deep focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
    >
      {children}
      <ArrowUpLeft className="size-4" aria-hidden />
      <span className="sr-only">(يفتح في نافذة جديدة)</span>
    </a>
  );
}

function SourceCard({ type, title, children, tone = "ink" }: { type: string; title: string; children: React.ReactNode; tone?: "ink" | "sage" }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-7">
      <p className={tone === "sage" ? "text-caption font-semibold text-sage-deep" : "text-caption font-semibold text-gold-ink"}>{type}</p>
      <h3 className="mt-2 text-section font-semibold text-ink">{title}</h3>
      <div className="mt-5 space-y-3 text-body leading-8 text-muted">{children}</div>
    </article>
  );
}

function Footer({ signedIn }: { signedIn: boolean }) {
  const links = [
    { href: "/", label: "الرئيسية" },
    { href: "/methodology", label: "المصادر والمنهجية" },
    ...(signedIn ? [] : [{ href: "/login", label: "تسجيل الدخول" }]),
  ];

  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 text-small text-muted">رحلة متدرجة لفهم الفقه وتثبيت العلم.</p>
          </div>
          <nav aria-label="روابط التذييل">
            <ul className="flex flex-wrap gap-x-1 gap-y-1 text-small">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="inline-block rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
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
  );
}

export default async function MethodologyPage() {
  const user = await getCurrentUser();
  const startHref = user ? "/dashboard" : "/register";

  return (
    <div className="overflow-x-clip">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-small font-medium text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
          <ArrowRightIcon />
          العودة للرئيسية
        </Link>
      </header>

      <main id="main">
        <section className="border-y border-line bg-surface/70">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
            <p className="text-caption font-semibold text-gold-ink">الشفافية العلمية</p>
            <h1 className="mt-3 max-w-3xl text-display-sm font-semibold text-ink sm:text-display">المصادر والمنهجية</h1>
            <p className="mt-5 max-w-3xl text-card leading-9 text-muted">نوضح هنا من أين تأتي المادة العلمية في تفقّه، وكيف تُراجع وتُستخدم، وما الدور الذي يؤديه الذكاء الاصطناعي داخل رحلة التعلّم.</p>
            <p className="mt-8 inline-flex rounded-xl border border-sage/35 bg-sage-soft px-4 py-3 text-card font-semibold text-sage-deep">المصدر أولًا، والذكاء الاصطناعي ضمن حدود المادة المعتمدة.</p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="layers-title">
          <h2 id="layers-title" className="sr-only">طبقات رحلة التعلّم</h2>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { icon: BookOpenText, title: "المتن", label: "للحفظ والمراجعة", text: "النص الذي يحفظه المتعلم ويعود إليه عند المراجعة.", tone: "sage" },
              { icon: Video, title: "الشرح", label: "للفهم", text: "المادة العلمية التي يدرس منها المتعلم قبل بدء الاختبار.", tone: "ink" },
              { icon: BrainCircuit, title: "الذكاء الاصطناعي", label: "لتخصيص الاختبار", text: "يستخدم المادة المعتمدة لتكييف اختبار الفهم وفق أداء المتعلم.", tone: "gold" },
            ].map(({ icon: Icon, title, label, text, tone }) => (
              <article key={title} className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
                <span className={`flex size-11 items-center justify-center rounded-xl ${tone === "sage" ? "bg-sage-soft text-sage-deep" : tone === "gold" ? "bg-gold-soft text-gold-ink" : "bg-ink-tint text-ink"}`}><Icon className="size-5" aria-hidden /></span>
                <p className="mt-5 text-caption font-semibold text-muted">{label}</p>
                <h3 className="mt-1 text-section font-semibold text-ink">{title}</h3>
                <p className="mt-2 leading-8 text-muted">{text}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 max-w-3xl border-r-4 border-gold pr-5 font-naskh text-title leading-relaxed text-ink">المصدر يحدد المعلومة الفقهية، والذكاء الاصطناعي يخصص اختبار فهمها.</p>
        </section>

        <section className="border-y border-line bg-surface/70 py-16 lg:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="المتاح اليوم" title="النطاق العلمي الحالي">
              <p>يركّز النطاق المطبّق حاليًا على <strong className="font-semibold text-ink">المستوى الأول — أخصر المختصرات</strong>. الدرس الأول منشور، أما الدرس الثاني فما زال في مسار المراجعة ولا يُتاح للمتعلمين قبل اعتماده ونشره.</p>
              <p className="mt-2">يُضاف المحتوى إلى تفقّه تدريجيًا بعد مراجعته واعتماده.</p>
            </SectionHeading>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="sources-title">
          <SectionHeading eyebrow="المتن والشرح مصدران منفصلان" title="مصادر رحلة التعلّم"><p>يُستخدم المتن للحفظ والمراجعة، ويُستخدم الشرح للفهم والاختبار التكيفي. الذكاء الاصطناعي ليس مصدرًا دينيًا.</p></SectionHeading>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <SourceCard type="المتن · للحفظ والمراجعة" title="أخصر المختصرات" tone="sage">
              <p><strong className="font-semibold text-ink">المؤلف:</strong> محمد بن بدر الدين بن بلبان الحنبلي</p>
              <p><strong className="font-semibold text-ink">الطبعة المستخدمة للتفريغ:</strong> الطبعة المحققة بتحقيق د. أنس بن عادل اليتامى ود. عبدالعزيز بن عدنان العيدان.</p>
              <p><strong className="font-semibold text-ink">الناشر:</strong> دار ركائز للنشر والتوزيع · <strong className="font-semibold text-ink">الطبعة:</strong> الأولى · <strong className="font-semibold text-ink">السنة:</strong> 1441هـ / 2019م</p>
              <p>تم إدخال نص المتن في تفقّه بالاعتماد على هذه الطبعة، مع الاقتصار على متن «أخصر المختصرات» دون الحواشي أو مواد التحقيق.</p>
            </SourceCard>
            <SourceCard type="الشرح · للفهم والاختبار التكيفي" title="شرح أخصر المختصرات">
              <p><strong className="font-semibold text-ink">الشيخ:</strong> محمد بن أحمد باجابر</p>
              <p><span className="inline-flex rounded-full bg-sage-soft px-2.5 py-1 text-caption font-semibold text-sage-deep">الاستخدام بإذن</span></p>
              <p>تم الحصول على إذن من الشيخ محمد بن أحمد باجابر لاستخدام شروحاته ضمن مشروع «تفقّه» التعليمي.</p>
              <p>يرتبط الدرس المنشور حاليًا بمصدر الفيديو الأصلي المحفوظ في بيانات المشروع.</p>
              <ExternalLink href={explanationVideoUrl}>عرض الشرح الأصلي</ExternalLink>
            </SourceCard>
          </div>
        </section>

        <section className="border-y border-line bg-surface/70 py-16 lg:py-20" aria-labelledby="content-method-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="كيف تدخل المادة العلمية إلى تفقّه؟" />
            <div className="mt-8 rounded-2xl border border-line bg-paper p-5 sm:p-7">
              <Flow steps={["المصدر", "تنظيم المادة", "تحديد المفاهيم ومواضعها", "المراجعة والاعتماد", "الإتاحة للمتعلم"]} />
              <p className="mt-6 max-w-3xl leading-8 text-muted">لا يكفي وجود المحتوى داخل النظام ليصبح مادة تعليمية متاحة؛ يمر المحتوى بمسار مراجعة واعتماد قبل استخدامه في رحلة المتعلم. لا تظهر نصوص الشرح للمتعلم إلا من الدروس المنشورة، ولا تُستخدم المقاطع في التوليد إلا عند اعتمادها.</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-line bg-surface p-6">
                <ShieldCheck className="size-6 text-sage-deep" aria-hidden />
                <h3 className="mt-4 text-section font-semibold text-ink">المراجعة البشرية</h3>
                <p className="mt-2 leading-8 text-muted">يُراجع فريق المحتوى نصوص المقاطع قبل اعتمادها. كما تمر مواضع الفيديو وتوقيتاته بمراجعة واعتماد بشريين قبل أن تستخدم في المراجعة الموجّهة.</p>
              </article>
              <article className="rounded-2xl border border-line bg-surface p-6">
                <FileCheck2 className="size-6 text-ink" aria-hidden />
                <h3 className="mt-4 text-section font-semibold text-ink">حد الاعتماد</h3>
                <p className="mt-2 leading-8 text-muted">تظل أقسام ومقاطع ووحدات المتن غير المعتمدة غير متاحة في رحلة الحفظ. الذكاء الاصطناعي لا يملك صلاحية اعتماد المصدر العلمي.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="ai-title">
          <SectionHeading eyebrow="ضمن حدود واضحة" title="ما دور الذكاء الاصطناعي؟"><p className="font-semibold text-ink">الذكاء الاصطناعي لا يحدد الحكم الشرعي؛ بل يخصص اختبار فهم الطالب للمادة المعتمدة.</p></SectionHeading>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ["يبني السؤال من مقطع معتمد", "يسترجع الخادم المادة من قاعدة البيانات؛ ولا يقبل نص المصدر من المتصفح."],
              ["يتفاعل مع الأداء", "يختار المفهوم اللاحق ومستوى صعوبة السؤال وفق إجابات المتعلم."],
              ["يوجه نحو التثبيت", "يساعد تسلسل الإجابات على تمييز المفاهيم التي قد تحتاج إلى مراجعة."],
            ].map(([title, text]) => <article key={title} className="rounded-2xl border border-line bg-surface p-6 shadow-soft"><h3 className="text-card font-semibold text-ink">{title}</h3><p className="mt-2 leading-8 text-muted">{text}</p></article>)}
          </div>
          <h3 className="mt-12 text-section font-semibold text-ink">ما الذي لا يفعله؟</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["لا يصدر فتوى", "لا يستبدل المصدر العلمي", "لا يعتمد المادة العلمية من تلقاء نفسه", "لا يستخدم التسجيل الصوتي للحفظ لتقييم المتعلم"].map((item) => <div key={item} className="rounded-xl border border-line bg-paper p-4 text-small font-semibold leading-7 text-ink"><CircleCheck className="mb-2 size-4 text-sage-deep" aria-hidden />{item}</div>)}
          </div>
        </section>

        <section className="border-y border-line bg-ink py-16 text-surface lg:py-20" aria-labelledby="question-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="كيف يُبنى السؤال؟"><p className="text-surface/75">توليد السؤال وحده لا يكفي ليصل إلى المتعلم.</p></SectionHeading>
            <div className="mt-8 rounded-2xl border border-surface/15 bg-surface/[0.06] p-5 sm:p-7">
              <Flow steps={["أداء المتعلم", "المفهوم المطلوب اختباره", "المادة المعتمدة", "توليد السؤال", "فحوص آلية", "تحقق مستقل", "عرض السؤال"]} />
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-surface/15 bg-surface/[0.06] p-6"><Sparkles className="size-5 text-gold" aria-hidden /><h3 className="mt-4 text-section font-semibold">التوليد</h3><p className="mt-2 leading-8 text-surface/75">يُنشأ السؤال استنادًا إلى المادة المعتمدة وسياق الاختبار.</p></article>
              <article className="rounded-2xl border border-surface/15 bg-surface/[0.06] p-6"><ScanSearch className="size-5 text-gold" aria-hidden /><h3 className="mt-4 text-section font-semibold">التحقق</h3><p className="mt-2 leading-8 text-surface/75">يمر السؤال المرشح بطبقة تحقق مستقلة قبل أن يصبح مؤهلًا للعرض، مع طبقات إضافية لتقليل الأسئلة غير المدعومة أو غير المناسبة.</p></article>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <SectionHeading title="ماذا يحدث عندما لا يكفي المصدر؟"><p>عندما لا توفر المادة المعتمدة أساسًا كافيًا للسؤال، لا يُستكمل الادعاء الفقهي من المعرفة العامة للنموذج. تسجل الحالة بوصفها مصدرًا غير كافٍ، ولا يُعرض سؤال مختلَق.</p></SectionHeading>
              <SectionHeading title="كيف يتكيف الاختبار مع المتعلم؟"><p>تتغير الأسئلة اللاحقة وفق أداء المتعلم مع بقائها مرتبطة بالمادة التعليمية المعتمدة. مستوى الإتقان مؤشر تعليمي تقريبي، وليس قياسًا نفسيًا أو علميًا دقيقًا.</p></SectionHeading>
              <Flow className="mt-6" steps={["الدرس", "الاختبار", "الإجابة", "تحليل الأداء", "السؤال التالي"]} />
            </div>
            <div>
              <SectionHeading title="خطأ واحد لا يكفي"><p>لا يُصنَّف المفهوم على أنه يحتاج إلى تثبيت من خطأ واحد فقط. بعد الإجابة غير الصحيحة، يمكن أن يأتي سؤالان لاحقان بصياغتين مختلفتين عن الفكرة نفسها؛ وعند تكرر الدليل تظهر حالة «يحتاج إلى تثبيت».</p></SectionHeading>
              <Flow className="mt-6" steps={["إجابة غير صحيحة", "سؤال لاحق بصياغة مختلفة", "تكرر الدليل", "يحتاج إلى تثبيت"]} />
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-surface/70 py-16 lg:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="المراجعة الموجّهة"><p>عند توفر موضع معتمد داخل الشرح، يمكن للمتعلم الرجوع مباشرة إلى الجزء المرتبط بالمفهوم بدل إعادة الدرس كاملًا. التوقيتات لا ينشئها الذكاء الاصطناعي في وقت التعلّم؛ بل تأتي من بيانات فيديو معتمدة.</p></SectionHeading>
            <Flow className="mt-8" steps={["يحتاج إلى تثبيت", "راجع هذا الجزء", "موضع الشرح المرتبط بالمفهوم", "اختبر فهمي مرة أخرى", "إعادة التقييم"]} />
            <div className="mt-12 rounded-2xl border border-sage/35 bg-sage-soft p-6 sm:p-8">
              <h2 className="text-section font-semibold text-ink">حلقة الفهم الكاملة</h2>
              <Flow className="mt-5" steps={["الدرس", "الاختبار التكيفي", "تحديد ما يحتاج إلى تثبيت", "المراجعة الموجّهة", "إعادة الاختبار", "تحديث مستوى الإتقان"]} />
              <p className="mt-5 text-small leading-7 text-sage-deep">تتكرر هذه الرحلة بحسب حاجة المتعلم.</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_.8fr] lg:gap-16">
            <div>
              <SectionHeading title="كيف تعمل رحلة الحفظ؟"><p>يختار المتعلم مقدارًا متصلًا من المتن، ويحفظه، ثم يُخفى المتن للتسميع. بعد ذلك يستمع إلى تسجيله، ويظهر النص المعتمد للمقارنة، ثم يقيّم نفسه ويعود للمراجعة أو إعادة التسميع.</p></SectionHeading>
              <Flow className="mt-7" steps={["اختيار المقطع", "الحفظ", "إخفاء المتن", "التسميع", "الاستماع للتسجيل", "إظهار المتن", "التقييم الذاتي", "المراجعة وإعادة التسميع"]} />
              <p className="mt-5 text-small leading-7 text-muted">تتوفر خيارات 3 أسطر و5 أسطر و10 أسطر، أو تحديد مخصص لمقطع متصل.</p>
            </div>
            <aside className="rounded-2xl border border-sage/35 bg-sage-soft p-6 sm:p-7" aria-labelledby="privacy-title">
              <Lock className="size-6 text-sage-deep" aria-hidden />
              <h2 id="privacy-title" className="mt-4 text-section font-semibold text-ink">خصوصية التسميع</h2>
              <p className="mt-3 text-card font-semibold leading-8 text-sage-deep">تسجيل التسميع يبقى على جهازك ولا يُرسل إلى الذكاء الاصطناعي.</p>
              <ul className="mt-5 space-y-3 text-small leading-7 text-ink">
                <li>يستمع المتعلم إلى التسجيل محليًا.</li>
                <li>يكشف المتن المعتمد ثم يقيّم أداءه بنفسه.</li>
                <li>لا يُرفع الصوت، ولا يستمع إليه الذكاء الاصطناعي، ولا يصححه أو يقيّمه.</li>
              </ul>
            </aside>
          </div>
        </section>

        <section className="border-y border-line bg-surface/70 py-16 lg:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading title="حدود تفقّه" />
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["أداة تعليمية", "يساعد تفقّه على التعلّم والاختبار والمراجعة."],
                ["ليس للإفتاء", "لا يقدّم تفقّه فتاوى شخصية، ولا يستبدل الرجوع إلى أهل العلم."],
                ["المصدر أولًا", "تخصيص الاختبار لا يمنح النموذج صلاحية إنشاء الأحكام الشرعية من معرفته العامة."],
                ["الإنسان ضمن عملية الاعتماد", "تُعتمد نصوص المحتوى ومواضع الفيديو وتوقيتاته ضمن مسار المراجعة قبل إتاحتها."],
              ].map(([title, text]) => <article key={title} className="rounded-2xl border border-line bg-surface p-5"><h3 className="text-card font-semibold text-ink">{title}</h3><p className="mt-2 text-small leading-7 text-muted">{text}</p></article>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="registry-title">
          <SectionHeading title="المصادر الحالية"><p>يعرض السجل أدناه المصادر الحالية المستخدمة في رحلة المتعلم، مع الفصل بين المتن والشرح.</p></SectionHeading>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <SourceCard type="المتن" title="أخصر المختصرات" tone="sage"><p><strong className="font-semibold text-ink">المؤلف:</strong> محمد بن بدر الدين بن بلبان الحنبلي</p><p><strong className="font-semibold text-ink">يستخدم لـ:</strong> الحفظ والمراجعة</p><p><strong className="font-semibold text-ink">الطبعة المستخدمة للتفريغ:</strong> الطبعة المحققة بتحقيق د. أنس بن عادل اليتامى ود. عبدالعزيز بن عدنان العيدان</p><p><strong className="font-semibold text-ink">الناشر:</strong> دار ركائز للنشر والتوزيع · <strong className="font-semibold text-ink">الطبعة:</strong> الأولى · <strong className="font-semibold text-ink">السنة:</strong> 1441هـ / 2019م</p><p>تم إدخال نص المتن في تفقّه بالاعتماد على هذه الطبعة، مع الاقتصار على متن «أخصر المختصرات» دون الحواشي أو مواد التحقيق.</p></SourceCard>
            <SourceCard type="الشرح" title="شرح أخصر المختصرات"><p><strong className="font-semibold text-ink">الشيخ:</strong> محمد بن أحمد باجابر</p><p><strong className="font-semibold text-ink">يستخدم لـ:</strong> الفهم والاختبار التكيفي</p><p><span className="inline-flex rounded-full bg-sage-soft px-2.5 py-1 text-caption font-semibold text-sage-deep">الاستخدام بإذن</span></p><p>تم الحصول على إذن من الشيخ محمد بن أحمد باجابر لاستخدام شروحاته ضمن مشروع «تفقّه» التعليمي.</p><ExternalLink href={explanationVideoUrl}>عرض الشرح الأصلي</ExternalLink></SourceCard>
          </div>
        </section>

        <section className="border-t border-line bg-ink py-16 text-surface lg:py-20">
          <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
            <p className="text-caption font-semibold text-gold">خطوة تالية</p>
            <h2 className="mt-2 text-title">ابدأ رحلتك من المصدر</h2>
            <p className="mx-auto mt-4 max-w-2xl leading-8 text-surface/75">تعلّم من المادة المعتمدة، اختبر فهمك، وارجع إلى موضع المراجعة الذي تحتاجه.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href={startHref} variant="light" size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>ابدأ الآن</ButtonLink>
              <ButtonLink href="/" variant="secondary" size="lg" className="border-surface/30 bg-transparent text-surface hover:border-surface hover:bg-surface/10">العودة للرئيسية</ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer signedIn={Boolean(user)} />
    </div>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden className="text-lg leading-none">→</span>;
}
