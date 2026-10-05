import type { Metadata } from "next";
import { Award, BookOpenText, CalendarDays, Lightbulb, NotebookPen } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { flattenPath, getLearningPath } from "@/server/content/queries";
import { prisma } from "@/server/db";
import { getHomeData } from "@/server/learner/home";
import { getContinuity } from "@/server/learner/motivation";
import { getCompletedAttempts, getMasteryByLesson } from "@/server/learner/overview";
import { getRecentActivity } from "@/server/learner/recent-activity";
import { getMemorizationGoal } from "@/server/memorization/goals";
import { loadMatnJourney } from "@/server/memorization/journey";
import { getMemorizationSummaries } from "@/server/memorization/progress";
import { ActivityCalendar, CalendarLegend, FlameMark } from "@/components/progress/activity-calendar";
import { DetailTabs } from "@/components/progress/detail-tabs";
import { MemorizationDetails, UnderstandingDetails } from "@/components/progress/details";
import { GoalProgressCard } from "@/components/progress/goal-progress-card";
import { daysLabel, MilestoneTrack } from "@/components/progress/milestone-path";
import { ArchArt, PathArt } from "@/components/progress/progress-art";
import { RecentActivity } from "@/components/progress/recent-activity";
import { StatCard } from "@/components/progress/stat-card";
import { milestonePath } from "@/lib/continuity";
import { ar, countLabel } from "@/lib/format";

export const metadata: Metadata = { title: "تقدمي" };

const DAY_N = { one: "يوم", two: "يومان", few: "أيام", many: "يومًا" };
const STREAK_N = { one: "يوم", two: "يومان متتاليان", few: "أيام متتالية", many: "يومًا متتاليًا" };
const LESSON_N = { one: "درس", two: "درسان", few: "دروس", many: "درسًا" };
const LINE_N = { one: "سطر", two: "سطران", few: "أسطر", many: "سطرًا" };
const LESSONS = ["درس واحد", "درسان", "دروس", "درسًا"] as [string, string, string, string];
const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];
const PERIOD = { DAILY: "اليوم", WEEKLY: "هذا الأسبوع", MONTHLY: "هذا الشهر" } as const;

/** The noun after a figure (the figure itself is shown large): 0–1 singular, 2 dual, 3–10 plural, 11+ accusative. */
function unit(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 2) return forms.two;
  if (n >= 3 && n <= 10) return forms.few;
  if (n >= 11) return forms.many;
  return forms.one;
}

/**
 * /progress — the learner's full progress and continuity destination. Every figure is read from an existing
 * authoritative helper: LearningDay (streak, calendar, milestones — via getContinuity, the same source as the home
 * streak), lesson completion (getHomeData), recited canonical lines (loadMatnJourney, the /memorize measure), and the
 * two goals (motivation.weekly and MemorizationGoal). Understanding and memorization are never combined.
 */
export default async function ProgressPage() {
  const user = await requireUser("/progress");
  const now = new Date();
  const [path, home, byLesson, attempts, summaries, continuity, memoGoal, recent] = await Promise.all([
    getLearningPath(user.id),
    getHomeData(user.id, user.name),
    getMasteryByLesson(user.id),
    getCompletedAttempts(user.id),
    getMemorizationSummaries(prisma, user.id, now),
    getContinuity(prisma, user.id, now),
    getMemorizationGoal(prisma, user.id, now),
    getRecentActivity(prisma, user.id),
  ]);
  const journeys = (await Promise.all(summaries.map((s) => loadMatnJourney(prisma, user.id, s.courseId, summaries, now)))).filter((j) => j !== null);
  const { motivation } = home;

  const lessonState = new Map(flattenPath(path).map((e) => [e.lesson.id, e.lesson.state]));
  // Cumulative memorization = distinct visible canonical lines recited at least once (same measure as /memorize).
  const recitedLines = journeys.reduce((n, j) => n + j.recited, 0);
  const streak = continuity.currentStreak;
  const longest = Math.max(continuity.longestStreak, streak.count);
  const milestones = milestonePath(streak.count, longest);

  const learningGoal = motivation.weekly
    ? { headline: countLabel(motivation.weekly.target, LESSONS), period: "هذا الأسبوع", value: motivation.weekly.current, max: motivation.weekly.target, fraction: `${ar(motivation.weekly.current)} من ${countLabel(motivation.weekly.target, LESSONS)}`, done: motivation.weekly.done }
    : null;
  const memoActive = memoGoal?.isActive ? memoGoal : null;
  const memorizationGoal = memoActive
    ? { headline: countLabel(memoActive.targetUnits, LINES), period: PERIOD[memoActive.period], value: memoActive.completedUnits, max: memoActive.targetUnits, fraction: `${ar(memoActive.completedUnits)} من ${countLabel(memoActive.targetUnits, LINES)}`, done: memoActive.completedUnits >= memoActive.targetUnits }
    : null;

  return (
    <div className="mx-auto max-w-6xl pb-6">
      <header className="animate-fade-up relative overflow-hidden rounded-[1.75rem] px-1 pt-2 pb-8 sm:pb-10">
        <ArchArt className="absolute -top-6 end-2 hidden h-64 text-gold opacity-35 sm:block lg:end-10" />
        <div aria-hidden className="bg-geometric absolute inset-y-0 end-0 hidden w-1/2 opacity-40 [mask-image:linear-gradient(to_left,black,transparent)] sm:block" />
        <div className="relative max-w-xl">
          <p className="inline-flex items-center gap-2 text-small font-semibold text-gold-ink">
            <span aria-hidden className="size-1.5 rotate-45 bg-gold" />
            تقدّمي
          </p>
          <h1 className="mt-2 text-[1.875rem] leading-[1.35] font-bold text-ink sm:text-display-sm">رحلتك حتى الآن</h1>
          <p className="mt-3 text-body text-muted">تابع خطواتك، واطّلع على إنجازك، واستمر في طلب العلم.</p>
        </div>
      </header>

      <section aria-label="ملخص تقدّمك" className="animate-fade-up grid grid-cols-2 gap-3 [animation-delay:40ms] sm:gap-4 md:grid-cols-6" data-testid="progress-stats">
        <StatCard className="md:col-span-2" tone="gold" icon={<FlameMark className="size-5" />} label="السلسلة الحالية" value={streak.count} unit={unit(streak.count, STREAK_N)} testId="stat-current-streak" />
        <StatCard className="md:col-span-2" tone="gold" icon={<Award className="size-5" />} label="أطول سلسلة" value={longest} unit={unit(longest, DAY_N)} testId="stat-longest-streak" />
        <StatCard className="md:col-span-2" tone="gold" icon={<CalendarDays className="size-5" />} label="أيام النشاط" value={continuity.totalActiveDays} unit={unit(continuity.totalActiveDays, DAY_N)} testId="stat-active-days" />
        <StatCard className="md:col-span-3" tone="ink" icon={<NotebookPen className="size-5" />} label="الدروس المكتملة" value={home.completedLessons} unit={unit(home.completedLessons, LESSON_N)} testId="stat-completed-lessons" />
        <StatCard className="col-span-2 md:col-span-3" tone="sage" icon={<BookOpenText className="size-5" />} label="إجمالي الحفظ" value={recitedLines} unit={unit(recitedLines, LINE_N)} hint="من المتن، سمّعتها مرة على الأقل" testId="stat-total-memorization" />
      </section>

      <section aria-labelledby="continuity-title" className="animate-fade-up mt-14 [animation-delay:80ms]" data-testid="continuity">
        <h2 id="continuity-title" className="inline-flex items-center gap-2.5 text-section font-bold text-ink">
          <FlameMark className="size-5 text-gold" />
          استمراريتي
        </h2>
        <p className="text-small text-muted">كل يوم هو خطوة في رحلتك، والاستمرار يصنع الفرق.</p>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-5">
          <div className="relative flex min-h-72 flex-col overflow-hidden rounded-[1.375rem] border border-gold/25 bg-surface p-6 shadow-soft sm:p-7" data-testid="streak-hero">
            <PathArt className="absolute inset-x-0 bottom-0 h-[62%] w-full" />
            <div className="relative">
              <p className="inline-flex items-center gap-2 text-small font-semibold text-gold-ink">
                <FlameMark className="size-4" />
                سلسلتك الحالية
              </p>
              {streak.count > 0 ? (
                <>
                  <p className="mt-3 text-[3.75rem] leading-none font-bold text-ink tabular-nums" data-testid="streak-number">
                    {ar(streak.count)}
                  </p>
                  <p className="mt-2 text-section font-semibold text-gold-ink">{streak.count === 1 ? "يوم واحد" : streak.count === 2 ? "يومان متتاليان" : streak.count <= 10 ? "أيام متتالية" : "يومًا متتاليًا"}</p>
                  <p className="mt-2 text-small text-muted">{streak.activeToday ? "استمر على هذا المنوال." : "أكمل نشاطًا اليوم لتبقى سلسلتك متصلة."}</p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-title font-bold text-ink" data-testid="streak-number">
                    ابدأ سلسلتك اليوم
                  </p>
                  <p className="mt-2 text-small text-muted">أكمل نشاطًا واحدًا لبدء سلسلتك.</p>
                </>
              )}
              <p className="mt-4 text-caption text-muted">يُحتسب اليوم بإتمام درس أو اختبار أو تسميع، لا بتسجيل الدخول.</p>
            </div>
          </div>

          <div className="rounded-[1.375rem] border border-line/90 bg-surface p-5 shadow-soft sm:p-7">
            <ActivityCalendar activeDays={continuity.activeDays} today={motivation.today} />
            <CalendarLegend className="mt-6 justify-center border-t border-line/80 pt-5" />
          </div>
        </div>
      </section>

      <section aria-labelledby="milestones-title" className="mt-5 rounded-[1.375rem] border border-line/90 bg-surface p-5 shadow-soft sm:p-7" data-testid="milestones">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center lg:gap-10">
          <div className="min-w-0">
            <h2 id="milestones-title" className="text-section font-bold text-ink">
              مسار استمراريتك
            </h2>
            <p className="text-small text-muted">محطات صغيرة نحو استمرارية أكبر.</p>
            <div className="mt-2 overflow-x-clip px-1">
              <MilestoneTrack path={milestones} />
            </div>
          </div>
          <div className="rounded-2xl border border-gold/25 bg-gold-soft/45 px-5 py-4" data-testid="milestone-next">
            {milestones.next ? (
              <>
                <p className="text-card font-semibold text-ink">تبقى {daysLabel(milestones.next.remaining)}</p>
                <p className="text-small text-muted">للوصول إلى محطة {daysLabel(milestones.next.days)}</p>
              </>
            ) : (
              <>
                <p className="text-card font-semibold text-ink">بلغت كل المحطات</p>
                <p className="text-small text-muted">سلسلتك تجاوزت {daysLabel(100)}.</p>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:gap-5">
        <GoalProgressCard
          accent="ink"
          icon={<Lightbulb className="size-5" />}
          title="تقدّم التعلّم والفهم"
          subtitle="عدد الدروس التي أكملتها من هدفك الحالي."
          goal={learningGoal}
          emptyText={motivation.weeklyLessons > 0 ? `أكملت ${countLabel(motivation.weeklyLessons, LESSONS)} هذا الأسبوع. حدد هدفًا ليظهر تقدّمك نحوه.` : "حدد عدد الدروس التي تريد إنجازها هذا الأسبوع."}
          detailsHref="#details"
          testId="progress-learning"
        />
        <GoalProgressCard
          accent="sage"
          icon={<BookOpenText className="size-5" />}
          title="تقدّم حفظ المتن"
          subtitle="الأسطر الجديدة التي سمّعتها من هدفك الحالي."
          goal={memorizationGoal}
          emptyText={memoGoal && !memoGoal.isActive ? "هدف الحفظ متوقف الآن. فعّله متى شئت." : "حدد مقدار المتن الذي تريد حفظه."}
          detailsHref="#details"
          testId="progress-memorization"
        />
      </div>

      <div className="mt-5">
        <RecentActivity items={recent} timezone={motivation.settings.timezone} />
      </div>

      <section id="details" aria-labelledby="details-title" className="mt-14 scroll-mt-6">
        <h2 id="details-title" className="text-section font-bold text-ink">
          تفاصيل التقدّم
        </h2>
        <p className="text-small text-muted">إتقان كل مفهوم، وحال كل قسم من المتن.</p>
        <div className="mt-4">
          <DetailTabs
            tabs={[
              { key: "understanding", label: "الفهم", hint: "إتقان المفاهيم", content: <UnderstandingDetails lessons={byLesson} lessonState={lessonState} attempts={attempts} /> },
              { key: "memorization", label: "الحفظ", hint: "أقسام المتن", content: <MemorizationDetails journeys={journeys} /> },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
