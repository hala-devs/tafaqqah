export type JourneyNodeState = "done" | "current" | "upcoming" | "soon";

export type JourneyNode = { id: string; number: number; title: string; state: JourneyNodeState; statusLabel?: string; href: string | null };

/**
 * The learner sees where they are and what is around them, never the whole book at once:
 * one lesson behind, the current lesson and the lessons right after it.
 */
export function pickJourneyWindow(nodes: JourneyNode[], size = 4): { shown: JourneyNode[]; hidden: number } {
  if (nodes.length <= size) return { shown: nodes, hidden: 0 };
  let anchor = nodes.findIndex((n) => n.state === "current");
  if (anchor < 0) {
    // Nothing current (everything open is done): anchor on the last completed lesson.
    anchor = nodes.reduce((last, n, i) => (n.state === "done" ? i : last), 0);
  }
  const before = Math.min(1, anchor);
  let start = anchor - before;
  start = Math.max(0, Math.min(start, nodes.length - size));
  const shown = nodes.slice(start, start + size);
  return { shown, hidden: nodes.length - shown.length };
}
