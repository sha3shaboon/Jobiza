import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { renderCitations, toBibtex, parseReferences, splitName, sanitizeBibHtml } = await import("./citations");

const papers = [
  { id: "A", title: "Attention is all you need", authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }], year: 2017, venue: "arXiv", doi: "10.48550/arxiv.1706.03762", url: null, source: "upload" },
  { id: "B", title: "Insect decline", authors: [{ name: "Caspar A. Hallmann" }], year: 2017, venue: "PLoS ONE", doi: null, url: null, source: "doi" },
  { id: "C", title: "Another insect study", authors: [{ name: "Caspar A. Hallmann" }], year: 2017, venue: null, doi: null, url: null, source: "doi" },
];
const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "First " },
        { type: "citation", attrs: { id: "c1", items: [{ paperId: "B" }] } },
        { type: "text", text: " then " },
        { type: "citation", attrs: { id: "c2", items: [{ paperId: "A", locator: "7" }] } },
        { type: "citation", attrs: { id: "c3", items: [{ paperId: "C" }, { paperId: "missing" }] } },
      ],
    },
  ],
};

describe("renderCitations", () => {
  it("numbers by first use in numeric styles", () => {
    const r = renderCitations(doc, "ieee", papers);
    expect(r.labels).toEqual({ c1: "[1]", c2: "[2, p. 7]", c3: "[3]" });
    expect(r.bibliography).toHaveLength(3);
    expect(r.bibliography[0].text).toMatch(/^\[1\]\s*C\. A\. Hallmann/);
  });

  it("disambiguates author-date styles and ignores papers that no longer exist", () => {
    const r = renderCitations(doc, "apa", papers);
    expect(r.labels.c2).toBe("(Vaswani & Shazeer, 2017, p. 7)");
    expect(r.labels.c1).toMatch(/^\(Hallmann, 2017[ab]\)$/);
    expect(r.labels.c3).toMatch(/^\(Hallmann, 2017[ab]\)$/);
    expect(r.labels.c1).not.toBe(r.labels.c3);
    expect(r.bibliography.map((b) => b.text).join("\n")).toContain("https://doi.org/10.48550/arxiv.1706.03762");
  });

  it("renders every bundled style", () => {
    for (const style of ["apa", "modern-language-association", "chicago-author-date", "ieee", "vancouver", "harvard-cite-them-right"]) {
      const r = renderCitations(doc, style, papers);
      expect(Object.keys(r.labels), style).toHaveLength(3);
      expect(r.bibliography.length, style).toBe(3);
    }
  });
});

describe("BibTeX", () => {
  it("exports with stable unique keys", () => {
    const { bibtex, keys } = toBibtex(papers);
    expect(keys.get("A")).toBe("Vaswani2017attention");
    expect(keys.get("B")).toBe("Hallmann2017insect");
    expect(keys.get("C")).toBe("Hallmann2017another");
    expect(bibtex).toContain("@article{Vaswani2017attention,");
  });

  it("imports BibTeX, RIS and CSL-JSON", () => {
    const bib = parseReferences(`@article{x, title={Sleep and memory}, author={Rahman, Ana and Cole, Ben}, year={2024}, journal={Sleep}, doi={10.1234/ABC}}`);
    expect(bib).toEqual([{ title: "Sleep and memory", authors: [{ name: "Ana Rahman" }, { name: "Ben Cole" }], year: 2024, venue: "Sleep", doi: "10.1234/abc", url: undefined, abstract: undefined }]);
    const ris = parseReferences("TY  - JOUR\nTI  - Insect decline\nAU  - Hallmann, Caspar\nPY  - 2017\nDO  - 10.1371/journal.pone.0185809\nER  - \n");
    expect(ris[0]).toMatchObject({ title: "Insect decline", year: 2017, doi: "10.1371/journal.pone.0185809" });
    const csl = parseReferences(JSON.stringify([{ title: "From Zotero", author: [{ family: "Doe", given: "J." }], issued: { "date-parts": [[2020]] } }]));
    expect(csl[0]).toMatchObject({ title: "From Zotero", authors: [{ name: "J. Doe" }], year: 2020 });
  });
});

describe("helpers", () => {
  it("splits names and keeps organisations whole", () => {
    expect(splitName("Caspar A. Hallmann")).toEqual({ family: "Hallmann", given: "Caspar A." });
    expect(splitName("Hallmann, Caspar")).toEqual({ family: "Hallmann", given: "Caspar" });
    expect(splitName("Wikimedia Foundation Inc.")).toEqual({ literal: "Wikimedia Foundation Inc." });
  });

  it("strips anything but formatting tags from bibliography HTML", () => {
    expect(sanitizeBibHtml('<div class="csl-entry" onclick="x">A <i>t</i><script>alert(1)</script><img src=x onerror=y></div>')).toBe(
      '<div class="csl-entry">A <i>t</i>alert(1)</div>',
    );
  });
});
