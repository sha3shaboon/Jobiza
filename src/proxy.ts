import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only (cookie presence). Every page and API route still
 * verifies the session against the database.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*"] };
