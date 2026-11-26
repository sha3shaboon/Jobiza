import { connection } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@/lib/auth";
import { env, isDesktop } from "@/lib/env";
import { LOCAL_EMAIL } from "@/server/desktop";

/** Only same-app paths, so the redirect can't leave the app. */
function safeNext(value: string | null) {
  return value && value.startsWith("/app") && !value.startsWith("//") ? value : "/app";
}

/**
 * Desktop app only: signs the window in to the local account. The Electron
 * shell opens this with a secret that changes every launch and is never shown.
 */
export async function GET(req: Request) {
  // Never prerender: whether this is the desktop app is only known at run time.
  await connection();
  if (!isDesktop()) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const given = Buffer.from(url.searchParams.get("token") ?? "");
  const expected = Buffer.from(env().JOBIZA_LAUNCH_TOKEN!);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Forbidden", { status: 403 });

  const next = safeNext(url.searchParams.get("next"));
  const redirect = new Headers({ Location: next, "Cache-Control": "no-store" });

  // Reuse a session that's still valid rather than piling up new ones.
  const current = await auth().api.getSession({ headers: req.headers });
  if (current?.user.email === LOCAL_EMAIL) return new Response(null, { status: 303, headers: redirect });

  const res = await auth().api.signInEmail({
    body: { email: LOCAL_EMAIL, password: env().JOBIZA_LOCAL_PASSWORD!, rememberMe: true },
    asResponse: true,
  });
  if (!res.ok) return new Response("Couldn't open your local library.", { status: 500 });
  for (const cookie of res.headers.getSetCookie()) redirect.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: redirect });
}
