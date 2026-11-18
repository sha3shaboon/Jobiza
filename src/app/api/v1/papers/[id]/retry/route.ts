import { errorResponse } from "@/server/http";
import { retryPaper } from "@/server/library";
import { apiSession } from "@/server/session";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ paper: await retryPaper(session.user.id, (await ctx.params).id) });
  } catch (err) {
    return errorResponse(err);
  }
}
