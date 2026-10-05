import { Badge } from "@/components/ui/badge";
import { VERDICT_LABEL, type StageVerdict } from "@/server/admin/trace";

export function VerdictChip({ verdict }: { verdict: StageVerdict }) {
  const tone = verdict === "PASSED" ? "success" : verdict === "REJECTED" ? "error" : "neutral";
  return (
    <Badge tone={tone} className="font-mono">
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}

export function DisplayedChip({ displayed }: { displayed: boolean }) {
  return (
    <Badge tone={displayed ? "ink" : "neutral"} className="font-mono">
      {displayed ? "YES" : "NO"}
    </Badge>
  );
}
