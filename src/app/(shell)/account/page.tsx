import type { Metadata } from "next";
import { BarChart3, CalendarDays, Flame, GraduationCap, LogOut, Mail, ShieldCheck, Sparkles, Target, UserRound } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { logoutAction } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { AccountGoalCenter } from "@/components/account/account-goal-center";
import { PremiumGoalCenter } from "@/components/account/premium-goal-center";
import { ContinuityCalendar } from "@/components/account/continuity-calendar";
import { getContinuity, getMotivation } from "@/server/learner/motivation";
import { getMemorizationGoal } from "@/server/memorization/goals";

export const metadata: Metadata = { title: "الحساب" };

export default async function AccountPage() {
  const session = await requireUser("/account");
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.id },
    select: { name: true, email: true, role: true, createdAt: true },
  });

  const [motivation, continuity, memorizationGoal] = await Promise.all([getMotivation(prisma, session.id), getContinuity(prisma, session.id), getMemorizationGoal(prisma, session.id)]);

  if (user.role === "STUDENT") {
    return <div className="mx-auto max-w-5xl pb-12"><header className="relative overflow-hidden py-7 sm:py-11"><div aria-hidden className="bg-geometric absolute inset-0 opacity-20" /><div className="relative"><p className="text-small font-semibold text-gold-ink">حسابي</p><h1 className="mt-2 text-display-sm font-bold text-ink">بيانات حسابك</h1><p className="mt-2 text-body text-muted">معلوماتك الشخصية وإعدادات رحلتك في تفقّه.</p></div></header><section aria-label="معلومات الحساب" className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-8"><div aria-hidden className="bg-geometric absolute inset-y-0 left-0 w-1/3 opacity-15" /><div className="relative grid gap-7 md:grid-cols-[auto_1fr] md:items-center"><span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-gold-soft text-gold-ink sm:size-24"><UserRound className="size-10" /></span><dl className="divide-y divide-line"><ProfileRow icon={<UserRound />} label="الاسم" value={user.name} /><ProfileRow icon={<Mail />} label="البريد الإلكتروني" value={<bdi dir="ltr">{user.email}</bdi>} /><ProfileRow icon={<GraduationCap />} label="نوع الحساب" value="متعلم" /><ProfileRow icon={<CalendarDays />} label="تاريخ الانضمام" value={formatDate(user.createdAt)} /></dl></div></section><section aria-labelledby="goals-title" className="mt-12"><div className="flex items-start gap-3"><Target className="mt-1 size-5 text-gold-ink" aria-hidden /><div><h2 id="goals-title" className="text-section text-ink">أهدافي</h2><p className="mt-1 text-small text-muted">حدّد ما تريد إنجازه، ودع تفقّه يساعدك على الاستمرار في رحلتك العلمية.</p></div></div><PremiumGoalCenter motivation={motivation} memorizationGoal={memorizationGoal} /></section><section className="mt-8 flex flex-col gap-4 rounded-2xl border border-gold/30 bg-gold-soft/35 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><BarChart3 className="mt-1 size-5 shrink-0 text-gold-ink" aria-hidden /><div><h2 className="text-card font-bold text-ink">متابعة تقدّمك بالتفصيل</h2><p className="mt-1 text-small leading-6 text-muted">يمكنك الاطلاع على إحصائيات إنجازك وسجل نشاطك والمزيد في صفحة تقدّمي.</p></div></div><ButtonLink href="/progress" variant="secondary">عرض تقدّمي</ButtonLink></section><section className="mt-8 rounded-2xl border border-error/25 bg-error-soft/25 p-5 sm:flex sm:items-center sm:justify-between"><div><h2 className="text-card font-bold text-error-ink">تسجيل الخروج</h2><p className="mt-1 text-small text-muted">سيتم تسجيل خروجك من حسابك الحالي.</p></div><form action={logoutAction} className="mt-4 sm:mt-0"><Button type="submit" variant="quiet-danger" icon={<LogOut className="size-4" aria-hidden />}>تسجيل الخروج</Button></form></section></div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8">
        <div aria-hidden className="bg-geometric absolute inset-0 opacity-30" />
        <div className="relative"><p className="text-small font-semibold text-gold-ink">مساحتك الخاصة</p><h1 className="mt-1 text-title text-ink">الحساب</h1><p className="mt-1 text-small text-muted">نظّم أهدافك وتابع استمراريتك في رحلة التفقه.</p></div>
      </header>
      <Card className="mt-5">
        <dl className="divide-y divide-line">
          <div className="flex flex-wrap justify-between gap-2 py-3 first:pt-0">
            <dt className="text-small text-muted">الاسم</dt>
            <dd className="text-body text-ink">{user.name}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-3">
            <dt className="text-small text-muted">البريد الإلكتروني</dt>
            <dd className="text-body text-ink" dir="ltr">
              {user.email}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-3">
            <dt className="text-small text-muted">نوع الحساب</dt>
            <dd>{user.role === "ADMIN" ? <Badge tone="gold">مشرف محتوى</Badge> : <Badge tone="neutral">متعلم</Badge>}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2 py-3 last:pb-0">
            <dt className="text-small text-muted">تاريخ الانضمام</dt>
            <dd className="text-body text-ink">{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {false ? (
        <>
        <section id="goals" aria-labelledby="goals-title" className="mt-12">
          <h2 id="goals-title" className="text-section text-ink">
            أهدافي
          </h2>
          <p className="mt-1 text-small text-muted">حدّد ما تريد إنجازه، ودع تفقّه يساعدك على الاستمرار.</p>
          <AccountGoalCenter motivation={motivation} memorizationGoal={memorizationGoal} />
        </section>
        <section id="continuity" aria-labelledby="continuity-title" className="mt-12">
          <h2 id="continuity-title" className="text-section text-ink">استمراريتي</h2>
          <p className="mt-1 text-small text-muted">تابع أيام نشاطك واستمرارك في رحلتك العلمية.</p>
          <div className="relative mt-5 overflow-hidden rounded-2xl bg-ink p-6 text-surface shadow-lift sm:p-8"><div aria-hidden className="bg-geometric absolute inset-0 opacity-20" /><div className="relative flex flex-wrap items-center gap-5"><span className="flex size-14 items-center justify-center rounded-2xl bg-gold-soft text-gold-ink"><Flame className="size-7" aria-hidden /></span><div className="min-w-44 flex-1"><p className="text-small text-surface/75">السلسلة الحالية</p><p className="mt-1 text-display-sm font-bold">{continuity.currentStreak.count} <span className="text-card">أيام متتالية</span></p><p className="mt-1 text-small text-surface/75">{continuity.currentStreak.count ? "استمر على هذا المنوال." : "أكمل نشاطًا واحدًا لبدء سلسلتك."}</p></div><div className="grid grid-cols-2 gap-5 border-surface/15 text-small sm:border-s sm:ps-6"><p><span className="block text-title font-bold">{continuity.longestStreak}</span><span className="text-surface/70">أطول سلسلة</span></p><p><span className="block text-title font-bold">{continuity.totalActiveDays}</span><span className="text-surface/70">أيام النشاط</span></p></div></div></div>
          <ContinuityCalendar activeDays={continuity.activeDays} today={motivation.today} />
          <div className="mt-5 rounded-2xl border border-gold/30 bg-gold-soft/45 p-5"><div className="flex items-center gap-2 text-card font-semibold text-gold-ink"><Sparkles className="size-4" aria-hidden />محطات الاستمرارية</div><p className="mt-2 text-small text-muted">{continuity.longestStreak >= 7 ? `أكملت ${continuity.longestStreak} أيام متتالية في أفضل سلسلة لك.` : continuity.currentStreak.count ? `بقي ${Math.max(0, 7 - continuity.currentStreak.count)} أيام للوصول إلى محطة ٧ أيام.` : "ابدأ بمحطة يوم واحد، ثم واصل بهدوء."}</p></div>
        </section>
        </>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {user.role === "ADMIN" ? (
          <ButtonLink href="/admin" variant="secondary" icon={<ShieldCheck className="size-4" aria-hidden />}>
            إدارة المحتوى
          </ButtonLink>
        ) : null}
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" icon={<LogOut className="size-4" aria-hidden />}>
            تسجيل الخروج
          </Button>
        </form>
      </div>

      <section className="mt-12 rounded-xl border border-line bg-surface-2/60 p-5 text-small leading-7 text-muted">
        <h2 className="text-card font-semibold text-ink">عن تفقّه</h2>
        <p className="mt-2">
          تفقّه أداة تعليمية، ولا يقدّم فتاوى. تُعرض المعلومة الفقهية من المادة العلمية المعتمدة كما هي، وتُبنى الأسئلة على
          تلك المادة وحدها ويُتحقق منها قبل عرضها. للسؤال عن حكم في واقعة بعينها، ارجع إلى أهل العلم.
        </p>
      </section>
    </div>
  );
}

function ProfileRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) { return <div className="flex items-center justify-between gap-5 py-4 first:pt-0 last:pb-0"><dt className="flex items-center gap-2 text-small text-muted"><span className="text-gold-ink">{icon}</span>{label}</dt><dd className="text-body font-medium text-ink">{value}</dd></div>; }
