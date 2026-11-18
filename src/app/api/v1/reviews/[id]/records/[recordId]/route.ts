import { z } from "zod";
import { errorResponse } from "@/server/http";
import { decideRecord } from "@/server/reviews";
import { apiSession } from "@/server/session";

const body = z.object({ screening: z.enum(["included", "excluded", "pending"]), reason: z.string().max(200).optional() });

/** Record the reviewer's screening decision. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; recordId: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid decision." }, { status: 400 });
  const { id, recordId } = await ctx.params;
  try {
    return Response.json({ record: await decideRecord(session.user.id, id, recordId, parsed.data.screening, parsed.data.reason) });
  } catch (err) {
    return errorResponse(err);
  }
}
