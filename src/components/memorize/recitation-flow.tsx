"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Lock, Mic, Minus, Pause, Play, Plus, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { revealUnitsAction, submitRecitationAction } from "@/app/(focus)/memorize/passage/[passageId]/actions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { ar, countLabel } from "@/lib/format";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { formatClock, RECORDER_ERROR_MESSAGE } from "@/lib/recorder";
import { previousAssessmentCopy, previousWordAssessmentKind, type AssessmentDetail } from "@/lib/recitation-detail";
import type { RevealedUnit } from "@/server/memorization/content";
import { SelfAssessmentList } from "./self-assessment";
import { useRecorder } from "./use-recorder";

type PreviousDetail = { unitId: string; status: "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes: number[] };
type Props = { passageId: string; startUnitId: string; remainingUnitCount: number; isReview: boolean; initialSize?: number; previousDetails?: PreviousDetail[]; reinforcementPlanId?: string };

const SIZES = [
  { size: 3, hint: "بداية سريعة" },
  { size: 5, hint: "مقدار متوازن" },
  { size: 10, hint: "جلسة أطول" },
] as const;
const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];
const MAX_CUSTOM_LINES = 20;

function newAttemptId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Calm, always-visible privacy line. True by construction: the recording is a local object URL only. */
function PrivacyNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-small text-muted", className)} data-testid="privacy-note">
      <Lock className="mt-1 size-3.5 shrink-0 text-sage-dark" aria-hidden />
      تسجيلك يبقى على جهازك ولا يُرفع إلى الخادم أو الذكاء الاصطناعي.
    </p>
  );
}

/**
 * Plays the LOCAL recording. A visible play/pause control replaces the browser's default bar; the audio element keeps
 * reporting playback to the recorder controller exactly as before.
 */
function LocalPlayer({ url, onPlaying, prominent, onListened }: { url: string; onPlaying: (playing: boolean) => void; prominent?: boolean; onListened?: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className={cn("flex items-center gap-4 rounded-2xl border border-line bg-surface p-3 sm:p-4", prominent && "shadow-soft")}>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        aria-label="تسجيلك"
        className="hidden"
        onPlay={() => {
          setPlaying(true);
          onPlaying(true);
          onListened?.();
        }}
        onPause={() => {
          setPlaying(false);
          onPlaying(false);
        }}
        onEnded={() => {
          setPlaying(false);
          onPlaying(false);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        data-testid="local-audio"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "إيقاف الاستماع مؤقتًا" : "استمع لتسميعك"}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] motion-reduce:active:scale-100",
          prominent ? "size-14 bg-ink text-surface hover:bg-ink-soft" : "size-11 bg-sage-soft text-sage-deep hover:bg-sage/30",
        )}
        data-testid="play-recording"
      >
        {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5 translate-x-[-1px]" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-ink">{playing ? "تستمع إلى تسميعك…" : "تسجيلك"}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-sage-dark transition-[width] duration-200 ease-linear motion-reduce:transition-none" style={{ width: duration ? `${Math.min(100, (position / duration) * 100)}%` : "0%" }} />
        </div>
      </div>
      <span className="shrink-0 text-caption tabular-nums text-muted" dir="ltr">
        {formatClock(position * 1000)}
        {duration ? ` / ${formatClock(duration * 1000)}` : ""}
      </span>
    </div>
  );
}

/**
 * The recitation session: record locally → listen → reveal the approved Matn → the learner marks every unit → save.
 * The selected canonical text is requested for STUDY, cleared before RECITE, and requested again for SELF_ASSESS.
 * Audio never leaves this component: it is played from a local object URL and the save action receives assessments only.
 */
export function RecitationFlow({ passageId, startUnitId, remainingUnitCount, isReview, initialSize, previousDetails = [], reinforcementPlanId }: Props) {
  const router = useRouter();
  const rec = useRecorder();
  const [units, setUnits] = useState<RevealedUnit[] | null>(null);
  const [stage, setStage] = useState<"SELECT" | "STUDY" | null>("SELECT");
  const effectiveMaximum = Math.min(MAX_CUSTOM_LINES, remainingUnitCount);
  const [selectedCount, setSelectedCount] = useState(() => clampSessionSize(initialSize ?? 3, effectiveMaximum));
  const [customOpen, setCustomOpen] = useState(() => !SIZES.some(({ size }) => size === clampSessionSize(initialSize ?? 3, effectiveMaximum)));
  const [listened, setListened] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [withoutRecording, setWithoutRecording] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AssessmentDetail | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptId = useRef<string | null>(null);
  const startedAt = useRef<string | null>(null);

  const answered = units
    ? units.filter((u) => {
        const detail = answers[u.id];
        return detail?.status === "CORRECT" || detail?.scope === "FULL_UNIT" || (detail?.scope === "WORDS" && (detail.wordIndexes.length > 0 || (detail.forgottenWordIndexes?.length ?? 0) > 0));
      }).length
    : 0;
  const total = units?.length ?? selectedCount;
  const complete = units !== null && answered === units.length;
  const inSession = rec.state === "RECORDING" || units !== null;

  // Leaving mid-session would discard the recording and the marks.
  useEffect(() => {
    if (!inSession || saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inSession, saving]);

  const phase = useMemo(() => {
    if (units) return "ASSESS" as const;
    if (rec.state === "RECORDING") return "RECORDING" as const;
    if (rec.state === "FINISHED" || rec.state === "PLAYBACK") return "FINISHED" as const;
    if (rec.state === "REQUESTING_PERMISSION") return "REQUESTING" as const;
    if (rec.state === "ERROR") return "ERROR" as const;
    return "READY" as const;
  }, [units, rec.state]);

  async function begin() {
    startedAt.current = new Date().toISOString();
    setError(null);
    setListened(false);
    await rec.start();
  }

  async function reveal() {
    setRevealing(true);
    setError(null);
    const result = await revealUnitsAction({ passageId, startUnitId, count: selectedCount });
    setRevealing(false);
    if (!result.ok) return setError(result.error);
    setUnits(result.units);
  }

  async function beginStudy() {
    if (!Number.isInteger(selectedCount) || selectedCount < 1 || selectedCount > effectiveMaximum) return setError("اختر عددًا صالحًا من الأسطر.");
    setRevealing(true); setError(null);
    const result = await revealUnitsAction({ passageId, startUnitId, count: selectedCount });
    setRevealing(false);
    if (!result.ok) return setError(result.error);
    setUnits(result.units); setStage("STUDY");
  }

  async function save() {
    if (!units || !complete || saving) return;
    setSaving(true);
    setError(null);
    attemptId.current ??= newAttemptId();
    const result = await submitRecitationAction({
      passageId,
      clientAttemptId: attemptId.current,
      startedAt: startedAt.current ?? undefined,
      reinforcementPlanId,
      results: units.map((u) => ({ unitId: u.id, status: answers[u.id]!.status, scope: answers[u.id]!.scope, wordIndexes: answers[u.id]!.wordIndexes, forgottenWordIndexes: answers[u.id]!.forgottenWordIndexes })),
    });
    if (!result.ok) {
      setSaving(false);
      return setError(result.error);
    }
    router.push(`/memorize/result/${result.attemptId}`);
  }

  const errorBox = error ? (
    <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-error/25 bg-error-soft px-4 py-3 text-small text-error-ink" data-testid="flow-error">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  ) : null;

  // ── 1. Choose the amount ────────────────────────────────────────────────────────────────────────────────────
  if (stage === "SELECT") {
    const matched = SIZES.find(({ size }) => size === selectedCount)?.size;
    const optionClass = (active: boolean, disabled = false) =>
      cn(
        "flex min-h-20 flex-col items-start justify-center rounded-xl border px-4 py-3 text-start transition-[border-color,background-color,box-shadow] duration-200 ease-calm focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]",
        active ? "border-sage-dark bg-sage-soft shadow-[inset_0_0_0_1px_var(--color-sage-dark)]" : "border-line bg-surface hover:border-sage",
        disabled && "cursor-not-allowed opacity-55 hover:border-line",
      );
    return (
      <section aria-labelledby="select-title" className="mt-8" data-testid="phase-select">
        <h2 id="select-title" className="text-section font-semibold text-ink">
          كم تريد أن تحفظ الآن؟
        </h2>
        <p className="mt-1 text-body text-muted">اختر مقدارًا متصلًا، ثم خذ وقتك في حفظه قبل التسميع.</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SIZES.map(({ size, hint }) => (
            <button
              key={size}
              type="button"
              aria-pressed={!customOpen && matched === size}
              disabled={size > remainingUnitCount}
              onClick={() => {
                if (size > remainingUnitCount) return;
                setCustomOpen(false);
                setSelectedCount(size);
              }}
              className={optionClass(!customOpen && matched === size, size > remainingUnitCount)}
            >
              <span className="text-card font-bold text-ink">{countLabel(size, LINES)}</span>
              <span className="mt-0.5 text-caption text-muted">{size > remainingUnitCount ? `المتبقي ${countLabel(remainingUnitCount, LINES)}` : hint}</span>
            </button>
          ))}
          <button type="button" aria-pressed={customOpen} aria-controls="custom-lines" onClick={() => setCustomOpen(true)} className={optionClass(customOpen)}>
            <span className="text-card font-bold text-ink">تحديد مخصص</span>
            <span className="mt-0.5 text-caption text-muted">اختر مقدارك بنفسك</span>
          </button>
        </div>

        {customOpen ? (
          <fieldset id="custom-lines" className="mt-5 motion-safe:animate-fade-in">
            <legend className="text-small font-medium text-ink">حدد عدد الأسطر</legend>
            <p className="mt-1 text-small text-muted">اختر عدد الأسطر التي تريد حفظها في هذه الجلسة.</p>
            <div className="mt-3 flex items-center justify-center gap-3" dir="rtl">
              <button type="button" aria-label="إنقاص عدد الأسطر" disabled={selectedCount <= 1} onClick={() => setSelectedCount((count) => Math.max(1, count - 1))} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"><Minus className="size-4" aria-hidden /></button>
              <label className="min-w-32 text-center">
                <span className="sr-only">عدد الأسطر</span>
                <input type="number" inputMode="numeric" min={1} max={effectiveMaximum} step={1} value={selectedCount} onChange={(event) => setSelectedCount(normalizeSessionSize(event.target.value, effectiveMaximum, selectedCount))} className="w-20 border-0 bg-transparent text-center text-card font-bold text-ink focus:outline-none" aria-label="عدد الأسطر" />
                <span className="block text-small font-semibold text-ink">{countLabel(selectedCount, LINES)}</span>
              </label>
              <button type="button" aria-label="زيادة عدد الأسطر" disabled={selectedCount >= effectiveMaximum} onClick={() => setSelectedCount((count) => Math.min(effectiveMaximum, count + 1))} className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"><Plus className="size-4" aria-hidden /></button>
            </div>
            <p className="mt-3 text-caption text-muted">من سطر واحد إلى {countLabel(effectiveMaximum, LINES)} في الجلسة{remainingUnitCount < MAX_CUSTOM_LINES ? ` · متبقي ${countLabel(remainingUnitCount, LINES)} في هذا المتن` : ""}</p>
          </fieldset>
        ) : null}

        <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-muted" role="status">
            <span className="font-semibold text-ink">{countLabel(selectedCount, LINES)}</span> · أسطر متتالية من موضعك الحالي
          </p>
          <Button size="xl" className="w-full sm:w-auto sm:min-w-56" loading={revealing} onClick={beginStudy} data-testid="start-study">
            {isReview ? "ابدأ المراجعة" : "ابدأ الحفظ"}
          </Button>
        </div>
        {errorBox}
      </section>
    );
  }

  // ── 2. Study: the Matn is the whole page ────────────────────────────────────────────────────────────────────
  if (stage === "STUDY") {
    return (
      <section aria-labelledby="study-title" className="mt-8" data-testid="phase-study">
        <h2 id="study-title" className="sr-only">
          احفظ هذا المقدار
        </h2>
        <p className="text-small text-muted">اقرأ بتأنٍّ، وكرّر حتى تشعر أنك تستطيع التسميع دون النظر.</p>
        {isReview && previousDetails.length ? <p className="mt-3 text-small font-semibold text-ink">مواضع احتاجت إلى تثبيت في تسميعك السابق</p> : null}
        <article className="relative mt-4 rounded-2xl border border-line bg-surface px-5 py-7 shadow-soft sm:px-10 sm:py-10" dir="rtl" data-testid="selected-matn">
          <span aria-hidden className="absolute inset-x-10 top-0 h-px bg-gradient-to-l from-transparent via-gold/70 to-transparent" />
          <ol className="space-y-4">
            {units?.map((unit) => {
              const previous = previousDetails.find((detail) => detail.unitId === unit.id);
              const label = previousAssessmentCopy(previous);
              return <li key={unit.id} className="flex items-baseline gap-4">
                <span aria-hidden className="w-6 shrink-0 text-end text-caption font-medium tabular-nums text-faint">
                  {ar(unit.order)}
                </span>
                <div className="min-w-0 flex-1"><p className="font-naskh text-question-lg leading-[2.1] text-ink-dark [overflow-wrap:anywhere]" lang="ar">{tokenizeCanonicalMatn(unit.text).map((token, wordIndex) => { const mark = previousWordAssessmentKind(previous, wordIndex); return <span key={`${wordIndex}-${token}`} className={cn("rounded-sm px-0.5", mark === "INCORRECT" && "bg-error-soft text-error-ink underline decoration-error decoration-2", mark === "FORGOTTEN" && "bg-sage-soft text-sage-deep underline decoration-sage-dark decoration-2")} aria-label={mark === "INCORRECT" ? `${token}: أخطأت فيها في تسميعك السابق` : mark === "FORGOTTEN" ? `${token}: لم تتذكرها في تسميعك السابق` : undefined}>{token}{" "}</span>; })}</p>{label ? <p className="mt-1 text-caption text-muted">{label}</p> : null}</div>
              </li>;
            })}
          </ol>
        </article>
        <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-card font-semibold text-ink">جاهز للتسميع؟</p>
            <p className="text-small text-muted">سيُخفى المتن، ثم تسمّع من حفظك.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setUnits(null);
                setStage("SELECT");
              }}
            >
              غيّر المقدار
            </Button>
            <Button
              size="xl"
              icon={<Eye className="size-5" aria-hidden />}
              onClick={() => {
                setUnits(null);
                setStage(null);
              }}
              data-testid="start-recitation"
            >
              أخفِ المتن وابدأ التسميع
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // ── 3. Ready to recite (Matn hidden) ────────────────────────────────────────────────────────────────────────
  if (phase === "READY" || phase === "REQUESTING" || phase === "ERROR") {
    const requesting = phase === "REQUESTING";
    return (
      <section aria-labelledby="start-title" className="mt-8 rounded-2xl border border-line bg-surface px-5 py-9 text-center shadow-soft sm:px-10 sm:py-12" data-testid="phase-ready">
        <span aria-hidden className="mx-auto flex size-16 items-center justify-center rounded-full bg-sage-soft text-sage-deep">
          <Mic className="size-7" />
        </span>
        <h2 id="start-title" className="mt-5 text-section font-semibold text-ink">
          {isReview ? "سمّع ما راجعته" : "سمّع من حفظك"}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-body text-muted">
          المتن مخفي الآن. سجّل {countLabel(total, LINES)} من حفظك، ثم استمع إلى تسجيلك وقارنه بالمتن.
        </p>

        {phase === "ERROR" && rec.error ? (
          <div role="alert" className="mx-auto mt-5 max-w-md rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-start text-small text-warning-ink" data-testid="recorder-error" data-code={rec.error}>
            <p className="flex items-start gap-2 font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {RECORDER_ERROR_MESSAGE[rec.error]}
            </p>
          </div>
        ) : null}
        {requesting ? (
          <p role="status" className="mt-5 text-small text-muted" data-testid="requesting-permission">
            اسمح باستخدام الميكروفون من نافذة المتصفح لنبدأ التسجيل…
          </p>
        ) : null}
        {errorBox}

        <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button size="xl" className="sm:min-w-60" icon={<Mic className="size-5" aria-hidden />} loading={requesting || !rec.ready} onClick={begin} data-testid="start-recitation">
            {phase === "ERROR" ? "أعد المحاولة" : "ابدأ التسميع"}
          </Button>
          {phase === "ERROR" ? (
            <Button
              size="xl"
              variant="secondary"
              onClick={() => {
                startedAt.current ??= new Date().toISOString();
                setWithoutRecording(true);
                void reveal();
              }}
              data-testid="continue-without-recording"
            >
              المتابعة دون تسجيل
            </Button>
          ) : null}
        </div>
        <PrivacyNote className="mx-auto mt-6 max-w-sm justify-center text-start" />
      </section>
    );
  }

  // ── 4. Recording ────────────────────────────────────────────────────────────────────────────────────────────
  if (phase === "RECORDING") {
    return (
      <section aria-labelledby="rec-title" className="mt-8 rounded-2xl border border-error/25 bg-surface px-5 py-10 text-center shadow-lift sm:px-10 sm:py-12" data-testid="phase-recording">
        <h2 id="rec-title" className="sr-only">
          جاري التسجيل
        </h2>
        <div aria-hidden className="relative mx-auto flex size-20 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-error/15 motion-safe:animate-pulse-soft" />
          <span className="relative flex size-12 items-center justify-center rounded-full bg-error text-white">
            <Mic className="size-6" />
          </span>
        </div>
        <p role="status" className="mt-5 text-card font-semibold text-error-ink" data-testid="recording-status">
          جاري التسجيل
        </p>
        <p className="mt-2 text-display-sm font-bold tabular-nums text-ink" dir="ltr" data-testid="recording-clock" aria-label={`مدة التسجيل ${formatClock(rec.elapsedMs)}`}>
          {formatClock(rec.elapsedMs)}
        </p>
        <p className="mx-auto mt-3 max-w-sm text-body text-muted">المتن مخفي. سمّع من حفظك، وعند الانتهاء أوقف التسجيل.</p>
        <Button size="xl" className="mt-8 w-full sm:w-auto sm:min-w-64" icon={<Square className="size-4 fill-current" aria-hidden />} onClick={() => rec.stop()} data-testid="stop-recitation">
          إيقاف التسجيل
        </Button>
      </section>
    );
  }

  // ── 5. Listen, then reveal ──────────────────────────────────────────────────────────────────────────────────
  if (phase === "FINISHED") {
    return (
      <section aria-labelledby="review-title" className="mt-8" data-testid="phase-finished">
        <h2 id="review-title" className="text-section font-semibold text-ink">
          {listened ? "قارن تسميعك بالمتن" : "استمع لتسميعك"}
        </h2>
        <p className="mt-1 text-body text-muted">
          {listened ? "عندما تنتهي من الاستماع، أظهر المتن المعتمد لتقارن وتقيّم نفسك." : "استمع إلى تسجيلك أولًا بهدوء، ثم قارنه بالمتن."}
        </p>
        {rec.url ? (
          <div className="mt-5">
            <LocalPlayer url={rec.url} onPlaying={rec.setPlaying} prominent onListened={() => setListened(true)} />
          </div>
        ) : null}
        <p className="mt-2 text-caption text-muted">مدة التسجيل {formatClock(rec.durationMs)} — يبقى على جهازك فقط.</p>
        {errorBox}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="xl" variant={listened ? "primary" : "secondary"} className="sm:min-w-60" icon={<Eye className="size-5" aria-hidden />} loading={revealing} onClick={reveal} data-testid="reveal-matn">
            أظهر المتن للمقارنة
          </Button>
          <Button size="lg" variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => rec.reset()} data-testid="retry-recording">
            أعد التسجيل
          </Button>
        </div>
      </section>
    );
  }

  // ── 6. Compare and self-assess ──────────────────────────────────────────────────────────────────────────────
  return (
    <section aria-labelledby="assess-title" className="mt-8" data-testid="phase-assess">
      <h2 id="assess-title" className="text-section font-semibold text-ink">
        {withoutRecording ? "قيّم نفسك على المتن المعتمد" : "قارن تسميعك بالمتن"}
      </h2>
      <p className="mt-1 text-body text-muted">اقرأ كل سطر، ثم اختر ما يصف تسميعك له. أنت من يقيّم؛ لا يتحقق التطبيق من تلاوتك.</p>
      {rec.url ? (
        <div className="mt-4">
          <LocalPlayer url={rec.url} onPlaying={rec.setPlaying} />
        </div>
      ) : null}

      <div className="sticky top-0 z-10 -mx-4 mt-5 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mb-2 flex items-center justify-between text-small">
          <p className="font-medium text-ink" role="status" data-testid="assess-progress">
            تم تقييم {ar(answered)} من {ar(total)}
          </p>
          {complete ? <span className="text-caption font-semibold text-sage-dark">جاهز للحفظ</span> : null}
        </div>
        <Progress value={answered} max={Math.max(total, 1)} label="تقدم التقييم" tone="sage" size="sm" />
      </div>

      <div className="mt-5">
        <SelfAssessmentList units={units ?? []} answers={answers} onChange={(id, detail) => setAnswers((prev) => ({ ...prev, [id]: detail }))} onClear={(id) => setAnswers((prev) => { const next = { ...prev }; delete next[id]; return next; })} disabled={saving} />
      </div>

      {errorBox}

      <div className="mt-8 flex flex-col gap-3 pb-6">
        <Button size="xl" className="w-full sm:w-auto sm:min-w-64 sm:self-start" disabled={!complete} loading={saving} onClick={save} data-testid="submit-recitation">
          احفظ التقييم واعرض النتيجة
        </Button>
        {!complete ? (
          <p className="text-small text-muted" data-testid="incomplete-hint">
            قيّم جميع الأسطر لتتمكن من الحفظ ({ar(total - answered)} متبقٍّ).
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function clampSessionSize(value: number, maximum: number): number {
  return Math.min(Math.max(Number.isInteger(value) ? value : 1, 1), Math.max(1, maximum));
}

/** Keeps direct numeric entry integer-only and within the server-advertised session bounds. */
export function normalizeSessionSize(value: string, maximum: number, fallback: number): number {
  if (!/^\d+$/.test(value)) return fallback;
  return clampSessionSize(Number(value), maximum);
}
