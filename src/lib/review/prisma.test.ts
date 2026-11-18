import { describe, expect, it } from "vitest";
import { prismaFlow, toCsv, type PrismaRecord } from "./prisma";

const rec = (screening: PrismaRecord["screening"], fullText: PrismaRecord["fullText"] = "not_requested", exclusionReason: string | null = null): PrismaRecord => ({ screening, fullText, exclusionReason });

describe("prismaFlow", () => {
  it("counts each PRISMA stage", () => {
    const flow = prismaFlow(
      { identified: { pubmed: 30, openalex: 50 }, duplicates: 20, unavailable: [] },
      [
        rec("excluded", "not_requested", "Wrong population"),
        rec("excluded", "not_requested", "Wrong population"),
        rec("excluded", "not_requested", "Not empirical"),
        rec("pending"),
        rec("included", "retrieved"),
        rec("included", "abstract_only"),
        rec("included", "failed"),
        rec("included", "not_requested"),
      ],
    );
    expect(flow).toMatchObject({
      identifiedTotal: 80,
      duplicatesRemoved: 20,
      screened: 7,
      awaitingScreening: 1,
      excludedAtScreening: 3,
      soughtForRetrieval: 3,
      notRetrieved: 1,
      abstractOnly: 1,
      includedInReview: 2,
    });
    expect(flow.identified[0]).toEqual({ source: "openalex", count: 50 });
    expect(flow.exclusionReasons[0]).toEqual({ reason: "Wrong population", count: 2 });
  });
});

describe("toCsv", () => {
  it("quotes and neutralises formula injection", () => {
    const csv = toCsv([{ title: 'A "quoted", title', note: "=HYPERLINK(1)", n: 3 }]);
    expect(csv).toBe('title,note,n\r\n"A ""quoted"", title",\'=HYPERLINK(1),3\r\n');
  });
});
