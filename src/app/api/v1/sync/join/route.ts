import { z } from "zod";
import { errorResponse } from "@/server/http";
import { joinWithOffer, PairingError } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

const body = z.object({ code: z.string().trim().min(10).max(4000) });

/** Pair with another device using its invitation. */
export async function POST(req: Request) {
  const { error } = await syncSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste the pairing code from the other device." }, { status: 400 });
  try {
    return Response.json(await joinWithOffer(parsed.data.code));
  } catch (err) {
    if (err instanceof PairingError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
