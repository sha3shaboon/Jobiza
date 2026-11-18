import { z } from "zod";
import { errorResponse } from "@/server/http";
import { enqueueReviewStep } from "@/server/queue";
import { createReview, listReviews, startStep } from "@/server/reviews";
import { apiSession } from "@/server/session";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ reviews: await listReviews(session.user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

const body = z.object({ question: z.string().trim().min(10).max(1000), mode: z.enum(["agentic", "screening"]) });

/** Start a review. Agentic reviews begin researching immediately. */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe your research question in at least a short sentence." }, { status: 400 });
  try {
    const review = await createReview(session.user.id, parsed.data);
    if (review.mode === "agentic") await startStep(session.user.id, review.id, "run", enqueueReviewStep);
    return Response.json({ review: { id: review.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
