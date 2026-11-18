import { describe, expect, it } from "vitest";
import { citedPaperIds, collectCitations, sentencesWithCitations, toBlocks, runsToText, type DocNode } from "./doc";

const cite = (id: string, paperId: string, locator?: string): DocNode => ({ type: "citation", attrs: { id, items: [{ paperId, locator }] } });
const t = (text: string, marks?: string[]): DocNode => ({ type: "text", text, marks: marks?.map((type) => ({ type })) });

const doc: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [t("Background")] },
    {
      type: "paragraph",
      content: [t("Sleep loss impairs recall "), cite("c1", "B", "7"), t(". It is "), t("common", ["italic"]), t(" in teenagers. Transformers rely on attention "), cite("c2", "A"), t(".")],
    },
    { type: "paragraph", content: [t("Insects declined sharply."), cite("c3", "B")] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [t("A listed claim.")] }] }] },
  ],
};

describe("citations", () => {
  it("collects citations in reading order and numbers papers by first use", () => {
    expect(collectCitations(doc).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(citedPaperIds(doc)).toEqual(["B", "A"]);
  });
});

describe("toBlocks", () => {
  it("flattens headings, paragraphs and lists with marks and citations", () => {
    const blocks = toBlocks(doc);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "paragraph", "list"]);
    const para = blocks[1] as { runs: unknown[] };
    expect(para.runs).toContainEqual({ text: "common", bold: undefined, italic: true });
    expect(runsToText((blocks[1] as unknown as { runs: never[] }).runs, (c) => `[${c.id}]`)).toBe(
      "Sleep loss impairs recall [c1]. It is common in teenagers. Transformers rely on attention [c2].",
    );
  });
});

describe("sentencesWithCitations", () => {
  it("attaches citations to their sentences, including ones after the full stop", () => {
    const s = sentencesWithCitations(doc);
    expect(s.map((x) => [x.text, x.citations.map((c) => c.paperId)])).toEqual([
      ["Sleep loss impairs recall.", ["B"]],
      ["It is common in teenagers.", []],
      ["Transformers rely on attention.", ["A"]],
      ["Insects declined sharply.", ["B"]],
      ["A listed claim.", []],
    ]);
    expect(s[0].citations[0].locator).toBe("7");
  });
});
