import { abstractFromInvertedIndex, normalizeDoi } from "../ingest/text";
import { getJson } from "./http";
import type { DiscoveredRecord, SearchOptions } from "./types";

type Work = {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  best_oa_location?: { pdf_url?: string | null } | null;
  cited_by_count?: number;
};

export function parseOpenAlex(body: { results?: Work[] }): DiscoveredRecord[] {
  return (body.results ?? []).flatMap((w) => {
    const title = (w.title ?? w.display_name)?.trim();
    if (!title) return [];
    return [
      {
        source: "openalex" as const,
        sourceId: w.id.replace("https://openalex.org/", ""),
        title,
        authors: (w.authorships ?? []).flatMap((a) => (a.author?.display_name ? [a.author.display_name] : [])),
        year: w.publication_year ?? undefined,
        venue: w.primary_location?.source?.display_name ?? undefined,
        abstract: abstractFromInvertedIndex(w.abstract_inverted_index) ?? undefined,
        doi: w.doi ? (normalizeDoi(w.doi) ?? undefined) : undefined,
        url: w.primary_location?.landing_page_url ?? w.id,
        openAccessPdfUrl: w.best_oa_location?.pdf_url ?? undefined,
        citationCount: w.cited_by_count,
      },
    ];
  });
}

export async function searchOpenAlex(opts: SearchOptions, keys: { apiKey?: string; mailto?: string } = {}) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", opts.query);
  url.searchParams.set("per-page", String(Math.min(opts.limit, 100)));
  url.searchParams.set(
    "select",
    "id,doi,title,display_name,publication_year,authorships,primary_location,abstract_inverted_index,best_oa_location,cited_by_count",
  );
  const filters = [
    opts.yearFrom ? `from_publication_date:${opts.yearFrom}-01-01` : null,
    opts.yearTo ? `to_publication_date:${opts.yearTo}-12-31` : null,
  ].filter(Boolean);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  if (keys.apiKey) url.searchParams.set("api_key", keys.apiKey);
  if (keys.mailto) url.searchParams.set("mailto", keys.mailto);
  return parseOpenAlex(await getJson("openalex", url.toString()));
}
