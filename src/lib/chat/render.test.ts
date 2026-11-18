import { describe, expect, it } from "vitest";
import type { MessageCitation } from "@/db/schema";
import { citationHref, segmentAnswer } from "./render";

const cite = (start: number, end: number, paperId: string, citedText: string, pageNumber = 1): MessageCitation => ({
  start, end, paperId, citedText, pageNumber, paperTitle: paperId, chunkId: "c",
});

describe("segmentAnswer", () => {
  const text = "Yes. Recall dropped a fifth. Emotion mattered most.";
  it("splits text into plain and cited segments with note numbers", () => {
    const { segments, notes } = segmentAnswer(text, [cite(5, 28, "p1", "A"), cite(29, 51, "p2", "B")]);
    expect(segments).toEqual([
      { text: "Yes. ", refs: [] },
      { text: "Recall dropped a fifth.", refs: [1] },
      { text: " ", refs: [] },
      { text: "Emotion mattered most.", refs: [2] },
    ]);
    expect(notes.map((n) => n.n)).toEqual([1, 2]);
  });

  it("reuses a number when the same passage is cited twice, and groups citations on one span", () => {
    const { segments, notes } = segmentAnswer(text, [cite(5, 28, "p1", "A"), cite(5, 28, "p2", "B"), cite(29, 51, "p1", "A")]);
    expect(notes).toHaveLength(2);
    expect(segments[1].refs).toEqual([1, 2]);
    expect(segments[3].refs).toEqual([1]);
  });

  it("returns the whole text when there are no citations", () => {
    expect(segmentAnswer("Plain.", [])).toEqual({ segments: [{ text: "Plain.", refs: [] }], notes: [] });
  });
});

describe("citationHref", () => {
  it("links to the page with the passage to highlight", () => {
    expect(citationHref({ paperId: "abc", pageNumber: 7, citedText: "recall fell" })).toBe("/app/library/abc?page=7&hl=recall+fell");
  });
});
