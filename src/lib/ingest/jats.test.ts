import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { europePmcFullTextUrl, parseJats } from "./jats";

describe("parseJats (real Europe PMC response)", () => {
  const article = parseJats(readFileSync(path.join(__dirname, "../discovery/fixtures/europepmc-jats.xml"), "utf8"));

  it("reads the article's own metadata, not its references", () => {
    expect(article.title).toMatch(/^Sleep deprivation in adolescent mice impairs long-term memory/);
    expect(article.authors.length).toBeGreaterThan(0);
    expect(article.abstract?.length).toBeGreaterThan(200);
  });

  it("splits the body into readable sections without the reference list", () => {
    expect(article.sections.length).toBeGreaterThan(2);
    const all = article.sections.join(" ");
    expect(all.length).toBeGreaterThan(5000);
    expect(all).not.toMatch(/The global problem of insufficient sleep and its serious public health implications/);
  });
});

describe("europePmcFullTextUrl", () => {
  it("maps PMC links to the Europe PMC endpoint", () => {
    expect(europePmcFullTextUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC11467059/pdf/")).toBe(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC11467059/fullTextXML",
    );
    expect(europePmcFullTextUrl("https://example.org/paper.pdf")).toBeNull();
  });
});
