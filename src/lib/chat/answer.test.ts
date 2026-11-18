import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildAnswer, searchResultBlocks, shortAuthors, sourceLabel, toSource } from "./answer";

const sources = [
  toSource({
    chunkId: "c1", paperId: "p1", paperTitle: "Sleep and memory", authors: ["Ana Rahman", "Ben Cole", "Chi Diaz"],
    year: 2024, pageNumber: 7, locator: "page",
    text: "Recall fell by 19% after restriction. Effects were larger for emotional words.",
  }),
  toSource({
    chunkId: "c2", paperId: "p2", paperTitle: "Khubbayza", authors: [], year: null, pageNumber: 2, locator: "section",
    text: "Malva parviflora grows after winter rains.",
  }),
];

describe("source formatting", () => {
  it("labels sources with short authors, year and locator", () => {
    expect(shortAuthors(["Ana Rahman", "Ben Cole"])).toBe("Rahman and Cole");
    expect(sourceLabel(sources[0])).toBe("Sleep and memory (Rahman et al., 2024), page 7");
    expect(sourceLabel(sources[1])).toBe("Khubbayza, section 2");
  });

  it("splits passages into one citable block per sentence", () => {
    const [block] = searchResultBlocks(sources);
    expect(block.source).toBe("jobiza://paper/p1#page=7");
    expect(block.content).toHaveLength(2);
    expect(block.citations).toEqual({ enabled: true });
  });
});

describe("buildAnswer", () => {
  it("maps search_result_location citations to character spans and papers", () => {
    const content = [
      { type: "text", text: "Yes. ", citations: null },
      {
        type: "text",
        text: "One night of restricted sleep cut recall by about a fifth",
        citations: [
          { type: "search_result_location", search_result_index: 0, start_block_index: 0, end_block_index: 1,
            cited_text: "Recall fell by 19% after restriction.", source: "jobiza://paper/p1#page=7", title: "x" },
        ],
      },
      { type: "text", text: ".", citations: null },
    ] as unknown as Anthropic.ContentBlock[];
    const out = buildAnswer(content, sources);
    expect(out.text).toBe("Yes. One night of restricted sleep cut recall by about a fifth.");
    expect(out.citations).toEqual([
      { start: 5, end: 62, paperId: "p1", paperTitle: "Sleep and memory", pageNumber: 7, locator: "page", chunkId: "c1", citedText: "Recall fell by 19% after restriction." },
    ]);
    expect(out.text.slice(5, 62)).toBe("One night of restricted sleep cut recall by about a fifth");
  });

  it("ignores thinking blocks and citations to unknown sources", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "Answer", citations: [{ type: "search_result_location", search_result_index: 9, start_block_index: 0, end_block_index: 1, cited_text: "x", source: "", title: "" }] },
    ] as unknown as Anthropic.ContentBlock[];
    expect(buildAnswer(content, sources)).toEqual({ text: "Answer", citations: [] });
  });
});
