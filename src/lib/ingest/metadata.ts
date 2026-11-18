import { env } from "../env";
import { abstractFromInvertedIndex } from "./text";

export type PaperMetadata = {
  title?: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
  abstract?: string;
  /** A legal open-access PDF, when OpenAlex (Unpaywall data) knows one. */
  openAccessPdfUrl?: string;
  landingUrl?: string;
};

const TIMEOUT = 15_000;

function withContact(url: URL) {
  const email = env().CONTACT_EMAIL;
  if (email) url.searchParams.set("mailto", email);
  return url;
}

type OpenAlexWork = {
  title?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string }; landing_page_url?: string };
  abstract_inverted_index?: Record<string, number[]>;
  best_oa_location?: { pdf_url?: string | null } | null;
  open_access?: { oa_url?: string | null };
};

async function fromOpenAlex(doi: string): Promise<PaperMetadata | null> {
  const url = withContact(new URL(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`));
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const w = (await res.json()) as OpenAlexWork;
  const pdf = w.best_oa_location?.pdf_url ?? (w.open_access?.oa_url?.toLowerCase().endsWith(".pdf") ? w.open_access.oa_url : null);
  return {
    title: w.title ?? undefined,
    authors: (w.authorships ?? []).flatMap((a) => (a.author?.display_name ? [{ name: a.author.display_name }] : [])),
    year: w.publication_year ?? undefined,
    venue: w.primary_location?.source?.display_name ?? undefined,
    abstract: abstractFromInvertedIndex(w.abstract_inverted_index) ?? undefined,
    openAccessPdfUrl: pdf ?? undefined,
    landingUrl: w.primary_location?.landing_page_url ?? undefined,
  };
}

type CrossrefWork = {
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  abstract?: string;
  URL?: string;
};

async function fromCrossref(doi: string): Promise<PaperMetadata | null> {
  const url = withContact(new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`));
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const w = ((await res.json()) as { message: CrossrefWork }).message;
  return {
    title: w.title?.[0],
    authors: (w.author ?? []).map((a) => ({ name: a.name ?? [a.given, a.family].filter(Boolean).join(" ") })),
    year: w.issued?.["date-parts"]?.[0]?.[0],
    venue: w["container-title"]?.[0],
    abstract: w.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    landingUrl: w.URL,
  };
}

/** Best-effort metadata for a DOI: OpenAlex first, Crossref to fill gaps. Never throws. */
export async function lookupDoi(doi: string): Promise<PaperMetadata | null> {
  const [oa, cr] = await Promise.all([fromOpenAlex(doi).catch(() => null), fromCrossref(doi).catch(() => null)]);
  if (!oa && !cr) return null;
  return {
    title: oa?.title ?? cr?.title,
    authors: oa?.authors?.length ? oa.authors : cr?.authors,
    year: oa?.year ?? cr?.year,
    venue: oa?.venue ?? cr?.venue,
    abstract: oa?.abstract ?? cr?.abstract,
    openAccessPdfUrl: oa?.openAccessPdfUrl,
    landingUrl: oa?.landingUrl ?? cr?.landingUrl,
  };
}
