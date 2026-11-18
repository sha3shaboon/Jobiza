import { errorResponse } from "@/server/http";
import { deletePaper, getOwnedPaper, toSummary } from "@/server/library";
import { apiSession } from "@/server/session";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    const paper = await getOwnedPaper(session.user.id, (await ctx.params).id);
    return Response.json({ paper: { ...toSummary(paper), abstract: paper.abstract } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    await deletePaper(session.user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
