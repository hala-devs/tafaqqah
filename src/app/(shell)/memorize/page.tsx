import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current-user";
import { getRoadmaps } from "@/server/content/queries";
import { prisma } from "@/server/db";
import { getMemorizationGoal } from "@/server/memorization/goals";
import { getMemorizationSummaries } from "@/server/memorization/progress";
import { loadMatnJourney } from "@/server/memorization/journey";
import { FutureLevelRow, LevelIdentity } from "@/components/learning/journey-parts";
import { JourneyTabs } from "@/components/memorize/journey-tabs";
import { MatnJourney } from "@/components/memorize/matn-journey";
import { MemorizationGoalForm } from "@/components/memorize/memorization-goal-form";
import { SessionSteps } from "@/components/memorize/memorize-ui";

export const metadata: Metadata = { title: "مسار الحفظ" };

/**
 * /memorize — the memorization side of the scientific path, parallel to /curriculum. Levels come from the roadmap;
 * a book appears as a Matn journey only when it has approved, visible Matn. Nothing here is specific to one book.
 */
export default async function MemorizePathPage() {
  const user = await requireUser("/memorize");
  const now = new Date();
  const [roadmaps, summaries, goal] = await Promise.all([getRoadmaps(), getMemorizationSummaries(prisma, user.id, now), getMemorizationGoal(prisma, user.id, now)]);
  const memorizable = new Set(summaries.map((s) => s.courseId));
  const attached = new Set(roadmaps.flatMap((r) => r.levels.flatMap((l) => l.courseIds)));
  const loose = summaries.filter((s) => !attached.has(s.courseId)).map((s) => s.courseId);

  // Load every Matn journey that is actually available (approved Matn), in roadmap order.
  const journeyIds = [...roadmaps.flatMap((r) => r.levels.filter((l) => l.status === "ACTIVE").flatMap((l) => l.courseIds.filter((id) => memorizable.has(id)))), ...loose];
  const loaded = await Promise.all(journeyIds.map((id) => loadMatnJourney(prisma, user.id, id, summaries, now)));
  const journeys = new Map(loaded.filter((j) => j !== null).map((j) => [j.courseId, j]));

  return (
    <div className="mx-auto max-w-5xl space-y-14">
      <article className="animate-fade-up">
        <header>
          <p className="text-caption font-semibold text-gold-ink">مسار الحفظ</p>
          <h1 className="mt-1.5 text-title text-ink sm:text-display-sm">احفظ المتن بتدرّج</h1>
          <p className="mt-2 text-body text-muted">احفظ بخطوات صغيرة، سمّع ما حفظت، وراجع ما يحتاج إلى تثبيت.</p>
        </header>

        {roadmaps.map((roadmap) => (
          <ol key={roadmap.id} className="mt-8 space-y-3" aria-label="مستويات مسار الحفظ">
            {roadmap.levels.map((level) => {
              if (level.status !== "ACTIVE") {
                return (
                  <li key={level.id}>
                    <FutureLevelRow order={level.order} title={level.title} />
                  </li>
                );
              }
              const books = level.courseIds.map((id) => journeys.get(id)).filter((j) => j !== undefined);
              return (
                <li key={level.id} aria-current="step" className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
                  {books.length ? (
                    books.map((journey, i) => (
                      <div key={journey.courseId} className={i > 0 ? "border-t-4 border-paper" : undefined}>
                        <MatnJourney {...journey} levelOrder={level.order} levelTitle={level.title} />
                      </div>
                    ))
                  ) : (
                    <div className="space-y-5 p-5 sm:p-7" data-testid="memorize-no-matn">
                      <LevelIdentity levelOrder={level.order} levelTitle={null} title={level.title} meta={[]} />
                      <p className="text-body text-muted">لم يُعتمد متن هذا المستوى للحفظ بعد. سيظهر هنا فور مراجعته واعتماده.</p>
                      <JourneyTabs active="MEMORIZE" learnHref="/curriculum" memorizeHref="/memorize" />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ))}

        {loose.map((id) => {
          const journey = journeys.get(id);
          return journey ? (
            <div key={id} className="mt-8 overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
              <MatnJourney {...journey} />
            </div>
          ) : null;
        })}
      </article>

      {journeys.size > 0 ? (
        <section aria-label="أدوات مساندة" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start">
          <MemorizationGoalForm goal={goal} />
          <div className="rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
            <SessionSteps />
          </div>
        </section>
      ) : null}
    </div>
  );
}
