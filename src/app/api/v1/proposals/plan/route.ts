import { aiErrorResponse } from "@/server/ai-http";
import { BriefSchema, planProposal } from "@/server/proposals";
import { apiSession } from "@/server/session";

/** Claude drafts a proposal outline from a brief. Nothing is saved until the outline is accepted. */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = BriefSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the topic of your proposal." }, { status: 400 });
  try {
    return Response.json(await planProposal(session.user.id, parsed.data));
  } catch (err) {
    return aiErrorResponse(err);
  }
}
