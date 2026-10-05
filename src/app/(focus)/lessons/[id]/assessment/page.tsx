import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, BookOpenCheck, CircleCheck, Compass, Hourglass, ListChecks, MessageSquareText } from "lucide-react";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { getLessonView } from "@/server/content/queries";
import { getNextQuestion } from "@/server/assessment/engine";
import { AssessmentRunner } from "@/components/learning/assessment-runner";
import { StartAssessmentButton } from "@/components/learning/start-assessment-button";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Logo } from "@/components/shell/logo";
import { ar } from "@/lib/format";

export const metadata: Metadata = { title: "اختبار فهمك" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; session?: string; focus?: string }> };

function Frame({ lessonId, children }: { lessonId: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between">
        <Logo href="/dashboard" />
        <ButtonLink href={`/lessons/${lessonId}`} variant="ghost" size="sm" icon={<ArrowRight className="size-4" aria-hidden />}>
          العودة إلى الدرس
        </ButtonLink>
      </div>
      <main id="main" className="flex flex-1 items-center py-10">
        <div className="w-full animate-fade-up">{children}</div>
      </main>
    </div>
  );
}

export default async function AssessmentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { notice, session: sessionParam, focus } = await searchParams;
  const user = await requireUser(`/lessons/${id}/assessment`);
  const view = await getLessonView(user.id, id);
  if (!view) notFound();
  if (!view.accessible || view.lesson.status !== "PUBLISHED") redirect(`/lessons/${id}`);

  // A specific session (practice, reassessment, pre/post test) opened from a start action.
  if (sessionParam) {
    const session = await prisma.assessmentSession.findFirst({
      where: { id: sessionParam, userId: user.id, lessonId: id },
      select: { id: true, mode: true, purpose: true, status: true, focusConceptIds: true, _count: { select: { questions: true } } },
    });
    if (session?.status === "COMPLETED") redirect(`/lessons/${id}/result?session=${session.id}`);
    if (session?.status === "IN_PROGRESS") {
      // A brand-new lesson assessment begins with an approved fixed-bank baseline. Selecting it
      // during the server render avoids waiting for hydration and a second request before Q1.
      // Resumed sessions keep the existing /next recovery path, including adaptive follow-ups.
      const first = session.mode === "FIXED" && session._count.questions === 0 ? await getNextQuestion({ db: prisma }, user.id, session.id) : null;
      const initialQuestion = first?.kind === "question" ? { question: first.question, progress: first.progress } : undefined;
      return (
        <AssessmentRunner
          key={session.id}
          sessionId={session.id}
          lessonId={id}
          lessonTitle={view.lesson.title}
          purpose={session.purpose}
          initialQuestion={initialQuestion}
          requiresSourceGeneration={session.mode === "ADAPTIVE"}
        />
      );
    }
  }

  // Pre-tests may run before studying; everything else needs the lesson studied first.
  if (!view.progress?.studied) {
    if (view.measurement?.activeSession) redirect(`/lessons/${id}/assessment?session=${view.measurement.activeSession.id}`);
    return (
      <Frame lessonId={id}>
        <EmptyState
          icon={<BookOpenCheck className="size-5" aria-hidden />}
          title="أكمل دراسة الدرس أولًا لبدء اختبار الفهم."
          description="اقرأ المادة المعتمدة كاملة، ثم اضغط «أكملت دراسة الدرس» في آخر الصفحة."
          action={<ButtonLink href={`/lessons/${id}`}>الانتقال إلى الدرس</ButtonLink>}
        />
      </Frame>
    );
  }

  if (view.activeSession && !notice) redirect(`/lessons/${id}/assessment?session=${view.activeSession.id}`);

  // Only a focused reassessment (AI-generated) can be unavailable; the base assessment never needs AI to start.
  if (notice === "ai-unavailable") {
    const focusConcept = focus ? view.concepts.find((c) => c.id === focus) : undefined;
    const fixedCount = focusConcept
      ? await prisma.fixedQuestion.count({
          where: { lessonId: id, conceptId: focusConcept.id, approved: true, sourcePassage: { approved: true } },
        })
      : view.fixedQuestionCount;
    return (
      <Frame lessonId={id}>
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning-ink">
            <Hourglass className="size-5" aria-hidden />
          </div>
          <h1 className="mt-4 text-section text-ink">إعادة الاختبار غير متاحة حاليًا</h1>
          <p className="mx-auto mt-2 max-w-md text-small text-muted">
            لم تُهيّأ خدمة إعداد الأسئلة الجديدة على هذا الخادم بعد. لن نعرض عليك أسئلة غير موثّقة بديلًا عنها.
          </p>
          {fixedCount > 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2">
              <StartAssessmentButton
                lessonId={id}
                label={focusConcept ? "اختبر فهمي بالأسئلة المعتمدة" : "ابدأ الاختبار الثابت"}
                kind={focusConcept ? `REASSESS_FIXED:${focusConcept.id}` : "FIXED"}
              />
              <p className="text-caption text-faint">
                {ar(fixedCount)} {focusConcept ? `أسئلة معتمدة مسبقًا عن «${focusConcept.title}»` : "أسئلة معتمدة مسبقًا لهذا الدرس"}، ولا تتكيّف مع إجاباتك.
              </p>
            </div>
          ) : (
            <ButtonLink href={`/lessons/${id}`} variant="secondary" className="mt-6">
              العودة إلى الدرس
            </ButtonLink>
          )}
        </div>
      </Frame>
    );
  }

  const guidance = [
    { icon: ListChecks, text: "اقرأ السؤال بتأنٍّ، واختر إجابة واحدة ثم أكّدها." },
    { icon: MessageSquareText, text: "بعد كل إجابة ترى توضيحًا قصيرًا." },
    { icon: CircleCheck, text: `${ar(view.fixedQuestionCount)} أسئلة بالترتيب نفسه لكل متعلم.` },
    { icon: Compass, text: "إذا أخطأت في فكرة نتأكد منها بسؤال قصير آخر، فلا يحكم خطأ واحد على فهمك." },
  ];

  return (
    <Frame lessonId={id}>
      <p className="text-caption font-medium text-gold-ink">مرحلة قياس الفهم</p>
      <h1 className="mt-1 text-title text-ink">اختبار فهمك</h1>
      <p className="mt-2 text-muted">{view.lesson.title}</p>
      <ul className="mt-8 space-y-4">
        {guidance.map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3 text-body text-text">
            <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-sage-soft text-sage-dark">
              <Icon className="size-4" aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <StartAssessmentButton lessonId={id} label="ابدأ الاختبار" />
      </div>
      <p className="mt-8 border-t border-line pt-4 text-caption text-muted">
        تُراجَع الأسئلة قبل عرضها عليك لتبقى ضمن مادة الدرس. تفقّه أداة تعليمية، ولا يقدّم فتاوى.
      </p>
    </Frame>
  );
}
