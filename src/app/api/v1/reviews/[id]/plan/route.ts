import { errorResponse } from "@/server/http";
import { describeApiError, ReviewAiError } from "@/server/review-ai";
import { getReviewDetail, suggestPlan } from "@/server/reviews";
import { apiSession } from "@/server/session";
import Anthropic from "@anthropic-ai/sdk";

/** Claude suggests search queries, criteria and table columns. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const { id } = await ctx.params;
  try {
    await suggestPlan(session.user.id, id);
    return Response.json(await getReviewDetail(session.user.id, id));
  } catch (err) {
    if (err instanceof ReviewAiError || err instanceof Anthropic.APIError) {
      return Response.json({ error: describeApiError(err) }, { status: 400 });
    }
    return errorResponse(err);
  }
}
