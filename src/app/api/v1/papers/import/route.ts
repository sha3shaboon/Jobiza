import { z } from "zod";
import { errorResponse } from "@/server/http";
import { addImport } from "@/server/library";
import { apiSession } from "@/server/session";

const body = z.object({ input: z.string().min(3).max(2000) });

/** Import by DOI or link: { "input": "10.1038/nature14539" } */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a DOI or a link." }, { status: 400 });
  try {
    return Response.json({ paper: await addImport(session.user.id, parsed.data.input) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
