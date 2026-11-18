import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** Works for cookie sessions (web) and `Authorization: Bearer` (future native clients). */
export async function getSession() {
  // Read request headers first: this marks the route dynamic before any env/DB access.
  const h = await headers();
  return auth().api.getSession({ headers: h });
}

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/sign-in");
  return s;
}

/** For API routes: returns the session or a 401 response. */
export async function apiSession() {
  const s = await getSession();
  if (!s) return { session: null, error: Response.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { session: s, error: null } as const;
}
