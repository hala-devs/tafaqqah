import Link from "next/link";
import { ArrowLeft, Flame, Target } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProgressRing } from "@/components/ui/progress-ring";
import { streakPhrase } from "@/lib/home-state";
import { ar, countLabel, ordinalLesson } from "@/lib/format";
import type { CompletionSummary } from "@/server/learner/completion-summary";

type Props = {
  lessonNumber: number;
  summary: CompletionSummary;
  next: { id: string; title: string } | null;
  /** Concepts that still need reinforcement (any lesson), and where to review the first one. */
  weakCount: number;
  weakHref: string | null;
};

const LESSONS = ["درس واحد", "درسان", "دروس", "درسًا"] as [string, string, string, string];

/** Delays the entrance of each step so the result unfolds calmly: check → results → streak → goal → next step. */
const at = (ms: number) => ({ animationDelay: `${ms}ms` });

function StatRow({ value, children, delay }: { value: number; children: React.ReactNode; delay: number }) {
  return (
    <li className="flex items-baseline gap-3 animate-fade-up" style={at(delay)}>
      <span className="w-9 text-end text-title font-semibold leading-none tabular-nums text-ink">{ar(value)}</span>
      <span className="text-body text-ink-soft">{children}</span>
    </li>
  );
}

/**
 * The most important visual moment: a lesson is complete. A drawn check, then real results appear
 * one after another. No confetti, trophies, coins or points — only what the learner actually did.
 */
export function CompletionExperience({ lessonNumber, summary, next, weakCount, weakHref }: Props) {
  const { mastered, stabilized, streak, weekly, monthly } = summary;
  const hasResults = mastered > 0 || stabilized > 0;

  return (
    <section aria-labelledby="completion-title" data-testid="completion" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <div className="hero-surface px-6 py-9 text-center text-surface sm:py-12">
        <ProgressRing value={100} onDark label="أتممت الدرس" className="mx-auto size-24 animate-pop-in sm:size-28">
          <svg viewBox="0 0 32 32" className="size-11 sm:size-12" aria-hidden>
            <path d="M8 16.5l5.5 5.5L24 11" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-draw stroke-surface [animation-delay:500ms]" strokeDasharray="30" style={{ ["--dash" as string]: 30 }} />
          </svg>
        </ProgressRing>
        <h1 id="completion-title" className="mt-6 animate-fade-up" style={at(250)}>
          <span className="block text-title font-semibold sm:text-display-sm">أحسنت</span>
          <span className="mt-1 block text-card font-normal text-surface/80">أتممت {ordinalLesson(lessonNumber)} ✓</span>
        </h1>
      </div>

      <div className="space-y-8 p-6 sm:p-9">
        {hasResults ? (
          <ul className="space-y-4" aria-label="ما أنجزته في هذا الدرس">
            {mastered > 0 ? <StatRow value={mastered} delay={500}>{mastered === 1 ? "مفهوم أتقنته" : "مفاهيم أتقنتها"}</StatRow> : null}
            {stabilized > 0 ? <StatRow value={stabilized} delay={700}>{stabilized === 1 ? "مفهوم راجعته وثبّتّه" : "مفاهيم راجعتها وثبّتّها"}</StatRow> : null}
          </ul>
        ) : (
          <p className="text-body text-ink-soft animate-fade-up" style={at(500)}>
            أجبت عن {countLabel(summary.totalQuestions, ["سؤال واحد", "سؤالين", "أسئلة", "سؤالًا"])}، وما زالت بعض المفاهيم قيد التعلّم؛ كل خطوة تثبّتها.
          </p>
        )}

        {streak.count > 0 ? (
          <div className="flex items-start gap-3 border-t border-line pt-6 animate-fade-up" style={at(900)} data-testid="completion-streak">
            <Flame className="mt-1 size-5 shrink-0 text-gold-ink" aria-hidden />
            <div>
              <p className="text-small text-muted">سلسلة التعلّم</p>
              <p className="text-card font-semibold text-ink">{streakPhrase(streak.count)}</p>
              {streak.count >= 2 ? <p className="mt-0.5 text-caption text-muted">عودتك اليوم حافظت على سلسلة تعلّمك.</p> : null}
            </div>
          </div>
        ) : null}

        {weekly ? (
          <div className="border-t border-line pt-6 animate-fade-up" style={at(1100)} data-testid="completion-weekly">
            <div className="flex items-baseline justify-between gap-4">
              <p className="inline-flex items-center gap-2 text-small text-muted">
                <Target className="size-4 text-sage-dark" aria-hidden />
                هدف الأسبوع
              </p>
              <p className="text-card font-semibold tabular-nums text-ink">
                {ar(weekly.current)} / {ar(weekly.target)} دروس
              </p>
            </div>
            <Progress
              value={weekly.current}
              max={weekly.target}
              label={`هدف الأسبوع: ${ar(weekly.current)} من ${ar(weekly.target)} دروس`}
              size="lg"
              animateFrom={(weekly.before / weekly.target) * 100}
              className="mt-3"
            />
            <p className="mt-2.5 text-small text-muted">
              {weekly.done
                ? "أتممت هدفك الأسبوعي ✓"
                : weekly.remaining === 1
                  ? "باقي لك درس واحد لتحقيق هدفك."
                  : `باقي لك ${countLabel(weekly.remaining, LESSONS)} لتحقيق هدفك.`}
            </p>
          </div>
        ) : null}

        {monthly ? (
          <div className="border-t border-line pt-6 animate-fade-up" style={at(1250)} data-testid="completion-monthly">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-small text-muted">هدف {monthly.monthName}</p>
              <p className="text-small font-semibold tabular-nums text-ink">
                {ar(monthly.current)} / {ar(monthly.target)} {monthly.kind === "LESSONS" ? "دروس" : "مفهومًا"}
              </p>
            </div>
            <Progress
              value={monthly.current}
              max={monthly.target}
              label={`هدف ${monthly.monthName}`}
              size="md"
              animateFrom={(monthly.before / monthly.target) * 100}
              className="mt-2.5"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-line pt-8 animate-fade-up sm:flex-row sm:flex-wrap" style={at(1400)}>
          {next ? (
            <>
              <ButtonLink href={`/lessons/${next.id}`} size="xl" className="w-full sm:w-auto" iconAfter={<ArrowLeft className="size-5" aria-hidden />}>
                ابدأ الدرس التالي
              </ButtonLink>
              <ButtonLink href="/dashboard" variant="secondary" size="xl" className="w-full sm:w-auto">
                تابع رحلتك
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href="/dashboard" size="xl" className="w-full sm:w-auto" iconAfter={<ArrowLeft className="size-5" aria-hidden />}>
              تابع رحلتك
            </ButtonLink>
          )}
          {weakCount > 0 && weakHref ? (
            <ButtonLink href={weakHref} variant="ghost" size="xl" className="w-full sm:w-auto">
              راجع ما يحتاج إلى تثبيت
            </ButtonLink>
          ) : null}
        </div>
        {!weekly ? (
          <p className="text-caption text-faint">
            <Link href="/account#goals" className="underline underline-offset-4 hover:text-ink">
              حدد هدفًا أسبوعيًا
            </Link>{" "}
            لتتابع تقدمك بوضوح.
          </p>
        ) : null}
      </div>
    </section>
  );
}
