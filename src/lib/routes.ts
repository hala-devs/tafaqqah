/** Link for "راجع هذا الجزء": the focused targeted-review screen for one concept. */
export function reviewHref(lessonId: string, conceptId: string): string {
  return `/lessons/${lessonId}/review/${conceptId}`;
}

export function assessmentHref(lessonId: string, sessionId?: string): string {
  return sessionId ? `/lessons/${lessonId}/assessment?session=${sessionId}` : `/lessons/${lessonId}/assessment`;
}

export function resultHref(lessonId: string, sessionId: string): string {
  return `/lessons/${lessonId}/result?session=${sessionId}`;
}

/** «حفظ المتن» — an independent journey; none of these routes involve a lesson. */
export const MEMORIZE_HOME = "/memorize";
export function memorizeBookHref(courseId: string): string {
  return `/memorize/${courseId}`;
}
export function memorizeSectionHref(sectionId: string): string {
  return `/memorize/section/${sectionId}`;
}
export function memorizePassageHref(passageId: string, startUnitId?: string): string {
  return startUnitId ? `/memorize/passage/${passageId}?start=${encodeURIComponent(startUnitId)}` : `/memorize/passage/${passageId}`;
}
export function memorizeResultHref(attemptId: string): string {
  return `/memorize/result/${attemptId}`;
}
export function memorizeReinforceHref(planId: string): string {
  return `/memorize/reinforce/${planId}`;
}
/** Re-recitation of exactly the same units, linked to the reinforcement plan for a before/after comparison. */
export function memorizeReReciteHref(passageId: string, startUnitId: string, size: number, planId: string): string {
  return `/memorize/passage/${passageId}?start=${encodeURIComponent(startUnitId)}&size=${size}&plan=${encodeURIComponent(planId)}`;
}
