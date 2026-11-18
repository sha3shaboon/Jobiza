import { toCsv } from "@/lib/review/prisma";
import { errorResponse } from "@/server/http";
import { exportRecords, ownedReview } from "@/server/reviews";
import { apiSession } from "@/server/session";

/** Screening log as CSV: every record with its decision, who made it and why. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const { id } = await ctx.params;
  try {
    const review = await ownedReview(session.user.id, id);
    const csv = toCsv(await exportRecords(session.user.id, id));
    const name = review.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "review";
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name} - screening log.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
