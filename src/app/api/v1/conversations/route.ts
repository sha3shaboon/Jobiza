import { z } from "zod";
import { createConversation, listConversations } from "@/server/chat";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ conversations: await listConversations(session.user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

const body = z.object({ scopePaperIds: z.array(z.string().uuid()).max(200).optional() });

export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    return Response.json({ conversation: await createConversation(session.user.id, parsed.data.scopePaperIds) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
