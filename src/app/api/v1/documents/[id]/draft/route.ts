import { z } from "zod";
import { aiErrorResponse } from "@/server/ai-http";
import { draftWithClaude } from "@/server/documents";
import { apiSession } from "@/server/session";

const body = z.object({ instruction: z.string().trim().min(5).max(2000), scopePaperIds: z.array(z.string().uuid()).max(200).optional() });

/** Claude drafts text from the library; returns editor nodes with citations. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe what to write." }, { status: 400 });
  try {
    return Response.json(await draftWithClaude(session.user.id, (await ctx.params).id, parsed.data.instruction, parsed.data.scopePaperIds));
  } catch (err) {
    return aiErrorResponse(err);
  }
}
