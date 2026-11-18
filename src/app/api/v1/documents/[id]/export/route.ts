import { citedPaperIds, type DocNode } from "@/lib/writing/doc";
import { citablePapers, ownedDocument } from "@/server/documents";
import { bibtexFor, toDocx, toLatexZip, toMarkdown, toPdf } from "@/server/exports";
import { errorResponse } from "@/server/http";
import { apiSession } from "@/server/session";

const TYPES = {
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  pdf: ["application/pdf", "pdf"],
  latex: ["application/zip", "zip"],
  markdown: ["text/markdown; charset=utf-8", "md"],
  bibtex: ["application/x-bibtex; charset=utf-8", "bib"],
} as const;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { session, error } = await apiSession();
  if (error) return error;
  const format = new URL(req.url).searchParams.get("format") as keyof typeof TYPES;
  if (!(format in TYPES)) return Response.json({ error: "Unknown format." }, { status: 400 });
  try {
    const doc = await ownedDocument(session.user.id, (await ctx.params).id);
    const content = doc.content as DocNode;
    const ids = new Set(citedPaperIds(content));
    const papers = (await citablePapers(session.user.id)).filter((p) => ids.has(p.id));
    const input = { title: doc.title, content, style: doc.citationStyle, papers };
    const body =
      format === "docx" ? await toDocx(input)
      : format === "pdf" ? await toPdf(input)
      : format === "latex" ? await toLatexZip(input)
      : format === "markdown" ? toMarkdown(input)
      : bibtexFor(input);
    const [type, ext] = TYPES[format];
    const name = doc.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 80) || "document";
    return new Response(typeof body === "string" ? body : new Uint8Array(body), {
      headers: {
        "content-type": type,
        "content-disposition": `attachment; filename="${name}${format === "latex" ? " (LaTeX)" : ""}.${ext}"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
