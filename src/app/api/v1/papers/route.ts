import { errorResponse } from "@/server/http";
import { addUpload, listPapers, MAX_UPLOAD_BYTES } from "@/server/library";
import { apiSession } from "@/server/session";

export async function GET() {
  const { session, error } = await apiSession();
  if (error) return error;
  try {
    return Response.json({ papers: await listPapers(session.user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Upload a PDF as multipart form data, field name "file". */
export async function POST(req: Request) {
  const { session, error } = await apiSession();
  if (error) return error;
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return Response.json({ error: "That file is larger than 50 MB." }, { status: 413 });
  }
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a PDF to upload." }, { status: 400 });
    const paper = await addUpload(session.user.id, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ paper }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
