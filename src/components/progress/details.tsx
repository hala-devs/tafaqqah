import Link from "next/link";
import { ArrowLeft, BookOpenText, ChevronLeft, Lightbulb, RotateCcw } from "lucide-react";
import type { PathState } from "@/server/content/path-state";
import type { CompletedAttempt, LessonMastery, WeakConcept } from "@/server/learner/overview";
import { conceptReviewHref, groupConcepts, type ConceptRow } from "@/server/learner/progress-view";
import type { MatnJourneyData } from "@/server/memorization/journey";
import { SECTION_PATH_LABEL, sectionPathState, type SectionPathState } from "@/server/memorization/path-view";
import type { DueReview } from "@/server/memorization/progress";
import { PATH_STATE_LABEL } from "@/components/learning/path-node";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { MASTERY_LEVEL_META } from "@/lib/mastery-levels";
import { ar, countLabel, formatDate } from "@/lib/format";
import { memorizePassageHref, memorizeSectionHref } from "@/lib/routes";

const PASSAGES = ["مقطع واحد", "مقطعين", "مقاطع", "مقطعًا"] as [string, string, string, string];

const CONCEPT_TONE: Record<string, BadgeTone> = { MASTERED: "success", GOOD: "sage", LEARNING: "ink", NEEDS_REINFORCEMENT: "warning" };
const SECTION_TONE: Record<SectionPathState, BadgeTone> = { COMPLETED: "success", IN_PROGRESS: "sage", REVIEW_DUE: "warning", NOT_STARTED: "neutral" };

/** «يحتاج إلى انتباهك»: actionable items only, each labelled with its journey. Rendered only when non-empty. */
export function NeedsAttention({ weak, due }: { weak: WeakConcept[]; due: DueReview[] }) {
  if (weak.length === 0 && due.length === 0) return null;
  return (
    <section aria-labelledby="attention-title" className="rounded-2xl border border-warning/30 bg-warning-soft/40 p-5 sm:p-6" data-testid="needs-attention">
      <h2 id="attention-title" className="text-section text-ink">
        يحتاج إلى انتباهك
      </h2>
      <ul className="mt-4 space-y-2">
        {weak.slice(0, 4).map((w) => (
          <li key={w.conceptId}>
            <Link href={conceptReviewHref(w.lessonId, w.conceptId)} className="group flex items-center gap-3 rounded-xl bg-surface px-4 py-3 transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
              <Badge tone="ink" icon={<Lightbulb className="size-3" aria-hidden />}>
                فهم
              </Badge>
              <span className="min-w-0 flex-1 text-small text-ink">
                <span className="font-semibold">{w.conceptTitle}</span> يحتاج إلى تثبيت
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-warning-ink">
                راجع المفهوم
                <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
        {due.slice(0, 4).map((d) => (
          <li key={d.passageId}>
            <Link href={memorizePassageHref(d.passageId)} className="group flex items-center gap-3 rounded-xl bg-surface px-4 py-3 transition-shadow hover:shadow-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
              <Badge tone="sage" icon={<BookOpenText className="size-3" aria-hidden />}>
                حفظ
              </Badge>
              <span className="min-w-0 flex-1 text-small text-ink">
                <span className="font-semibold">
                  {d.sectionTitle} — {d.passageTitle}
                </span>{" "}
                حان وقت مراجعته
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-small font-semibold text-warning-ink">
                ابدأ المراجعة
                <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** «الفهم»: concept mastery per lesson in learner language, plus the assessment history. */
export function UnderstandingDetails({ lessons, lessonState, attempts }: { lessons: LessonMastery[]; lessonState: Map<string, PathState>; attempts: CompletedAttempt[] }) {
  const all: ConceptRow[] = lessons.flatMap((l) => l.concepts.map((c) => ({ id: c.id, title: c.title, state: c.state })));
  const groups = groupConcepts(all);
  if (all.length === 0) return <p className="text-body text-muted">ستظهر مفاهيم الدروس هنا بعد نشرها.</p>;
  return (
    <div className="space-y-6">
      <p className="text-small text-muted">
        {groups.unassessed.length === all.length
          ? "لم تُختبر أي مفاهيم بعد. يظهر مستوى كل مفهوم بعد اختبار فهمه."
          : `اختُبر فهمك في ${ar(all.length - groups.unassessed.length)} من ${ar(all.length)} مفهومًا: ${ar(groups.mastered.length)} متقن، و${ar(groups.reinforce.length)} يحتاج إلى تثبيت.`}
      </p>
      {lessons.map((lesson) => {
        const state = lessonState.get(lesson.lessonId);
        return (
          <article key={lesson.lessonId} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={`/lessons/${lesson.lessonId}`} className="rounded text-card font-semibold text-ink underline-offset-4 hover:underline">
                {lesson.lessonTitle}
              </Link>
              {state ? <Badge tone={state === "COMPLETED" ? "success" : state === "CURRENT" ? "ink" : "neutral"}>{PATH_STATE_LABEL[state]}</Badge> : null}
            </div>
            <ul className="mt-3 divide-y divide-line">
              {lesson.concepts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="text-body text-text">{c.title}</span>
                  <span className="flex items-center gap-2">
                    {c.state ? <Badge tone={CONCEPT_TONE[c.state] ?? "neutral"}>{MASTERY_LEVEL_META[c.state].label}</Badge> : <span className="text-caption text-muted">لم يُختبر بعد</span>}
                    {c.state === "NEEDS_REINFORCEMENT" ? (
                      <Link href={conceptReviewHref(lesson.lessonId, c.id)} className="rounded text-small font-semibold text-warning-ink underline-offset-4 hover:underline">
                        راجع المفهوم
                      </Link>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
      {attempts.length ? (
        <section aria-labelledby="history-title">
          <h3 id="history-title" className="text-card font-semibold text-ink">
            سجلّ الاختبارات
          </h3>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
            {attempts.map((a) => (
              <li key={a.sessionId}>
                <Link href={`/lessons/${a.lessonId}/result?session=${a.sessionId}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]">
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-ink">{a.lessonTitle}</span>
                    <span className="block text-caption text-muted">
                      {formatDate(a.completedAt)} · {a.mode === "ADAPTIVE" ? "تكيفي" : "ثابت"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-small text-muted">
                    {a.report ? MASTERY_LEVEL_META[a.report.overallLevel].label : null}
                    <ChevronLeft className="size-4" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** «الحفظ»: each Matn's real sections with the SAME state rule as /memorize. */
export function MemorizationDetails({ journeys }: { journeys: MatnJourneyData[] }) {
  if (journeys.length === 0) return <p className="text-body text-muted">لم يُعتمد متن للحفظ بعد. سيظهر تقدّم حفظك هنا فور اعتماده.</p>;
  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 text-small text-muted">
        <RotateCcw className="mt-1 size-3.5 shrink-0 text-sage-dark" aria-hidden />
        «سمّعت» تعني أنك أتممت جلسة تسميع، و«متقن» تعني أن تسميعاتك المتتالية للمقطع كانت صحيحة كاملة بحسب تقييمك الذاتي.
      </p>
      {journeys.map((j) => (
        <article key={j.courseId} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h3 className="font-naskh text-section font-semibold text-ink">{j.title}</h3>
          <ol className="mt-3 divide-y divide-line" aria-label={`أقسام ${j.title}`}>
            {j.sections.map((s, i) => {
              const state = sectionPathState({ passageCount: s.passages.length, attemptedPassages: s.attemptedPassages, masteredPassages: s.masteredPassages, dueCount: s.dueCount });
              return (
                <li key={s.id}>
                  <Link
                    href={memorizeSectionHref(s.id)}
                    aria-label={`${s.title} — ${SECTION_PATH_LABEL[state]}`}
                    className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-paper focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                  >
                    <span className="w-6 shrink-0 text-center text-caption font-semibold tabular-nums text-faint">{ar(i + 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-naskh text-card font-semibold text-ink">{s.title}</span>
                      <span className="block text-caption text-muted">{state === "NOT_STARTED" ? countLabel(s.passages.length, PASSAGES) : `${ar(s.masteredPassages)} من ${ar(s.passages.length)} متقنة`}</span>
                    </span>
                    <Badge tone={SECTION_TONE[state]}>{SECTION_PATH_LABEL[state]}</Badge>
                    <ChevronLeft className={cn("size-4 shrink-0 text-faint transition-transform duration-200 group-hover:-translate-x-0.5")} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ol>
        </article>
      ))}
    </div>
  );
}
