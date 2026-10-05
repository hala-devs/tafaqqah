import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getBaselineReview } from "@/server/memorization/reinforcement/baseline";
import { getCoachView } from "@/server/memorization/reinforcement/coach-service";
import { BaselineReview } from "@/components/memorize/baseline-review";
import { ReinforcementCoach } from "@/components/memorize/reinforcement-coach";
import { Logo } from "@/components/shell/logo";

export const metadata: Metadata = { title: "جلسة التثبيت" };

type Props = { params: Promise<{ planId: string }> };

/**
 * The review condition comes only from the stored session row (never from the URL or the learner). Canonical content
 * is resolved on the server from approved MatnUnit rows; this render never creates an exercise or calls a provider.
 */
export default async function ReinforcePage({ params }: Props) {
  const { planId } = await params;
  const user = await requireUser(`/memorize/reinforce/${planId}`);
  const [coach, baseline] = await Promise.all([getCoachView(prisma, user.id, planId), getBaselineReview(prisma, user.id, planId)]);
  if (!coach && !baseline) notFound();

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <Logo href="/dashboard" />
      </div>
      <main id="main" className="flex-1 py-8 sm:py-10">
        {coach ? <ReinforcementCoach initial={coach} /> : <BaselineReview view={baseline!} />}
      </main>
    </div>
  );
}
