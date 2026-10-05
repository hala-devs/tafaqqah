import Link from "next/link";
import { ArrowLeft, BookOpenText, Lightbulb, PlayCircle } from "lucide-react";
import { StartAssessmentButton } from "@/components/learning/start-assessment-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ar } from "@/lib/format";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { memorizePassageHref, reviewHref } from "@/lib/routes";
import { timestampRange } from "@/lib/video";
import { lineLabel, memorizationReason, wordLabel } from "@/server/learner/review-view";
import type { WeakConcept } from "@/server/learner/overview";
import type { LineDetail, MemorizationReviewItem } from "@/server/memorization/review-data";

const primaryCta =
  "group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-5 text-small font-semibold text-surface shadow-soft transition-colors hover:bg-ink-soft focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]";

/**
 * One saved line of the latest recitation. The FULL canonical text is always shown, token by token, unchanged.
 * WORDS: each marked word carries its label directly above it (ruby annotation). FULL_UNIT / legacy: one line label.
 */
export function ReviewLine({ detail }: { detail: LineDetail }) {
  const marked = detail.scope === "WORDS" ? new Set([...detail.wordIndexes, ...detail.forgottenWordIndexes]) : new Set<number>();
  const forgotten = detail.scope === "WORDS" ? new Set(detail.forgottenWordIndexes) : new Set<number>();
  const label = lineLabel(detail);
  return (
    <li className="py-3" data-testid="review-line" data-scope={detail.scope ?? "LEGACY"}>
      <div className="flex items-center gap-2 text-caption text-muted">
        <span className="font-semibold tabular-nums">السطر {ar(detail.unitOrder)}</span>
        {label ? <span className={cn("rounded-full px-2 py-0.5 font-semibold", detail.status === "INCORRECT" ? "bg-error-soft text-error-ink" : "bg-sage-soft text-sage-deep")}>{label}</span> : null}
      </div>
      <p className="mt-1 font-naskh text-question leading-[2.6] text-ink-dark [overflow-wrap:anywhere]" lang="ar" data-testid="review-line-text">
        {tokenizeCanonicalMatn(detail.text).map((token, index) =>
          marked.has(index) ? (
            <span key={`${index}-${token}`}>
              {/* The label sits directly above the exact word; the word itself is never replaced. */}
              <span className="inline-flex flex-col items-center align-bottom" data-testid="marked-word">
                <span aria-hidden className={cn("mb-0.5 rounded-full px-1.5 font-sans text-micro leading-5 font-semibold whitespace-nowrap", detail.status === "INCORRECT" ? "bg-error-soft text-error-ink" : "bg-sage-soft text-sage-deep")}>
                  {wordLabel(forgotten.has(index) ? "FORGOTTEN" : detail.status)}
                </span>
                <mark className={cn("rounded-sm bg-transparent px-0.5 text-inherit underline decoration-2 underline-offset-[10px]", detail.status === "INCORRECT" ? "decoration-error" : "decoration-sage-dark")}>
                  {token}
                  <span className="sr-only"> ({wordLabel(forgotten.has(index) ? "FORGOTTEN" : detail.status)})</span>
                </mark>
              </span>{" "}
            </span>
          ) : (
            <span key={`${index}-${token}`}>{token} </span>
          ),
        )}
      </p>
    </li>
  );
}

export function MemorizationReviewCard({ item }: { item: MemorizationReviewItem }) {
  const reason = memorizationReason(item);
  const where = `${item.sectionTitle} — ${item.passageTitle}`;
  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6" data-testid="review-item" data-type="MEMORIZATION" data-due={item.due}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="sage" icon={<BookOpenText className="size-3" aria-hidden />}>
          حفظ
        </Badge>
        <Badge tone="warning">{reason.label}</Badge>
      </div>
      <h3 className="mt-3 font-naskh text-section leading-normal font-semibold text-ink">{where}</h3>
      <p className="text-small text-muted">{item.bookTitle}</p>
      <p className="mt-2 text-body text-text">{reason.text}</p>

      {item.details.length ? (
        <div className="mt-4 rounded-xl bg-paper px-4 py-1">
          <p className="pt-3 text-caption font-semibold text-ink">ما سجّلته في آخر تسميع</p>
          <ol className="divide-y divide-line">
            {item.details.map((d) => (
              <ReviewLine key={d.unitId} detail={d} />
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-5">
        <Link href={memorizePassageHref(item.passageId)} className={primaryCta} aria-label={`حفظ: ${where} — ${item.due ? "ابدأ المراجعة" : "أعد التسميع"}`}>
          {item.due ? "ابدأ المراجعة" : "أعد التسميع"}
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
}

export function UnderstandingReviewCard({ concept }: { concept: WeakConcept }) {
  const range = concept.video ? timestampRange(concept.video) : null;
  return (
    <article className="rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6" data-testid="review-item" data-type="UNDERSTANDING">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="gold" icon={<Lightbulb className="size-3" aria-hidden />}>
          فهم
        </Badge>
        <Badge tone="warning">يحتاج إلى تثبيت</Badge>
      </div>
      <h3 className="mt-3 text-section font-semibold text-ink">{concept.conceptTitle}</h3>
      <p className="text-small text-muted">
        {concept.bookTitle} · {concept.lessonTitle}
      </p>
      <p className="mt-2 text-body text-text">تكرّر الخطأ في هذا المفهوم في إجاباتك، فهو يحتاج إلى مراجعة ثم اختبار فهمه من جديد.</p>
      {range ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-gold-soft/60 px-3 py-2 text-small text-ink" data-testid="targeted-source">
          <PlayCircle className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
          <span>
            مراجعة موجهة: سنأخذك مباشرة إلى الجزء المرتبط بهذا المفهوم في الشرح (<bdi dir="ltr" className="tabular-nums">{range}</bdi>).
          </span>
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href={reviewHref(concept.lessonId, concept.conceptId)} className={primaryCta} aria-label={`فهم: ${concept.conceptTitle} — راجع المفهوم`}>
          راجع المفهوم
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden />
        </Link>
        <StartAssessmentButton lessonId={concept.lessonId} label="اختبر فهمي مرة أخرى" kind={`REASSESS:${concept.conceptId}`} variant="ghost" size="sm" icon="retry" />
      </div>
    </article>
  );
}
