import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/cn";

/** Required marking for development seed content — never presented as authentic material. */
export function SampleNotice({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-gold/35 bg-gold-soft/70 text-small text-gold-ink",
        compact ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <FlaskConical className="mt-1 size-4 shrink-0" aria-hidden />
      <p>
        <strong className="font-semibold">محتوى تجريبي — يُستبدل بالمادة العلمية المعتمدة قبل التقييم النهائي.</strong>
        {compact ? null : (
          <span className="text-gold-ink/90">
            {" "}
            هذه المادة تشرح منهج تفقّه نفسه لعرض رحلة التعلّم كاملة، ولا تتضمن أحكامًا فقهية.
          </span>
        )}
      </p>
    </div>
  );
}
