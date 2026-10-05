import { Check, CircleDashed, RotateCcw, Sprout } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { MEMORIZATION_STATE_LABEL, type MemorizationStateKey } from "@/server/memorization/config";

const TONE: Record<MemorizationStateKey, BadgeTone> = { MASTERED: "success", GOOD: "sage", NEEDS_REINFORCEMENT: "warning", NEEDS_REVIEW: "warning" };
const ICON = { MASTERED: Check, GOOD: Sprout, NEEDS_REINFORCEMENT: RotateCcw, NEEDS_REVIEW: RotateCcw } as const;

/** Memorization mastery state: always an icon plus a word, never colour alone. A learning state, not an error. */
export function StateBadge({ state }: { state: MemorizationStateKey | null }) {
  if (!state) {
    return (
      <Badge tone="neutral" icon={<CircleDashed className="size-3" aria-hidden />}>
        لم يُسمَّع بعد
      </Badge>
    );
  }
  const Icon = ICON[state];
  return (
    <Badge tone={TONE[state]} icon={<Icon className="size-3" aria-hidden />}>
      {MEMORIZATION_STATE_LABEL[state]}
    </Badge>
  );
}
