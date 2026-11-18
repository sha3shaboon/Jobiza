import type { DiscoveredRecord, DiscoverySource } from "./types";

export type MergedRecord = Omit<DiscoveredRecord, "source" | "sourceId"> & {
  key: string;
  sources: DiscoverySource[];
  sourceIds: Partial<Record<DiscoverySource, string>>;
  /** Best (lowest) rank this record reached in any single result list. */
  bestRank: number;
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** All identifiers a record can be matched by. */
function identities(r: Pick<DiscoveredRecord, "doi" | "pmid" | "arxivId" | "title" | "year">): string[] {
  const ids: string[] = [];
  if (r.doi) ids.push(`doi:${r.doi.toLowerCase()}`);
  if (r.pmid) ids.push(`pmid:${r.pmid}`);
  if (r.arxivId) ids.push(`arxiv:${r.arxivId.toLowerCase().replace(/v\d+$/, "")}`);
  const t = normalizeTitle(r.title);
  if (t.length > 20) ids.push(`title:${t.slice(0, 120)}`);
  return ids;
}

/**
 * Merge results from several sources and queries into unique records.
 * Two hits are the same work when they share a DOI, PMID, arXiv id or
 * normalised title. Fields are filled from whichever source has them.
 * Returns records plus how many duplicates were removed (for PRISMA).
 */
export function mergeRecords(lists: { records: DiscoveredRecord[] }[]): { records: MergedRecord[]; duplicates: number } {
  const byIdentity = new Map<string, MergedRecord>();
  const all: MergedRecord[] = [];
  let duplicates = 0;

  for (const { records } of lists) {
    records.forEach((r, rank) => {
      const ids = identities(r);
      const existing = ids.map((id) => byIdentity.get(id)).find(Boolean);
      if (existing) {
        duplicates++;
        if (!existing.sources.includes(r.source)) existing.sources.push(r.source);
        existing.sourceIds[r.source] ??= r.sourceId;
        existing.bestRank = Math.min(existing.bestRank, rank);
        existing.doi ??= r.doi;
        existing.pmid ??= r.pmid;
        existing.arxivId ??= r.arxivId;
        existing.year ??= r.year;
        existing.venue ??= r.venue;
        existing.url ??= r.url;
        existing.openAccessPdfUrl ??= r.openAccessPdfUrl;
        if ((r.abstract?.length ?? 0) > (existing.abstract?.length ?? 0)) existing.abstract = r.abstract;
        if (r.authors.length > existing.authors.length) existing.authors = r.authors;
        if (r.citationCount !== undefined) existing.citationCount = Math.max(existing.citationCount ?? 0, r.citationCount);
        for (const id of identities(existing)) byIdentity.set(id, existing);
        return;
      }
      const { source, sourceId, ...rest } = r;
      const merged: MergedRecord = { ...rest, key: ids[0] ?? `${source}:${sourceId}`, sources: [source], sourceIds: { [source]: sourceId }, bestRank: rank };
      all.push(merged);
      for (const id of ids) byIdentity.set(id, merged);
    });
  }
  return { records: all, duplicates };
}
