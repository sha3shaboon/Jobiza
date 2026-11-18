import { parseReferences } from "@/server/citations";
import { errorResponse } from "@/server/http";
import { addReferences } from "@/server/library";
import { apiSession } from "@/server/session";

/** Import a BibTeX (.bib), RIS (.ris) or CSL-JSON (.json) file, field name "file". */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a .bib, .ris or .json file." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return Response.json({ error: "That file is larger than 10 MB." }, { status: 413 });
    let refs;
    try {
      refs = parseReferences(await file.text());
    } catch {
      return Response.json({ error: "Couldn't read that file. Export it from your reference manager as BibTeX, RIS or CSL JSON." }, { status: 400 });
    }
    if (!refs.length) return Response.json({ error: "No references were found in that file." }, { status: 400 });
    return Response.json(await addReferences(session.user.id, refs), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
