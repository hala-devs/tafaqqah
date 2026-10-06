import { ArrowLeft, Check } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { ar, learnerDescription, lessonDenominator, ordinalLesson } from "@/lib/format";

type Props = {
  lesson: { id: string; title: string; description: string; number: number; studied: boolean; estimatedMinutes: number | null };
  chapterTitle: string;
  activeSessionId: string | null;
  coursePosition: { completed: number; total: number };
};

function Stage({ label, state }: { label: string; state: "done" | "active" | "upcoming" }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full border text-caption",
          state === "done" && "border-sage-dark bg-sage-dark text-surface",
          state === "active" && "border-ink bg-surface text-ink",
          state === "upcoming" && "border-line-strong bg-surface text-faint",
        )}
        aria-hidden
      >
        {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : state === "active" ? <span className="size-2 rounded-full bg-ink" /> : null}
      </span>
      <span className={cn("text-small", state === "upcoming" ? "text-faint" : "text-ink", state === "active" && "font-medium")}>
        {label}
        <span className="sr-only">{state === "done" ? " — مكتملة" : state === "active" ? " — المرحلة الحالية" : " — لاحقًا"}</span>
      </span>
    </li>
  );
}

/** "أكمل رحلتك" — the first thing a learner sees. */
export function CurrentLessonCard({ lesson, chapterTitle, activeSessionId, coursePosition }: Props) {
  const stage = activeSessionId ? "assessing" : lesson.studied ? "ready" : "studying";
  const cta =
    stage === "assessing"
      ? { href: `/lessons/${lesson.id}/assessment`, label: "تابع الاختبار" }
      : stage === "ready"
        ? { href: `/lessons/${lesson.id}/assessment`, label: "ابدأ اختبار فهمك" }
        : { href: `/lessons/${lesson.id}`, label: lesson.studied ? "تابع الدرس" : "ابدأ الدرس" };

  return (
    <article className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-soft sm:p-8">
      <div aria-hidden className="bg-geometric pointer-events-none absolute -top-10 -end-10 size-64 opacity-70 [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
      <div className="relative">
        <p className="text-small font-medium text-gold-ink">
          {ordinalLesson(lesson.number)} · {chapterTitle}
        </p>
        <h3 className="mt-2 max-w-xl text-title text-ink">{lesson.title}</h3>
        {learnerDescription(lesson.description) ? <p className="mt-2 max-w-xl text-muted">{learnerDescription(lesson.description)}</p> : null}

        <ol className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="مرحلة الدرس">
          <Stage label="مرحلة التعلّم" state={lesson.studied ? "done" : "active"} />
          <li aria-hidden className="h-px w-8 bg-line-strong" />
          <Stage label="مرحلة قياس الفهم" state={lesson.studied ? "active" : "upcoming"} />
        </ol>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-6">
          <ButtonLink href={cta.href} size="lg" iconAfter={<ArrowLeft className="size-4" aria-hidden />}>
            {cta.label}
          </ButtonLink>
          <div className="w-full max-w-56 sm:w-56">
            <Progress
              value={coursePosition.completed}
              max={coursePosition.total}
              label={`أكملت ${ar(coursePosition.completed)} من ${lessonDenominator(coursePosition.total)}`}
              tone="sage"
            />
            <p className="mt-1.5 text-caption text-muted">
              أكملت {ar(coursePosition.completed)} من {lessonDenominator(coursePosition.total)}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}
