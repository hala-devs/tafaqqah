import { prisma } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { getEvaluationRows, getLatencySummary, getMeasurementRows, summarize, summarizeMeasurements } from "@/server/admin/evaluation";
import { apiHandler } from "@/server/http";

/** Admin-only export of real session data for the fixed-vs-adaptive evaluation. */
export async function GET(request: Request) {
  return apiHandler(request, async () => {
    const actor = await getCurrentUser();
    const rows = await getEvaluationRows(prisma, actor);
    const measurements = await getMeasurementRows(prisma, actor);
    return {
      exportedAt: new Date().toISOString(),
      summary: summarize(rows),
      measurementSummary: summarizeMeasurements(measurements),
      latency: await getLatencySummary(prisma, actor),
      sessions: rows,
      measurements,
    };
  });
}
