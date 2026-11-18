import { z } from "zod";
import { createDocument, listDocuments } from "@/server/documents";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ documents: await listDocuments(session.user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

const body = z.object({ title: z.string().max(200).optional() });

export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    const doc = await createDocument(session.user.id, parsed.data.title);
    return Response.json({ document: { id: doc.id } }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
