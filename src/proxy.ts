import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only (cookie presence). Every page and API route still
 * verifies the session against the database.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The desktop app has no landing page or sign-in: it opens straight into the library.
  // Sign-in pages still render (a stale cookie could otherwise loop); the desktop shell
  // catches any navigation to them and signs the window in again.
  if (process.env.JOBIZA_DESKTOP === "1" && pathname === "/") return NextResponse.redirect(new URL("/app", request.url));
  if (pathname === "/") return NextResponse.next();
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/app/:path*"] };
