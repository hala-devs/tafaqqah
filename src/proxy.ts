import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: redirects visitors without a session cookie away from
 * protected pages. Real authentication and authorization happen server-side in
 * layouts, pages, route handlers and server actions.
 */
const SESSION_COOKIE = "tafaqqah_session";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/admin/login") return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/") ? "/admin/login" : "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/curriculum/:path*",
    "/lessons/:path*",
    "/memorize/:path*",
    "/progress/:path*",
    "/review/:path*",
    "/account/:path*",
    "/admin/:path*",
  ],
};
