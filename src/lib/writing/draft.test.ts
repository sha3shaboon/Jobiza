import { describe, expect, it } from "vitest";
import type { MessageCitation } from "@/db/schema";
import { answerToNodes } from "./draft";

const c = (start: number, end: number, paperId: string, pageNumber = 3): MessageCitation => ({
  start, end, paperId, pageNumber, paperTitle: paperId, chunkId: "x", citedText: "q", locator: "page",
});

describe("answerToNodes", () => {
  it("places a citation node after each cited span, with the page as locator", () => {
    const text = "Sleep loss cuts recall by a fifth. Emotion matters most.";
    const nodes = answerToNodes(text, [c(0, 33, "A", 7), c(35, 56, "B"), c(35, 56, "A")], (() => { let n = 0; return () => `c${++n}`; })());
    expect(nodes).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Sleep loss cuts recall by a fifth" },
          { type: "citation", attrs: { id: "c1", items: [{ paperId: "A", locator: "7" }] } },
          { type: "text", text: ". Emotion matters most." },
          { type: "citation", attrs: { id: "c2", items: [{ paperId: "B", locator: "3" }, { paperId: "A", locator: "3" }] } },
        ],
      },
    ]);
  });

  it("splits paragraphs on blank lines and turns dash lines into a list", () => {
    const nodes = answerToNodes("Intro line.\n\n- First point\n- Second point\n\nClosing.", [], () => "x");
    expect(nodes.map((n) => n.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
    expect(nodes[1].content).toHaveLength(2);
    expect(nodes[1].content![1].content![0].content![0].text).toBe("Second point");
  });
});
