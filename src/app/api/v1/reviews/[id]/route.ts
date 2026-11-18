import { z } from "zod";
import { errorResponse } from "@/server/http";
import { deleteReview, getReviewDetail, updateReview } from "@/server/reviews";
import { apiSession } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json(await getReviewDetail(session.user.id, (await ctx.params).id));
  } catch (err) {
    return errorResponse(err);
  }
}

const text = z.string().trim().min(1).max(300);
const patch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  question: z.string().trim().min(10).max(1000).optional(),
  criteria: z
    .object({
      include: z.array(text).max(10),
      exclude: z.array(text).max(10),
      yearFrom: z.number().int().min(1800).max(2100).optional(),
      yearTo: z.number().int().min(1800).max(2100).optional(),
    })
    .optional(),
  queries: z.array(text).max(8).optional(),
  sources: z.array(z.enum(["openalex", "semantic_scholar", "arxiv", "pubmed"])).min(1).optional(),
  matrixColumns: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Some of those settings aren't valid." }, { status: 400 });
  try {
    await updateReview(session.user.id, (await ctx.params).id, parsed.data);
    return Response.json(await getReviewDetail(session.user.id, (await ctx.params).id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    await deleteReview(session.user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
