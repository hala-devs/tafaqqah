"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Play, ShieldCheck, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTimestamp, parseVideoUrl, playerSrc } from "@/lib/video";

export type VerifierConcept = {
  id: string;
  title: string;
  videoUrl: string | null;
  startSecond: number | null;
  endSecond: number | null;
  approved: boolean;
  passageIds: string[];
};

/**
 * Admin-only player: pick a concept and play the video from its stored startSecond to check the
 * text against the clip. It works for unapproved timestamps too — that is the point of review.
 * Students get their own player, which only ever receives approved timestamps.
 */
export function ConceptVideoVerifier({ concepts, initialConceptId }: { concepts: VerifierConcept[]; initialConceptId?: string }) {
  const [conceptId, setConceptId] = useState(concepts.find((c) => c.id === initialConceptId)?.id ?? concepts.find((c) => c.videoUrl)?.id ?? concepts[0]?.id ?? "");
  const [run, setRun] = useState(0);
  const [passageIndex, setPassageIndex] = useState(0);
  const concept = concepts.find((c) => c.id === conceptId);

  function revealPassage(index: number, behavior: ScrollBehavior = "smooth") {
    const passageId = concept?.passageIds[index];
    if (!passageId) return;
    document.querySelectorAll<HTMLElement>("[data-concept-passage]").forEach((item) => item.classList.remove("concept-passage-highlight"));
    const passage = document.getElementById(`source-passage-${passageId}`);
    if (!passage) return;
    passage.classList.add("concept-passage-highlight");
    passage.scrollIntoView({ behavior, block: "center" });
    passage.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!initialConceptId || conceptId !== initialConceptId) return;
    const frame = requestAnimationFrame(() => revealPassage(0, "auto"));
    return () => cancelAnimationFrame(frame);
  // The initial focus link is intentionally the only automatic scroll on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConceptId]);

  const src = useMemo(() => {
    if (!concept?.videoUrl || concept.startSecond == null || !parseVideoUrl(concept.videoUrl)) return null;
    const base = playerSrc({ url: concept.videoUrl, startSecond: concept.startSecond, endSecond: concept.endSecond });
    if (!base) return null;
    return run > 0 && base.includes("youtube-nocookie.com") ? `${base}&autoplay=1` : base;
  }, [concept, run]);

  if (concepts.length === 0) return <p className="text-small text-muted">لا مفاهيم في هذا الدرس بعد.</p>;

  return (
    <div className="space-y-4" data-testid="admin-video-verifier">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="verifier-concept" className="mb-1.5 block text-small font-medium text-ink">
            المفهوم المراد التحقق منه
          </label>
          <select
            id="verifier-concept"
            value={conceptId}
            onChange={(e) => {
              setConceptId(e.target.value);
              setRun(0);
              setPassageIndex(0);
              const selected = concepts.find((item) => item.id === e.target.value);
              requestAnimationFrame(() => {
                const passageId = selected?.passageIds[0];
                if (!passageId) return;
                document.querySelectorAll<HTMLElement>("[data-concept-passage]").forEach((item) => item.classList.remove("concept-passage-highlight"));
                const passage = document.getElementById(`source-passage-${passageId}`);
                passage?.classList.add("concept-passage-highlight");
                passage?.scrollIntoView({ behavior: "smooth", block: "center" });
                passage?.focus({ preventScroll: true });
              });
            }}
            className="h-11 w-full rounded-lg border border-line-strong bg-white px-3.5 text-body text-text focus:border-ink/50 focus:outline-none focus:shadow-[var(--shadow-focus)]"
          >
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" variant="secondary" disabled={!src} onClick={() => setRun((n) => n + 1)} icon={<Play className="size-4" aria-hidden />}>
          تشغيل من بداية المقطع
        </Button>
      </div>

      {concept ? (
        <p className="flex flex-wrap items-center gap-2 text-small text-muted">
          <span dir="ltr" className="tabular-nums text-ink" data-testid="verifier-range">
            {concept.startSecond != null ? formatTimestamp(concept.startSecond) : "—"} → {concept.endSecond != null ? formatTimestamp(concept.endSecond) : "—"}
          </span>
          {concept.approved ? (
            <Badge tone="success" icon={<ShieldCheck className="size-3" aria-hidden />}>
              توقيت معتمد
            </Badge>
          ) : (
            <Badge tone="warning" icon={<ShieldOff className="size-3" aria-hidden />}>
              توقيت غير معتمد — لا يصل إلى الطالب
            </Badge>
          )}
        </p>
      ) : null}

      {concept?.passageIds.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/30 bg-gold-soft/45 px-3 py-2 text-small text-ink" aria-live="polite">
          <span>مقاطع التفريغ المرتبطة: {concept.passageIds.length}</span>
          <span className="text-muted">{passageIndex + 1} من {concept.passageIds.length}</span>
          {concept.passageIds.length > 1 ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={passageIndex === 0}
                onClick={() => {
                  const next = passageIndex - 1;
                  setPassageIndex(next);
                  revealPassage(next);
                }}
                icon={<ChevronLeft className="size-3.5 rotate-180" aria-hidden />}
              >
                السابق
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={passageIndex === concept.passageIds.length - 1}
                onClick={() => {
                  const next = passageIndex + 1;
                  setPassageIndex(next);
                  revealPassage(next);
                }}
                icon={<ChevronLeft className="size-3.5" aria-hidden />}
              >
                التالي
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-small text-muted">لا توجد مقاطع تفريغ مرتبطة بهذا المفهوم بعد.</p>
      )}

      {src ? (
        <div className="overflow-hidden rounded-xl border border-line bg-ink-dark">
          <iframe
            key={`${conceptId}-${run}`}
            src={src}
            title={`فيديو التحقق — ${concept?.title ?? ""}`}
            className="aspect-video w-full"
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            data-testid="admin-video-player"
            data-src={src}
          />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-small text-muted">لا يوجد فيديو أو توقيت صالح مسجّل لهذا المفهوم.</p>
      )}
    </div>
  );
}
