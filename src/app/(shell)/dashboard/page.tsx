import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenText, ChevronLeft, Lightbulb } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { flattenPath, getLearningPath, getRoadmaps } from "@/server/content/queries";
import { prisma } from "@/server/db";
import { getContinueTarget, getHomeData } from "@/server/learner/home";
import { learningCardCta, learningCardState, memorizationCardCta, memorizationCardState } from "@/server/learner/home-view";
import { memorizationAction } from "@/server/learner/progress-view";
import { orderReview } from "@/server/learner/review-view";
import { getMemorizationGoal } from "@/server/memorization/goals";
import { loadMatnJourney } from "@/server/memorization/journey";
import { getMemorizationSummaries } from "@/server/memorization/progress";
import { getMemorizationReviewData } from "@/server/memorization/review-data";
import { HomeAttention } from "@/components/home/attention";
import { JourneyCard } from "@/components/home/journey-card";
import { TimezoneSync } from "@/components/home/timezone-sync";
import { WeekCard } from "@/components/home/week-card";
import { ar, countLabel, lessonDenominator } from "@/lib/format";

export const metadata: Metadata = { title: "الرئيسية" };

const LINES = ["سطر واحد", "سطرين", "أسطر", "سطرًا"] as [string, string, string, string];

/**
 * Learner home. Two equal journeys (understanding | memorization) under the current level and book — each card IS that
 * journey's next action (no single global winner) — then the two independent weekly goals, then real review items only.
 * Every state comes from the helpers /curriculum, /memorize, /progress and /review already use.
 */
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const now = new Date();
  const [home, path, roadmaps, summaries, reviewData, memoGoal] = await Promise.all([
    getHomeData(user.id, user.name),
    getLearningPath(user.id),
    getRoadmaps(),
    getMemorizationSummaries(prisma, user.id, now),
    getMemorizationReviewData(prisma, user.id, now),
    getMemorizationGoal(prisma, user.id, now),
  ]);
  const [learningTarget, journey] = await Promise.all([
    getContinueTarget(user.id, path, home.weak),
    summaries[0] ? loadMatnJourney(prisma, user.id, summaries[0].courseId, summaries, now) : Promise.resolve(null),
  ]);
  const { motivation } = home;

  // Current place on the scientific path (same rule as /progress): first ACTIVE level and its first book.
  const activeLevel = roadmaps.flatMap((r) => r.levels).find((l) => l.status === "ACTIVE") ?? null;
  const currentCourse = path.find((c) => activeLevel?.courseIds.includes(c.id)) ?? path[0] ?? null;

  // Understanding.
  const lessons = flattenPath(path).map((e) => e.lesson);
  const assessed = home.mastery.mastered + home.mastery.learning + home.mastery.needsReinforcement;
  const started = lessons.some((l) => l.studied || l.completed) || assessed > 0;
  const learnState = learningCardState(learningTarget, { started, completed: home.completedLessons, published: home.publishedLessons });
  const learnCta = learningCardCta(learningTarget, started);
  const learnAction = learningTarget && learnCta ? { label: learnCta, href: learningTarget.href } : { label: "عرض المسار العلمي", href: "/curriculum" };
  const learnProgress = !home.publishedLessons
    ? "ستظهر الدروس هنا فور نشرها."
    : !started
      ? "لم تبدأ هذا الدرس بعد."
      : `أكملت ${ar(home.completedLessons)} من ${lessonDenominator(home.publishedLessons)}`;

  // Memorization (same next step as /memorize).
  const memoCta = journey ? memorizationCardCta(journey.step) : null;
  const memoAction = journey ? memorizationAction(journey.step) : null;

  const attention = orderReview(reviewData.items, home.weak);

  return (
    <div className="mx-auto max-w-5xl pb-4">
      <TimezoneSync stored={motivation.settings.timezone} />

      <header className="animate-fade-up border-b border-line pb-5 sm:pb-6">
        <p className="text-small text-muted">السلام عليكم، {home.firstName}</p>
        <h1 className="mt-1 text-[1.625rem] leading-[1.45] font-bold text-ink sm:text-title">واصل رحلتك في طلب العلم</h1>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          {currentCourse ? (
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="current-path">
              {activeLevel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-gold-soft/70 px-2.5 py-0.5 text-caption font-medium text-gold-ink">
                  <span aria-hidden className="size-1.5 rounded-full bg-gold" />
                  {activeLevel.title}
                </span>
              ) : null}
              <span className="font-naskh text-card font-semibold text-ink">{currentCourse.title}</span>
            </p>
          ) : (
            <span />
          )}
          <Link
            href="/curriculum"
            className="group inline-flex min-h-11 items-center gap-1 rounded text-small font-medium text-muted underline decoration-transparent underline-offset-[6px] transition-colors duration-200 hover:text-ink hover:decoration-line-strong focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            عرض المسار العلمي
            <ChevronLeft className="size-4 transition-transform duration-200 ease-calm group-hover:-translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        </div>
      </header>

      <section aria-label="رحلتاك: التعلّم والفهم، وحفظ المتن" className="animate-fade-up mt-7 grid gap-4 [animation-delay:40ms] sm:mt-8 md:grid-cols-2 lg:gap-5" data-testid="journey">
        <JourneyCard
          id="journey-learning"
          title="التعلّم والفهم"
          blurb="ادرس الشرح، ثم اختبر فهمك باختبار تكيفي."
          icon={<Lightbulb className="size-5" />}
          accent="ink"
          state={learnState}
          context={learningTarget?.lesson ? learningTarget.lesson.title : learningTarget?.stage === "REVIEW" && learningTarget.detail ? learningTarget.detail : null}
          progress={learnProgress}
          meter={started && home.publishedLessons ? { value: home.completedLessons, max: home.publishedLessons, label: `الدروس المكتملة: ${ar(home.completedLessons)} من ${ar(home.publishedLessons)}` } : null}
          extra={
            assessed > 0 ? (
              <p className="text-caption text-muted" data-testid="mastery-counts">
                مفاهيم متقنة: {ar(home.mastery.mastered)} · تحتاج إلى تثبيت: {ar(home.mastery.needsReinforcement)}
              </p>
            ) : null
          }
          action={learnAction}
          testId="home-learning"
        />
        <JourneyCard
          id="journey-memorization"
          title="حفظ المتن"
          blurb="احفظ المتن، سمّع ما حفظت، وثبّت ما يحتاج إلى مراجعة."
          icon={<BookOpenText className="size-5" />}
          accent="sage"
          state={journey ? memorizationCardState(journey.step) : { label: "لم يُعتمد بعد", tone: "neutral" }}
          context={journey ? (journey.step.kind === "DONE" ? journey.title : journey.step.sectionTitle) : null}
          progress={
            journey
              ? journey.recited === 0
                ? "لم تبدأ الحفظ بعد."
                : `سمّعت ${ar(journey.recited)} من ${countLabel(journey.total, LINES)}`
              : "سيظهر متن الحفظ هنا فور مراجعته واعتماده."
          }
          meter={journey && journey.recited > 0 ? { value: journey.recited, max: journey.total, label: `الأسطر المسمّعة: ${ar(journey.recited)} من ${ar(journey.total)}` } : null}
          extra={
            journey && summaries[0] && summaries[0].masteredPassages > 0 ? (
              <p className="text-caption text-muted" data-testid="memo-counts">
                مقاطع متقنة: {ar(summaries[0].masteredPassages)}
              </p>
            ) : null
          }
          action={memoAction && memoCta ? { label: memoCta, href: memoAction.href } : { label: "مسار الحفظ", href: "/memorize" }}
          testId="home-memorization"
        />
      </section>

      <div className="animate-fade-up mt-12 [animation-delay:100ms] sm:mt-14">
        <WeekCard motivation={motivation} memoGoal={memoGoal} />
      </div>

      {attention.length > 0 ? (
        <div className="mt-12 sm:mt-14">
          <HomeAttention entries={attention} />
        </div>
      ) : null}

      {home.quote ? (
        <figure className="mt-12 border-t border-line pt-8 sm:mt-14" data-testid="quote-of-day">
          <figcaption className="text-caption font-medium text-gold-ink">اقتباس اليوم</figcaption>
          <blockquote className="mt-2 font-naskh text-card leading-loose text-ink">«{home.quote.text}»</blockquote>
          <p className="mt-1 text-caption text-muted">
            {home.quote.author} — {home.quote.source}
          </p>
        </figure>
      ) : null}

    </div>
  );
}
