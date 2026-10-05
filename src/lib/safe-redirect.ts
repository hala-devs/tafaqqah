/** Only same-origin relative paths are accepted as post-login destinations. */
export function safeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.length > 300) return fallback;
  return value;
}

export function safePortalNextPath(value: unknown, portal: "LEARNER" | "ADMIN"): string {
  const fallback = portal === "ADMIN" ? "/admin" : "/dashboard";
  const path = safeNextPath(value, fallback);
  if (portal === "ADMIN") return path === "/admin" || path.startsWith("/admin/") ? path : fallback;
  return path === "/admin" || path.startsWith("/admin/") ? fallback : path;
}
