import { describe, expect, it } from "vitest";
import { findHighlightRange } from "./highlight";

describe("findHighlightRange", () => {
  const page = "Results.\nRecall fell by 19 %\nafter re-\nstriction, as shown in Table 2. Other text follows.";
  it("matches across whitespace, line breaks and hyphenation", () => {
    const r = findHighlightRange(page, "Recall fell by 19% after restriction")!;
    expect(page.slice(r.start, r.end)).toBe("Recall fell by 19 %\nafter re-\nstriction");
  });
  it("falls back to the longest matching start", () => {
    const r = findHighlightRange(page, "as shown in Table 2. Other text follows, and the quote continues onto the next page")!;
    expect(page.slice(r.start, r.end)).toContain("as shown in Table 2. Other text f");
  });
  it("returns null when nothing matches", () => {
    expect(findHighlightRange(page, "completely unrelated words")).toBeNull();
  });
});
