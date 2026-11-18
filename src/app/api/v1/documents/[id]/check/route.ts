import { aiErrorResponse } from "@/server/ai-http";
import { checkClaims } from "@/server/documents";
import { apiSession } from "@/server/session";

/** Check the saved document's sentences against their sources. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ checks: await checkClaims(session.user.id, (await ctx.params).id), checkedAt: new Date().toISOString() });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
