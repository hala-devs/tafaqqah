import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { getMemorizationSessionAvailability, getPassageStart } from "@/server/memorization/content";
import { getLinkablePlan } from "@/server/memorization/reinforcement/service";
import { RecitationFlow } from "@/components/memorize/recitation-flow";
import { StateBadge } from "@/components/memorize/state-badge";
import { Logo } from "@/components/shell/logo";
import { ButtonLink } from "@/components/ui/button";
import { ar, countLabel } from "@/lib/format";
import { memorizeSectionHref } from "@/lib/routes";

export const metadata: Metadata = { title: "تسميع المقطع" };

type Props = { params: Promise<{ passageId: string }>; searchParams: Promise<{ start?: string; size?: string; plan?: string }> };

const LINES = ["سطر واحد", "سطران", "أسطر", "سطرًا"] as [string, string, string, string];
const ATTEMPTS = ["محاولة واحدة", "محاولتان", "محاولات", "محاولة"] as [string, string, string, string];
const MAX_SESSION_SIZE = 20;

export default async function PassageStartPage({ params, searchParams }: Props) {
  const { passageId } = await params;
  const { start: startUnitId, size, plan } = await searchParams;
  const user = await requireUser(`/memorize/passage/${passageId}`);
  const start = await getPassageStart(prisma, user.id, passageId);
  if (!start) notFound();
  const validStartUnitId = start.units.some((unit) => unit.id === startUnitId) ? startUnitId! : start.units[0]!.id;
  const requestedSize = size ? Number(size) : undefined;
  const initialSize = Number.isInteger(requestedSize) && requestedSize! >= 1 && requestedSize! <= MAX_SESSION_SIZE ? requestedSize : undefined;
  const remainingUnitCount = await getMemorizationSessionAvailability(prisma, start.id, validStartUnitId);
  if (!remainingUnitCount) notFound();
  const weak = start.state === "NEEDS_REINFORCEMENT" || start.state === "NEEDS_REVIEW";
  // Re-recitation after reinforcement: only a plan of THIS learner, for this passage, not yet followed up.
  const linkable = plan && plan.length <= 100 ? await getLinkablePlan(prisma, user.id, plan) : null;
  const reinforcementPlanId = linkable && linkable.sourceAttempt.passageId === start.id ? linkable.id : undefined;
  const previousDetails = reinforcementPlanId
    ? linkable!.sourceAttempt.results.map((result) => ({
        unitId: result.unitId,
        status: result.selfAssessmentStatus as "INCORRECT" | "FORGOTTEN",
        scope: result.selfAssessmentScope,
        wordIndexes: result.wordIndexes,
        // Old rows created before this column are represented by Prisma as an empty array; retain that legacy meaning.
        forgottenWordIndexes: result.forgottenWordIndexes ?? [],
      }))
    : start.previousDetails;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <Logo href="/dashboard" />
        <ButtonLink href={memorizeSectionHref(start.section.id)} variant="ghost" size="sm" icon={<ArrowRight className="size-4" aria-hidden />}>
          العودة إلى القسم
        </ButtonLink>
      </div>

      <main id="main" className="flex-1 py-8 sm:py-10">
        <header className="animate-fade-up">
          <p className="text-small text-muted">
            {start.course.title}
            {start.section.groupTitle ? ` · ${start.section.groupTitle}` : ""} · <span className="font-medium text-ink">{start.section.title}</span>
          </p>
          {start.due ? <p className="mt-4 text-caption font-semibold text-warning-ink">مراجعة محفوظك</p> : null}
          {reinforcementPlanId ? <p className="mt-4 text-caption font-semibold text-sage-deep" data-testid="re-recitation-note">إعادة التسميع بعد التثبيت</p> : null}
          <h1 className="mt-1 font-naskh text-title leading-normal text-ink" data-testid="passage-title">
            {start.title}
          </h1>
          {start.due ? (
            <p className="mt-2 text-body text-muted">{weak ? "هذا المقطع يحتاج إلى تثبيت." : "حان وقت مراجعة هذا المقطع."} راجع بهدوء ثم سمّع مرة أخرى.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-muted" data-testid="passage-meta">
            <StateBadge state={start.state} />
            <span>
              {countLabel(start.unitCount, LINES)} · نحو {ar(start.wordCount)} كلمة
            </span>
            {start.attempts > 0 && start.lastScore !== null ? (
              <span data-testid="previous-status">
                آخر تسميع: <bdi dir="ltr">{ar(Math.round(start.lastScore))}٪</bdi> · {countLabel(start.attempts, ATTEMPTS)}
              </span>
            ) : null}
          </div>
        </header>

        <div className="animate-fade-up [animation-delay:60ms]">
          <RecitationFlow
            passageId={start.id}
            startUnitId={validStartUnitId}
            remainingUnitCount={remainingUnitCount}
            isReview={start.due}
            initialSize={initialSize}
            previousDetails={previousDetails}
            reinforcementPlanId={reinforcementPlanId}
          />
        </div>
      </main>
    </div>
  );
}
