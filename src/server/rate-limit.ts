/**
 * Small in-memory fixed-window limiter. Best-effort only: on serverless platforms each
 * instance keeps its own window. AI generation uses a database-backed limit instead
 * (see src/server/assessment/engine.ts) because it protects a paid resource.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function hitRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}
