import { z } from "zod";
import { errorResponse } from "@/server/http";
import { addReferences } from "@/server/library";
import { apiSession } from "@/server/session";
import { fetchZoteroLibrary } from "@/server/zotero";

const body = z.object({
  libraryType: z.enum(["user", "group"]),
  libraryId: z.string().trim().max(12),
  apiKey: z.string().trim().min(10).max(100),
  collectionKey: z.string().trim().max(8).optional(),
});

/** Import a Zotero library or collection. The API key is used once and not stored. */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your Zotero ID and API key." }, { status: 400 });
  try {
    const refs = await fetchZoteroLibrary({ ...parsed.data, collectionKey: parsed.data.collectionKey || undefined });
    if (!refs.length) return Response.json({ error: "That Zotero library has no items." }, { status: 400 });
    return Response.json(await addReferences(session.user.id, refs), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
