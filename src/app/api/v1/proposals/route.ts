import { z } from "zod";
import { errorResponse } from "@/server/http";
import { createProposal, PlanSchema } from "@/server/proposals";
import { apiSession } from "@/server/session";

const body = z.object({ title: z.string().trim().max(200), plan: PlanSchema });

/** Create a proposal document from an accepted outline: every section heading, ready to write. */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The outline needs at least one section with a heading." }, { status: 400 });
  try {
    const doc = await createProposal(session.user.id, parsed.data.title, parsed.data.plan);
    return Response.json({ document: { id: doc.id, title: doc.title } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
