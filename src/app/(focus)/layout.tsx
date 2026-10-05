import { requireLearner } from "@/server/auth/current-user";

/** Distraction-free layout for the assessment: no sidebar, no tab bar. */
export default async function FocusLayout({ children }: { children: React.ReactNode }) {
  await requireLearner();
  return <div className="min-h-dvh bg-paper">{children}</div>;
}
