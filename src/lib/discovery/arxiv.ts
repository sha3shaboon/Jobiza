import { DOMParser } from "linkedom";
import { normalizeDoi } from "../ingest/text";
import { cleanText, getText } from "./http";
import type { DiscoveredRecord, SearchOptions } from "./types";

/** Parse the arXiv Atom feed. */
export function parseArxiv(xml: string): DiscoveredRecord[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  return [...doc.getElementsByTagName("entry")].flatMap((entry) => {
    const text = (tag: string) => cleanText(entry.getElementsByTagName(tag)[0]?.textContent);
    const idUrl = text("id");
    const title = text("title");
    if (!idUrl || !title) return [];
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    const links = [...entry.getElementsByTagName("link")];
    const pdf = links.find((l) => l.getAttribute("title") === "pdf")?.getAttribute("href") ?? undefined;
    const doi = text("arxiv:doi");
    const published = text("published");
    return [
      {
        source: "arxiv" as const,
        sourceId: arxivId,
        title,
        authors: [...entry.getElementsByTagName("author")].flatMap((a) => {
          const n = cleanText(a.getElementsByTagName("name")[0]?.textContent);
          return n ? [n] : [];
        }),
        year: published ? Number(published.slice(0, 4)) : undefined,
        venue: "arXiv",
        abstract: text("summary"),
        doi: (doi && normalizeDoi(doi)) || `10.48550/arxiv.${arxivId.toLowerCase()}`,
        arxivId,
        url: `https://arxiv.org/abs/${arxivId}`,
        openAccessPdfUrl: pdf?.replace(/^http:/, "https:"),
      },
    ];
  });
}

export async function searchArxiv(opts: SearchOptions) {
  const terms = opts.query
    .replace(/["()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .slice(0, 12)
    .map((t) => `all:${t}`);
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", terms.join(" AND "));
  url.searchParams.set("max_results", String(Math.min(opts.limit, 100)));
  url.searchParams.set("sortBy", "relevance");
  const records = parseArxiv(await getText("arxiv", url.toString()));
  return records.filter((r) => (!opts.yearFrom || (r.year ?? 0) >= opts.yearFrom) && (!opts.yearTo || (r.year ?? 9999) <= opts.yearTo));
}
