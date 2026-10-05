/**
 * Learning-path states. Pure and deterministic so it can be unit-tested.
 *
 *   COMPLETED   — an assessment for the lesson has been completed
 *   CURRENT     — the first unlocked, not-yet-completed lesson (where "أكمل رحلتك" points)
 *   AVAILABLE   — unlocked but not current (e.g. studied lessons after the current one)
 *   LOCKED      — the previous published lesson has not been studied yet
 *   COMING_SOON — published structure only; source material not approved yet
 *
 * A lesson unlocks once the previous *published* lesson has been studied.
 */
export type PathState = "COMPLETED" | "CURRENT" | "AVAILABLE" | "LOCKED" | "COMING_SOON";

export type PathInput = {
  id: string;
  status: "DRAFT" | "COMING_SOON" | "PUBLISHED";
  studied: boolean;
  completed: boolean;
};

export function computePathStates(lessons: PathInput[]): Map<string, PathState> {
  const states = new Map<string, PathState>();
  let previousStudied = true;
  let currentAssigned = false;

  for (const lesson of lessons) {
    if (lesson.status === "DRAFT") continue;
    if (lesson.status === "COMING_SOON") {
      states.set(lesson.id, "COMING_SOON");
      continue;
    }
    const unlocked = previousStudied;
    let state: PathState;
    if (lesson.completed) state = "COMPLETED";
    else if (!unlocked) state = "LOCKED";
    else if (!currentAssigned) {
      state = "CURRENT";
      currentAssigned = true;
    } else state = "AVAILABLE";

    states.set(lesson.id, state);
    previousStudied = lesson.studied || lesson.completed;
  }
  return states;
}

export function isAccessible(state: PathState | undefined): boolean {
  return state === "COMPLETED" || state === "CURRENT" || state === "AVAILABLE";
}
