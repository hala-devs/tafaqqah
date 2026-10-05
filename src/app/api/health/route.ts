import { prisma, isDatabaseConfigured } from "@/server/db";
import { resolveAIStatus } from "@/server/ai/factory";

export const dynamic = "force-dynamic";

/** Deployment health check. Reports configuration state only — never secrets. */
export async function GET() {
  let database: "ok" | "unreachable" | "not_configured" = "not_configured";
  if (isDatabaseConfigured()) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }
  const ai = resolveAIStatus();
  const body = {
    status: database === "ok" && ai.configured ? "ok" : "degraded",
    database,
    ai: ai.configured
      ? { configured: true, provider: ai.provider, developmentMock: ai.isDevelopmentMock, generatorModel: ai.generatorModel, validatorModel: ai.validatorModel }
      : { configured: false, provider: ai.provider, reason: ai.reason },
  };
  return Response.json(body, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
