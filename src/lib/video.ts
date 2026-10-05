import { ar } from "./format";

/**
 * Review-video helpers. Timestamps always come from human-approved concept metadata;
 * nothing here infers or adjusts them.
 */
export type ParsedVideo = { kind: "youtube"; id: string } | { kind: "file"; url: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function parseVideoUrl(raw: string | null | undefined): ParsedVideo | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/live/")) id = url.pathname.split("/")[2] ?? null;
  } else if (host === "youtu.be") {
    id = url.pathname.slice(1);
  }
  if (id) return YOUTUBE_ID.test(id) ? { kind: "youtube", id } : null;
  if (/\.(mp4|webm|m4v|ogg)$/i.test(url.pathname)) return { kind: "file", url: url.toString() };
  return null;
}

export type ApprovedVideo = { url: string; startSecond: number; endSecond: number | null };

/** Returns the review video only when it is approved and its timestamps are coherent. */
export function approvedVideo(concept: {
  videoUrl: string | null;
  videoStartSecond: number | null;
  videoEndSecond: number | null;
  videoApproved: boolean;
}): ApprovedVideo | null {
  if (!concept.videoApproved || !concept.videoUrl || concept.videoStartSecond == null) return null;
  if (!parseVideoUrl(concept.videoUrl)) return null;
  if (concept.videoStartSecond < 0) return null;
  if (concept.videoEndSecond != null && concept.videoEndSecond <= concept.videoStartSecond) return null;
  return { url: concept.videoUrl, startSecond: concept.videoStartSecond, endSecond: concept.videoEndSecond };
}

/** Player URL that starts (and, when known, ends) exactly at the approved timestamps. */
export function playerSrc(video: ApprovedVideo): string | null {
  const parsed = parseVideoUrl(video.url);
  if (!parsed) return null;
  if (parsed.kind === "youtube") {
    const params = new URLSearchParams({ start: String(video.startSecond), rel: "0", modestbranding: "1" });
    if (video.endSecond != null) params.set("end", String(video.endSecond));
    return `https://www.youtube-nocookie.com/embed/${parsed.id}?${params.toString()}`;
  }
  return `${parsed.url}#t=${video.startSecond}${video.endSecond != null ? `,${video.endSecond}` : ""}`;
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "١٢:٣٥ – ١٦:٢٠" (or "من ١٢:٣٥" when no end is recorded). */
export function timestampRange(video: ApprovedVideo): string {
  const start = ar(formatTimestamp(video.startSecond));
  return video.endSecond != null ? `${start} – ${ar(formatTimestamp(video.endSecond))}` : `من ${start}`;
}

/** Parses "755", "12:35" or "1:02:03" into seconds; returns null for anything else. */
export function parseTimestamp(raw: string | null | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return null;
  return nums.reduce((total, n) => total * 60 + n, 0);
}
