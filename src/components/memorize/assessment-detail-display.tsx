import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { cn } from "@/lib/cn";

type Detail = { unitId: string; unitOrder: number; text: string; status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes?: number[] };

const INCORRECT_TONE = "bg-error-soft text-error-ink underline decoration-2 decoration-error";
const FORGOTTEN_TONE = "bg-sage-soft text-sage-deep underline decoration-dotted decoration-2 decoration-sage-dark";

/**
 * Read-only canonical text: highlights only selections explicitly saved by the learner. A unit may contain both
 * INCORRECT (`wordIndexes`) and FORGOTTEN (`forgottenWordIndexes`) words; each keeps its own style and a text label
 * for assistive technology, so meaning never depends on colour alone.
 */
export function AssessmentDetailDisplay({ detail }: { detail: Detail }) {
  const forgotten = detail.forgottenWordIndexes ?? [];
  return (
    <p className="font-naskh text-question-lg leading-[2.1] text-ink-dark [overflow-wrap:anywhere]" lang="ar">
      {tokenizeCanonicalMatn(detail.text).map((token, index) => {
        const words = detail.scope === "WORDS";
        const kind = words && detail.wordIndexes.includes(index) ? "INCORRECT" : words && forgotten.includes(index) ? "FORGOTTEN" : null;
        return (
          <span key={`${index}-${token}`} className={cn("rounded-sm px-0.5", kind === "INCORRECT" && INCORRECT_TONE, kind === "FORGOTTEN" && FORGOTTEN_TONE)}>
            {token}
            {kind ? <span className="sr-only">{kind === "INCORRECT" ? " (أخطأت)" : " (لم أتذكر)"}</span> : null}{" "}
          </span>
        );
      })}
    </p>
  );
}
