import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetch } from "../net/safe-fetch";
import { looksLikePdf } from "./storage";
import { findDoi, normalizeDoi, normalizeText } from "./text";

export type FetchedSource =
  | { kind: "pdf"; data: Buffer; url: string }
  | {
      kind: "article";
      url: string;
      title: string;
      byline?: string;
      siteName?: string;
      doi?: string;
      /** Article text split into sections of roughly a page each. */
      sections: string[];
    };

/** Fetch a user-supplied link. PDFs come back as-is; web pages as readable article text. */
export async function fetchSource(rawUrl: string): Promise<FetchedSource> {
  const res = await safeFetch(rawUrl, { accept: "application/pdf,text/html;q=0.9,*/*;q=0.5" });
  if (res.contentType.includes("pdf") || looksLikePdf(res.body)) return { kind: "pdf", data: res.body, url: res.url };
  if (!res.contentType.includes("html")) throw new Error("That link isn't a web page or a PDF.");

  const { document } = parseHTML(res.body.toString("utf8"));
  const meta = (name: string) =>
    document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ??
    document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ??
    undefined;

  // Scholarly pages (journals, arXiv) advertise their PDF; prefer the real paper.
  const pdfUrl = meta("citation_pdf_url");
  if (pdfUrl) {
    try {
      const pdf = await safeFetch(new URL(pdfUrl, res.url).toString(), { accept: "application/pdf" });
      if (looksLikePdf(pdf.body)) return { kind: "pdf", data: pdf.body, url: pdf.url };
    } catch {
      // fall back to the article text
    }
  }

  const article = new Readability(document as unknown as Document).parse();
  const text = normalizeText(article?.textContent ?? "");
  if (text.length < 200) throw new Error("Couldn't find readable article text on that page.");
  const doiMeta = meta("citation_doi") ?? meta("dc.identifier");
  return {
    kind: "article",
    url: res.url,
    title: (meta("citation_title") ?? article?.title ?? res.url).trim(),
    byline: meta("citation_author") ?? article?.byline ?? undefined,
    siteName: meta("og:site_name") ?? article?.siteName ?? undefined,
    doi: (doiMeta && normalizeDoi(doiMeta)) || findDoi(text.slice(0, 3000)) || undefined,
    sections: splitIntoSections(text),
  };
}

/** Group paragraphs into ~3,000-character sections so citations can point somewhere specific. */
export function splitIntoSections(text: string, size = 3000): string[] {
  const sections: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length > size) {
      sections.push(current.trim());
      current = "";
    }
    current += para + "\n\n";
  }
  if (current.trim()) sections.push(current.trim());
  return sections;
}
