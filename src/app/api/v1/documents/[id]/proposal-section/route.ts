import { z } from "zod";
import { aiErrorResponse } from "@/server/ai-http";
import { draftProposalSection } from "@/server/proposals";
import { apiSession } from "@/server/session";

const body = z.object({
  sectionId: z.string().min(1).max(64),
  /** Plain text of the sections already written, so the new one stays consistent. */
  priorText: z.string().max(20000).optional(),
  /** Optional request for this version ("shorter", "focus on qualitative methods"). */
  note: z.string().trim().max(500).optional(),
});

/** Claude writes one section of a proposal; returns editor nodes with citations. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a section to write." }, { status: 400 });
  try {
    const { sectionId, ...opts } = parsed.data;
    return Response.json(await draftProposalSection(session.user.id, (await ctx.params).id, sectionId, opts));
  } catch (err) {
    return aiErrorResponse(err);
  }
}
