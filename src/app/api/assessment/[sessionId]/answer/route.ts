import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { submitAnswer } from "@/server/assessment/engine";
import { answerBody, parseWith, sessionIdParam } from "@/server/assessment/api-schemas";
import { apiHandler, readJson } from "@/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return apiHandler(request, async () => {
    const user = await requireApiLearner();
    const sessionId = parseWith(sessionIdParam, (await params).sessionId);
    const body = parseWith(answerBody, await readJson(request));
    return submitAnswer({ db: prisma }, user.id, sessionId, body.questionId, body.selectedIndex);
  });
}
