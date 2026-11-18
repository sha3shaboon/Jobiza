import { normalizeDoi } from "../ingest/text";
import { getJson } from "./http";
import type { DiscoveredRecord, SearchOptions } from "./types";

type Paper = {
  paperId: string;
  title?: string;
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  url?: string;
  citationCount?: number;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; PubMed?: string; ArXiv?: string } | null;
  openAccessPdf?: { url?: string | null } | null;
};

export function parseSemanticScholar(body: { data?: Paper[] }): DiscoveredRecord[] {
  return (body.data ?? []).flatMap((p) => {
    if (!p.title?.trim()) return [];
    return [
      {
        source: "semantic_scholar" as const,
        sourceId: p.paperId,
        title: p.title.trim(),
        authors: (p.authors ?? []).flatMap((a) => (a.name ? [a.name] : [])),
        year: p.year ?? undefined,
        venue: p.venue || undefined,
        abstract: p.abstract ?? undefined,
        doi: p.externalIds?.DOI ? (normalizeDoi(p.externalIds.DOI) ?? undefined) : undefined,
        pmid: p.externalIds?.PubMed ?? undefined,
        arxivId: p.externalIds?.ArXiv ?? undefined,
        url: p.url,
        openAccessPdfUrl: p.openAccessPdf?.url || undefined,
        citationCount: p.citationCount,
      },
    ];
  });
}

export async function searchSemanticScholar(opts: SearchOptions, keys: { apiKey?: string } = {}) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", opts.query);
  url.searchParams.set("limit", String(Math.min(opts.limit, 100)));
  url.searchParams.set("fields", "title,year,venue,abstract,url,citationCount,authors,externalIds,openAccessPdf");
  if (opts.yearFrom || opts.yearTo) url.searchParams.set("year", `${opts.yearFrom ?? ""}-${opts.yearTo ?? ""}`);
  const headers: Record<string, string> = keys.apiKey ? { "x-api-key": keys.apiKey } : {};
  return parseSemanticScholar(await getJson("semantic_scholar", url.toString(), headers));
}
