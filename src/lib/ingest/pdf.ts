import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { normalizeText } from "./text";

export type ExtractedPdf = {
  pageCount: number;
  pages: { pageNumber: number; text: string }[];
  info: { title?: string; author?: string };
};

/** Text layer of every page, plus the document's own title/author metadata. */
export async function extractPdf(data: Buffer): Promise<ExtractedPdf> {
  const doc = await getDocumentProxy(new Uint8Array(data));
  const [{ totalPages, text }, meta] = await Promise.all([
    extractText(doc, { mergePages: false }),
    getMeta(doc).catch(() => null),
  ]);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  return {
    pageCount: totalPages,
    pages: text.map((t, i) => ({ pageNumber: i + 1, text: normalizeText(t) })),
    info: { title: info.Title?.trim() || undefined, author: info.Author?.trim() || undefined },
  };
}

/** A page with almost no extractable text is probably a scan. */
export function needsOcr(pageText: string): boolean {
  return pageText.replace(/\s+/g, "").length < 40;
}

/** One page as its own small PDF, for sending a scanned page to Claude. */
export async function singlePagePdf(data: Buffer, pageNumber: number): Promise<Buffer> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [pageNumber - 1]);
  out.addPage(page);
  return Buffer.from(await out.save());
}
