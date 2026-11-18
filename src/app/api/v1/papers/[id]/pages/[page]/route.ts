import { errorResponse } from "@/server/http";
import { getPaperPage } from "@/server/library";
import { apiSession } from "@/server/session";

/** Extracted text of one page (or article section). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; page: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const { id, page } = await ctx.params;
  const n = Number(page);
  if (!Number.isInteger(n) || n < 1) return Response.json({ error: "Invalid page." }, { status: 400 });
  try {
    const row = await getPaperPage(session.user.id, id, n);
    if (!row) return Response.json({ error: "Page not found." }, { status: 404 });
    return Response.json({ pageNumber: row.pageNumber, text: row.text, method: row.method });
  } catch (err) {
    return errorResponse(err);
  }
}
