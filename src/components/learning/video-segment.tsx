"use client";

import { useState } from "react";
import { PlayCircle } from "lucide-react";
import { parseVideoUrl, playerSrc, timestampRange, type ApprovedVideo } from "@/lib/video";

/**
 * Plays ONLY the human-approved segment of a concept's review video. The start/end seconds
 * come from approved content metadata — they are never generated or adjusted.
 */
export function VideoSegment({ video, title, autoLoad = false }: { video: ApprovedVideo; title: string; autoLoad?: boolean }) {
  const [loaded, setLoaded] = useState(autoLoad);
  const src = playerSrc(video);
  const parsed = parseVideoUrl(video.url);
  if (!src || !parsed) return null;

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-surface">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-small">
        <span className="font-medium text-ink">الجزء المقترح للمراجعة</span>
        <span className="tabular-nums text-muted" data-testid="video-range">
          {timestampRange(video)}
        </span>
      </figcaption>
      {loaded ? (
        parsed.kind === "youtube" ? (
          <iframe
            src={src}
            title={`مقطع مراجعة: ${title}`}
            className="aspect-video w-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
            data-testid="video-player"
          />
        ) : (
          <video src={src} controls preload="metadata" className="aspect-video w-full bg-ink-dark" data-testid="video-player">
            <track kind="captions" />
          </video>
        )
      ) : (
        <button
          type="button"
          onClick={() => setLoaded(true)}
          className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-ink text-surface transition-colors duration-200 hover:bg-ink-soft"
        >
          <PlayCircle className="size-10 text-gold" aria-hidden />
          <span className="text-small font-medium">شاهد هذا الجزء من الشرح</span>
          <span className="text-caption text-surface/70">
            {timestampRange(video)}
          </span>
        </button>
      )}
    </figure>
  );
}
