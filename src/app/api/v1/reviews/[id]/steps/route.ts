import { z } from "zod";
import { errorResponse } from "@/server/http";
import { enqueueReviewStep } from "@/server/queue";
import { getReviewDetail, startStep } from "@/server/reviews";
import { apiSession } from "@/server/session";

const body = z.object({ step: z.enum(["run", "search", "ai-screen", "retrieve", "extract", "synthesize"]) });

/** Queue a review step in the background worker. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown step." }, { status: 400 });
  const { id } = await ctx.params;
  try {
    await startStep(session.user.id, id, parsed.data.step, enqueueReviewStep);
    return Response.json(await getReviewDetail(session.user.id, id), { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
