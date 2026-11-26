import { errorResponse } from "@/server/http";
import { readRecord } from "@/server/reviews";
import { apiSession } from "@/server/session";

/** Add a found paper to the library and fetch its text, so it can be read in the app. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; recordId: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const { id, recordId } = await ctx.params;
  try {
    return Response.json({ record: await readRecord(session.user.id, id, recordId) });
  } catch (err) {
    return errorResponse(err);
  }
}
