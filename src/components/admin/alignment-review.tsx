import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/video";

/** Concept-level verification details stored in SourcePassage.alignmentDetails. */
export type Fix = { old: string; new: string; source: string; page: number | null };
export type ReviewItem = { issue: string; why: string; check: string; timestamp?: string; pdfPages?: string; bahethExcerpt?: string };
export type VerificationDetails = { fixes: Fix[]; recovered: string[]; humanReview: ReviewItem[] };

export type VerificationPassage = {
  alignmentStatus: string | null;
  humanReviewRequired: boolean;
  alignmentDetails: unknown;
  rawPdfText: string | null;
  pdfSource: string | null;
  pdfPageStart: number | null;
  pdfPageEnd: number | null;
  bahethUrl: string | null;
  videoUrl: string | null;
  startSecond: number | null;
  endSecond: number | null;
};

const TONE: Record<string, "success" | "warning" | "neutral" | "gold" | "ink"> = {
  VERIFIED: "success",
  VERIFIED_WITH_CLEANUP: "success",
  HUMAN_REVIEW_REQUIRED: "warning",
  PDF_ONLY_UNTIMED: "neutral",
};

const LABEL: Record<string, string> = {
  VERIFIED: "موثّق",
  VERIFIED_WITH_CLEANUP: "موثّق بعد تنظيف آلي",
  HUMAN_REVIEW_REQUIRED: "يحتاج مراجعة بشرية",
  PDF_ONLY_UNTIMED: "نص PDF بلا توقيت",
};

export function parseDetails(value: unknown): VerificationDetails {
  const v = (value && typeof value === "object" ? value : {}) as Partial<VerificationDetails>;
  return { fixes: Array.isArray(v.fixes) ? v.fixes : [], recovered: Array.isArray(v.recovered) ? v.recovered : [], humanReview: Array.isArray(v.humanReview) ? v.humanReview : [] };
}

/** Deep link to the recording at the passage start (never invents a time). */
export function videoLink(url: string | null, startSecond: number | null) {
  if (!url) return null;
  if (startSecond == null) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${startSecond}`;
}

export function AlignmentReview({ passage }: { passage: VerificationPassage }) {
  if (!passage.alignmentStatus) return null;
  const details = parseDetails(passage.alignmentDetails);
  const pages =
    passage.pdfPageStart == null ? "غير محدد" : passage.pdfPageStart === passage.pdfPageEnd ? `ص ${passage.pdfPageStart}` : `ص ${passage.pdfPageStart}–${passage.pdfPageEnd}`;
  const link = videoLink(passage.videoUrl, passage.startSecond);
  const flagged = passage.humanReviewRequired || passage.alignmentStatus === "HUMAN_REVIEW_REQUIRED";

  return (
    <div className="mt-3 space-y-3" data-testid="verification-review" data-verification-status={passage.alignmentStatus}>
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <Badge tone={TONE[passage.alignmentStatus] ?? "neutral"}>
          {LABEL[passage.alignmentStatus] ?? passage.alignmentStatus} ({passage.alignmentStatus})
        </Badge>
        <span className="text-muted">PDF: {pages}</span>
        {passage.startSecond != null && passage.endSecond != null ? (
          <span className="text-muted" dir="ltr">
            {formatTimestamp(passage.startSecond)}–{formatTimestamp(passage.endSecond)}
          </span>
        ) : (
          <span className="font-medium text-red-700">لا يوجد توقيت</span>
        )}
      </div>

      {flagged
        ? details.humanReview.map((item, i) => (
            <div key={i} role="alert" className="rounded-lg border border-red-600/40 bg-red-50 p-3 text-small text-red-800" data-testid="human-review-item">
              <p className="flex items-start gap-2 font-semibold">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>HUMAN_REVIEW_REQUIRED — {item.timestamp ? <span dir="ltr">{item.timestamp}</span> : null}{item.pdfPages ? ` · PDF ص ${item.pdfPages}` : ""}</span>
              </p>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="font-medium">المشكلة المحددة</dt>
                  <dd>{item.issue}</dd>
                </div>
                <div>
                  <dt className="font-medium">لماذا قد تؤثر على المعنى</dt>
                  <dd>{item.why}</dd>
                </div>
                <div>
                  <dt className="font-medium">ما الذي يجب أن تتحقق منه</dt>
                  <dd>{item.check}</dd>
                </div>
                {item.bahethExcerpt ? (
                  <div>
                    <dt className="font-medium">مقتطف باحث ذو الصلة</dt>
                    <dd className="font-naskh leading-8 text-ink-dark">{item.bahethExcerpt}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ))
        : null}

      <div className="grid gap-1 text-caption text-muted" dir="ltr">
        {passage.bahethUrl ? (
          <a className="break-all underline" href={passage.bahethUrl} target="_blank" rel="noreferrer">
            Baheth: {passage.bahethUrl}
          </a>
        ) : null}
        {link ? (
          <a className="break-all underline" href={link} target="_blank" rel="noreferrer">
            Video: {link}
          </a>
        ) : null}
      </div>
      {passage.pdfSource ? <p className="text-caption text-muted">مصدر الـPDF: {passage.pdfSource}</p> : null}

      {details.fixes.length ? (
        <details>
          <summary className="cursor-pointer text-small font-medium text-ink">تصحيحات أُجريت في نص المراجعة ({details.fixes.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pr-5 text-caption text-muted">
            {details.fixes.map((f, i) => (
              <li key={i}>
                «{f.old}» ← «{f.new}» ({f.source}
                {f.page ? `، ص${f.page}` : ""})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {details.recovered.length ? (
        <details>
          <summary className="cursor-pointer text-small font-medium text-ink">مواضع استُعيدت من باحث لأن الـPDF غير مقروء ({details.recovered.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pr-5 text-caption text-muted">
            {details.recovered.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {passage.rawPdfText ? (
        <details>
          <summary className="cursor-pointer text-small font-medium text-ink">نص الـPDF الخام ({pages})</summary>
          <p className="mt-3 whitespace-pre-wrap font-naskh text-card leading-9 text-muted">{passage.rawPdfText}</p>
        </details>
      ) : null}
    </div>
  );
}
