import { connection } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pglite } from "@/db";
import { env, isDesktop } from "@/lib/env";

/**
 * Local apps only: write everything to disk now. Android calls this when the app
 * goes to the background, since it may then stop the app without warning.
 */
export async function POST(req: Request) {
  await connection();
  if (!isDesktop()) return new Response("Not found", { status: 404 });
  const given = Buffer.from(req.headers.get("x-jobiza-launch-token") ?? "");
  const expected = Buffer.from(env().JOBIZA_LAUNCH_TOKEN!);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Forbidden", { status: 403 });
  await pglite()?.exec("CHECKPOINT");
  return new Response(null, { status: 204 });
}
