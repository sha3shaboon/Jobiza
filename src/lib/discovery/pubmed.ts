import { DOMParser } from "linkedom";
import { normalizeDoi } from "../ingest/text";
import { cleanText, getJson, getText } from "./http";
import type { DiscoveredRecord, SearchOptions } from "./types";

type El = Element;

/** Direct children with a tag name (avoids matching nested reference lists). */
function children(el: El | null | undefined, tag: string): El[] {
  return el ? [...el.children].filter((c) => c.tagName.toLowerCase() === tag.toLowerCase()) : [];
}
function child(el: El | null | undefined, ...path: string[]): El | undefined {
  let cur: El | undefined = el ?? undefined;
  for (const tag of path) cur = children(cur, tag)[0];
  return cur;
}

/** Parse efetch XML (journal articles and book chapters). */
export function parsePubmed(xml: string): DiscoveredRecord[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const root = doc.documentElement as unknown as El;
  const out: DiscoveredRecord[] = [];
  for (const item of [...children(root, "PubmedArticle"), ...children(root, "PubmedBookArticle")]) {
    const isBook = item.tagName === "PubmedBookArticle";
    const citation = isBook ? child(item, "BookDocument") : child(item, "MedlineCitation");
    const article = isBook ? citation : child(citation, "Article");
    const pmid = cleanText(child(citation, "PMID")?.textContent);
    const title = cleanText((isBook ? child(article, "ArticleTitle") ?? child(article, "Book", "BookTitle") : child(article, "ArticleTitle"))?.textContent);
    if (!pmid || !title) continue;

    const authorList = isBook ? children(article, "AuthorList")[0] : child(article, "AuthorList");
    const authors = children(authorList, "Author").flatMap((a) => {
      const collective = cleanText(child(a, "CollectiveName")?.textContent);
      const name = [cleanText(child(a, "ForeName")?.textContent), cleanText(child(a, "LastName")?.textContent)].filter(Boolean).join(" ");
      return name ? [name] : collective ? [collective] : [];
    });

    const abstract = children(child(article, "Abstract"), "AbstractText")
      .map((p) => {
        const label = p.getAttribute("Label");
        const body = cleanText(p.textContent);
        return body ? (label ? `${label}: ${body}` : body) : "";
      })
      .filter(Boolean)
      .join("\n");

    const pubDate = isBook ? child(article, "Book", "PubDate") : child(article, "Journal", "JournalIssue", "PubDate");
    const yearText = cleanText(child(pubDate, "Year")?.textContent) ?? cleanText(child(pubDate, "MedlineDate")?.textContent)?.slice(0, 4);
    const venue = isBook ? cleanText(child(article, "Book", "BookTitle")?.textContent) : cleanText(child(article, "Journal", "Title")?.textContent);

    // The article's own identifiers live in PubmedData > ArticleIdList (not in its reference list).
    const idList = isBook ? child(item, "PubmedBookData", "ArticleIdList") : child(item, "PubmedData", "ArticleIdList");
    const id = (type: string) => cleanText(children(idList, "ArticleId").find((x) => x.getAttribute("IdType") === type)?.textContent);
    const elocDoi = children(article, "ELocationID").find((x) => x.getAttribute("EIdType") === "doi")?.textContent;
    const doiRaw = id("doi") ?? elocDoi ?? undefined;
    const pmc = id("pmc");

    out.push({
      source: "pubmed",
      sourceId: pmid,
      title: title.replace(/\.$/, ""),
      authors,
      year: yearText ? Number(yearText) : undefined,
      venue,
      abstract: abstract || undefined,
      doi: doiRaw ? (normalizeDoi(doiRaw) ?? undefined) : undefined,
      pmid,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      openAccessPdfUrl: pmc ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmc}/pdf/` : undefined,
    });
  }
  return out;
}

export async function searchPubmed(opts: SearchOptions, keys: { apiKey?: string } = {}) {
  const term =
    opts.yearFrom || opts.yearTo ? `(${opts.query}) AND ("${opts.yearFrom ?? 1800}"[dp] : "${opts.yearTo ?? 3000}"[dp])` : opts.query;
  const search = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  search.searchParams.set("db", "pubmed");
  search.searchParams.set("term", term);
  search.searchParams.set("retmax", String(Math.min(opts.limit, 100)));
  search.searchParams.set("retmode", "json");
  search.searchParams.set("sort", "relevance");
  if (keys.apiKey) search.searchParams.set("api_key", keys.apiKey);
  const ids = (await getJson<{ esearchresult?: { idlist?: string[] } }>("pubmed", search.toString())).esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const fetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  fetchUrl.searchParams.set("db", "pubmed");
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("retmode", "xml");
  if (keys.apiKey) fetchUrl.searchParams.set("api_key", keys.apiKey);
  const records = parsePubmed(await getText("pubmed", fetchUrl.toString()));
  // efetch doesn't keep relevance order; restore it.
  const rank = new Map(ids.map((id, i) => [id, i]));
  return records.sort((a, b) => (rank.get(a.sourceId) ?? 0) - (rank.get(b.sourceId) ?? 0));
}
