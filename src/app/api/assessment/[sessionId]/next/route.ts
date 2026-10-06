import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { getNextQuestion } from "@/server/assessment/engine";
import { nextQuestionBody, parseWith, sessionIdParam } from "@/server/assessment/api-schemas";
import { apiHandler, readJson } from "@/server/http";

// One question = generator + independent validator, retried at most 3 times inside a
// 100 s budget (GENERATION_RULES.budgetMs); 120 s leaves headroom for the database work.
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return apiHandler(request, async () => {
    const user = await requireApiLearner();
    const sessionId = parseWith(sessionIdParam, (await params).sessionId);
    const body = parseWith(nextQuestionBody, await readJson(request));
    return getNextQuestion({ db: prisma }, user.id, sessionId, { reviewed: body.reviewed, peek: body.peek });
  });
}
