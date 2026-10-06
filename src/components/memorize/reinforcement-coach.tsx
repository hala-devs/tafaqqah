"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Lightbulb, RotateCcw } from "lucide-react";
import { advanceCoachAction, finishReinforcementAction, hintExerciseAction, respondExerciseAction, revealExerciseAction, type CoachState } from "@/app/(focus)/memorize/reinforce/[planId]/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ExerciseText } from "./exercise-text";
import { ar } from "@/lib/format";
import { memorizeReReciteHref } from "@/lib/routes";
import type { RecallResponse } from "@/server/memorization/reinforcement/coach";
import type { CoachView } from "@/server/memorization/reinforcement/coach-service";

const RESPONSES: { value: RecallResponse; label: string; variant: "sage" | "secondary" }[] = [
  { value: "RECALLED", label: "استذكرتها", variant: "sage" },
  { value: "PARTIAL", label: "احتجت مساعدة", variant: "secondary" },
  { value: "NOT_RECALLED", label: "لم أتذكرها", variant: "secondary" },
];
const POLL_MS = 1500;
const MAX_POLLS = 10;

/**
 * The interactive reinforcement coach: one exercise card at a time (always with a cue: the previous line or the start of
 * the hidden line) → optional «تلميح» (more of the beginning, never all of it) → «أظهر النص» → «كيف كان استرجاعك؟» → the next
 * exercise is chosen from that answer. No chat, no generated prose: every sentence comes from the server's approved copy.
 * Hidden words never reach this component before reveal (the server sends typed placeholders only).
 */
export function ReinforcementCoach({ initial }: { initial: CoachView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const responseTitle = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const exerciseKey = view.exercise ? `${view.exercise.id}:${view.exercise.revealed}` : view.state;

  // Move focus to the new exercise (or to the self-report question after reveal) — not on first render.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (view.exercise?.revealed) responseTitle.current?.focus();
    else title.current?.focus();
  }, [exerciseKey, view.exercise?.revealed]);

  // The next exercise is decided on demand (refresh / second tab reuse the same one).
  useEffect(() => {
    if (view.state !== "NEEDS_NEXT" && view.state !== "PENDING") return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const state = await advanceCoachAction(view.planId);
      if (cancelled) return;
      if (!state.ok) return setError(state.error);
      if (state.view.state === "PENDING" && polls++ < MAX_POLLS) {
        timer = setTimeout(run, POLL_MS);
        return;
      }
      setView(state.view);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view.state, view.planId]);

  async function apply(promise: Promise<CoachState>) {
    setBusy(true);
    setError(null);
    const state = await promise;
    setBusy(false);
    if (!state.ok) return setError(state.error);
    setView(state.view);
  }

  async function endNow() {
    setBusy(true);
    setError(null);
    const result = await finishReinforcementAction({ planId: view.planId, completed: false });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setEnded(true);
  }

  const reciteHref = memorizeReReciteHref(view.recite.passageId, view.recite.startUnitId, view.recite.size, view.planId);

  if (view.state === "DONE" || ended) {
    return (
      <section aria-labelledby="done-title" data-testid="reinforcement-complete">
        <h1 id="done-title" ref={title} tabIndex={-1} className="text-title text-ink focus:outline-none">
          {ended ? "أنهيت جولة التثبيت" : "اكتملت جلسة التثبيت"}
        </h1>
        <p className="mt-2 text-body text-muted">
          {view.alreadyReRecited
            ? "سبق أن أعدت تسميع هذه الأسطر بعد هذه الجولة."
            : view.needsMoreReview
              ? "بعض المواضع ما زالت تحتاج إلى مراجعة. سمّع الأسطر نفسها الآن، ثم قيّم تسميعك من جديد."
              : "سمّع الأسطر نفسها الآن، ثم قيّم تسميعك من جديد لترى ما ثبت منها."}
        </p>
        {!view.alreadyReRecited ? (
          <div className="mt-6">
            <ButtonLink href={reciteHref} variant="sage" size="lg" icon={<RotateCcw className="size-4" aria-hidden />} data-testid="re-recite">
              أعد التسميع
            </ButtonLink>
          </div>
        ) : null}
      </section>
    );
  }

  if (view.state === "UNAVAILABLE") {
    return (
      <section aria-labelledby="unavailable-title" data-testid="reinforcement-unavailable">
        <h1 id="unavailable-title" className="text-title text-ink">هذا التمرين غير متاح الآن</h1>
        <p className="mt-2 text-body text-muted">تغيّر النص المعتمد لهذه الأسطر، فلا يمكن متابعة هذه الجولة.</p>
      </section>
    );
  }

  const exercise = view.exercise;
  return (
    <section aria-labelledby="coach-title" data-testid="reinforcement-session" data-exercise-type={exercise?.exerciseType ?? ""}>
      <p className="text-small font-medium text-sage-deep">خلّنا نثبّت المواضع التي احتاجت مراجعة</p>
      <p className="mt-3 flex justify-between text-small text-muted">
        <span data-testid="exercise-counter">{exercise ? `التمرين ${ar(exercise.number)}` : "التمرين التالي"}</span>
        <span>{`أنجزت ${ar(view.answered)}`}</span>
      </p>
      <Progress value={view.answered} max={view.budget} label={`أنجزت ${ar(view.answered)} من ${ar(view.budget)} تمارين على الأكثر`} className="mt-2" />

      {!exercise ? (
        <div aria-live="polite" aria-busy={!error}>
          <h1 id="coach-title" ref={title} tabIndex={-1} className="mt-6 text-title text-ink focus:outline-none">
            التمرين التالي
          </h1>
          {!error ? (
            <p className="mt-2 flex items-center gap-2 text-body text-muted" data-testid="coach-loading">
              <span aria-hidden className="size-2 rounded-full bg-sage-dark motion-safe:animate-pulse" />
              نجهّز التمرين التالي...
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <h1 id="coach-title" ref={title} tabIndex={-1} className="mt-6 text-title text-ink focus:outline-none" data-testid="exercise-title">
            {exercise.title}
          </h1>
          <div aria-live="polite">
            {exercise.lead ? <p className="mt-1 text-body text-sage-deep" data-testid="exercise-lead">{exercise.lead}</p> : null}
            <p className="mt-2 text-body text-ink" data-testid="exercise-instruction">
              {exercise.revealed ? "قارن ما استذكرته بالنص." : exercise.instruction}
            </p>
          </div>
          <ExerciseText units={exercise.units} revealed={exercise.revealed} />
        </>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-error/25 bg-error-soft px-4 py-3 text-small text-error-ink">
          {error}
        </p>
      ) : null}

      {!exercise && error ? (
        <div className="mt-4">
          <Button variant="secondary" size="md" loading={busy} onClick={() => void apply(advanceCoachAction(view.planId))} data-testid="coach-retry">
            حاول مرة أخرى
          </Button>
        </div>
      ) : null}

      {exercise && !exercise.revealed ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {exercise.hints.canHint ? (
            <Button
              variant="secondary"
              size="lg"
              disabled={busy}
              icon={<Lightbulb className="size-4" aria-hidden />}
              onClick={() => void apply(hintExerciseAction(view.planId, exercise.id, exercise.hints.used + 1))}
              data-testid="hint-target"
            >
              {exercise.hints.used === 0 ? "تلميح" : "تلميح آخر"}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" loading={busy} icon={<Eye className="size-4" aria-hidden />} onClick={() => void apply(revealExerciseAction(view.planId, exercise.id))} data-testid="reveal-target">
            أظهر النص
          </Button>
        </div>
      ) : null}

      {exercise && exercise.revealed ? (
        <div role="group" aria-labelledby="response-title" className="mt-6" data-testid="response-group">
          <h2 id="response-title" ref={responseTitle} tabIndex={-1} className="text-card font-semibold text-ink focus:outline-none">
            كيف كان استرجاعك؟
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            {RESPONSES.map((r) => (
              <Button key={r.value} variant={r.variant} size="lg" disabled={busy} onClick={() => void apply(respondExerciseAction(view.planId, exercise.id, r.value))} data-testid={`response-${r.value}`}>
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-8 border-t border-line pt-4">
        <Button variant="ghost" size="md" disabled={busy} onClick={() => void endNow()} data-testid="skip-reinforcement">
          إنهاء الجولة والانتقال إلى إعادة التسميع
        </Button>
      </div>
    </section>
  );
}
