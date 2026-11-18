import { describe, expect, it } from "vitest";
import {
  abstractFromInvertedIndex,
  findArxivDoi,
  chunkPages,
  findDoi,
  normalizeDoi,
  normalizeText,
  reciprocalRankFusion,
  splitSentences,
} from "./text";

describe("normalizeText", () => {
  it("re-joins hyphenated words and collapses whitespace", () => {
    expect(normalizeText("con-\nsolidation   of  memory\n\n\n\nnext")).toBe("consolidation of memory\n\nnext");
  });
});

describe("splitSentences", () => {
  it("keeps academic abbreviations and decimals inside sentences", () => {
    const s = splitSentences("Walker et al. found an effect of 0.42 on recall. See Fig. 2 for details. Done!");
    expect(s).toEqual(["Walker et al. found an effect of 0.42 on recall.", "See Fig. 2 for details.", "Done!"]);
  });
  it("handles text without a final full stop", () => {
    expect(splitSentences("One. Two")).toEqual(["One.", "Two"]);
  });
});

describe("chunkPages", () => {
  const sentence = (i: number) => `Sentence number ${i} talks about sleep and memory in some detail.`;
  const long = Array.from({ length: 60 }, (_, i) => sentence(i)).join(" ");

  it("never crosses pages and numbers chunks globally", () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: long },
      { pageNumber: 2, text: long },
    ]);
    expect(chunks.length).toBeGreaterThan(4);
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2]));
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.text.length).toBeLessThan(1400);
  });

  it("overlaps by one sentence between consecutive chunks", () => {
    const [a, b] = chunkPages([{ pageNumber: 1, text: long }]);
    const lastOfA = splitSentences(a.text).at(-1)!;
    expect(b.text.startsWith(lastOfA)).toBe(true);
  });

  it("drops near-empty pages", () => {
    expect(chunkPages([{ pageNumber: 3, text: "  12 " }])).toEqual([]);
  });
});

describe("DOIs", () => {
  it("finds and normalizes DOIs", () => {
    expect(findDoi("Published as https://doi.org/10.1038/Nature14539. Received")).toBe("10.1038/nature14539");
    expect(normalizeDoi("doi: 10.1145/3292500.3330701")).toBe("10.1145/3292500.3330701");
    expect(normalizeDoi("not a doi")).toBeNull();
  });
  it("maps arXiv ids to their DOIs", () => {
    expect(findArxivDoi("arXiv:1706.03762v7 [cs.CL] 2 Aug 2023")).toBe("10.48550/arxiv.1706.03762");
    expect(findArxivDoi("see https://arxiv.org/abs/2005.14165")).toBe("10.48550/arxiv.2005.14165");
    expect(findArxivDoi("no id here")).toBeNull();
  });
});

describe("reciprocalRankFusion", () => {
  it("rewards ids that rank well in several lists", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["c", "a", "d"],
    ]);
    expect(fused[0].id).toBe("a");
    expect(fused.map((f) => f.id)).toContain("d");
  });
});

describe("abstractFromInvertedIndex", () => {
  it("rebuilds word order", () => {
    expect(abstractFromInvertedIndex({ Deep: [0], learning: [1, 3], "and": [2] })).toBe("Deep learning and learning");
    expect(abstractFromInvertedIndex(null)).toBeNull();
  });
});
