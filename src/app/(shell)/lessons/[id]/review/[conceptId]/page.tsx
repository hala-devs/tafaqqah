import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { getLessonView } from "@/server/content/queries";
import { getReviewTarget } from "@/server/learner/review";
import { SampleNotice } from "@/components/learning/sample-notice";
import { StartAssessmentButton } from "@/components/learning/start-assessment-button";
import { VideoSegment } from "@/components/learning/video-segment";
import { ButtonLink } from "@/components/ui/button";
import { MasteryIndicator } from "@/components/ui/mastery-indicator";
import { MASTERY_LEVEL_META } from "@/lib/mastery-levels";

export const metadata: Metadata = { title: "مراجعة موجّهة" };

type Props = { params: Promise<{ id: string; conceptId: string }> };

/**
 * Targeted review plays the human-approved segment of the lesson video for one concept,
 * then offers a focused reassessment. Transcript and source-review data stay server-side.
 */
export default async function TargetedReviewPage({ params }: Props) {
  const { id, conceptId } = await params;
  const user = await requireUser(`/lessons/${id}/review/${conceptId}`);
  const view = await getLessonView(user.id, id);
  if (!view) notFound();
  if (!view.accessible) redirect(`/lessons/${id}`);
  const target = await getReviewTarget(prisma, user.id, id, conceptId);
  if (!target) notFound();

  const state = target.mastery?.state ?? null;

  return (
    <div className="mx-auto max-w-2xl">
      <nav aria-label="مسار التنقل" className="mb-6 flex flex-wrap items-center gap-1 text-caption text-muted">
        <Link href={`/lessons/${id}`} className="hover:text-ink">
          {target.lesson.title}
        </Link>
        <ChevronLeft className="size-3.5" aria-hidden />
        <span>مراجعة موجّهة</span>
      </nav>

      <header className="animate-fade-up">
        <p className="text-caption font-medium text-gold-ink">راجع هذا الجزء</p>
        <h1 className="mt-1 text-title text-ink">{target.concept.title}</h1>
        <p className="mt-3 text-body text-muted">راجع هذا المقطع، ثم اختبر فهمك مرة أخرى.</p>
        {target.mastery ? (
          <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <MasteryIndicator score={target.mastery.score} state={target.mastery.state} />
            {state ? <p className="mt-1.5 text-caption text-muted">{MASTERY_LEVEL_META[state].hint}</p> : null}
          </div>
        ) : null}
        {target.lesson.isSample ? <SampleNotice compact className="mt-4" /> : null}
      </header>

      {target.video ? (
        <section aria-label="مقطع المراجعة" className="mt-8">
          <VideoSegment video={target.video} title={target.concept.title} autoLoad />
        </section>
      ) : (
        <p className="mt-8 rounded-xl border border-line bg-surface p-5 text-small text-muted">{target.concept.description}</p>
      )}

      <section aria-labelledby="reassess" className="mt-12 rounded-2xl border border-line bg-surface-2/60 p-6 sm:p-8">
        <h2 id="reassess" className="text-section text-ink">
          جاهز للاختبار؟
        </h2>
        <p className="mt-1 text-small text-muted">بعد المراجعة، سنختبر فهمك بأسئلة قصيرة جديدة عن هذا الجزء.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <StartAssessmentButton lessonId={id} label="اختبر فهمي مرة أخرى" kind={`REASSESS:${conceptId}`} />
          <ButtonLink href={`/lessons/${id}`} variant="ghost" icon={<ArrowRight className="size-4" aria-hidden />}>
            العودة إلى الدرس
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
