import type { PathChapter, PathLesson } from "@/server/content/queries";
import { cn } from "@/lib/cn";
import { PathNode } from "./path-node";

function toNode(lesson: PathLesson) {
  return {
    id: lesson.id,
    number: lesson.number,
    title: lesson.title,
    description: lesson.description,
    state: lesson.state,
    studied: lesson.studied,
    assessmentState: lesson.assessmentState,
    conceptCount: lesson.conceptCount,
    estimatedMinutes: lesson.estimatedMinutes,
    mastery: lesson.mastery,
  };
}

/**
 * Refined vertical journey. When every chapter is just a wrapper around one lesson of the same name, the headings
 * would only repeat the lesson titles, so the lessons form ONE continuous timeline. Otherwise chapters keep their
 * headings, and the connector still runs to the very last lesson.
 */
export function LearningPath({ chapters: all, compact }: { chapters: PathChapter[]; compact?: boolean }) {
  // A chapter whose lessons are all unpublished drafts has nothing to show the learner.
  const chapters = all.filter((c) => c.lessons.length > 0);
  const lessons = chapters.flatMap((c) => c.lessons);
  const lastId = lessons.at(-1)?.id;
  const headingsRedundant = chapters.every((c) => c.lessons.length === 1 && c.lessons[0]!.title === c.title && !c.description);

  if (headingsRedundant) {
    return (
      <ol className="relative" aria-label="الدروس">
        {lessons.map((lesson) => (
          <PathNode key={lesson.id} isLast={lesson.id === lastId} compact={compact} node={toNode(lesson)} />
        ))}
      </ol>
    );
  }

  return (
    <div className={cn(compact ? "space-y-4" : "space-y-6")}>
      {chapters.map((chapter) => (
        <section key={chapter.id} aria-labelledby={`chapter-${chapter.id}`}>
          <div className="mb-2 flex items-center gap-3">
            <span aria-hidden className="h-px w-6 bg-gold/70" />
            <h3 id={`chapter-${chapter.id}`} className={cn("font-naskh font-semibold text-ink", compact ? "text-card" : "text-section")}>
              {chapter.title}
            </h3>
          </div>
          {!compact && chapter.description ? <p className="mb-3 ms-9 max-w-xl text-small text-muted">{chapter.description}</p> : null}
          <ol className="relative">
            {chapter.lessons.map((lesson) => (
              <PathNode key={lesson.id} isLast={lesson.id === lastId} compact={compact} node={toNode(lesson)} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
