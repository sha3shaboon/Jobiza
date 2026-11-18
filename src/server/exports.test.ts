import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { toDocx, toPdf, toLatexZip, toMarkdown, bibtexFor, escapeLatex } = await import("./exports");

const papers = [
  { id: "A", title: "Attention is all you need", authors: [{ name: "Ashish Vaswani" }], year: 2017, venue: "arXiv", doi: null, url: null, source: "upload" },
  { id: "B", title: "Insect decline & biomass", authors: [{ name: "Caspar Hallmann" }], year: 2017, venue: "PLoS ONE", doi: "10.1371/journal.pone.0185809", url: null, source: "doi" },
];
const content = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Findings" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Insects fell by 75% " },
        { type: "citation", attrs: { id: "c1", items: [{ paperId: "B", locator: "3" }] } },
        { type: "text", text: ". Attention is " },
        { type: "text", text: "all", marks: [{ type: "italic" }] },
        { type: "text", text: " you need" },
        { type: "citation", attrs: { id: "c2", items: [{ paperId: "A" }] } },
        { type: "text", text: "." },
      ],
    },
    { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Point one" }] }] }] },
  ],
};
const input = { title: "My review", content, style: "apa", papers };

describe("exports", () => {
  it("Markdown has labels and references", () => {
    const md = toMarkdown(input);
    expect(md).toContain("Insects fell by 75% (Hallmann, 2017, p. 3). Attention is *all* you need (Vaswani, 2017).");
    expect(md).toContain("## References");
    expect(md).toContain("1. Point one");
  });

  it("Word document contains the text, labels and bibliography", async () => {
    const zip = await JSZip.loadAsync(await toDocx(input));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("(Hallmann, 2017, p. 3)");
    expect(xml).toContain("References");
    expect(xml).toContain("Insect decline &amp; biomass");
  });

  it("PDF renders", async () => {
    const pdf = await toPdf(input);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("LaTeX zip has biblatex citations, escaped text and a .bib", async () => {
    const zip = await JSZip.loadAsync(await toLatexZip(input));
    const tex = await zip.file("main.tex")!.async("string");
    const bib = await zip.file("references.bib")!.async("string");
    expect(tex).toContain("Insects fell by 75\\% \\autocite[p.~3]{Hallmann2017insect}");
    expect(tex).toContain("\\emph{all}");
    expect(tex).toContain("\\usepackage[style=apa,backend=biber]{biblatex}");
    expect(tex).toContain("\\begin{enumerate}");
    expect(bib).toContain("@article{Hallmann2017insect,");
    expect(bibtexFor(input)).toContain("Vaswani2017attention");
  });

  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("50% of $x_1 & {y}#~^\\")).toBe("50\\% of \\$x\\_1 \\& \\{y\\}\\#\\textasciitilde{}\\textasciicircum{}\\textbackslash{}");
  });
});
