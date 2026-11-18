import { z } from "zod";
import { STYLE_FILES } from "@/server/citations";
import { renderForDocument } from "@/server/documents";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";
import type { DocNode } from "@/lib/writing/doc";

const body = z.object({
  style: z.enum(Object.keys(STYLE_FILES) as [string, ...string[]]),
  content: z.object({ type: z.literal("doc") }).passthrough(),
});

/** Format a document's citations and bibliography (used live by the editor). */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    return Response.json(await renderForDocument(session.user.id, parsed.data.content as unknown as DocNode, parsed.data.style));
  } catch (err) {
    return errorResponse(err);
  }
}
