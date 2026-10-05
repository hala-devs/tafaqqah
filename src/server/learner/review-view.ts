import { countLabel } from "@/lib/format";
import type { LineDetail, MemorizationReviewItem } from "@/server/memorization/review-data";

/**
 * View model of /review. Presentation only: which items exist is decided by getWeakConcepts (understanding) and
 * getMemorizationReviewData (memorization). Understanding and memorization are never merged into one score.
 */

/** Learner wording of a memorization review item — due-ness from the stored schedule, never assumed. */
export function memorizationReason(item: Pick<MemorizationReviewItem, "due" | "repeatedWeakness">): { label: string; text: string } {
  if (item.due && item.repeatedWeakness) return { label: "حان وقت مراجعته", text: "تكرّر الضعف فيه في آخر تسميعاتك، وقد حان وقت مراجعته." };
  if (item.due) return { label: "حان وقت مراجعته", text: "حلّ موعد مراجعة هذا المقطع بحسب جدول مراجعتك." };
  return { label: "يحتاج إلى تثبيت", text: "لم يحن موعد مراجعته بعد، لكن تقييمك له يشير إلى حاجته إلى مزيد من التثبيت." };
}

/** Label placed directly above a word the learner marked (WORDS scope only). */
export function wordLabel(status: LineDetail["status"]): string {
  return status === "INCORRECT" ? "خطأ" : "لم أتذكر";
}

/**
 * One truthful line-level label when no word positions exist: FULL_UNIT, or legacy records saved before word-level
 * detail (scope null). WORDS returns null — the words themselves carry the labels. Positions are never invented.
 */
export function lineLabel(detail: Pick<LineDetail, "status" | "scope">): string | null {
  if (detail.scope === "WORDS") return null;
  if (detail.scope === "FULL_UNIT") return detail.status === "INCORRECT" ? "السطر كاملًا — أخطأت فيه" : "السطر كاملًا — لم أتذكره";
  return detail.status === "INCORRECT" ? "أخطأت في هذا السطر" : "لم تتذكر هذا السطر";
}

export type ReviewEntry<W> = { type: "MEMORIZATION"; item: MemorizationReviewItem } | { type: "UNDERSTANDING"; item: W };

/** Priority: memorization due now → understanding concepts needing reinforcement → memorization reinforcement (not due). */
export function orderReview<W>(memorization: MemorizationReviewItem[], weak: W[]): ReviewEntry<W>[] {
  return [
    ...memorization.filter((m) => m.due).map((item) => ({ type: "MEMORIZATION" as const, item })),
    ...weak.map((item) => ({ type: "UNDERSTANDING" as const, item })),
    ...memorization.filter((m) => !m.due).map((item) => ({ type: "MEMORIZATION" as const, item })),
  ];
}

const CONCEPTS = ["مفهوم واحد", "مفهومان", "مفاهيم", "مفهومًا"] as [string, string, string, string];
const PASSAGES = ["مقطع واحد", "مقطعان", "مقاطع", "مقطعًا"] as [string, string, string, string];

/** Summary lines — one per review system, each about its own items. */
export function reviewSummary(weakCount: number, memorization: MemorizationReviewItem[]) {
  const due = memorization.filter((m) => m.due).length;
  const reinforce = memorization.length - due;
  const understanding = weakCount === 0 ? null : `${countLabel(weakCount, CONCEPTS)} ${weakCount === 1 ? "يحتاج" : weakCount === 2 ? "يحتاجان" : "تحتاج"} إلى تثبيت`;
  const parts: string[] = [];
  if (due) parts.push(`${countLabel(due, PASSAGES)} حان وقت ${due === 1 ? "مراجعته" : "مراجعتها"}`);
  if (reinforce) parts.push(`${countLabel(reinforce, PASSAGES)} ${reinforce === 1 ? "يحتاج" : reinforce === 2 ? "يحتاجان" : "تحتاج"} إلى تثبيت`);
  return { understanding, memorization: parts.length ? parts.join("، و") : null, empty: weakCount === 0 && memorization.length === 0 };
}
