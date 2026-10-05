import Link from "next/link";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import type { SectionCard } from "@/server/memorization/content";
import { SECTION_PATH_LABEL, memorizeProgressLine, sectionPathState, type MemorizeNextStep, type SectionPathState } from "@/server/memorization/path-view";
import { JourneyProgress, LevelIdentity, NextStepPanel } from "@/components/learning/journey-parts";
import { JourneyTabs } from "@/components/memorize/journey-tabs";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import { memorizePassageHref, memorizeSectionHref } from "@/lib/routes";

const LINES = ["سطر واحد", "سطرين", "أسطر", "سطرًا"] as [string, string, string, string];
const SECTIONS = ["قسم واحد", "قسمان", "أقسام", "قسمًا"] as [string, string, string, string];
const PASSAGES = ["مقطع واحد", "مقطعان", "مقاطع", "مقطعًا"] as [string, string, string, string];

export type MatnJourneyProps = {
  courseId: string;
  title: string;
  madhhab: string | null;
  levelOrder: number | null;
  levelTitle: string | null;
  recited: number;
  total: number;
  dueCount: number;
  step: MemorizeNextStep;
  sections: SectionCard[];
};

function nextStepView(step: Exclude<MemorizeNextStep, { kind: "DONE" }>, bookTitle: string) {
  const where = `${step.sectionTitle} — ${step.passageTitle}`;
  switch (step.kind) {
    case "REVIEW":
      return { title: "راجع محفوظك", text: `حان وقت مراجعة هذا المقطع: ${where}. راجع بهدوء ثم سمّع مرة أخرى.`, href: memorizePassageHref(step.passageId), cta: "ابدأ المراجعة", tone: "review" as const, ctaTestId: "hub-start-review" };
    case "START":
      return { title: `ابدأ حفظ ${bookTitle}`, text: where, href: memorizePassageHref(step.passageId, step.startUnitId), cta: "ابدأ الحفظ", tone: "ink" as const, ctaTestId: "hub-continue" };
    case "CONTINUE":
      return { title: "تابع حفظك", text: where, href: memorizePassageHref(step.passageId, step.startUnitId), cta: "تابع الحفظ", tone: "ink" as const, ctaTestId: "hub-continue" };
    case "REINFORCE":
      return { title: "ثبّت محفوظك", text: `سمّعت كل المتاح. أعد تسميع المقطع الأقل إتقانًا: ${where}.`, href: memorizePassageHref(step.passageId, step.startUnitId), cta: "أعد التسميع", tone: "ink" as const, ctaTestId: "hub-continue" };
  }
}

function Marker({ state, current }: { state: SectionPathState; current: boolean }) {
  if (state === "COMPLETED")
    return (
      <span className="flex size-10 items-center justify-center rounded-full bg-sage-dark text-surface shadow-soft">
        <Check className="size-4.5" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (state === "REVIEW_DUE")
    return (
      <span className="flex size-10 items-center justify-center rounded-full border-2 border-warning bg-warning-soft text-warning-ink">
        <RotateCcw className="size-4" aria-hidden />
      </span>
    );
  if (current)
    return (
      <span className="relative flex size-10 items-center justify-center rounded-full bg-ink shadow-soft">
        <span className="absolute inset-[-5px] rounded-full border border-ink/20 motion-safe:animate-pulse-soft" aria-hidden />
        <span className="size-2.5 rounded-full bg-gold" />
      </span>
    );
  if (state === "IN_PROGRESS") return <span className="flex size-10 items-center justify-center rounded-full border-2 border-sage-dark bg-sage-soft" />;
  return <span className="flex size-10 items-center justify-center rounded-full border-2 border-ink/25 bg-surface" />;
}

/** «مسار الحفظ»: the book's real approved sections, in order, as one continuous timeline. */
function MemorizationPath({ sections, currentSectionId }: { sections: SectionCard[]; currentSectionId: string | null }) {
  return (
    <ol className="relative" aria-label="أقسام المتن">
      {sections.map((section, i) => {
        const state = sectionPathState({ passageCount: section.passages.length, attemptedPassages: section.attemptedPassages, masteredPassages: section.masteredPassages, dueCount: section.dueCount });
        const current = section.id === currentSectionId;
        const label = current && state !== "REVIEW_DUE" ? (state === "NOT_STARTED" ? "موضعك الحالي" : "جارٍ — موضعك الحالي") : SECTION_PATH_LABEL[state];
        const detail =
          state === "NOT_STARTED"
            ? countLabel(section.passages.length, PASSAGES)
            : `${ar(section.masteredPassages)} من ${ar(section.passages.length)} ${section.passages.length <= 10 ? "مقاطع" : "مقطعًا"} متقنة`;
        return (
          <li key={section.id} className="relative flex gap-3 sm:gap-4">
            <div className="relative flex w-10 shrink-0 justify-center pt-3">
              <Marker state={state} current={current} />
              {i < sections.length - 1 ? <span aria-hidden className={cn("absolute top-14 -bottom-3 w-0.5 rounded-full", state === "COMPLETED" ? "bg-sage" : "bg-line-strong/70")} /> : null}
            </div>
            <Link
              href={memorizeSectionHref(section.id)}
              data-testid="section-link"
              aria-label={`${section.title} — ${label} — افتح القسم`}
              className={cn(
                "group mb-2 flex min-w-0 flex-1 items-center gap-3 rounded-2xl border px-4 py-3 transition-[background-color,border-color,box-shadow] duration-200 ease-calm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:px-5",
                current ? "border-ink/20 bg-surface shadow-soft hover:shadow-lift" : "border-transparent hover:border-line hover:bg-surface",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-caption font-semibold tabular-nums text-faint">{ar(i + 1)}</span>
                  <span className="font-naskh text-card font-semibold text-ink">{section.title}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-micro font-semibold",
                      state === "COMPLETED" && "bg-success-soft text-success-ink",
                      state === "REVIEW_DUE" && "bg-warning-soft text-warning-ink",
                      state === "IN_PROGRESS" && !current && "bg-sage-soft text-sage-deep",
                      current && state !== "REVIEW_DUE" && state !== "COMPLETED" && "bg-ink text-surface",
                      state === "NOT_STARTED" && !current && "bg-surface-2 text-muted",
                    )}
                  >
                    {label}
                  </span>
                </div>
                <p className="mt-0.5 text-small text-muted">{detail}</p>
              </div>
              <ArrowLeft className="size-4 shrink-0 text-faint transition-transform duration-200 group-hover:-translate-x-0.5 group-hover:text-ink" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The memorization journey of ONE Matn book, structured exactly like CourseJourney on /curriculum:
 * identity + progress → journey switch → next step → path. Everything comes from props built from real data.
 */
export function MatnJourney({ courseId, title, madhhab, levelOrder, levelTitle, recited, total, dueCount, step, sections }: MatnJourneyProps) {
  const passageCount = sections.reduce((n, s) => n + s.passages.length, 0);
  const view = step.kind === "DONE" ? null : nextStepView(step, title);
  const currentPassageId = step.kind === "DONE" ? null : step.passageId;
  const currentSectionId = currentPassageId ? (sections.find((s) => s.passages.some((p) => p.id === currentPassageId))?.id ?? null) : null;

  return (
    <div>
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <LevelIdentity
          levelOrder={levelOrder}
          levelTitle={levelTitle}
          title={title}
          meta={[madhhab ? `المذهب ${madhhab}` : null, countLabel(sections.length, SECTIONS), countLabel(passageCount, PASSAGES)]}
        />
        <JourneyProgress
          title="تقدمك في الحفظ"
          done={recited}
          total={total}
          fraction={`سمّعت ${ar(recited)} من ${countLabel(total, LINES)}`}
          line={memorizeProgressLine(recited, total, dueCount)}
          testId="memorize-progress"
        />
      </div>

      <div className="border-t border-line px-5 py-4 sm:px-7">
        <JourneyTabs active="MEMORIZE" learnHref="/curriculum" memorizeHref="/memorize" />
      </div>

      <div className="border-t border-line p-5 sm:p-7">
        {view ? (
          <NextStepPanel id={`memorize-next-${courseId}`} title={view.title} text={view.text} href={view.href} cta={view.cta} tone={view.tone} testId="memorize-next-action" ctaTestId={view.ctaTestId} />
        ) : (
          <p className="rounded-2xl bg-success-soft px-5 py-4 text-body font-medium text-success-ink" data-testid="memorize-done">
            أتقنت كل المتاح للحفظ في هذا المتن، ولا مراجعة مستحقة الآن. سيظهر الجديد هنا فور اعتماده.
          </p>
        )}

        <div className="mt-9">
          <h3 className="text-section text-ink">مسار الحفظ</h3>
          <p className="mt-1 text-small text-muted">اختر قسمًا لترى مقاطعه، أو تابع من خطوتك التالية. تختار مقدار الحفظ عند بدء الجلسة.</p>
          <div className="mt-4">
            <MemorizationPath sections={sections} currentSectionId={currentSectionId} />
          </div>
        </div>
      </div>
    </div>
  );
}
