export type DiscoverySource = "openalex" | "semantic_scholar" | "arxiv" | "pubmed";

export const SOURCE_LABELS: Record<DiscoverySource, string> = {
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
  arxiv: "arXiv",
  pubmed: "PubMed",
};

/** One search hit, normalised across sources. */
export type DiscoveredRecord = {
  source: DiscoverySource;
  sourceId: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  url?: string;
  openAccessPdfUrl?: string;
  citationCount?: number;
};

export type SearchOptions = { query: string; limit: number; yearFrom?: number; yearTo?: number };

export class SourceUnavailableError extends Error {
  constructor(
    public source: DiscoverySource,
    public reason: "rate_limited" | "error",
    message: string,
  ) {
    super(message);
  }
}
