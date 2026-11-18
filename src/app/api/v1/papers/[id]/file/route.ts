import { loadFile } from "@/lib/ingest/storage";
import { errorResponse } from "@/server/http";
import { getOwnedPaper } from "@/server/library";
import { apiSession } from "@/server/session";

/** The paper's PDF, for the in-app viewer. Only for members of the paper's workspace. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    const paper = await getOwnedPaper(session.user.id, (await ctx.params).id);
    if (!paper.fileKey) return Response.json({ error: "This source has no PDF." }, { status: 404 });
    const data = await loadFile(paper.fileKey);
    const name = `${(paper.fileName ?? paper.title).replace(/[^\w\- ]+/g, "").slice(0, 80) || "paper"}.pdf`;
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${name}"`,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
