import { z } from "zod";
import { deleteConversation, getConversation, updateConversationScope } from "@/server/chat";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ conversation: await getConversation(session.user.id, (await ctx.params).id) });
  } catch (err) {
    return errorResponse(err);
  }
}

const patch = z.object({ scopePaperIds: z.array(z.string().uuid()).max(200) });

/** Change which papers the conversation asks (empty = whole library). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    return Response.json({ conversation: await updateConversationScope(session.user.id, (await ctx.params).id, parsed.data.scopePaperIds) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    await deleteConversation(session.user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
