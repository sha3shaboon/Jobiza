import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArxiv } from "./arxiv";
import { mergeRecords } from "./merge";
import { parseOpenAlex } from "./openalex";
import { parsePubmed } from "./pubmed";
import { parseSemanticScholar } from "./semantic-scholar";

describe("PubMed parser (real efetch response)", () => {
  const xml = readFileSync(path.join(__dirname, "fixtures/pubmed-efetch.xml"), "utf8");
  const records = parsePubmed(xml);

  it("reads journal articles and book chapters", () => {
    expect(records.length).toBe(2);
    const article = records.find((r) => r.title.startsWith("Impact of REM sleep deprivation"))!;
    expect(article.authors.length).toBeGreaterThan(0);
    expect(article.year).toBe(2026);
    expect(article.venue).toMatch(/Acta neurobiologiae/i);
    expect(article.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`);
  });

  it("takes identifiers from the article, not from its reference list", () => {
    for (const r of records) {
      expect(r.sourceId).toBe(r.pmid);
      if (r.openAccessPdfUrl) expect(r.openAccessPdfUrl).toMatch(/^https:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/pdf\/$/);
    }
    // The reference list in this fixture contains other PMIDs (e.g. 21190458); none may leak in.
    expect(records.map((r) => r.pmid)).not.toContain("21190458");
  });
});

describe("OpenAlex parser", () => {
  it("normalises works and rebuilds abstracts", () => {
    const [r] = parseOpenAlex({
      results: [
        {
          id: "https://openalex.org/W123",
          doi: "https://doi.org/10.1234/ABC",
          title: "Sleep and memory",
          publication_year: 2020,
          authorships: [{ author: { display_name: "Ana Rahman" } }],
          primary_location: { source: { display_name: "Sleep" }, landing_page_url: "https://x.org/a" },
          abstract_inverted_index: { Sleep: [0], helps: [1] },
          best_oa_location: { pdf_url: "https://x.org/a.pdf" },
          cited_by_count: 42,
        },
      ],
    });
    expect(r).toMatchObject({ source: "openalex", sourceId: "W123", doi: "10.1234/abc", year: 2020, abstract: "Sleep helps", openAccessPdfUrl: "https://x.org/a.pdf", citationCount: 42 });
  });
});

describe("Semantic Scholar parser", () => {
  it("maps external ids", () => {
    const [r] = parseSemanticScholar({
      data: [{ paperId: "abc", title: "Sleep and memory", year: 2020, authors: [{ name: "A" }], externalIds: { DOI: "10.1234/ABC", PubMed: "999" }, openAccessPdf: { url: "" } }],
    });
    expect(r).toMatchObject({ source: "semantic_scholar", doi: "10.1234/abc", pmid: "999", openAccessPdfUrl: undefined });
  });
});

describe("arXiv parser", () => {
  it("reads Atom entries", () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published>
      <title>Attention Is All
        You Need</title><summary> The dominant sequence transduction models… </summary>
      <author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author>
      <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/></entry></feed>`;
    const [r] = parseArxiv(xml);
    expect(r).toMatchObject({
      arxivId: "1706.03762",
      title: "Attention Is All You Need",
      year: 2017,
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      doi: "10.48550/arxiv.1706.03762",
      openAccessPdfUrl: "https://arxiv.org/pdf/1706.03762v7",
    });
  });
});

describe("mergeRecords", () => {
  it("merges the same work across sources and counts duplicates", () => {
    const { records, duplicates } = mergeRecords([
      { records: [{ source: "openalex", sourceId: "W1", title: "Sleep and memory in adolescents: a review", authors: ["A"], doi: "10.1/x", year: 2020 }] },
      {
        records: [
          { source: "pubmed", sourceId: "55", title: "Sleep and memory in adolescents: a review.", authors: ["A", "B"], pmid: "55", abstract: "Longer abstract text." },
          { source: "pubmed", sourceId: "56", title: "Something entirely different about plants", authors: [] },
        ],
      },
      { records: [{ source: "semantic_scholar", sourceId: "s", title: "Other", authors: [], pmid: "55", doi: "10.1/x" }] },
    ]);
    expect(duplicates).toBe(2);
    expect(records).toHaveLength(2);
    const merged = records[0];
    expect(merged.sources).toEqual(["openalex", "pubmed", "semantic_scholar"]);
    expect(merged.pmid).toBe("55");
    expect(merged.abstract).toBe("Longer abstract text.");
    expect(merged.authors).toEqual(["A", "B"]);
  });
});
