import { z } from "zod";
import { errorResponse } from "@/server/http";
import { createOffer } from "@/server/sync/engine";
import { syncSession } from "@/server/sync/http";

const body = z.object({ shareApiKey: z.boolean().default(false) });

/** A one-time pairing invitation (shown as a QR code and as text). */
export async function POST(req: Request) {
  const { error } = await syncSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    return Response.json(await createOffer(parsed.data.shareApiKey), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
