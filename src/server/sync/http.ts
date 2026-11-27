import "server-only";
import { isDesktop } from "@/lib/env";
import { apiSession } from "../session";

/** Sync belongs to the local apps; the server build has accounts instead. */
export async function syncSession() {
  if (!isDesktop()) return { session: null, error: Response.json({ error: "Sync is part of the desktop and Android apps." }, { status: 404 }) } as const;
  return apiSession();
}
