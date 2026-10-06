"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, RotateCcw, WifiOff, X } from "lucide-react";
import { Button, ButtonLink, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Logo } from "@/components/shell/logo";
import { ar } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ApprovedVideo } from "@/lib/video";
import { QuestionCard, type QuestionView } from "./question-card";
import { VideoSegment } from "./video-segment";
import { ApiError, NETWORK_FAILURE, NO_RETRY_CODES, fetchNext, post, type ApiFailure } from "./next-request";

type Purpose = "PRACTICE" | "PRE_TEST" | "POST_TEST" | "REASSESSMENT";

const PURPOSE_TITLE: Record<Purpose, string> = {
  PRACTICE: "اختبار فهمك",
  REASSESSMENT: "اختبر فهمك مرة أخرى",
  PRE_TEST: "الاختبار القبلي",
  POST_TEST: "الاختبار البعدي",
};

type Progress = { answered: number; min: number; max: number; fixedTotal: number | null };

type ReviewStep = { conceptId: string; conceptTitle: string; description: string; video: ApprovedVideo | null };

type NextResponse =
  | { kind: "question"; question: QuestionView & { conceptId: string }; progress: Progress }
  | { kind: "review"; review: ReviewStep; progress: Progress }
  | { kind: "completed" }
  | { kind: "pending" };

type AnswerResponse = {
  questionId: string;
  stage: QuestionView["stage"];
  correct: boolean;
  selectedIndex: number;
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  conceptId: string;
  conceptTitle: string;
  feedbackTitle: string;
  adaptiveMessage: string;
  followUp: "NONE" | "GENERATE" | "REVIEW";
  sessionComplete: boolean;
  progress: Progress;
};

const GENERATION_MESSAGES = [
  { after: 0, text: "نجهز سؤالك من المادة المعتمدة…" },
  { after: 3500, text: "نراجع السؤال للتأكد من وضوحه…" },
  { after: 9000, text: "ما زلنا نجهّز السؤال؛ الدقة أهم من السرعة…" },
];

type QuestionPayload = QuestionView & { conceptId: string };
type InitialQuestion = { question: QuestionPayload; progress: Progress };
type LoadingKind = "INITIAL" | "NEXT" | "GENERATING";

type Phase =
  | { name: "loading"; kind: LoadingKind }
  | { name: "question"; question: QuestionPayload; progress: Progress; selected: number | null; submitting: boolean }
  | { name: "feedback"; question: QuestionPayload; progress: Progress; result: AnswerResponse }
  | { name: "review"; review: ReviewStep; progress: Progress; starting: boolean }
  | { name: "error"; failure: ApiFailure }
  | { name: "completed" };

function LoadingState({ kind, purpose }: { kind: LoadingKind; purpose: Purpose }) {
  const initialMessage = kind === "GENERATING" ? GENERATION_MESSAGES[0].text : kind === "NEXT" ? "نجهز السؤال التالي…" : purpose === "REASSESSMENT" ? GENERATION_MESSAGES[0].text : "نجهز اختبارك…";
  const [message, setMessage] = useState(initialMessage);
  useEffect(() => {
    if (kind !== "GENERATING") return;
    const timers = GENERATION_MESSAGES.slice(1).map((m) => window.setTimeout(() => setMessage(m.text), m.after));
    return () => timers.forEach(window.clearTimeout);
  }, [kind]);

  return (
    <div aria-busy className="animate-fade-in">
      <p role="status" aria-live="polite" className="mb-8 inline-flex items-center gap-3 text-small text-muted">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full rounded-full bg-sage opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-sage-dark" />
        </span>
        {message}
      </p>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <SkeletonText lines={2} className="mt-8" />
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** «السؤال X من Y» — follow-up questions keep the position of the question they follow. */
function ProgressDots({ progress, current }: { progress: Progress; current: number }) {
  if (progress.fixedTotal) {
    const total = progress.fixedTotal;
    const position = Math.min(current, total);
    return (
      <div className="flex items-center gap-3" data-testid="assessment-progress">
        <span className="shrink-0 text-small font-medium text-ink">
          السؤال {ar(position)} من {ar(total)}
        </span>
        <div
          className="flex min-w-0 flex-1 gap-1"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={position}
          aria-label={`السؤال ${ar(position)} من ${ar(total)}`}
        >
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={cn("h-1.5 min-w-0 flex-1 rounded-full transition-colors duration-300", i < position - 1 ? "bg-sage" : i === position - 1 ? "bg-ink" : "bg-surface-2")} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="assessment-progress">
      <span className="text-small font-medium text-ink">السؤال {ar(current)}</span>
      <div
        className="flex gap-1"
        role="img"
        aria-label={`أجبت عن ${ar(progress.answered)} أسئلة، والاختبار بين ${ar(progress.min)} و${ar(progress.max)} أسئلة بحسب إجاباتك`}
      >
        {Array.from({ length: progress.max }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-3 rounded-full transition-colors duration-300 sm:w-4",
              i < current - 1 ? "bg-sage" : i === current - 1 ? "bg-ink" : i < progress.min ? "bg-line-strong" : "bg-surface-2",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function AssessmentRunner({
  sessionId,
  lessonId,
  lessonTitle,
  purpose = "PRACTICE",
  initialQuestion,
  requiresSourceGeneration = false,
}: {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  purpose?: Purpose;
  /** New fixed baseline selected during the server render, before client hydration. */
  initialQuestion?: InitialQuestion;
  /** True only when no eligible fixed baseline exists and the validated generation path is needed. */
  requiresSourceGeneration?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() =>
    initialQuestion
      ? { name: "question", question: initialQuestion.question, progress: initialQuestion.progress, selected: null, submitting: false }
      : { name: "loading", kind: requiresSourceGeneration ? "GENERATING" : "INITIAL" },
  );
  const [exitOpen, setExitOpen] = useState(false);
  const prefetch = useRef<Promise<NextResponse> | null>(null);
  /** Set once the learner confirmed the review step, so a retry re-sends the same request. */
  const reviewed = useRef(false);
  const resultUrl = `/lessons/${lessonId}/result?session=${sessionId}`;

  const inFlight = useRef<Promise<NextResponse> | null>(null);
  const requestNext = useCallback(
    (options: { checkFirst?: boolean } = {}): Promise<NextResponse> => {
      // One logical request at a time: a double click or a retry during a request joins the running one.
      if (inFlight.current) return inFlight.current;
      const body = () => (reviewed.current ? { reviewed: true } : {});
      const run = () => fetchNext<NextResponse>(`/api/assessment/${sessionId}/next`, body, options);
      const promise = run().finally(() => {
        if (inFlight.current === promise) inFlight.current = null;
      });
      inFlight.current = promise;
      return promise;
    },
    [sessionId],
  );

  const applyNext = useCallback(
    (data: NextResponse) => {
      if (data.kind === "completed") {
        setPhase({ name: "completed" });
        router.push(resultUrl);
      } else if (data.kind === "review") {
        setPhase({ name: "review", review: data.review, progress: data.progress, starting: false });
      } else if (data.kind === "question") {
        reviewed.current = false;
        setPhase({ name: "question", question: data.question, progress: data.progress, selected: null, submitting: false });
      }
    },
    [router, resultUrl],
  );

  const applyFailure = useCallback((error: unknown) => {
    const failure = error instanceof ApiError ? error.failure : NETWORK_FAILURE;
    setPhase({ name: "error", failure });
  }, []);

  const showNext = useCallback(
    (source?: Promise<NextResponse> | null) => (source ?? requestNext()).then(applyNext, applyFailure),
    [requestNext, applyNext, applyFailure],
  );

  // Load the first (or resumed) question once the screen mounts.
  useEffect(() => {
    if (initialQuestion) return;
    let cancelled = false;
    requestNext().then(
      (data) => !cancelled && applyNext(data),
      (error) => !cancelled && applyFailure(error),
    );
    return () => {
      cancelled = true;
    };
  }, [initialQuestion, requestNext, applyNext, applyFailure]);

  async function submit() {
    if (phase.name !== "question" || phase.selected === null || phase.submitting) return;
    const { question, selected } = phase;
    setPhase({ ...phase, submitting: true });
    try {
      const result = await post<AnswerResponse>(`/api/assessment/${sessionId}/answer`, {
        questionId: question.id,
        selectedIndex: selected,
      });
      if (!result.sessionComplete) {
        // Start preparing the next question while the learner reads the feedback.
        // (The review step is never prefetched past: it needs the learner's confirmation.)
        prefetch.current = requestNext();
        prefetch.current.catch(() => undefined);
      }
      setPhase({ name: "feedback", question, progress: result.progress, result });
    } catch (error) {
      // The answer may or may not have been stored; re-asking /next resumes the same question safely.
      applyFailure(error);
    }
  }

  async function goNext() {
    if (phase.name !== "feedback") return;
    if (phase.result.sessionComplete) {
      setPhase({ name: "completed" });
      router.push(resultUrl);
      return;
    }
    const source = prefetch.current;
    prefetch.current = null;
    setPhase({ name: "loading", kind: phase.result.followUp === "GENERATE" ? "GENERATING" : "NEXT" });
    await showNext(source);
  }

  async function startReassessment() {
    if (phase.name !== "review" || phase.starting) return;
    reviewed.current = true;
    setPhase({ ...phase, starting: true });
    await showNext();
  }

  function retry() {
    if (phase.name !== "error") return;
    setPhase({ name: "loading", kind: "NEXT" });
    // Re-asking /next safely resumes: an unanswered question is returned, an answered one is not repeated.
    // Check first: a question the server already saved is shown, never generated again.
    void requestNext({ checkFirst: true }).then(applyNext, applyFailure);
  }

  const current = phase.name === "question" || phase.name === "feedback" ? (phase.progress.fixedTotal ? phase.question.position : phase.question.sequence) : null;

  return (
    <div className="min-h-dvh">
      {/* Focus header */}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <Logo href="/dashboard" className="shrink-0" imageClassName="w-16" ariaLabel="تفقّه — لوحة التعلّم" />
          <div className="min-w-0 flex-1">
            <p className="text-caption text-muted">{PURPOSE_TITLE[purpose]}</p>
            <p className="truncate text-small font-medium text-ink">{lessonTitle}</p>
          </div>
          <IconButton label="الخروج من الاختبار" onClick={() => setExitOpen(true)}>
            <X className="size-5" aria-hidden />
          </IconButton>
        </div>
        {current && (phase.name === "question" || phase.name === "feedback") ? (
          <div className="mx-auto max-w-3xl px-4 pb-3 sm:px-6">
            <ProgressDots progress={phase.progress} current={current} />
          </div>
        ) : null}
      </header>

      <main id="main" className="mx-auto max-w-3xl px-4 pt-8 pb-32 sm:px-6 sm:pt-12">
        {phase.name === "loading" || phase.name === "completed" ? (
          phase.name === "completed" ? (
            <p role="status" className="py-20 text-center text-muted">
              نجهّز نتيجة الدرس…
            </p>
          ) : (
            <LoadingState key={phase.kind} kind={phase.kind} purpose={purpose} />
          )
        ) : null}

        {phase.name === "error" ? (
          <div role="alert" className="mx-auto max-w-lg animate-fade-up rounded-2xl border border-line bg-surface p-8 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning-ink">
              {phase.failure.code === "NETWORK" ? <WifiOff className="size-5" aria-hidden /> : <RotateCcw className="size-5" aria-hidden />}
            </div>
            <p className="mt-4 text-card font-medium text-ink">{phase.failure.message}</p>
            <p className="mt-1 text-small text-muted">تقدّمك في هذا الاختبار محفوظ.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {NO_RETRY_CODES.has(phase.failure.code) ? null : (
                <Button onClick={retry} icon={<RotateCcw className="size-4" aria-hidden />}>
                  حاول مرة أخرى
                </Button>
              )}
              <ButtonLink href={`/lessons/${lessonId}`} variant="secondary">
                العودة إلى الدرس
              </ButtonLink>
            </div>
          </div>
        ) : null}

        {phase.name === "review" ? <ReviewPanel review={phase.review} starting={phase.starting} onStart={startReassessment} /> : null}

        {phase.name === "question" || phase.name === "feedback" ? (
          <>
            <QuestionCard
              question={phase.question}
              selected={phase.name === "question" ? phase.selected : phase.result.selectedIndex}
              answered={
                phase.name === "feedback"
                  ? { selectedIndex: phase.result.selectedIndex, correctIndex: phase.result.correctIndex }
                  : null
              }
              disabled={phase.name === "question" && phase.submitting}
              onSelect={(index) => {
                if (phase.name === "question" && !phase.submitting) setPhase({ ...phase, selected: index });
              }}
            />

            {phase.name === "question" ? (
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Button
                  size="lg"
                  onClick={submit}
                  disabled={phase.selected === null}
                  loading={phase.submitting}
                  className="min-w-44"
                >
                  {phase.submitting ? "نحلّل إجابتك…" : "تأكيد الإجابة"}
                </Button>
                {phase.selected === null ? <p className="text-caption text-faint">اختر إجابة واحدة.</p> : null}
              </div>
            ) : null}

            {phase.name === "feedback" ? <Feedback result={phase.result} onNext={goNext} /> : null}
          </>
        ) : null}
      </main>

      <Dialog
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="الخروج من الاختبار؟"
        description="تقدّمك محفوظ، ويمكنك متابعة الاختبار لاحقًا من صفحة الدرس."
        actions={
          <>
            <Button variant="ghost" onClick={() => setExitOpen(false)}>
              متابعة الاختبار
            </Button>
            <ButtonLink href={`/lessons/${lessonId}`} variant="primary">
              الخروج إلى الدرس
            </ButtonLink>
          </>
        }
      />
    </div>
  );
}

/** The exact human-approved segment for the concept the learner keeps missing, then a fresh check. */
function ReviewPanel({ review, starting, onStart }: { review: ReviewStep; starting: boolean; onStart: () => void }) {
  return (
    <section aria-labelledby="review-title" data-testid="review-step" className="animate-fade-up">
      <p className="inline-flex items-center gap-2 text-caption font-medium text-gold-ink">
        <BookOpen className="size-4" aria-hidden />
        راجع هذا الجزء
      </p>
      <h1 id="review-title" className="mt-2 text-title text-ink">
        {review.conceptTitle}
      </h1>
      <p className="mt-3 text-body text-muted">راجع هذا المقطع، ثم اختبر فهمك مرة أخرى.</p>

      {review.video ? (
        <div className="mt-8">
          <VideoSegment video={review.video} title={review.conceptTitle} autoLoad />
        </div>
      ) : (
        <p className="mt-8 rounded-xl border border-line bg-surface p-5 text-small text-muted">{review.description}</p>
      )}

      <div className="mt-10 rounded-2xl border border-line bg-surface-2/60 p-6">
        <p className="text-small text-muted">بعد المراجعة، سنختبر فهمك بأسئلة قصيرة جديدة عن هذا الجزء.</p>
        <Button size="lg" className="mt-5 min-w-44" onClick={onStart} loading={starting} icon={<RotateCcw className="size-4" aria-hidden />}>
          اختبر فهمي مرة أخرى
        </Button>
      </div>
    </section>
  );
}

function Feedback({ result, onNext }: { result: AnswerResponse; onNext: () => void }) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  const explanation = result.explanation.trim();
  const nextLabel = result.sessionComplete
    ? "عرض نتيجة الدرس"
    : result.followUp === "REVIEW"
      ? "راجع هذا الجزء"
      : result.followUp === "GENERATE"
        ? "تابع"
        : "السؤال التالي";

  return (
    <section
      aria-live="polite"
      data-testid="answer-feedback"
      data-correct={result.correct}
      className={cn(
        "mt-8 animate-fade-up rounded-2xl border p-5 sm:p-6",
        result.correct ? "border-success/30 bg-success-soft/50" : "border-warning/35 bg-warning-soft/50",
      )}
    >
      <h3 className={cn("inline-flex items-center gap-2 text-section font-semibold", result.correct ? "text-success-ink" : "text-warning-ink")}>
        {result.correct ? <CheckCircle2 className="size-5" aria-hidden /> : <RotateCcw className="size-5" aria-hidden />}
        {result.feedbackTitle}
      </h3>
      {result.adaptiveMessage ? <p className="mt-1 text-small text-muted">{result.adaptiveMessage}</p> : null}

      {explanation ? <p className="mt-4 border-t border-line/70 pt-4 text-body leading-8 text-text">{explanation}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button ref={nextRef} size="lg" onClick={onNext} className="min-w-44">
          {nextLabel}
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
      </div>
    </section>
  );
}
