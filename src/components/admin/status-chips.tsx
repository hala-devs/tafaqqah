import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { LessonStatus } from "@/generated/prisma/enums";
import { COMBINED_STATUS_LABEL, CONTENT_STATUS_LABEL, PUBLICATION_LABEL, type CombinedStatus, type ContentStatus } from "@/server/admin/content-overview";

const COMBINED_TONE: Record<CombinedStatus, BadgeTone> = { DRAFT: "neutral", READY_FOR_REVIEW: "warning", APPROVED: "sage", PUBLISHED: "success" };
const COMBINED_KEY: Record<CombinedStatus, string> = { DRAFT: "DRAFT", READY_FOR_REVIEW: "READY FOR REVIEW", APPROVED: "APPROVED", PUBLISHED: "PUBLISHED" };

/** DRAFT / READY FOR REVIEW / APPROVED / PUBLISHED — the single combined state of a lesson. */
export function CombinedStatusBadge({ status }: { status: CombinedStatus }) {
  return (
    <Badge tone={COMBINED_TONE[status]}>
      <span dir="ltr" className="text-micro opacity-70">
        {COMBINED_KEY[status]}
      </span>
      {COMBINED_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Internal approval of the source material — says nothing about student visibility. */
export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={COMBINED_TONE[status]}>المحتوى: {CONTENT_STATUS_LABEL[status]}</Badge>;
}

/** Student visibility — separate from approval. */
export function PublicationBadge({ status }: { status: LessonStatus }) {
  return <Badge tone={status === "PUBLISHED" ? "success" : status === "COMING_SOON" ? "gold" : "neutral"}>النشر: {PUBLICATION_LABEL[status]}</Badge>;
}
