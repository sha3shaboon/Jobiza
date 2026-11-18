import { errorResponse } from "@/server/http";
import { acceptAiSuggestions, getReviewDetail } from "@/server/reviews";
import { apiSession } from "@/server/session";

/** Apply Claude's screening suggestions to every record still undecided. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const { id } = await ctx.params;
  try {
    await acceptAiSuggestions(session.user.id, id);
    return Response.json(await getReviewDetail(session.user.id, id));
  } catch (err) {
    return errorResponse(err);
  }
}
